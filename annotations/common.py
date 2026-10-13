# -*- coding: utf-8 -*-
"""卷一标注的小工具。"""

from __future__ import annotations


def S(text: str, tr: str, rows: list) -> dict:
    gl = []
    for row in rows:
        if len(row) < 3:
            raise ValueError(f"词条过短：{row} @ {text}")
        word, py, ctx = row[0], row[1], row[2]
        pos = row[3] if len(row) > 3 else ""
        extra = row[4] if len(row) > 4 else ""
        gl.append((word, py, ctx, pos, extra))
    return {"text": text, "tr": tr, "gl": gl}


def article(aid: str, lesson: dict, paragraphs: list) -> dict:
    return {"id": aid, "lesson": lesson, "paragraphs": paragraphs}
