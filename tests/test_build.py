import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_site
import fill_textbook_gloss
import build_updates
from annotations.volume1 import ARTICLES


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / "data"
        (self.out / "articles").mkdir(parents=True)
        self.sources = []
        for volume in range(1, 13):
            aid = f"v{volume:02d}-01"
            self.sources.append({"id": aid, "volume": volume, "volumeTitle": "卷", "volumeSubtitle": "测试",
                                 "index": 1, "title": "字", "author": "作者", "book": "书", "sourceHead": "",
                                 "classicComment": "", "paragraphs": ["字。"]})
            self.write(f"articles/{aid}.json", {
                "id": aid, "volume": volume, "volumeTitle": "卷", "volumeSubtitle": "测试",
                "index": 1, "title": {"s": "字", "t": "字"}, "author": "作者", "book": {"s": "书", "t": "書"},
                "annotated": True, "paragraphs": [{"sentences": [{"tr": "已校订译文", "tokens": [
                    {"t": "字", "s": "字", "py": "zì", "ctx": "已核定句义", "level": "sentence"}]}]}],
                "lesson": {"theme": "已有的完整讲解"}, "editionReview": "must survive",
            })
        for name in ("d01-01", "h01-01", "l01-01", "z01-01", "v02-01.0123456789ab"):
            self.write(f"articles/{name}.json", {"sentinel": name})
        self.write("dict.json", {"source": "reviewed", "chars": {
            "字": {"py": "zì", "inShuowen": True, "review": "manual"}, "外": {"py": "wài", "inShuowen": True}}})
        self.write("build-inputs.json", {"schema": 1, "articles": build_updates.fingerprints(
            self.sources, {a["id"]: a for a in ARTICLES})})
        self.addCleanup(patch.stopall)
        patch.object(build_site, "OUT", self.out).start()
        patch.object(build_site, "load_source_articles", return_value=self.sources).start()
        patch.object(build_site, "build_dict", side_effect=AssertionError("Existing dictionary must suffice")).start()

    def write(self, name, value):
        (self.out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

    def snapshot(self):
        return {p.relative_to(self.out).as_posix(): p.read_bytes() for p in self.out.rglob("*") if p.is_file()}

    def test_preserves_reviewed_articles_other_books_hashes_and_dictionary(self):
        before = self.snapshot()
        build_site.main()
        after = self.snapshot()
        for name, data in before.items():
            self.assertEqual(after[name], data, name)
        self.assertEqual(json.loads(after["catalog.json"])["annotatedCount"], 12)
        build_site.main()
        self.assertEqual(self.snapshot(), after, "A second build must be stable")

    def test_serialization_failure_does_not_publish_partial_batch(self):
        before = self.snapshot()
        real_dumps = json.dumps
        calls = 0
        def fail_late(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 5:
                raise ValueError("simulated serialization failure")
            return real_dumps(*args, **kwargs)
        with patch.object(build_site.json, "dumps", side_effect=fail_late):
            with self.assertRaises(ValueError):
                build_site.main()
        self.assertEqual(before, self.snapshot())

    def test_invalid_existing_article_stops_before_writes(self):
        self.write("articles/v12-01.json", {"id": "wrong", "paragraphs": []})
        before = self.snapshot()
        with self.assertRaises(SystemExit):
            build_site.main()
        self.assertEqual(before, self.snapshot())

    def test_changed_source_fails_instead_of_silently_reusing_old_json(self):
        self.sources[1]["title"] = "新标题"
        before = self.snapshot()
        with self.assertRaisesRegex(SystemExit, "检测到原文/annotations 变更"):
            build_site.main()
        self.assertEqual(before, self.snapshot())

    def test_existing_dictionary_gaps_do_not_require_an_external_checkout(self):
        self.write("dict.json", {"chars": {"外": {"py": "wài", "inShuowen": True}}})
        before = (self.out / "dict.json").read_bytes()
        build_site.main()
        self.assertEqual((self.out / "dict.json").read_bytes(), before)

    def test_changed_annotation_fails_before_writes(self):
        revised = copy.deepcopy(ARTICLES)
        revised[0]["lesson"]["theme"] = "修订后的讲解"
        before = self.snapshot()
        with patch("annotations.volume1.ARTICLES", revised):
            with self.assertRaisesRegex(SystemExit, "annotations 变更"):
                build_site.main()
        self.assertEqual(before, self.snapshot())

    def make_plan(self):
        self.sources[1]["title"] = "新标题"
        directory = Path(self.temp.name) / "review"
        build_site.main(["--plan-update", str(directory)])
        path = directory / "plan.json"
        return path, json.loads(path.read_text())

    def test_reviewed_update_changes_title_but_preserves_later_chapter_notes(self):
        before = self.snapshot()
        path, plan = self.make_plan()
        self.assertEqual(before, self.snapshot(), "Planning must not touch published files")
        item = plan["updates"]["v02-01"]
        reviewed = path.parent / item["reviewed_file"]
        article = json.loads(reviewed.read_text())
        old_title = copy.deepcopy(article["title"])
        article["title"] = {"s": "新标题", "t": "新標題"}
        build_updates.write_json(reviewed, article)
        item["reviewed_sha256"] = build_updates.file_digest(reviewed)
        item["approved_field_changes"] = {"title": {
            "before": build_updates.digest(old_title), "after": build_updates.digest(article["title"])}}
        plan["review_note"] = "标题更新，逐句译注和系统讲解保留。"
        build_updates.write_json(path, plan)
        build_site.main(["--apply-update", str(path)])
        result = json.loads((self.out / "articles/v02-01.json").read_text())
        original = json.loads(before["articles/v02-01.json"])
        self.assertEqual(result["title"], article["title"])
        for field in ("paragraphs", "lesson", "editionReview"):
            self.assertEqual(result[field], original[field])
        after = self.snapshot()
        build_site.main()
        self.assertEqual(after, self.snapshot())

    def test_generated_draft_cannot_erase_existing_notes_without_field_approval(self):
        path, plan = self.make_plan()
        item = plan["updates"]["v02-01"]
        reviewed = path.parent / item["reviewed_file"]
        reviewed.write_bytes((path.parent / "v02-01.generated.json").read_bytes())
        item["reviewed_sha256"] = build_updates.file_digest(reviewed)
        plan["review_note"] = "Only a draft; note loss must be rejected."
        build_updates.write_json(path, plan)
        before = self.snapshot()
        with self.assertRaisesRegex(SystemExit, "未批准的字段变更/译注冲突"):
            build_site.main(["--apply-update", str(path)])
        self.assertEqual(before, self.snapshot())

    def test_stale_input_plan_rejected_without_writes(self):
        path, plan = self.make_plan()
        self.sources[1]["title"] = "又一次修改"
        before = self.snapshot()
        with self.assertRaisesRegex(SystemExit, "已过期或输入不匹配"):
            build_site.main(["--apply-update", str(path)])
        self.assertEqual(before, self.snapshot())

    def test_changed_publication_rejected_without_writes(self):
        path, plan = self.make_plan()
        plan["review_note"] = "Review"
        build_updates.write_json(path, plan)
        self.write("articles/v02-01.json", {"id": "v02-01", "newEditorialWork": True})
        before = self.snapshot()
        with self.assertRaisesRegex(SystemExit, "已发布篇目在审阅后发生变化"):
            build_site.main(["--apply-update", str(path)])
        self.assertEqual(before, self.snapshot())


class ReadingTests(unittest.TestCase):
    def test_phrase_reading_is_independent_of_locked_meaning(self):
        for text, expected in (("槁暴", ["gǎo", "pù"]), ("可汗", ["kè", "hán"])):
            tokens = [{"s": ch, "t": ch, "py": "gǎo" if ch == "槁" else "wrong", "ctx": "已审定释义", "level": "sentence"} for ch in text]
            before = copy.deepcopy(tokens)
            fill_textbook_gloss.fill_tokens(tokens, "fixture")
            self.assertEqual([t["py"] for t in tokens], expected)
            self.assertEqual([t["ctx"] for t in tokens], [t["ctx"] for t in before])
            fill_textbook_gloss.fill_tokens(tokens, "fixture")
            self.assertEqual([t["py"] for t in tokens], expected)

    def test_published_quanxue_reading(self):
        path = Path(__file__).resolve().parents[1] / "data/ke.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        piece = next(p for p in data["pieces"] if p["id"] == "quanxue")
        found = []
        for line in piece["lines"]:
            tokens = line["tokens"]
            for i, tok in enumerate(tokens[1:], 1):
                if tokens[i-1].get("s") == "槁" and tok.get("s") == "暴":
                    found.append(tok["py"])
        self.assertEqual(found, ["pù"])
