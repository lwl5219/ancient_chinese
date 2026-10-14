# -*- coding: utf-8 -*-
"""从《国粹学报》已刊六十四则生成人间词话篇目。

底本是维基文库《人间词话》卷上。三处明显错字在 EDITION.md 里说明，
不改正文以外的后人注文。课注在 sources/renjian/lessons/。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
WIKI = ROOT / "sources" / "renjian" / "guocui-juan-shang.wikitext"
LESSONS = ROOT / "sources" / "renjian" / "lessons"
ARTICLES = ROOT / "data" / "articles"
CATALOG = ROOT / "data" / "renjian.json"
DUMP = ROOT / "sources" / "renjian" / "sentences.json"

CC = OpenCC("t2s")
NUMERALS = "〇一二三四五六七八九"
# 维基文库卷上的三处错字。对照见 sources/renjian/EDITION.md。
CORRECTIONS = (
    ("雞犬不已", "雞鳴不已"),
    ("莫之興京", "莫之與京"),
    ("玉固、草窗", "玉田、草窗"),
)
VARIANTS = str.maketrans({"髙": "高", "籐": "藤", "鄕": "乡"})
PUNCT = set("，。！？；、：·．…—～「」『』（）【】《》〈〉〔〕〖〗､“”‘’")


def dump_json(path: Path, data, pretty: bool = False) -> None:
    if pretty:
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    else:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    path.write_text(text, encoding="utf-8")


def cn_to_int(text: str) -> int:
    digits = {ch: i for i, ch in enumerate(NUMERALS)}
    if len(text) == 1:
        return digits[text]
    if len(text) == 2:
        return digits[text[0]] * 10 + digits[text[1]]
    raise ValueError(text)


def clean_markup(text: str) -> str:
    text = re.sub(r"\{\{-\|.*?\}\}", "", text, flags=re.S)
    text = re.sub(r"<sup>.*?</sup>", "", text, flags=re.S)
    text = re.sub(r"</?sup>", "", text)
    text = re.sub(r"-\{([^}]+)\}-", r"\1", text)
    text = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\{\{[^}]+\}\}", "", text)
    text = re.sub(r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]", "", text)
    text = text.translate(VARIANTS)
    for old, new in CORRECTIONS:
        text = text.replace(old, new)
    # 沈著、沈雄是沉着、沉雄，不是姓沈。沈伯时不改。
    text = text.replace("沈著", "沉着").replace("沈雄", "沉雄")
    return text


def parse_entries(wikitext: str) -> list[dict]:
    parts = re.split(r"^===\s*(.+?)\s*===\s*$", wikitext, flags=re.M)
    entries = []
    for i in range(1, len(parts), 2):
        heading = clean_markup(parts[i]).strip()
        j = 0
        while j < len(heading) and heading[j] in NUMERALS:
            j += 1
        number = cn_to_int(heading[:j])
        title_t = heading[j:].strip(" 　").replace(",", "，")
        lines = []
        for line in clean_markup(parts[i + 1]).splitlines():
            line = re.sub(r"\s+", "", line)
            if line:
                lines.append(line)
        body_t = "".join(lines)
        entries.append({"n": number, "title_t": title_t, "body_t": body_t})
    entries.sort(key=lambda item: item["n"])
    return entries


def to_simplified(text: str) -> str:
    out = []
    for ch in text:
        simp = CC.convert(ch)
        if len(simp) != 1:
            raise SystemExit(f"简繁不对齐：{ch} -> {simp}")
        out.append(simp)
    return "".join(out)


def split_sentences(text: str) -> list[str]:
    sentences = []
    buf: list[str] = []
    depth = 0
    for ch in text:
        buf.append(ch)
        if ch == "「":
            depth += 1
        elif ch == "」":
            depth = max(0, depth - 1)
        elif ch in "。！？" and depth == 0:
            sentences.append("".join(buf))
            buf = []
    tail = "".join(buf)
    if tail:
        sentences.append(tail)
    return sentences


def tokens_for(trad: str, simp: str) -> list[dict]:
    rows = []
    for t_ch, s_ch in zip(trad, simp):
        if t_ch in PUNCT or s_ch in PUNCT:
            rows.append({"t": t_ch, "s": s_ch, "punct": True})
        else:
            rows.append({"t": t_ch, "s": s_ch, "py": "", "ctx": "", "pos": "", "extra": "", "level": "dict"})
    return rows


def article_for(entry: dict, lesson: dict | None) -> dict:
    trad_sents = split_sentences(entry["body_t"])
    simp_sents = [to_simplified(sent) for sent in trad_sents]
    title_t = entry["title_t"]
    title_s = to_simplified(title_t)
    sentences = []
    for trad, simp in zip(trad_sents, simp_sents):
        sentences.append({"tr": "", "tokens": tokens_for(trad, simp)})
    art = {
        "id": f"h01-{entry['n']:02d}",
        "volume": 1,
        "volumeTitle": "人间词话",
        "volumeSubtitle": "六十四则",
        "index": entry["n"],
        "title": {"t": title_t, "s": title_s},
        "book": {"t": "人間詞話", "s": "人间词话"},
        "sourceHead": {"t": "國粹學報本", "s": "国粹学报本"},
        "author": "王国维",
        "annotated": False,
        "paragraphs": [{"sentences": sentences}],
    }
    if lesson:
        trs = lesson.get("trs") or []
        if len(trs) != len(sentences):
            raise SystemExit(f"{art['id']} 译文 {len(trs)} 句，原文 {len(sentences)} 句")
        for sent, tr in zip(sentences, trs):
            sent["tr"] = tr.strip()
        art["lesson"] = lesson["lesson"]
        art["annotated"] = True
    return art


def catalog_for(articles: list[dict]) -> dict:
    return {
        "title": "人间词话",
        "author": "王国维",
        "edition": "光绪三十四年至宣统元年《国粹学报》已刊六十四则",
        "articleCount": len(articles),
        "annotatedCount": sum(1 for art in articles if art.get("annotated")),
        "volumes": [
            {
                "volume": 1,
                "title": "人间词话",
                "subtitle": "六十四则",
                "articles": [
                    {
                        "id": art["id"],
                        "index": art["index"],
                        "title": art["title"]["s"],
                        "titleT": art["title"]["t"],
                        "author": "王国维",
                        "book": "人间词话",
                        "annotated": art["annotated"],
                    }
                    for art in articles
                ],
            }
        ],
    }


def load_lessons() -> dict[str, dict]:
    found = {}
    if not LESSONS.is_dir():
        return found
    for path in sorted(LESSONS.glob("h01-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        found[data.get("id") or path.stem] = data
    return found


def main() -> int:
    entries = parse_entries(WIKI.read_text(encoding="utf-8"))
    if [item["n"] for item in entries] != list(range(1, 65)):
        print("则号不连续：", [item["n"] for item in entries])
        return 1
    if "--dump" in sys.argv:
        rows = []
        for entry in entries:
            trad = split_sentences(entry["body_t"])
            rows.append(
                {
                    "id": f"h01-{entry['n']:02d}",
                    "n": entry["n"],
                    "title": to_simplified(entry["title_t"]),
                    "titleT": entry["title_t"],
                    "sentences": [to_simplified(sent) for sent in trad],
                }
            )
        dump_json(DUMP, rows, pretty=True)
        print(f"写出 {DUMP} ，{len(rows)} 则，{sum(len(r['sentences']) for r in rows)} 句")
        return 0

    lessons = load_lessons()
    articles = [article_for(entry, lessons.get(f"h01-{entry['n']:02d}")) for entry in entries]
    ARTICLES.mkdir(parents=True, exist_ok=True)
    for art in articles:
        dump_json(ARTICLES / f"{art['id']}.json", art)
    dump_json(CATALOG, catalog_for(articles))
    missing = [art["id"] for art in articles if not art["annotated"]]
    print(f"篇目 {len(articles)}，已注 {len(articles) - len(missing)}")
    if missing:
        print("还没有课注：" + " ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
