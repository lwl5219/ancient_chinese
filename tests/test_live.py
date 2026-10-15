import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import stamp_assets
import verify_live
from test_release import fixture


class LiveVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = fixture(Path(self.temp.name) / "site")
        stamp_assets.main([str(self.site)])

    def test_verifies_real_expected_files_including_audio_and_hashes(self):
        requested = []
        def read(relative):
            requested.append(relative)
            return (self.site / relative).read_bytes()
        result = verify_live.verify(self.site, "https://example.test/site/", read)
        self.assertGreater(result["verified_public_files"], 10)
        self.assertIn("audio/pu4.ogg", requested)
        self.assertIn("version.json", requested)

    def test_detects_stale_or_corrupt_public_bytes(self):
        def read(relative):
            return b"stale" if relative == "index.html" else (self.site / relative).read_bytes()
        with self.assertRaisesRegex(ValueError, "index.html"):
            verify_live.verify(self.site, "https://example.test/site/", read)

    def test_requires_https(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            verify_live.verify(self.site, "http://example.test/site/")
