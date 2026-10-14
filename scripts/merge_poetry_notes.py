# -*- coding: utf-8 -*-
"""把 sources/poetry/notes/*.json 并进 data/poetry-notes.json。

每批是 {id: {author, form, notes, vernacular, analysis, background, review}}。
白话用简体写，这里再转一份繁体。条数必须和正文行数一致。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import opencc

ROOT = Path(__file__).resolve().parents[1]
NOTES = ROOT / "data" / "poetry-notes.json"
BATCH = ROOT / "sources" / "poetry" / "notes"
S2T = opencc.OpenCC("s2t")


def bi(text: str) -> dict:
    return {"s": text, "t": S2T.convert(text)}


def main() -> int:
    notes = json.loads(NOTES.read_text(encoding="utf-8"))
    tang = json.loads((ROOT / "data" / "tang.json").read_text(encoding="utf-8"))
    ci = json.loads((ROOT / "data" / "songci.json").read_text(encoding="utf-8"))
    lines = {}
    for piece in tang["pieces"] + ci["pieces"]:
        lines[piece["id"]] = len(piece["lines"])
    added = 0
    bad = []
    for path in sorted(BATCH.glob("*.json")):
        batch = json.loads(path.read_text(encoding="utf-8"))
        for pid, item in batch.items():
            if pid not in lines:
                bad.append("%s 不在目录里" % pid)
                continue
            vern = item.get("vernacular") or []
            if len(vern) != lines[pid]:
                bad.append("%s 译文 %d 行，正文 %d 行" % (pid, len(vern), lines[pid]))
                continue
            if pid in notes["pieces"]:
                continue
            glosses = []
            for note in item.get("notes") or []:
                glosses.append({"term": bi(note["term"]), "gloss": bi(note["gloss"])})
            notes["pieces"][pid] = {
                "author": item.get("author") or "",
                "form": bi(item.get("form") or ""),
                "notes": glosses,
                "vernacular": [bi(line) for line in vern],
                "analysis": bi(item.get("analysis") or ""),
                "background": bi(item.get("background") or ""),
                "review": bool(item.get("review")),
            }
            added += 1
    if bad:
        print("\n".join(bad[:30]))
        print("问题", len(bad))
        return 1
    NOTES.write_text(json.dumps(notes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("added", added, "pieces", len(notes["pieces"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
