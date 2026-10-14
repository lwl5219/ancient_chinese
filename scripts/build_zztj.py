# -*- coding: utf-8 -*-
"""从维基文库《资治通鉴》卷一至卷八生成周纪、秦纪篇目。

正文是司马光的纪事。标明「增补」或「据近人考证移入」的段落不收。
课注在 sources/zztj/lessons/。底本说明见 sources/zztj/EDITION.md。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "sources" / "zztj"
LESSONS = SRC / "lessons"
ARTICLES = ROOT / "data" / "articles"
CATALOG = ROOT / "data" / "zztj.json"
DUMP = SRC / "years.json"

CC = OpenCC("t2s")
VARIANTS = str.maketrans({"髙": "高", "籐": "藤", "鄕": "乡"})
PUNCT = set("，。！？；、：·．…—～「」『』（）【】《》〈〉〔〕〖〗､“”‘’")
CN_DIGIT = "〇一二三四五六七八九零○"
YEAR_RE = re.compile(r"^(.+?)([元一二三四五六七八九十百]+)年(.*)$")
RESTORE_MARK = ("章校", "十二行本")
SUPPLEMENT_MARK = ("增补", "增補", "移入", "移往", "近人")
HEADING_RE = re.compile(r"^(=+)\s*(.+?)\s*\1\s*$")
STOP_RE = re.compile(r"校刊|校記|校记|校改")

JUAN_ERA = {
    1: "zhou",
    2: "zhou",
    3: "zhou",
    4: "zhou",
    5: "zhou",
    6: "qin",
    7: "qin",
    8: "qin",
}

LATER_ERAS = [
    {"id": "han", "title": "汉纪", "juan": "卷九起", "note": "待添加"},
    {"id": "wei", "title": "魏纪", "juan": "卷六十起", "note": "待添加"},
    {"id": "jin", "title": "晋纪", "juan": "卷七十九起", "note": "待添加"},
    {"id": "song", "title": "宋纪", "juan": "卷一百一十九起", "note": "待添加"},
    {"id": "qi", "title": "齐纪", "juan": "卷一百三十五起", "note": "待添加"},
    {"id": "liang", "title": "梁纪", "juan": "卷一百四十五起", "note": "待添加"},
    {"id": "chen", "title": "陈纪", "juan": "卷一百六十七起", "note": "待添加"},
    {"id": "sui", "title": "隋纪", "juan": "卷一百七十七起", "note": "待添加"},
    {"id": "tang", "title": "唐纪", "juan": "卷一百八十五起", "note": "待添加"},
    {"id": "houliang", "title": "后梁纪", "juan": "卷二百六十六起", "note": "待添加"},
    {"id": "houtang", "title": "后唐纪", "juan": "卷二百七十二起", "note": "待添加"},
    {"id": "houjin", "title": "后晋纪", "juan": "卷二百八十起", "note": "待添加"},
    {"id": "houhan", "title": "后汉纪", "juan": "卷二百八十六起", "note": "待添加"},
    {"id": "houzhou", "title": "后周纪", "juan": "卷二百九十起", "note": "待添加"},
]


def dump_json(path: Path, data, pretty: bool = False) -> None:
    if pretty:
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    else:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    path.write_text(text, encoding="utf-8")


def to_simplified(text: str) -> str:
    out = []
    for ch in text:
        simp = CC.convert(ch)
        if len(simp) != 1:
            raise SystemExit(f"简繁不对齐：{ch} -> {simp}")
        out.append(simp)
    text = "".join(out)
    # OpenCC 把卦名「乾」收成「干」。乾坤不是干湿的干。
    text = text.replace("干坤", "乾坤")
    # 人名樊於期的於不是介词于。单独称「於期」也要留下。
    text = text.replace("樊于期", "樊於期").replace("于期太息", "於期太息")
    # 维基文库这一句没有顿号。代与光狼城是两处，取字管两者。
    return text.replace("取代光狼城", "取代、光狼城")


def clean_inline(text: str) -> str:
    text = text.replace("'''", "")
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"-\{([^}]+)\}-", r"\1", text)
    text = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\{\{\*\|(.*?)\}\}", r"（\1）", text)
    text = re.sub(r"\{\{[^}]+\}\}", "", text)
    text = text.translate(VARIANTS)
    return text


def classify_ref(ref: str) -> str:
    if any(mark in ref for mark in RESTORE_MARK):
        return "restore"
    if any(mark in ref for mark in SUPPLEMENT_MARK):
        return "supplement"
    if re.search(r"增[。．]?$", ref.strip()):
        return "supplement"
    if "补" in ref or "補" in ref:
        return "supplement"
    return "emend"


def transform_segment(segment: str, kind: str) -> str:
    if kind == "supplement":
        # 增补、移入的〔〕不是司马光原文；括号里留着的才是要删改前的字。
        segment = re.sub(r"〔[^〕]*〕", "", segment)
        segment = re.sub(r"\(([^)]*)\)", r"\1", segment)
        return segment
    segment = re.sub(r"〔([^〕]*)〕\(([^)]*)\)", r"\1", segment)
    segment = re.sub(r"\([^)]{1,16}\)", "", segment)
    segment = re.sub(r"〔([^〕]*)〕", r"\1", segment)
    return segment


def tidy_text(text: str) -> str:
    text = re.sub(r"[ \t\u3000]+", "", text)
    text = text.replace("。」。", "。」")
    text = text.replace("！」！", "！」")
    text = text.replace("？」？", "？」")
    text = re.sub(r"，{2,}", "，", text)
    text = re.sub(r"。{2,}", "。", text)
    # 删掉增补的名单之后，顿号会贴在逗号或句号前面。
    text = text.replace("、，", "，").replace("、。", "。")
    # 代与光狼城是两处。维基文库这一句没有顿号，繁简都补上，避免对不齐。
    text = text.replace("取代光狼城", "取代、光狼城")
    text = re.sub(r"^，+", "", text)
    text = re.sub(r"，。", "。", text)
    text = re.sub(r"。，", "。", text)
    return text


def apply_emendations(text: str) -> str:
    parts = re.split(r"<ref>(.*?)</ref>", text, flags=re.S)
    chunks = []
    for i, part in enumerate(parts):
        if i % 2 == 1:
            continue
        ref = parts[i + 1] if i + 1 < len(parts) else ""
        if ref:
            part = transform_segment(part, classify_ref(ref))
        chunks.append(part)
    text = "".join(chunks)
    text = transform_segment(text, "emend")
    return tidy_text(text)


def split_sentences(text: str) -> list[str]:
    sentences = []
    buf: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        buf.append(ch)
        i += 1
        if ch in "。！？":
            while i < len(text) and text[i] in "」』":
                buf.append(text[i])
                i += 1
            sentences.append("".join(buf))
            buf = []
    tail = "".join(buf).strip("，、；：")
    if tail:
        sentences.append(tail)
    cleaned = []
    for item in sentences:
        item = item.strip("，、；：")
        if item.strip("，。！？；、：「」『』"):
            cleaned.append(item)
    return cleaned


def paragraph_from_line(raw: str) -> str:
    line = raw.strip()
    if (
        not line
        or line.startswith(("{{", "[[", "|"))
        or line in {"}}", "}}"}
        or re.fullmatch(r"-{2,}", line)
    ):
        return ""
    line = re.sub(r"^:+", "", line).strip()
    line = re.sub(r"^'''\d+'''", "", line).strip()
    line = clean_inline(line)
    line = apply_emendations(line)
    line = line.strip("，、；： ")
    if not line or line in {"。", "，"}:
        return ""
    if re.fullmatch(r"[，。！？；、：\s]*", line):
        return ""
    return line


def cn_int(text: str) -> int | None:
    text = text.strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    if any(ch not in CN_DIGIT for ch in text):
        return None
    value = 0
    for ch in text:
        if ch in "〇○零":
            value *= 10
        else:
            value = value * 10 + "一二三四五六七八九".index(ch) + 1
    return value


def parse_heading(raw: str, last_king: str) -> tuple[str, dict | None]:
    heading = clean_inline(raw).strip()
    heading = re.sub(r"\s+", "", heading)
    if not heading or STOP_RE.search(heading):
        return last_king, None
    matched = YEAR_RE.match(heading)
    if not matched:
        king = re.sub(r"[上中下]$", "", heading)
        king = re.sub(r"^秦(?=昭襄|孝文|庄襄|莊襄|始皇)", "", king)
        if king and "纪" not in king and "紀" not in king and len(king) <= 6:
            return king, None
        return last_king, None
    king, num, rest = matched.group(1), matched.group(2), matched.group(3)
    if king in {"", "王"} and last_king:
        king = last_king
        heading = king + num + "年" + rest
    elif king:
        last_king = king
    title = f"{king}{num}年"
    date = ""
    ganzhi = ""
    inner = rest.strip("（）()")
    if inner:
        bits = re.split(r"[，,]", inner)
        if bits:
            ganzhi = bits[0].strip()
        year_bit = inner
        m = re.search(r"(?:西元)?前([〇○零一二三四五六七八九\d]+)年?", year_bit)
        if m:
            year = cn_int(m.group(1))
            if year:
                date = f"前{year}"
    return last_king, {
        "title_t": title,
        "date": date,
        "ganzhi": ganzhi,
        "heading_t": heading,
    }


def parse_juan(juan: int, text: str) -> tuple[str, list[dict]]:
    span = ""
    years: list[dict] = []
    last_king = ""
    current: dict | None = None
    stopped = False
    for raw in text.splitlines():
        heading_match = HEADING_RE.match(raw.strip())
        if heading_match:
            level = len(heading_match.group(1))
            title_raw = heading_match.group(2)
            if STOP_RE.search(clean_inline(title_raw)):
                stopped = True
                current = None
                continue
            if level == 1 and ("纪" in title_raw or "紀" in title_raw):
                current = None
                continue
            last_king, meta = parse_heading(title_raw, last_king)
            current = None
            if meta:
                meta["paragraphs_t"] = []
                years.append(meta)
                current = meta
            continue
        if stopped:
            continue
        stripped = raw.strip()
        if stripped.startswith("'''起") and not span:
            span = apply_emendations(clean_inline(stripped))
            continue
        if current is None:
            continue
        paragraph = paragraph_from_line(raw)
        if paragraph:
            current["paragraphs_t"].append(paragraph)
    kept = []
    for year in years:
        paragraphs = []
        for paragraph in year["paragraphs_t"]:
            sentences = split_sentences(paragraph)
            if sentences:
                paragraphs.append(sentences)
        if not paragraphs:
            continue
        year["paragraphs_t"] = paragraphs
        kept.append(year)
    return span, kept


def tokens_for(trad: str, simp: str) -> list[dict]:
    rows = []
    for t_ch, s_ch in zip(trad, simp):
        if t_ch in PUNCT or s_ch in PUNCT:
            rows.append({"t": t_ch, "s": s_ch, "punct": True})
        else:
            rows.append({"t": t_ch, "s": s_ch, "py": "", "ctx": "", "pos": "", "extra": "", "level": "dict"})
    return rows


def load_years() -> list[dict]:
    entries = []
    for juan in range(1, 9):
        path = SRC / f"juan{juan:02d}.wikitext"
        span, years = parse_juan(juan, path.read_text(encoding="utf-8"))
        for index, year in enumerate(years, 1):
            paragraphs_s = []
            for paragraph in year["paragraphs_t"]:
                paragraphs_s.append([to_simplified(sent) for sent in paragraph])
            title_s = to_simplified(year["title_t"])
            entries.append({
                "id": f"z{juan:02d}-{index:02d}",
                "juan": juan,
                "era": JUAN_ERA[juan],
                "index": index,
                "title_t": year["title_t"],
                "title_s": title_s,
                "date": year["date"],
                "ganzhi": to_simplified(year["ganzhi"]),
                "span": to_simplified(span),
                "paragraphs_t": year["paragraphs_t"],
                "paragraphs_s": paragraphs_s,
            })
    return entries


def sentence_count(entry: dict) -> int:
    return sum(len(paragraph) for paragraph in entry["paragraphs_s"])


def article_for(entry: dict, lesson: dict | None) -> dict:
    trs = list(lesson["trs"]) if lesson else []
    cursor = 0
    paragraphs = []
    for trad_p, simp_p in zip(entry["paragraphs_t"], entry["paragraphs_s"]):
        sentences = []
        for trad, simp in zip(trad_p, simp_p):
            if len(trad) != len(simp):
                raise SystemExit(f"{entry['id']} 简繁长度不一致：{trad} / {simp}")
            tr = trs[cursor] if cursor < len(trs) else ""
            cursor += 1
            sentences.append({"tr": tr, "tokens": tokens_for(trad, simp)})
        paragraphs.append({"sentences": sentences})
    art = {
        "id": entry["id"],
        "volume": entry["juan"],
        "volumeTitle": volume_title(entry),
        "volumeSubtitle": entry["date"] or "",
        "index": entry["index"],
        "title": {"t": entry["title_t"], "s": entry["title_s"]},
        "book": {"t": "資治通鑑", "s": "资治通鉴"},
        "sourceHead": {"t": source_head(entry, trad=True), "s": source_head(entry, trad=False)},
        "author": "司马光",
        "annotated": bool(lesson),
        "paragraphs": paragraphs,
    }
    if lesson:
        art["lesson"] = lesson["lesson"]
    return art


def volume_title(entry: dict) -> str:
    names = {
        1: "周纪一",
        2: "周纪二",
        3: "周纪三",
        4: "周纪四",
        5: "周纪五",
        6: "秦纪一",
        7: "秦纪二",
        8: "秦纪三",
    }
    return names[entry["juan"]]


def source_head(entry: dict, trad: bool) -> str:
    title = volume_title(entry)
    date = entry["date"]
    ganzhi = entry["ganzhi"]
    bits = [title]
    if date:
        bits.append(date)
    if ganzhi:
        bits.append(ganzhi)
    text = " · ".join(bits)
    return text if not trad else to_traditional_head(text)


def to_traditional_head(text: str) -> str:
    table = str.maketrans({
        "周": "周",
        "纪": "紀",
        "秦": "秦",
        "一": "一",
        "二": "二",
        "三": "三",
        "四": "四",
        "五": "五",
        "前": "前",
    })
    return text.translate(table)


def catalog_for(entries: list[dict]) -> dict:
    volumes = []
    for juan in range(1, 9):
        group = [item for item in entries if item["juan"] == juan]
        if not group:
            continue
        articles = []
        for item in group:
            articles.append({
                "id": item["id"],
                "index": item["index"],
                "title": item["title_s"],
                "titleT": item["title_t"],
                "date": item["date"],
                "author": "司马光",
            })
        volumes.append({
            "volume": juan,
            "era": JUAN_ERA[juan],
            "title": volume_title(group[0]),
            "subtitle": f"{group[0]['title_s']}至{group[-1]['title_s']}",
            "span": group[0]["span"],
            "articles": articles,
        })
    return {
        "title": "资治通鉴",
        "author": "司马光",
        "articleCount": len(entries),
        "scope": "周纪、秦纪（卷一至卷八）",
        "volumes": volumes,
        "later": LATER_ERAS,
    }


def load_lesson(entry: dict) -> dict:
    direct = LESSONS / f"{entry['id']}.json"
    if direct.exists():
        return json.loads(direct.read_text(encoding="utf-8"))
    parts = sorted((LESSONS / "parts").glob(f"{entry['id']}-*.json"))
    lesson_path = LESSONS / f"{entry['id']}.lesson.json"
    if not parts or not lesson_path.exists():
        raise FileNotFoundError(entry["id"])
    trs: list[str] = []
    for path in parts:
        data = json.loads(path.read_text(encoding="utf-8"))
        trs.extend(data["trs"])
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    body = lesson.get("lesson") if isinstance(lesson.get("lesson"), dict) else lesson
    return {"id": entry["id"], "trs": trs, "lesson": body}


def write_articles(entries: list[dict]) -> None:
    missing = []
    for entry in entries:
        try:
            load_lesson(entry)
        except FileNotFoundError:
            missing.append(entry["id"])
    if missing:
        raise SystemExit(f"缺课注 {len(missing)} 篇，例如 {', '.join(missing[:8])}")
    ARTICLES.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        lesson = load_lesson(entry)
        expected = sentence_count(entry)
        if lesson.get("id") != entry["id"]:
            raise SystemExit(f"{entry['id']} 课注 id 不符")
        if len(lesson.get("trs") or []) != expected:
            raise SystemExit(f"{entry['id']} 译文 {len(lesson.get('trs') or [])} 句，原文 {expected} 句")
        dump_json(ARTICLES / f"{entry['id']}.json", article_for(entry, lesson))
    dump_json(CATALOG, catalog_for(entries))


def write_dump(entries: list[dict]) -> None:
    payload = []
    for entry in entries:
        payload.append({
            "id": entry["id"],
            "juan": entry["juan"],
            "index": entry["index"],
            "title": entry["title_s"],
            "date": entry["date"],
            "sentences": sentence_count(entry),
            "paragraphs": entry["paragraphs_s"],
        })
    dump_json(DUMP, payload, pretty=True)


def report(entries: list[dict]) -> None:
    print(f"years {len(entries)} sentences {sum(sentence_count(item) for item in entries)}")
    for juan in range(1, 9):
        group = [item for item in entries if item["juan"] == juan]
        chars = sum(len(sent) for item in group for para in item["paragraphs_s"] for sent in para)
        print(f"  juan {juan} {volume_title(group[0]) if group else '?'} years {len(group)} chars {chars}")
    first = entries[0]
    print("FIRST", first["id"], first["title_s"], first["date"])
    print(first["paragraphs_s"][0][0][:80])
    dirty = []
    for entry in entries:
        blob = "".join(sent for para in entry["paragraphs_s"] for sent in para)
        if any(mark in blob for mark in ("〔", "〕", "<", ">", "{", "}", "'''", "==")):
            dirty.append(entry["id"])
    print("dirty", dirty[:12], "count", len(dirty))


def main() -> None:
    entries = load_years()
    if "--write" in sys.argv:
        write_articles(entries)
        print(f"wrote {len(entries)} articles")
        return
    if "--catalog" in sys.argv:
        dump_json(CATALOG, catalog_for(entries))
        print(f"catalog {len(entries)}")
        return
    write_dump(entries)
    report(entries)


if __name__ == "__main__":
    main()
