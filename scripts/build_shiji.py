# -*- coding: utf-8 -*-
"""从维基文库《史記》生成史记篇目。

正文是司马迁的本文和「太史公曰」，不收三家注，也不收篇末的【索隱述贊】。
一篇一页。课注在 sources/shiji/lessons/，长篇的白话分段写在 parts/。
句中读音写在 sources/shiji/readings/{id}.json。底本说明见 sources/shiji/EDITION.md。

用法：
  python3 scripts/build_shiji.py          打印解析结果，写 sources/shiji/texts.json
  python3 scripts/build_shiji.py --write  写 data/articles/s*.json 和 data/shiji.json
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from opencc import OpenCC
from pypinyin import Style, pinyin

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "sources" / "shiji"
LESSONS = SRC / "lessons"
READINGS = SRC / "readings"
ARTICLES = ROOT / "data" / "articles"
CATALOG = ROOT / "data" / "shiji.json"
DUMP = SRC / "texts.json"
URL = "https://zh.wikisource.org/wiki/史記/卷{juan:03d}"

CC = OpenCC("t2s")
PUNCT = set("，。！？；、：·．…—～「」『』（）【】《》〈〉〔〕〖〗､“”‘’")
CN_NUM = "〇一二三四五六七八九十百"

# 已收的篇。以后每做一篇，在这里加卷号。
DONE = [7]

GROUPS = [
    ("benji", "本纪", 1, 12),
    ("biao", "表", 13, 22),
    ("shu", "书", 23, 30),
    ("shijia", "世家", 31, 60),
    ("liezhuan", "列传", 61, 130),
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
        # 史记里的「閒」都是间隔、间道、离间的间，人名涉閒、田閒也读间。OpenCC 收成「闲」，这里改作「间」。
        simp = "间" if ch == "閒" else CC.convert(ch)
        if len(simp) != 1:
            raise SystemExit(f"简繁不对齐：{ch} -> {simp}")
        out.append(simp)
    text = "".join(out)
    # 繁简转换的误收，逐条改回。
    text = text.replace("干坤", "乾坤")
    return text


def clean_inline(text: str) -> str:
    text = text.replace("'''", "")
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"-\{([^}]+)\}-", r"\1", text)
    text = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\{\{[^}]+\}\}", "", text)
    text = re.sub(r"[ \t\u3000]+", "", text)
    return text.strip()


def emend(text: str) -> str:
    """维基文库本的个别字。每一条都记在 EDITION.md。"""
    # 维基文库照中华书局点校本标校改：圆括号里是删去的字，方括号里是补入或改正的字。
    text = re.sub(r"（[^）]*）", "", text)
    text = re.sub(r"［([^］]*)］", r"\1", text)
    # 鸿门宴范增所举是玉玦。中华书局点校本、《资治通鉴》卷九都作「玦」，维基文库作「玉珪」。
    text = text.replace("舉所佩玉珪", "舉所佩玉玦")
    # 「烹周苛，并殺樅公」。维基文库作「井殺」，形近而误，据中华书局点校本改。
    text = text.replace("烹周苛，井殺樅公", "烹周苛，并殺樅公")
    # 维基文库漏掉的标点。
    text = text.replace("公為我獻之」張良曰", "公為我獻之。」張良曰")
    text = text.replace("沛公曰「", "沛公曰：「")
    if "□" in text:
        raise SystemExit(f"正文有 □，要先查证再补字：{text[:40]}")
    return text


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
    return [s for s in (item.strip("，、；：") for item in sentences) if s.strip("，。！？；、：「」『』")]


def parse_index() -> list[dict]:
    raw = (SRC / "index.wikitext").read_text(encoding="utf-8")
    rows = []
    for m in re.finditer(r"^\*\[\[史記/卷(\d{3})\|[^\]]+\]\][\s　]*(.+?)\s*$", raw, flags=re.M):
        juan = int(m.group(1))
        full_t = clean_inline(m.group(2))
        title_t = re.sub(r"第[" + CN_NUM + r"]+$", "", full_t)
        rows.append({"juan": juan, "full_t": full_t, "title_t": title_t, "title_s": to_simplified(title_t)})
    if [row["juan"] for row in rows] != list(range(1, 131)):
        raise SystemExit("目录不是卷一至卷一百三十")
    return rows


def parse_juan(juan: int) -> list[list[str]]:
    raw = (SRC / f"juan{juan:03d}.wikitext").read_text(encoding="utf-8")
    body = raw.split("}}", 1)[1]
    paragraphs = []
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith(("__", "{{", "==", "|", "[[")):
            continue
        # 篇末的【索隱述贊】是司马贞写的，不是史记本文。
        if line.startswith("【"):
            continue
        text = emend(clean_inline(line))
        sents = split_sentences(text)
        if sents:
            paragraphs.append(sents)
    return paragraphs


def article_id(juan: int) -> str:
    return f"s{juan:03d}"


def group_for(juan: int) -> tuple[str, str]:
    for gid, label, lo, hi in GROUPS:
        if lo <= juan <= hi:
            return gid, label
    raise ValueError(juan)


def cn_juan(n: int) -> str:
    digits = "〇一二三四五六七八九"
    if n < 10:
        return digits[n]
    if n < 20:
        return "十" + (digits[n % 10] if n % 10 else "")
    if n < 100:
        return digits[n // 10] + "十" + (digits[n % 10] if n % 10 else "")
    rest = n % 100
    head = "一百"
    if rest == 0:
        return head
    if rest < 10:
        return head + "零" + digits[rest]
    return head + ("一" + cn_juan(rest) if rest < 20 else cn_juan(rest))


def load_entries() -> list[dict]:
    index = {row["juan"]: row for row in parse_index()}
    entries = []
    for juan in DONE:
        row = index[juan]
        paras_t = parse_juan(juan)
        paras_s = [[to_simplified(s) for s in p] for p in paras_t]
        entries.append({**row, "id": article_id(juan), "paragraphs_t": paras_t, "paragraphs_s": paras_s})
    return entries


def sentence_count(entry: dict) -> int:
    return sum(len(p) for p in entry["paragraphs_s"])


def load_lesson(entry: dict) -> dict:
    parts = sorted((LESSONS / "parts").glob(f"{entry['id']}-*.json"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
    lesson_path = LESSONS / f"{entry['id']}.lesson.json"
    if not parts or not lesson_path.exists():
        raise FileNotFoundError(entry["id"])
    trs: list[str] = []
    for path in parts:
        trs.extend(json.loads(path.read_text(encoding="utf-8"))["trs"])
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    return {"id": entry["id"], "trs": trs, "lesson": lesson["lesson"]}


def load_readings(entry: dict) -> dict:
    path = READINGS / f"{entry['id']}.json"
    if not path.exists():
        return {"defaults": [], "readings": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"defaults": data.get("defaults", []), "readings": data["readings"]}


def apply_readings(entry: dict, sentences: list[list[dict]], spec: dict) -> None:
    """句中读音。每条给一个上下文片段 ctx、片段里第几个字 at（从 0 起）和读音 py。

    片段在全篇简体正文里每次出现都套用；一次都没有对上就报错。
    """
    flat = []
    for sent_tokens in sentences:
        for tok in sent_tokens:
            flat.append(tok)
    text = "".join(tok["s"] for tok in flat)
    # 本篇默认读音：整篇几乎只有一种读法的多音字，先统一给字典级读音，再由下面的句中规则覆盖。
    for rule in spec["defaults"]:
        allowed = set(pinyin(rule["char"], style=Style.TONE, heteronym=True)[0])
        if rule["py"] not in allowed:
            raise SystemExit(f"{entry['id']} 默认读音不对：{rule}")
        for tok in flat:
            if tok["s"] == rule["char"]:
                tok["py"] = rule["py"]
    for rule in spec["readings"]:
        ctx, at, py = rule["ctx"], rule["at"], rule["py"]
        if not (0 <= at < len(ctx)) or ctx[at] in PUNCT or len(py.split()) != 1:
            raise SystemExit(f"{entry['id']} 读音规则不对：{rule}")
        # 通假字按本字读，读音从本字查。
        allowed = set(pinyin(rule.get("loan") or ctx[at], style=Style.TONE, heteronym=True)[0])
        if py not in allowed:
            raise SystemExit(f"{entry['id']} {ctx[at]} 没有 {py} 这个读音：{sorted(allowed)}")
        hits = [m.start() for m in re.finditer(re.escape(ctx), text)]
        if not hits:
            raise SystemExit(f"{entry['id']} 读音规则没对上原文：{ctx}")
        rule["_hits"] = len(hits)
        for start in hits:
            tok = flat[start + at]
            tok["py"] = py
            tok["level"] = "sentence"
            tok["ctx"] = rule.get("note", "")


def tokens_for(trad: str, simp: str) -> list[dict]:
    rows = []
    for t_ch, s_ch in zip(trad, simp):
        if t_ch in PUNCT or s_ch in PUNCT:
            rows.append({"t": t_ch, "s": s_ch, "punct": True})
        else:
            rows.append({"t": t_ch, "s": s_ch, "py": "", "ctx": "", "pos": "", "extra": "", "level": "dict"})
    return rows


def article_for(entry: dict, lesson: dict) -> dict:
    trs = lesson["trs"]
    cursor = 0
    paragraphs = []
    token_rows = []
    for trad_p, simp_p in zip(entry["paragraphs_t"], entry["paragraphs_s"]):
        sentences = []
        for trad, simp in zip(trad_p, simp_p):
            if len(trad) != len(simp):
                raise SystemExit(f"{entry['id']} 简繁长度不一致：{trad}")
            toks = tokens_for(trad, simp)
            token_rows.append(toks)
            sentences.append({"tr": trs[cursor], "tokens": toks})
            cursor += 1
        paragraphs.append({"sentences": sentences})
    apply_readings(entry, token_rows, load_readings(entry))
    gid, label = group_for(entry["juan"])
    head = f"{label} · 卷{cn_juan(entry['juan'])}"
    return {
        "id": entry["id"],
        "volume": entry["juan"],
        "volumeTitle": label,
        "volumeSubtitle": f"卷{cn_juan(entry['juan'])}",
        "index": entry["juan"],
        "title": {"t": entry["title_t"], "s": entry["title_s"]},
        "book": {"t": "史記", "s": "史记"},
        "sourceHead": {"t": f"{entry['full_t']}", "s": head},
        "author": "司马迁",
        "annotated": True,
        "paragraphs": paragraphs,
        "lesson": lesson["lesson"],
    }


def catalog_for(entries: list[dict]) -> dict:
    done = {e["juan"]: e for e in entries}
    volumes = []
    for gid, label, lo, hi in GROUPS:
        items = []
        articles = []
        for row in parse_index():
            if not lo <= row["juan"] <= hi:
                continue
            item = {"juan": row["juan"], "title": row["title_s"], "titleT": row["title_t"]}
            if row["juan"] in done:
                item["id"] = article_id(row["juan"])
                articles.append({
                    "id": item["id"], "index": row["juan"], "title": row["title_s"],
                    "titleT": row["title_t"], "date": f"卷{cn_juan(row['juan'])}", "author": "司马迁",
                })
            else:
                item["note"] = "待添加"
            items.append(item)
        volumes.append({"volume": len(volumes) + 1, "group": gid, "title": label,
                        "subtitle": f"卷{cn_juan(lo)}至卷{cn_juan(hi)}", "entries": items, "articles": articles})
    return {"title": "史记", "author": "司马迁", "articleCount": len(entries), "total": 130,
            "source": "维基文库《史記》", "volumes": volumes}


def extend_dict(entries: list[dict]) -> None:
    path = ROOT / "data" / "dict.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    chars = payload["chars"]
    need = set()
    for entry in entries:
        for para in entry["paragraphs_t"]:
            for sent in para:
                need.update(ch for ch in sent if ch not in PUNCT and ch not in chars)
    if not need:
        return
    sys.path.insert(0, str(ROOT / "scripts"))
    from build_site import build_dict

    chars.update(build_dict(need))
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"dict +{len(need)}: {''.join(sorted(need))}")


def han_only(text: str) -> str:
    return "".join(ch for ch in text if "\u3400" <= ch <= "\u9fff" or ord(ch) > 0xFFFF)


def merge_famous(entries: list[dict]) -> None:
    """课注里的名句写进 data/famous.json。先去掉本书旧条目，再按篇加回。"""
    path = ROOT / "data" / "famous.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    ids = {e["id"] for e in entries}
    data["lines"] = [l for l in data["lines"] if not any(re.fullmatch(r"s\d{3}", p) for p in l.get("pieces", []))]
    for key in [k for k in data["pieces"] if re.fullmatch(r"s\d{3}", k)]:
        del data["pieces"][key]
    for entry in entries:
        famous = json.loads((LESSONS / f"{entry['id']}.lesson.json").read_text(encoding="utf-8")).get("famous", [])
        sentences = [s for p in entry["paragraphs_s"] for s in p]
        for item in famous:
            quote = han_only(item["quote"])
            hits = [s for s in sentences if quote in han_only(s)]
            if len(quote) < 3 or not hits:
                raise SystemExit(f"{entry['id']} 名句对不上原文：{item['quote']}")
            data["lines"].append({"pieces": [entry["id"]], "quote": item["quote"], "text": hits[0],
                                  "fame": item["fame"], "vernacular": item["vernacular"],
                                  "appreciate": item["appreciate"]})
        if famous:
            data["pieces"][entry["id"]] = {"collection": famous[0]["fame"] if any(f["fame"] != "通行名句" for f in famous) else "通行名句"}
    assert ids
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write(entries: list[dict]) -> None:
    for entry in entries:
        lesson = load_lesson(entry)
        if len(lesson["trs"]) != sentence_count(entry):
            raise SystemExit(f"{entry['id']} 译文 {len(lesson['trs'])} 句，原文 {sentence_count(entry)} 句")
        dump_json(ARTICLES / f"{entry['id']}.json", article_for(entry, lesson))
    dump_json(CATALOG, catalog_for(entries))
    merge_famous(entries)
    extend_dict(entries)


def main() -> None:
    entries = load_entries()
    if "--write" in sys.argv:
        write(entries)
        print(f"wrote {len(entries)} articles")
        return
    dump_json(DUMP, [{"id": e["id"], "title": e["title_s"], "sentences": sentence_count(e),
                      "paragraphs": e["paragraphs_s"]} for e in entries], pretty=True)
    for e in entries:
        chars = sum(len(s) for p in e["paragraphs_s"] for s in p)
        print(e["id"], e["title_s"], "paragraphs", len(e["paragraphs_s"]), "sentences", sentence_count(e), "chars", chars)


if __name__ == "__main__":
    main()
