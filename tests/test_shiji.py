import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_shiji  # noqa: E402


class ShijiTests(unittest.TestCase):
    def test_catalog_lists_all_130(self):
        data = json.loads((ROOT / "data" / "shiji.json").read_text(encoding="utf-8"))
        juans = [item["juan"] for vol in data["volumes"] for item in vol["entries"]]
        self.assertEqual(juans, list(range(1, 131)))
        done = {art["id"] for vol in data["volumes"] for art in vol["articles"]}
        self.assertEqual(done, {build_shiji.article_id(j) for j in build_shiji.DONE})
        for vol in data["volumes"]:
            for item in vol["entries"]:
                self.assertTrue(item.get("id") or item.get("note") == "待添加")

    def test_articles_match_source_and_translations(self):
        for entry in build_shiji.load_entries():
            art = json.loads((ROOT / "data" / "articles" / f"{entry['id']}.json").read_text(encoding="utf-8"))
            sents = [s for p in art["paragraphs"] for s in p["sentences"]]
            self.assertEqual(len(sents), build_shiji.sentence_count(entry))
            text = "".join(t["s"] for s in sents for t in s["tokens"])
            self.assertNotIn("□", text)
            self.assertNotIn("索隐", text)
            for s in sents:
                self.assertTrue(s["tr"].strip())
                self.assertNotEqual(s["tr"], "".join(t["s"] for t in s["tokens"]))

    def test_fitted_readings_are_applied(self):
        art = json.loads((ROOT / "data" / "articles" / "s007.json").read_text(encoding="utf-8"))
        toks = [t for p in art["paragraphs"] for s in p["sentences"] for t in s["tokens"]]
        text = "".join(t["s"] for t in toks)
        at = text.index("沛公欲王关中") + 3
        self.assertEqual((toks[at]["s"], toks[at]["py"], toks[at]["level"]), ("王", "wàng", "sentence"))
        at = text.index("玉玦")
        self.assertEqual(toks[at + 1]["s"], "玦")


if __name__ == "__main__":
    unittest.main()
