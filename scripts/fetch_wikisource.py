# -*- coding: utf-8 -*-
"""Download 《古文观止》 volumes 1–12 from zh.wikisource.org."""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "sources" / "wikisource"
API = "https://zh.wikisource.org/w/api.php"
UA = "GuwenGuanzhiStudyBot/1.0 (educational static site; local import)"


def fetch_wikitext(title: str) -> str:
    params = {
        "action": "parse",
        "page": title,
        "prop": "wikitext",
        "format": "json",
        "redirects": "1",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if "error" in data:
        raise SystemExit(f"Wikisource error for {title}: {data['error']}")
    return data["parse"]["wikitext"]["*"]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for vol in range(1, 13):
        title = f"古文觀止/卷{vol}"
        dest = OUT / f"vol{vol:02d}.wikitext"
        if dest.exists() and dest.stat().st_size > 500:
            print(f"skip {dest.name}")
            continue
        print(f"fetch {title}")
        text = fetch_wikitext(title)
        dest.write_text(text, encoding="utf-8")
        time.sleep(0.4)
    print("done", OUT)


if __name__ == "__main__":
    main()
