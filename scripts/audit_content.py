# -*- coding: utf-8 -*-
"""检查古文观止 222 篇和人间词话 64 则是否都有逐句译文、注释、赏析、背景和作者。

用法：python3 scripts/audit_content.py
有缺口时退出码为 1，并逐篇打印缺什么。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from content_rules import ARTICLES, AUTHORS, article_gaps, load_json


def audit_group(authors: dict, name_re: re.Pattern[str], expected: int, label: str) -> list[tuple[str, str, list[str]]]:
    # 带内容哈希的副本是给缓存用的，不另算一篇。
    files = sorted(path for path in ARTICLES.glob("*.json") if name_re.fullmatch(path.name))
    gaps = []
    if len(files) != expected:
        gaps.append(("-", label, [f"篇数不是 {expected}：{len(files)}"]))
    for path in files:
        article = load_json(path)
        found = article_gaps(article, authors)
        if found:
            title = (article.get("title") or {}).get("s") or path.stem
            gaps.append((article.get("id") or path.stem, title, found))
    print(f"{label} {len(files)}，有缺口 {len(gaps)}")
    return gaps


def main() -> int:
    authors = load_json(AUTHORS)
    gaps = []
    gaps.extend(audit_group(authors, re.compile(r"v\d{2}-\d{2}\.json"), 222, "古文观止"))
    gaps.extend(audit_group(authors, re.compile(r"h01-\d{2}\.json"), 64, "人间词话"))
    for art_id, title, found in gaps:
        print(f"{art_id}\t{title}\t" + "；".join(found))
    if gaps:
        return 1
    print("审计通过：译文、注释、赏析、背景、作者都齐全。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
