# -*- coding: utf-8 -*-
"""把 sources/lessons/*.json 写进对应篇目。句数对不上就拒绝，不改原文。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from content_rules import ARTICLES, ROOT, load_json, overlay_problems

LESSONS = ROOT / "sources" / "lessons"
CATALOG = ROOT / "data" / "catalog.json"
META = ROOT / "data" / "build-meta.json"


def dump(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else LESSONS
    files = sorted(src.glob("*.json"))
    if not files:
        print(f"没有课注文件：{src}")
        return 1
    failed = 0
    applied = 0
    for path in files:
        overlay = load_json(path)
        art_id = overlay.get("id") or path.stem
        article_path = ARTICLES / f"{art_id}.json"
        if not article_path.exists():
            print(f"{path.name}\t找不到篇目")
            failed += 1
            continue
        article = load_json(article_path)
        problems = overlay_problems(article, overlay)
        if problems:
            print(f"{art_id}\t" + "；".join(problems))
            failed += 1
            continue
        sentences = [s for para in article["paragraphs"] for s in para["sentences"]]
        for sent, tr in zip(sentences, overlay["trs"]):
            sent["tr"] = tr.strip()
        article["lesson"] = overlay["lesson"]
        article["annotated"] = True
        dump(article_path, article)
        applied += 1
    catalog = load_json(CATALOG)
    by_id = {}
    for vol in catalog["volumes"]:
        for art in vol["articles"]:
            by_id[art["id"]] = art
    annotated = 0
    for path in sorted(ARTICLES.glob("v*.json")):
        article = load_json(path)
        flag = bool(article.get("annotated"))
        if article["id"] in by_id:
            by_id[article["id"]]["annotated"] = flag
        if flag:
            annotated += 1
    catalog["annotatedCount"] = annotated
    dump(CATALOG, catalog)
    if META.exists():
        meta = load_json(META)
        meta["annotated"] = annotated
        META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"写入 {applied} 篇，拒绝 {failed} 篇，目录已标注 {annotated} 篇")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
