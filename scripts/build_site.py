# -*- coding: utf-8 -*-
"""把维基文库原文、卷一手工标注和《说文》字头编成静态站点数据。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import opencc
from pypinyin import Style, pinyin

from build_dict import load_shuowen
from hanzi import is_han, only_han
from parse_wikisource import parse_volume, split_sentences

SRC = ROOT / "sources" / "wikisource"
OUT = ROOT / "data"
T2S = opencc.OpenCC("t2s")
S2T = opencc.OpenCC("s2t")

TITLE_AUTHOR = {
    "卜居": "屈原",
    "宋玉對楚王問": "宋玉",
    "李斯諫逐客書": "李斯",
    "諫逐客書": "李斯",
    "樂毅報燕王書": "乐毅",
    "諸葛亮前出師表": "诸葛亮",
    "諸葛亮後出師表": "诸葛亮",
}

BOOK_FIX = {
    "國策": "戰國策",
    "秦文": "李斯",
}


def simplify(text: str) -> str:
    """不要用这个函数发布简体正文。

    OpenCC 会把乾坤收成干坤、流徵收成流征、禕收成袆。
    已发布的简体字段按《简化字总表》里中华书局简体古籍的通行归并手核，
    不靠这里整篇转换。
    """
    raw = text or ""
    out = []
    for i, ch in enumerate(raw):
        nxt = raw[i + 1] if i + 1 < len(raw) else ""
        prev = raw[i - 1] if i else ""
        if ch == "乾" and nxt in ("坤", "谿"):
            out.append("乾")
        elif ch == "徵" and prev == "流":
            out.append("徵")
        else:
            simp = T2S.convert(ch)
            out.append(simp if len(simp) == 1 else ch)
    return "".join(out)


def pinyin_of(text: str) -> str:
    parts = []
    for ch in text:
        if not is_han(ch):
            continue
        py = pinyin(ch, style=Style.TONE, errors="ignore")
        parts.append(py[0][0] if py and py[0] else ch)
    return " ".join(parts)


def normalize_paragraph(paragraph: str) -> str:
    paragraph = paragraph.replace("。。", "。")
    # 部分卷次用顿号充当句读，几乎不用句号。
    if paragraph.count("、") >= 8 and paragraph.count("。") <= 1:
        paragraph = paragraph.replace("、", "，")
    return paragraph


def breakup_long(sentence: str, limit: int = 72) -> list[str]:
    sentence = sentence.strip()
    if len(sentence) <= limit or "，" not in sentence:
        return [sentence] if sentence else []
    chunks: list[str] = []
    buf = ""
    for piece in sentence.split("，"):
        piece = piece.strip()
        if not piece:
            continue
        nxt = piece if not buf else buf + "，" + piece
        if buf and len(nxt) > limit:
            chunks.append(buf + "，")
            buf = piece
        else:
            buf = nxt
    if buf:
        chunks.append(buf)
    return chunks


def sentences_from_paragraph(paragraph: str) -> list[str]:
    paragraph = normalize_paragraph(paragraph)
    rough = split_sentences(paragraph)
    out: list[str] = []
    for sent in rough:
        out.extend(breakup_long(sent))
    return [s for s in out if s.strip()]


def char_tokens(sentence: str) -> list[dict]:
    tokens = []
    buf = []

    def flush_punct():
        if buf:
            raw = "".join(buf)
            tokens.append({"t": raw, "s": raw, "punct": True})
            buf.clear()

    for ch in sentence:
        if is_han(ch):
            flush_punct()
            tokens.append(
                {
                    "t": ch,
                    "s": simplify(ch),
                    "py": "",
                    "ctx": "",
                    "pos": "",
                    "extra": "",
                    "level": "dict",
                }
            )
        else:
            buf.append(ch)
    flush_punct()
    return tokens


def align_sentence(sentence: str, glosses: list) -> list[dict]:
    tokens: list[dict] = []
    si = 0
    gi = 0
    n = len(sentence)
    while si < n:
        if not is_han(sentence[si]):
            j = si
            while j < n and not is_han(sentence[j]):
                j += 1
            raw = sentence[si:j]
            tokens.append({"t": raw, "s": raw, "punct": True})
            si = j
            continue
        if gi >= len(glosses):
            raise SystemExit(f"标注短于句子：{sentence[si:]} || {sentence}")
        item = glosses[gi]
        word, py, ctx = item[0], item[1], item[2]
        pos = item[3] if len(item) > 3 else ""
        extra = item[4] if len(item) > 4 else ""
        if sentence[si : si + len(word)] != word:
            raise SystemExit(
                "标注与原文对不齐：\n"
                f"  句：{sentence}\n"
                f"  期望「{word}」，实际「{sentence[si:si+len(word)+6]}」"
            )
        tokens.append(
            {
                "t": word,
                "s": simplify(word),
                "py": py,
                "ctx": ctx,
                "pos": pos,
                "extra": extra,
                "level": "sentence",
            }
        )
        si += len(word)
        gi += 1
    if gi != len(glosses):
        raise SystemExit(f"标注未用完：{sentence} / {glosses[gi:]}")
    return tokens


def load_source_articles() -> list[dict]:
    articles = []
    for vol in range(1, 13):
        text = (SRC / f"vol{vol:02d}.wikitext").read_text(encoding="utf-8")
        articles.extend(parse_volume(vol, text))
    if len(articles) != 222:
        raise SystemExit(f"篇数应为 222，实际 {len(articles)}")
    return articles


def apply_author(article: dict) -> str:
    title = article["title"]
    if title in TITLE_AUTHOR:
        return TITLE_AUTHOR[title]
    book = BOOK_FIX.get(article["book"], article["book"])
    article["book"] = book
    return article["author"]


def article_hanzi(paragraphs: list[str]) -> str:
    return only_han("".join(paragraphs))


def annotated_payload(src: dict, note: dict) -> dict:
    paragraphs = []
    han_parts = []
    for para in note["paragraphs"]:
        sentences = []
        for sent in para:
            han_parts.append(only_han(sent["text"]))
            sentences.append(
                {
                    "tr": sent["tr"],
                    "tokens": align_sentence(sent["text"], sent["gl"]),
                }
            )
        paragraphs.append({"sentences": sentences})
    got = "".join(han_parts)
    expect = article_hanzi(src["paragraphs"])
    if got != expect:
        raise SystemExit(diff_han(src["id"], src["title"], expect, got))
    lesson = note["lesson"]
    required = [
        "background",
        "keyContentWords",
        "keyFunctionWords",
        "ancientModern",
        "phoneticLoans",
        "flexibleUsage",
        "specialSyntax",
        "theme",
        "technique",
    ]
    for key in required:
        if not lesson.get(key):
            raise SystemExit(f"{src['id']} 讲解缺少 {key}")
    return {
        "annotated": True,
        "paragraphs": paragraphs,
        "lesson": lesson,
    }


def diff_han(aid: str, title: str, expect: str, got: str) -> str:
    lines = [f"{aid} {title} 汉字序列与维基文库底本不一致", f"底本 {len(expect)} 字，标注 {len(got)} 字"]
    # 找第一处差异
    n = min(len(expect), len(got))
    i = 0
    while i < n and expect[i] == got[i]:
        i += 1
    lines.append(f"第 {i} 字起：底本「{expect[i:i+24]}」标注「{got[i:i+24]}」")
    return "\n".join(lines)


def plain_payload(src: dict) -> dict:
    paragraphs = []
    for para in src["paragraphs"]:
        sentences = []
        for sent in sentences_from_paragraph(para):
            sentences.append({"tr": "", "tokens": char_tokens(sent)})
        if sentences:
            paragraphs.append({"sentences": sentences})
    return {"annotated": False, "paragraphs": paragraphs, "lesson": None}


def collect_chars(articles: list[dict]) -> set[str]:
    chars = set()
    for art in articles:
        for para in art["paragraphs"]:
            for sent in para["sentences"]:
                for tok in sent["tokens"]:
                    if tok.get("punct"):
                        continue
                    for ch in tok["t"]:
                        if is_han(ch):
                            chars.add(ch)
    return chars


def build_dict(chars: set[str]) -> dict:
    shuowen = load_shuowen()
    out = {}
    for ch in chars:
        entry = shuowen.get(ch)
        if entry is None:
            trad = S2T.convert(ch)
            if trad != ch:
                entry = shuowen.get(trad)
        ben = entry["ben"] if entry else ""
        out[ch] = {
            "py": (entry or {}).get("py") or pinyin_of(ch),
            "fanqie": (entry or {}).get("fanqie") or "",
            "ben": ben,
            "benS": simplify(ben) if ben else "",
            "inShuowen": bool(entry),
        }
    return out


def public_article(src: dict, body: dict) -> dict:
    book = src["book"]
    return {
        "id": src["id"],
        "volume": src["volume"],
        "volumeTitle": src["volumeTitle"],
        "volumeSubtitle": src["volumeSubtitle"],
        "index": src["index"],
        "title": {"t": src["title"], "s": simplify(src["title"])},
        "book": {"t": book, "s": simplify(book)},
        "sourceHead": {"t": src["sourceHead"], "s": simplify(src["sourceHead"])},
        "author": simplify(apply_author(src)) if False else apply_author(src),
        "annotated": body["annotated"],
        "paragraphs": body["paragraphs"],
        "lesson": body["lesson"],
        "classicComment": {
            "t": src["classicComment"],
            "s": simplify(src["classicComment"]),
        },
    }


def main() -> None:
    from annotations.volume1 import ARTICLES

    notes = {item["id"]: item for item in ARTICLES}
    source = load_source_articles()
    built = []
    for src in source:
        apply_author(src)
        if src["id"] in notes:
            body = annotated_payload(src, notes[src["id"]])
        else:
            body = plain_payload(src)
        built.append(public_article(src, body))

    missing = [i for i in range(1, 19) if f"v01-{i:02d}" not in notes]
    if missing:
        raise SystemExit(f"卷一未标注篇目：{missing}")

    chars = collect_chars(built)
    dictionary = build_dict(chars)
    covered = sum(1 for ch in chars if dictionary[ch]["inShuowen"])

    OUT.mkdir(parents=True, exist_ok=True)
    art_dir = OUT / "articles"
    art_dir.mkdir(exist_ok=True)
    # 清掉旧篇，避免篇目变动后残留
    for old in art_dir.glob("*.json"):
        old.unlink()

    catalog_volumes: dict[int, dict] = {}
    for art in built:
        vol = art["volume"]
        catalog_volumes.setdefault(
            vol,
            {
                "volume": vol,
                "title": art["volumeTitle"],
                "subtitle": art["volumeSubtitle"],
                "articles": [],
            },
        )
        catalog_volumes[vol]["articles"].append(
            {
                "id": art["id"],
                "index": art["index"],
                "title": art["title"]["s"],
                "titleT": art["title"]["t"],
                "author": art["author"],
                "book": art["book"]["s"],
                "annotated": art["annotated"],
            }
        )
        (art_dir / f"{art['id']}.json").write_text(
            json.dumps(art, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    catalog = {
        "title": "古文观止",
        "editor": "吴楚材、吴调侯",
        "year": 1695,
        "articleCount": len(built),
        "annotatedCount": sum(1 for a in built if a["annotated"]),
        "volumes": [catalog_volumes[i] for i in range(1, 13)],
    }
    (OUT / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (OUT / "dict.json").write_text(
        json.dumps(
            {
                "source": "shuowenjiezi/shuowen",
                "license": "Apache-2.0",
                "chars": dictionary,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    meta = {
        "articles": len(built),
        "annotated": catalog["annotatedCount"],
        "chars": len(chars),
        "shuowenHit": covered,
        "shuowenMiss": len(chars) - covered,
    }
    (OUT / "build-meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    main()
