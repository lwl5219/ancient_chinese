# -*- coding: utf-8 -*-
"""把 sources/sanzijing/text.txt 编成 data/sanzijing.json。

格式：
    # 章节标题
    原文一行
    > 这一行的白话
    # 未完成的章节
    ! 说明
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import opencc
from pypinyin import Style, pinyin

from hanzi import is_han

SRC = ROOT / "sources" / "sanzijing" / "text.txt"
OUT = ROOT / "data" / "sanzijing.json"
T2S = opencc.OpenCC("t2s")


def reading(text: str) -> str:
    parts = []
    chars = list(text)
    for i, ch in enumerate(chars):
        if not is_han(ch):
            continue
        prev = chars[i - 1] if i else ""
        nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if ch == "弟" and prev == "孝":
            py = "tì"
        elif ch == "長" and prev == "於":
            py = "zhǎng"
        elif ch == "少" and nxt == "時":
            py = "shào"
        elif ch == "處":
            py = "chǔ"
        elif ch in ("爲", "為"):
            py = "wéi"
        elif ch == "燕":
            py = "Yān"
        elif ch == "教":
            py = "jiào"
        elif ch == "子":
            py = "zǐ"
        elif ch == "琢":
            py = "zhuó"
        else:
            got = pinyin(ch, style=Style.TONE, errors="ignore")
            py = got[0][0] if got and got[0] else ""
        parts.append(py)
    return " ".join(parts)


def tokens_for(trad: str, gloss: str) -> list[dict]:
    tokens = []
    buf = ""

    def flush() -> None:
        nonlocal buf
        if not buf:
            return
        tokens.append(
            {
                "t": buf,
                "s": T2S.convert(buf),
                "py": reading(buf),
                "ctx": gloss,
                "pos": "",
                "extra": "",
                "level": "dict",
            }
        )
        buf = ""

    for ch in trad:
        if is_han(ch):
            buf += ch
        else:
            flush()
            tokens.append({"t": ch, "s": T2S.convert(ch), "punct": True})
    flush()
    return tokens


def parse(text: str) -> list[dict]:
    sections: list[dict] = []
    current: dict | None = None
    pending_line = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# "):
            current = {"id": "s%d" % (len(sections) + 1), "title": line[2:].strip(), "ready": True, "lines": []}
            sections.append(current)
            pending_line = ""
            continue
        if current is None:
            raise SystemExit("原文必须写在「# 标题」下面")
        if line.startswith("! "):
            current["ready"] = False
            current["note"] = line[2:].strip()
            continue
        if line.startswith(">"):
            if not pending_line:
                raise SystemExit("白话前面缺少原文：%s" % line)
            gloss = line[1:].strip()
            current["lines"].append({"tr": gloss, "tokens": tokens_for(pending_line, gloss)})
            pending_line = ""
            continue
        if pending_line:
            raise SystemExit("这一行还没有白话：%s" % pending_line)
        pending_line = line
    if pending_line:
        raise SystemExit("最后一行还没有白话：%s" % pending_line)
    return sections


def main() -> None:
    sections = parse(SRC.read_text(encoding="utf-8"))
    ready = [s for s in sections if s.get("ready")]
    data = {
        "id": "szj",
        "title": {"t": "三字經", "s": "三字经"},
        "source": "通行本开篇。注音是现代汉语今读；孝弟的弟读 tì，弟于长的长读 zhǎng。",
        "sections": sections,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    lines = sum(len(s["lines"]) for s in ready)
    print("wrote %s (%d ready sections, %d lines)" % (OUT.relative_to(ROOT), len(ready), lines))


if __name__ == "__main__":
    main()
