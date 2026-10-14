# -*- coding: utf-8 -*-
"""核对古文观止课注，能对上的写上出处，对不上的标待人工复核。

课注、读音、译文以通行说法为准。简体注本优先用钟基、李先银、王身钢译注
《古文观止》（中华书局，简体横排，ISBN 978-7-101-07898-5；藏书升级版
ISBN 978-7-101-11362-4 同此译注）。这一本没有收进仓库，不能逐字比较。
维基文库是繁体，只作公有领域正文和旧夹注的对照，不代替中华书局简体注本。
人教版教材和《古汉语常用字字典》仍可用来核对单条释义。读音再参
《现代汉语词典》和汉典，教材读音优先。
维基文库夹注和杜预等旧注只用来对照。旧注和通行说法不一致时，不把课注改成旧注。
异说可以写在课注里，但「异说」以后的字不拿来对出处。对不上的不改。

对照三处，不另编释义：

- 这一篇在维基文库《古文观止》里的夹注
- legacy/dict/out_file/ancient_chinese.json（汉典文言）
- data/dict.json 里的《说文》本义

一句课注里要有连续两个字出现在上述出处里，才算对上。
「不是」「这里」这类字不算。对不上的不改课注。

用法：
    python3 scripts/verify_glosses.py
    python3 scripts/verify_glosses.py --write
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from parse_wikisource import iter_templates  # noqa: E402

ARTICLES = ROOT / "data" / "articles"
WIKI = ROOT / "sources" / "wikisource"
HAN_PATH = ROOT / "legacy" / "dict" / "out_file" / "ancient_chinese.json"
SHUOWEN_PATH = ROOT / "data" / "dict.json"
OUT_PATH = ROOT / "data" / "gloss-sources.json"
REPORT_PATH = ROOT / "sources" / "verification" / "GLOSSES.md"
HASHED = re.compile(r"\.[0-9a-f]{12}\.json$")
KINDS = (
    ("实词", "keyContentWords", "word"),
    ("虚词", "keyFunctionWords", "word"),
    ("古今异义", "ancientModern", "word"),
    ("通假", "phoneticLoans", "word"),
    ("活用", "flexibleUsage", "word"),
    ("句式", "specialSyntax", "name"),
)
STOP = {
    "不是", "就是", "而是", "这里", "这个", "那个", "所以", "因为", "可以", "不能",
    "没有", "自己", "他们", "我们", "什么", "怎么", "如果", "以及", "还是", "已经",
    "时候", "意思", "表示", "用来", "后世", "现在", "当时", "本文", "这句", "一句",
    "不要", "不会", "不是指", "指的", "而是指",
}
PHRASE = re.compile(r"[\u4e00-\u9fff]{2,8}")


def load_handian() -> dict[str, dict]:
    rows = json.loads(HAN_PATH.read_text(encoding="utf-8"))
    out = {}
    for item in rows:
        text = re.sub(r"<[^>]+>", "", json.dumps(item.get("explain") or {}, ensure_ascii=False))
        out[item["word"]] = {"url": item.get("url") or "", "text": text}
    return out


def load_shuowen() -> dict[str, str]:
    chars = json.loads(SHUOWEN_PATH.read_text(encoding="utf-8"))["chars"]
    return {ch: (info.get("ben") or "") for ch, info in chars.items()}


def article_files():
    return [path for path in sorted(ARTICLES.glob("v*.json")) if not HASHED.search(path.name)]


def inline_notes(volume: int, title: str) -> list[str]:
    text = (WIKI / f"vol{volume:02d}.wikitext").read_text(encoding="utf-8")
    sections = re.split(r"(?m)^==\s*([^=]+?)\s*==\s*$", text)
    i = 1
    while i + 1 < len(sections):
        name = sections[i].strip()
        content = sections[i + 1]
        i += 2
        if name != title:
            continue
        notes = []
        for _a, _b, raw in iter_templates(content):
            if not raw.startswith("{{*|"):
                continue
            inner = raw[len("{{*|") :]
            if inner.endswith("}}"):
                inner = inner[:-2]
            inner = re.sub(r"\{\{\*\|", "", inner)
            inner = inner.replace("}}", "")
            inner = re.sub(r"\s+", "", inner)
            if inner:
                notes.append(inner)
        return notes
    return []


def phrases(note: str, word: str) -> list[str]:
    # 异说只是备录，不能拿引文里的字把整条课注算成和旧注对上。
    note = note or ""
    cut = note.find("异说")
    if cut >= 0:
        note = note[:cut]
    found = []
    for piece in PHRASE.findall(note):
        if piece == word or piece in STOP:
            continue
        if len(piece) == 2 and piece in STOP:
            continue
        found.append(piece)
    found.sort(key=len, reverse=True)
    return found


def hit(phrases_found: list[str], text: str) -> str:
    if not text:
        return ""
    for piece in phrases_found:
        if piece in text:
            return piece
    return ""


def check_item(kind, word, note, wiki_notes, handian, shuowen, original: str) -> dict | None:
    found = [piece for piece in phrases(note, word) if piece not in original]
    if not found or not word:
        return None
    blob = "\n".join(wiki_notes)
    matched = hit(found, blob)
    if word and word in blob and matched:
        return {
            "kind": kind,
            "source": "维基文库《古文观止》夹注",
            "url": "",
            "via": matched,
        }
    for ch in word:
        entry = handian.get(ch)
        if not entry:
            continue
        matched = hit(found, entry["text"])
        if matched:
            return {
                "kind": kind,
                "source": "汉典文言",
                "url": entry["url"],
                "via": ch + "：" + matched,
            }
    for ch in word:
        ben = shuowen.get(ch) or ""
        matched = hit(found, ben)
        if matched:
            return {
                "kind": kind,
                "source": "说文解字",
                "url": "https://zh.wikisource.org/wiki/說文解字",
                "via": ch + "：" + matched,
            }
    return None


def collect() -> tuple[dict, list[dict], dict]:
    handian = load_handian()
    shuowen = load_shuowen()
    pieces = {}
    flagged = []
    counts = {"items": 0, "verified": 0, "unverified": 0}
    by_source = {}
    for path in article_files():
        art = json.loads(path.read_text(encoding="utf-8"))
        lesson = art.get("lesson") or {}
        if not lesson:
            continue
        title = art["title"]["t"]
        notes = inline_notes(art["volume"], title)
        from opencc import OpenCC
        cc = getattr(collect, "_cc", None)
        if cc is None:
            cc = OpenCC("t2s")
            collect._cc = cc
        notes = notes + [cc.convert(item) for item in notes]
        url = "https://zh.wikisource.org/wiki/古文觀止/卷%d" % art["volume"]
        trad = []
        simp = []
        for para in art["paragraphs"]:
            for sent in para["sentences"]:
                for tok in sent["tokens"]:
                    trad.append(tok.get("t") or "")
                    simp.append(tok.get("s") or "")
        original_text = "".join(trad) + "".join(simp)
        bucket = {}
        for kind, key, field in KINDS:
            for item in lesson.get(key) or []:
                counts["items"] += 1
                word = (item.get(field) or "").strip()
                note = item.get("note") or ""
                got = check_item(kind, word, note, notes, handian, shuowen, original_text)
                if not got:
                    counts["unverified"] += 1
                    flagged.append({
                        "id": art["id"],
                        "kind": kind,
                        "word": word,
                        "note": note,
                        "wiki": "",
                        "why": "待人工复核。夹注、汉典文言和《说文》里都没有对上这句里的词。",
                    })
                    continue
                counts["verified"] += 1
                by_source[got["source"]] = by_source.get(got["source"], 0) + 1
                if got["source"].startswith("维基文库"):
                    got["url"] = url
                bucket[kind + "|" + word] = got
        if bucket:
            pieces[art["id"]] = bucket
    counts["sources"] = by_source
    return {"note": "古文观止课注里对上出处的条目。对不上的见 sources/verification/GLOSSES.md。", "pieces": pieces}, flagged, counts


def render(counts: dict, flagged: list[dict]) -> str:
    lines = [
        "# 古文观止课注核对",
        "",
        "只核对了课注里的实词、虚词、古今异义、通假、活用和句式。译文没有逐句对上注本。",
        "对上的标准是：课注里有连续两个字，出现在这一篇的维基文库夹注、汉典文言该字的释文，或《说文》本义里。",
        "课注从通行注本和教材，不按旧注改义。简体以中华书局钟基、李先银、王身钢译注《古文观止》（ISBN 978-7-101-07898-5）为准，但这一本没有收进仓库，下面的「对上」不是拿它逐字比较。维基文库是繁体旧夹注，不代替这本简体注。对不上的标待人工复核，不改写。",
        "",
        "- v01-01「寤」：曾按《古文观止》卷一夹注改成「犹苏、绝而复苏」，并移出通假。夹注不是通行说法。现改回通假：寤通「啎」，逆生，足先出，即难产。异说保留杜预注原文「寐寤而庄公已生，故惊而恶之」（维基文库《春秋左传正义》卷一）。《史记·郑世家》作「生太子寤生，生之难」，与难产同向，一并写出。异说待人工复核。",
        "- v01-01「完聚」：课注和句译写了「粮食」「粮草」。通行注本作「修治城郭，聚集百姓」，本篇夹注亦作「完城郭，聚人民」。已去掉粮食、粮草。",
        "",
        "用字、标点没有按旧注改义，仍保留：费祎（不作袆）、乾谿、乾坤、流徵、罜䍡，以及「三分、」「高飞、」后多出来的句号。读音没有改显示的拼音；拿不准的仍在 data/reading-policy.json 标待复核。",
        "",
        "课注 %d 条。对上 %d 条。对不上 %d 条，留在下面，没有改。" % (
            counts["items"], counts["verified"], counts["unverified"],
        ),
        "",
        "对上的出处：",
        "",
    ]
    for name, num in sorted(counts["sources"].items()):
        lines.append("- %s：%d" % (name, num))
    lines.extend([
        "",
        "待人工复核：",
        "",
        "| 篇 | 类 | 词 | 课注 | 说明 |",
        "| --- | --- | --- | --- | --- |",
    ])
    if not flagged:
        lines.append("|  |  |  |  | 没有 |")
    for item in flagged:
        note = item["note"].replace("\n", " ")
        if len(note) > 80:
            note = note[:80] + "…"
        lines.append("| %s | %s | %s | %s | %s |" % (
            item["id"], item["kind"], item["word"], note.replace("|", "｜"), item["why"],
        ))
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    write = "--write" in sys.argv
    data, flagged, counts = collect()
    report = render(counts, flagged)
    if write:
        OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        REPORT_PATH.write_text(report, encoding="utf-8")
        print("wrote", counts)
        return 0
    problems = []
    if not OUT_PATH.is_file() or json.loads(OUT_PATH.read_text(encoding="utf-8")) != data:
        problems.append(str(OUT_PATH.relative_to(ROOT)))
    if not REPORT_PATH.is_file() or REPORT_PATH.read_text(encoding="utf-8") != report:
        problems.append(str(REPORT_PATH.relative_to(ROOT)))
    if problems:
        print("课注核对结果不是这次跑出来的：", "、".join(problems))
        print("请运行 python3 scripts/verify_glosses.py --write")
        return 1
    print("glosses", counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
