# -*- coding: utf-8 -*-
"""古文观止内容完整性规则。审计和写入共用，避免两套标准。"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTICLES = ROOT / "data" / "articles"
AUTHORS = ROOT / "data" / "prose-authors.json"

MIN_PROSE = 40
MIN_NOTES = 4

NOTE_LISTS = (
    "keyContentWords",
    "keyFunctionWords",
    "ancientModern",
    "phoneticLoans",
    "flexibleUsage",
    "specialSyntax",
)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sentence_texts(article: dict) -> list[tuple[str, str]]:
    rows = []
    for para in article.get("paragraphs") or []:
        for sent in para.get("sentences") or []:
            simp = "".join((tok.get("s") or "") for tok in sent.get("tokens") or [])
            trad = "".join((tok.get("t") or "") for tok in sent.get("tokens") or [])
            rows.append((simp.strip(), trad.strip()))
    return rows


def _filled(text: str) -> bool:
    return bool((text or "").strip())


def note_items(lesson: dict) -> int:
    if not isinstance(lesson, dict):
        return 0
    count = 0
    for key in ("keyContentWords", "keyFunctionWords", "ancientModern", "flexibleUsage"):
        for item in lesson.get(key) or []:
            if isinstance(item, dict) and _filled(item.get("word", "")) and _filled(item.get("note", "")):
                count += 1
    for item in lesson.get("phoneticLoans") or []:
        if (
            isinstance(item, dict)
            and _filled(item.get("word", ""))
            and _filled(item.get("loan", ""))
            and _filled(item.get("note", ""))
        ):
            count += 1
    for item in lesson.get("specialSyntax") or []:
        if isinstance(item, dict) and _filled(item.get("name", "")) and _filled(item.get("note", "")):
            count += 1
    return count


def article_gaps(article: dict, authors: dict) -> list[str]:
    gaps = []
    texts = sentence_texts(article)
    sentences = [s for para in article.get("paragraphs") or [] for s in para.get("sentences") or []]
    if len(sentences) != len(texts):
        gaps.append("句子结构损坏")
    empty = 0
    same = 0
    for sent, (simp, trad) in zip(sentences, texts):
        tr = (sent.get("tr") or "").strip()
        if not tr:
            empty += 1
            continue
        if tr == simp or tr == trad:
            same += 1
    if empty:
        gaps.append(f"译文缺 {empty}/{len(sentences)} 句")
    if same:
        gaps.append(f"译文与原文相同 {same} 句")
    lesson = article.get("lesson")
    if not isinstance(lesson, dict):
        gaps.append("没有注释、赏析、背景")
    else:
        for key, label in (("background", "背景"), ("theme", "赏析主旨"), ("technique", "赏析手法")):
            text = (lesson.get(key) or "").strip()
            if len(text) < MIN_PROSE:
                gaps.append(f"{label}不足（{len(text)} 字，至少 {MIN_PROSE}）")
        notes = note_items(lesson)
        if notes < MIN_NOTES:
            gaps.append(f"注释条目不足（{notes}，至少 {MIN_NOTES}）")
    author = article.get("author") or ""
    bio = authors.get(author) or {}
    bio_s = ""
    if isinstance(bio.get("bio"), dict):
        bio_s = (bio["bio"].get("s") or "").strip()
    elif isinstance(bio.get("bio"), str):
        bio_s = bio["bio"].strip()
    if not bio_s:
        gaps.append(f"作者「{author}」没有简介")
    return gaps


def overlay_problems(article: dict, overlay: dict) -> list[str]:
    problems = []
    if overlay.get("id") != article.get("id"):
        problems.append(f"id 不一致：{overlay.get('id')} / {article.get('id')}")
    texts = sentence_texts(article)
    trs = overlay.get("trs")
    if not isinstance(trs, list):
        problems.append("缺少 trs 数组")
        trs = []
    if len(trs) != len(texts):
        problems.append(f"译文 {len(trs)} 句，原文 {len(texts)} 句")
    for i, (tr, (simp, trad)) in enumerate(zip(trs, texts), 1):
        if not isinstance(tr, str) or not tr.strip():
            problems.append(f"第 {i} 句译文为空")
            continue
        text = tr.strip()
        if text == simp or text == trad:
            problems.append(f"第 {i} 句译文与原文相同")
    lesson = overlay.get("lesson")
    if not isinstance(lesson, dict):
        problems.append("缺少 lesson")
    else:
        fake = {"lesson": lesson, "paragraphs": [], "author": article.get("author")}
        # reuse prose/note checks only
        for key, label in (("background", "背景"), ("theme", "赏析主旨"), ("technique", "赏析手法")):
            text = (lesson.get(key) or "").strip()
            if len(text) < MIN_PROSE:
                problems.append(f"{label}不足（{len(text)} 字）")
        if note_items(lesson) < MIN_NOTES:
            problems.append(f"注释条目不足（{note_items(lesson)}）")
        for key in NOTE_LISTS:
            if key in lesson and not isinstance(lesson[key], list):
                problems.append(f"{key} 不是数组")
    return problems
