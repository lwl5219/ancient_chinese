# -*- coding: utf-8 -*-
"""检查 222 篇古文观止是否都有逐句译文、注释、赏析、背景和作者。

用法：python3 scripts/audit_content.py
有缺口时退出码为 1，并逐篇打印缺什么。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from content_rules import ARTICLES, AUTHORS, article_gaps, load_json


def main() -> int:
    authors = load_json(AUTHORS)
    files = sorted(ARTICLES.glob("v*.json"))
    if len(files) != 222:
        print(f"篇数不是 222：{len(files)}")
        return 1
    gaps = []
    for path in files:
        article = load_json(path)
        found = article_gaps(article, authors)
        if found:
            title = (article.get("title") or {}).get("s") or path.stem
            gaps.append((article.get("id") or path.stem, title, found))
    print(f"篇目 {len(files)}，有缺口 {len(gaps)}")
    for art_id, title, found in gaps:
        print(f"{art_id}\t{title}\t" + "；".join(found))
    if gaps:
        return 1
    print("审计通过：译文、注释、赏析、背景、作者都齐全。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
