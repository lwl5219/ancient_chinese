# -*- coding: utf-8 -*-
"""把 sources/poetry 里的简体注释转成 data/poetry-notes.json。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import opencc

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "sources" / "poetry"
S2T = opencc.OpenCC("s2t")
KEEP = {"years", "author", "stanzas"}

CREDIT = (
    "赏析、注释、背景和白话是本书编写的。"
    "史实依据两《唐书》《宋史》和常见文学史里的公共记载；"
    "词的小序只撮述时间和事由，不整段移录。"
    "不转录现代赏析网站的原文。"
    "正文用字来自 chinese-poetry 所选底本，和今天的课本不一定相同。"
)


def convert(value, key=None):
    if isinstance(value, str):
        if key in KEEP:
            return value
        return {"s": value, "t": S2T.convert(value)}
    if isinstance(value, list):
        return [convert(item) for item in value]
    if isinstance(value, dict):
        out = {}
        for item_key, item in value.items():
            if item_key in KEEP:
                out[item_key] = item
            else:
                out[item_key] = convert(item, item_key)
        return out
    return value


def clauses(piece: dict) -> list[str]:
    rows = []
    for line in piece["lines"]:
        buf = ""
        for tok in line["tokens"]:
            buf += tok.get("s") or tok["t"]
            if tok.get("punct") and tok["t"] in "，。！？；":
                rows.append(buf)
                buf = ""
        if buf:
            rows.append(buf)
    return rows


def main() -> None:
    authors = json.loads((SRC / "authors.json").read_text(encoding="utf-8"))
    pieces = {}
    pieces.update(json.loads((SRC / "tang_notes.json").read_text(encoding="utf-8")))
    pieces.update(json.loads((SRC / "ci_notes.json").read_text(encoding="utf-8")))
    tang = json.loads((ROOT / "data" / "tang.json").read_text(encoding="utf-8"))
    ci = json.loads((ROOT / "data" / "songci.json").read_text(encoding="utf-8"))
    missing = []
    for book in (tang, ci):
        for piece in book["pieces"]:
            note = pieces.get(piece["id"])
            if not note:
                missing.append(piece["id"])
                continue
            if note["author"] not in authors:
                raise SystemExit("%s 的作者不在作者表里：%s" % (piece["id"], note["author"]))
            got = clauses(piece)
            if len(note["vernacular"]) != len(got):
                raise SystemExit(
                    "%s 白话 %d 句，正文 %d 句" % (piece["id"], len(note["vernacular"]), len(got))
                )
            if note.get("stanzas"):
                if sum(note["stanzas"]) != len(piece["lines"]):
                    raise SystemExit(
                        "%s 阕的段数 %s 对不上 %d 段"
                        % (piece["id"], note["stanzas"], len(piece["lines"]))
                    )
            if not note.get("analysis") or not note.get("background") or not note.get("notes"):
                raise SystemExit("%s 缺少赏析、背景或注释" % piece["id"])
    extra = [key for key in pieces if key not in {item["id"] for book in (tang, ci) for item in book["pieces"]}]
    if missing or extra:
        raise SystemExit("篇目对不上，缺 %s，多 %s" % (missing, extra))
    data = {
        "credit": CREDIT,
        "authors": authors,
        "pieces": pieces,
    }
    out = ROOT / "data" / "poetry-notes.json"
    out.write_text(json.dumps(convert(data), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote %s (%d)" % (out.name, len(pieces)))


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    main()
