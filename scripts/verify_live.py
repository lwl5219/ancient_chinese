"""Verify the audited bytes on the public site; never send credentials."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HASHED = re.compile(r"\.[0-9a-f]{12}\.[A-Za-z0-9]+$")


def verify(site: Path, base: str, read=None) -> dict:
    version = json.loads((site / "version.json").read_text())
    base = base.rstrip("/") + "/"
    if urllib.parse.urlparse(base).scheme != "https":
        raise ValueError("Public verification requires HTTPS")
    if read is None:
        def read(relative):
            url = urllib.parse.urljoin(base, relative)
            request = urllib.request.Request(url + "?release-check=" + version["build"],
                                             headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=20) as response:
                return response.read()
    paths = {"index.html", "version.json", "js/asset-urls.js"}
    for path in site.rglob("*"):
        if path.is_file() and HASHED.search(path.name):
            paths.add(path.relative_to(site).as_posix())
    for relative in ("compatibility.json", "audio/manifest.json", "audio/pu4.ogg"):
        if (site / relative).is_file():
            paths.add(relative)

    def check(relative):
        expected = hashlib.sha256((site / relative).read_bytes()).digest()
        actual = hashlib.sha256(read(relative)).digest()
        if actual != expected:
            raise ValueError("Live bytes disagree with audited artifact: " + relative)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(check, sorted(paths)))
    result = {"build": version["build"], "verified_public_files": len(paths), "base": base}
    compatibility = site / "compatibility.json"
    if compatibility.exists():
        result["previous_build"] = json.loads(compatibility.read_text())["previous_build"]
    print(json.dumps(result, sort_keys=True))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path)
    parser.add_argument("base")
    args = parser.parse_args()
    for attempt in range(3):
        try:
            verify(args.site, args.base)
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5)
