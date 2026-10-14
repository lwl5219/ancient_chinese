# -*- coding: utf-8 -*-
"""检查一批课注是否都能对上原文。python3 scripts/check_batch.py /tmp/gwgz-packets/batch-01.json"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from content_rules import ARTICLES, ROOT, load_json, overlay_problems

LESSONS = ROOT / "sources" / "lessons"


def main() -> int:
    packet = load_json(Path(sys.argv[1]))
    failed = 0
    for item in packet["articles"]:
        art_id = item["id"]
        path = LESSONS / f"{art_id}.json"
        if not path.exists():
            print(f"{art_id}\t缺少文件")
            failed += 1
            continue
        problems = overlay_problems(load_json(ARTICLES / f"{art_id}.json"), load_json(path))
        if problems:
            print(f"{art_id}\t" + "；".join(problems))
            failed += 1
        else:
            print(f"{art_id}\tOK")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
