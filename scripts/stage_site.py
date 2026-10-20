"""Build and validate a deployment directory without modifying the checkout."""
from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
from pathlib import Path

import stamp_assets

ROOT = Path(__file__).resolve().parents[1]


def validate(root: Path) -> None:
    asset_js = (root / "js/asset-urls.js").read_text(encoding="utf-8")
    urls = json.loads(asset_js.split("window.ASSET_URLS = ", 1)[1].split(";\n", 1)[0])
    build = json.loads((root / "version.json").read_text())["build"]
    index = (root / "index.html").read_text(encoding="utf-8")
    if f'data-build="{build}"' not in index or f'window.SITE_BUILD = "{build}";' not in asset_js:
        raise ValueError("Build identifiers disagree")
    for canonical, hashed in urls.items():
        original, asset = root / canonical, root / hashed
        if not asset.is_file() or asset.read_bytes() != original.read_bytes():
            raise ValueError(f"Missing or stale hashed asset: {hashed}")
    for path in root.rglob("*"):
        if path.is_file() and stamp_assets.HASHED_NAME.match(path.name):
            if stamp_assets.HASHED_NAME.match(path.name)["digest"] != stamp_assets.digest(path.read_bytes()):
                raise ValueError(f"Incorrect content hash: {path}")
    for ref in re.findall(r'(?:src|href)="([^"#]+)"', index):
        if not re.match(r"(?:https?:|//)", ref) and not (root / ref).is_file():
            raise ValueError(f"Missing entry asset: {ref}")
    for catalog_name in ("catalog", "renjian", "zztj", "shiji", "daode", "lunyu"):
        catalog = json.loads((root / "data" / f"{catalog_name}.json").read_text())
        for volume in catalog["volumes"]:
            for article in volume["articles"]:
                if not (root / "data/articles" / f"{article['id']}.json").is_file():
                    raise ValueError(f"Missing article: {article['id']}")
    manifest = json.loads((root / "audio/manifest.json").read_text())
    for value in manifest.values():
        if not re.fullmatch(r"[a-z]+[1-5]", value) or not (root / "audio" / f"{value}.ogg").is_file():
            raise ValueError(f"Missing manifest recording: {value}")


def active_hashes(previous: Path) -> tuple[str | None, dict[str, bytes]]:
    """Only retain the previous release's active map, never its older backlog."""
    if not (previous / "version.json").is_file():
        return None, {}
    build = json.loads((previous / "version.json").read_text())["build"]
    mapping = (previous / "js/asset-urls.js").read_text(encoding="utf-8")
    urls = json.loads(mapping.split("window.ASSET_URLS = ", 1)[1].split(";\n", 1)[0])
    index = (previous / "index.html").read_text(encoding="utf-8")
    refs = set(urls.values()) | set(re.findall(r'(?:src|href)="([^"#]+)"', index))
    assets = {}
    for rel in sorted(refs):
        path = previous / rel
        if Path(rel).is_absolute() or ".." in Path(rel).parts or path.is_symlink():
            raise ValueError(f"Unsafe previous asset: {rel}")
        match = stamp_assets.HASHED_NAME.match(path.name)
        if not match:
            continue
        if path.is_file():
            data = path.read_bytes()
        else:
            # Some historical checkouts omitted a hashed manifest. Recover only
            # from its real canonical bytes and verify the requested digest.
            canonical = next((key for key, value in urls.items() if value == rel), None)
            if canonical is None or Path(canonical).is_absolute() or ".." in Path(canonical).parts:
                raise ValueError(f"Previous asset cannot be recovered: {rel}")
            data = (previous / canonical).read_bytes()
        if stamp_assets.digest(data) != match["digest"]:
            raise ValueError(f"Previous asset hash disagrees: {rel}")
        assets[rel] = data
    return build, assets


def stage(output: Path, previous_site: Path | None = None) -> None:
    output = output.resolve()
    if output.exists():
        raise ValueError(f"Output already exists; choose a new directory: {output}")
    previous_build, previous_assets = active_hashes(previous_site or ROOT)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".site-stage-", dir=output.parent) as temp:
        site = Path(temp) / "site"
        site.mkdir()
        for name in ("index.html", "favicon.svg", ".nojekyll", "stats.html"):
            source = ROOT / name
            if source.is_file():
                shutil.copy2(source, site / name)
        for name in ("css", "js", "data", "audio"):
            shutil.copytree(ROOT / name, site / name)
        if stamp_assets.main([str(site)]) != 0:
            raise ValueError("Asset stamping failed")
        for rel, data in previous_assets.items():
            target = site / rel
            if target.exists() and target.read_bytes() != data:
                raise ValueError(f"Content-hash collision: {rel}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (site / "compatibility.json").write_text(json.dumps({
            "previous_build": previous_build, "previous_releases_retained": 1 if previous_build else 0,
            "files": sorted(previous_assets),
        }, indent=2) + "\n", encoding="utf-8")
        validate(site)
        site.rename(output)
    print(f"Validated site: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--previous-site", type=Path, help="previous successful Pages artifact; retain its active hashes")
    args = parser.parse_args()
    stage(args.output, args.previous_site)
