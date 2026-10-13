# -*- coding: utf-8 -*-
"""从 shuowenjiezi/shuowen 构建站点用字头索引。"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHUOWEN = Path("/tmp/shuowen/data")


def load_shuowen(data_dir: Path | None = None) -> dict:
    data_dir = data_dir or DEFAULT_SHUOWEN
    if not data_dir.is_dir():
        raise SystemExit(
            f"未找到说文数据目录 {data_dir}。请先执行：\n"
            "git clone --depth 1 https://github.com/shuowenjiezi/shuowen.git /tmp/shuowen"
        )
    index: dict[str, dict] = {}
    for path in data_dir.glob("*.json"):
        try:
            item = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        entry = {
            "py": (item.get("pinyin_full") or item.get("pinyin") or "").strip(),
            "fanqie": (item.get("pronunciation") or "").strip(),
            "ben": (item.get("explanation") or "").strip(),
        }
        if not entry["ben"] and not entry["py"]:
            continue
        keys = []
        head = item.get("wordhead") or ""
        if head:
            keys.append(head)
        for key in item.get("indexes") or []:
            if key:
                keys.append(key)
        for key in keys:
            # 一字一条；字头优先于索引里的异体反查
            if len(key) != 1:
                continue
            prev = index.get(key)
            if prev is None or key == head:
                index[key] = entry
    return index
