"""Upload a validated site, then publish its entry points. Never delete old hashes."""
from __future__ import annotations

import argparse
import mimetypes
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from stage_site import validate

ENTRY_POINTS = ("index.html", "version.json")


def upload_command(site: Path, relative: str, destination: str) -> list[str]:
    path = site / relative
    hashed = bool(re.search(r"\.[0-9a-f]{12}\.[A-Za-z0-9]+$", path.name))
    cache = "public, max-age=31536000, immutable" if hashed else "no-cache, must-revalidate"
    types = {".js": "text/javascript", ".json": "application/json", ".ogg": "audio/ogg"}
    content_type = types.get(path.suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if content_type.startswith("text/") or content_type == "application/json":
        content_type += "; charset=utf-8"
    return ["ossutil", "cp", str(path), destination.rstrip("/") + "/" + relative,
            "--content-type", content_type, "--cache-control", cache, "--force", "--no-progress"]


def publish(site: Path, destination: str, runner=None, workers: int = 8) -> None:
    validate(site)
    if runner is None:
        def runner(command):
            subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    assets = sorted(path.relative_to(site).as_posix() for path in site.rglob("*")
                    if path.is_file() and path.relative_to(site).as_posix() not in ENTRY_POINTS)
    # Any failed upload aborts before either entry point is changed. Old immutable
    # objects remain available to tabs that still hold the preceding asset map.
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(lambda rel: runner(upload_command(site, rel, destination)), assets))
    for relative in ENTRY_POINTS:
        runner(upload_command(site, relative, destination))
    print(f"Published {len(assets)} assets, then index.html and version.json; old objects retained.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path)
    parser.add_argument("destination")
    args = parser.parse_args()
    if not re.fullmatch(r"oss://[a-z0-9][a-z0-9-]+", args.destination):
        parser.error("destination must be an OSS bucket URL")
    publish(args.site.resolve(), args.destination)
