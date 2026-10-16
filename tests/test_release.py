import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import deploy_oss
import stage_site
import stamp_assets


def fixture(root):
    files = {"index.html": '<html data-build=""><link href="favicon.svg"><link href="css/app.css"><script src="js/asset-urls.js"></script><script src="js/app.js"></script></html>',
             "favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>', ".nojekyll": "", "css/app.css": "body{}", "js/app.js": "void 0;", "js/asset-urls.js": "",
             "audio/manifest.json": '{"pù":"pu4"}', "audio/pu4.ogg": "fixture recording"}
    for name in ("catalog", "renjian", "zztj", "daode", "lunyu"):
        files[f"data/{name}.json"] = '{"volumes":[]}'
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return root


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = fixture(Path(self.temp.name) / "site")
        self.assertEqual(stamp_assets.main([str(self.site)]), 0)

    def test_assets_precede_entry_points_and_old_hashes_survive(self):
        remote = {"data/old.0123456789ab.json": b"old tab still needs this"}
        calls = []
        def upload(command):
            self.assertNotIn("--delete", command)
            relative = command[3].removeprefix("oss://example/")
            if relative in deploy_oss.ENTRY_POINTS:
                assets = [p.relative_to(self.site).as_posix() for p in self.site.rglob("*") if p.is_file() and p.name not in deploy_oss.ENTRY_POINTS]
                self.assertTrue(all(a in remote for a in assets))
            remote[relative] = Path(command[2]).read_bytes()
            calls.append(relative)
        deploy_oss.publish(self.site, "oss://example", runner=upload, workers=1)
        self.assertEqual(calls[-2:], ["index.html", "version.json"])
        self.assertIn("data/old.0123456789ab.json", remote)

    def test_failed_asset_upload_keeps_entry_points_untouched(self):
        calls = []
        def upload(command):
            calls.append(command[3])
            if command[3].endswith("app.js"):
                raise RuntimeError("simulated upload failure")
        with self.assertRaises(RuntimeError):
            deploy_oss.publish(self.site, "oss://example", runner=upload, workers=1)
        self.assertFalse(any(c.endswith("/index.html") or c.endswith("/version.json") for c in calls))

    def test_hash_validation_precedes_upload(self):
        next((self.site / "js").glob("app.*.js")).write_text("corrupted")
        calls = []
        with self.assertRaises(ValueError):
            deploy_oss.publish(self.site, "oss://example", runner=calls.append)
        self.assertEqual(calls, [])

    def test_stage_does_not_modify_source_and_rejects_existing_output(self):
        source = fixture(Path(self.temp.name) / "source")
        before = {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
        output = Path(self.temp.name) / "release"
        with patch.object(stage_site, "ROOT", source):
            stage_site.stage(output)
            with self.assertRaises(ValueError):
                stage_site.stage(output)
        self.assertEqual(before, {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()})
        stage_site.validate(output)

    def test_cache_headers(self):
        hashed = deploy_oss.upload_command(self.site, "js/app.0123456789ab.js", "oss://example")
        entry = deploy_oss.upload_command(self.site, "index.html", "oss://example")
        self.assertIn("public, max-age=31536000, immutable", hashed)
        self.assertIn("no-cache, must-revalidate", entry)

    def test_pages_retains_exactly_one_previous_release_active_hashes(self):
        source = fixture(Path(self.temp.name) / "source")
        versions = []
        maps = []
        for number in range(1, 4):
            (source / "data/catalog.json").write_text(json.dumps({"volumes": [], "edition": number}))
            (source / "js/app.js").write_text(f"void {number};")
            output = Path(self.temp.name) / f"release-{number}"
            with patch.object(stage_site, "ROOT", source):
                stage_site.stage(output, versions[-1] if versions else None)
            versions.append(output)
            mapping = (output / "js/asset-urls.js").read_text().split("window.ASSET_URLS = ", 1)[1].split(";\n", 1)[0]
            maps.append(json.loads(mapping))
        old_url = maps[0]["data/catalog.json"]
        previous_url = maps[1]["data/catalog.json"]
        self.assertTrue((versions[1] / old_url).is_file())
        self.assertTrue((versions[2] / previous_url).is_file())
        self.assertFalse((versions[2] / old_url).exists(), "Do not retain the previous release's own backlog")
        stage_site.validate(versions[2])

    def test_previous_corrupt_hash_fails_before_publishing_stage(self):
        source = fixture(Path(self.temp.name) / "source")
        next((self.site / "js").glob("app.*.js")).write_text("corrupted")
        output = Path(self.temp.name) / "release"
        with patch.object(stage_site, "ROOT", source):
            with self.assertRaisesRegex(ValueError, "Previous asset hash disagrees"):
                stage_site.stage(output, self.site)
        self.assertFalse(output.exists())

    def test_previous_path_traversal_is_rejected(self):
        path = self.site / "js/asset-urls.js"
        path.write_text('window.ASSET_URLS = {"bad":"../outside.0123456789ab.js"};\n')
        with self.assertRaisesRegex(ValueError, "Unsafe previous asset"):
            stage_site.active_hashes(self.site)

    def test_missing_old_manifest_hash_is_recovered_only_from_matching_real_bytes(self):
        manifest_hash = next((self.site / "audio").glob("manifest.*.json"))
        expected = manifest_hash.read_bytes()
        manifest_hash.unlink()
        build, assets = stage_site.active_hashes(self.site)
        self.assertEqual(assets[manifest_hash.relative_to(self.site).as_posix()], expected)
        (self.site / "audio/manifest.json").write_text('{"changed":"pu4"}')
        with self.assertRaisesRegex(ValueError, "Previous asset hash disagrees"):
            stage_site.active_hashes(self.site)

    def test_only_audited_artifact_can_reach_deploy_workflows(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/audit-content.yml").read_text()
        self.assertEqual(workflow.count("    needs: audit"), 2)
        self.assertEqual(workflow.count("artifact-id: ${{ needs.audit.outputs.artifact-id }}"), 2)
        self.assertIn("for attempt in 1 2 3 4 5 6 7 8 9 10 11 12", workflow)
        self.assertEqual(workflow.count("node scripts/previous_release.cjs https://maruiduan.github.io/ancient_chinese/ .previous-site"), 1)
        for name in ("deploy-pages.yml", "deploy-oss.yml"):
            text = (root / ".github/workflows" / name).read_text()
            self.assertIn("  workflow_call:", text)
            self.assertNotIn("  push:", text)
            self.assertNotIn("git push", text)
            self.assertNotIn("stamp_assets.py", text)
            self.assertIn("artifact-ids: ${{ inputs.artifact-id }}", text)
