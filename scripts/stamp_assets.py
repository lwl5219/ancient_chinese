# -*- coding: utf-8 -*-
"""Give a staged site content-hashed asset names.

Reads a directory that already contains index.html, css/, js/, data/ and
favicon.svg. Writes sibling files named name.<12 hex>.ext, points index.html
at those files, and writes version.json for the in-page update check.

Unhashed originals stay in place so a request without a hash can still be
served. Those originals are meant to be cached with no-cache; only the
hashed names should be immutable.

Usage: python3 scripts/stamp_assets.py site
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HASH_LEN = 12


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:HASH_LEN]


def hashed_path(rel: str, file_hash: str) -> str:
    path = Path(rel)
    return str(path.with_name(path.stem + "." + file_hash + path.suffix)).replace("\\", "/")


def is_hashed_name(name: str) -> bool:
    stem = Path(name).stem
    return "." in stem and len(stem.rsplit(".", 1)[-1]) == HASH_LEN and all(
        ch in "0123456789abcdef" for ch in stem.rsplit(".", 1)[-1]
    )


def collect(root: Path) -> list[Path]:
    files = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel in ("index.html", "version.json") or rel.startswith("."):
            continue
        if path.suffix.lower() not in {".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2"}:
            continue
        if is_hashed_name(path.name):
            continue
        files.append(path)
    return files


def main() -> int:
    if len(sys.argv) != 2:
        print("用法：python3 scripts/stamp_assets.py <site目录>", file=sys.stderr)
        return 2
    root = Path(sys.argv[1]).resolve()
    index_path = root / "index.html"
    if not index_path.is_file():
        print(f"没有 {index_path}", file=sys.stderr)
        return 1

    originals = collect(root)
    url_map: dict[str, str] = {}
    parts: list[str] = []
    for path in originals:
        rel = path.relative_to(root).as_posix()
        if rel == "js/asset-urls.js":
            continue
        file_hash = digest(path.read_bytes())
        dest_rel = hashed_path(rel, file_hash)
        dest = root / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(path.read_bytes())
        url_map[rel] = dest_rel
        parts.append(rel + ":" + file_hash)

    build = digest("".join(sorted(parts)).encode("utf-8"))
    asset_js = (
        "window.ASSET_URLS = "
        + json.dumps(url_map, ensure_ascii=False, separators=(",", ":"))
        + ";\nwindow.SITE_BUILD = "
        + json.dumps(build)
        + ";\n"
    )
    (root / "js" / "asset-urls.js").write_text(asset_js, encoding="utf-8")
    asset_hash = digest(asset_js.encode("utf-8"))
    asset_rel = hashed_path("js/asset-urls.js", asset_hash)
    (root / asset_rel).write_text(asset_js, encoding="utf-8")
    url_map["js/asset-urls.js"] = asset_rel

    index = index_path.read_text(encoding="utf-8")
    if 'href="css/app.css"' not in index:
        print("index.html 已经打过内容哈希，拒绝再跑一遍。", file=sys.stderr)
        return 1
    replacements = {
        "css/app.css": url_map["css/app.css"],
        "js/asset-urls.js": url_map["js/asset-urls.js"],
        "js/app.js": url_map["js/app.js"],
        "favicon.svg": url_map["favicon.svg"],
    }
    for old, new in replacements.items():
        count = index.count(old)
        if count != 1:
            print(f"index.html 里 {old} 出现 {count} 次", file=sys.stderr)
            return 1
        index = index.replace(old, new, 1)
    marker = 'data-build=""'
    if index.count(marker) != 1:
        print("index.html 缺少空的 data-build", file=sys.stderr)
        return 1
    index = index.replace(marker, f'data-build="{build}"', 1)
    index_path.write_text(index, encoding="utf-8")
    (root / "version.json").write_text(
        json.dumps({"build": build}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"build {build}")
    print(f"hashed {len(url_map)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
