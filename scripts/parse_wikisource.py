# -*- coding: utf-8 -*-
"""Parse zh.wikisource 《古文观止》 volume wikitext into structured articles."""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

VOL_META = {
    1: ("卷一", "周文"),
    2: ("卷二", "周文"),
    3: ("卷三", "周文"),
    4: ("卷四", "秦文"),
    5: ("卷五", "汉文"),
    6: ("卷六", "汉文"),
    7: ("卷七", "六朝唐文"),
    8: ("卷八", "唐文"),
    9: ("卷九", "唐宋文"),
    10: ("卷十", "宋文"),
    11: ("卷十一", "宋文"),
    12: ("卷十二", "明文"),
}

# 书名（繁体，与维基文库出处行一致）→ 作者展示名
BOOK_AUTHOR = {
    "左傳": "左丘明",
    "國語": "左丘明",
    "公羊傳": "公羊高",
    "穀梁傳": "穀梁赤",
    "禮記": "戴圣（编）",
    "戰國策": "刘向（编）",
    "李斯": "李斯",
    "楚辭": "屈原 / 宋玉",
    "史記": "司马迁",
    "司馬遷": "司马迁",
    "西漢文": "西汉",
    "東漢文": "东汉",
    "後漢文": "诸葛亮",
    "李密": "李密",
    "王羲之": "王羲之",
    "陶淵明": "陶渊明",
    "孔稚珪": "孔稚珪",
    "魏徵": "魏徵",
    "駱賓王": "骆宾王",
    "王勃": "王勃",
    "李白": "李白",
    "李華": "李华",
    "劉禹錫": "刘禹锡",
    "杜牧": "杜牧",
    "韓愈": "韩愈",
    "柳宗元": "柳宗元",
    "王禹偁": "王禹偁",
    "李格非": "李格非",
    "范仲淹": "范仲淹",
    "司馬光": "司马光",
    "錢公輔": "钱公辅",
    "李覯": "李觏",
    "歐陽修": "欧阳修",
    "蘇洵": "苏洵",
    "蘇軾": "苏轼",
    "蘇轍": "苏辙",
    "曾鞏": "曾巩",
    "王安石": "王安石",
    "宋濂": "宋濂",
    "劉基": "刘基",
    "方孝孺": "方孝孺",
    "王鏊": "王鏊",
    "王守仁": "王守仁",
    "唐順之": "唐顺之",
    "宗臣": "宗臣",
    "歸有光": "归有光",
    "茅坤": "茅坤",
    "王世貞": "王世贞",
    "袁宏道": "袁宏道",
    "張溥": "张溥",
}


def iter_templates(text: str):
    i = 0
    n = len(text)
    while i < n - 1:
        j = text.find("{{", i)
        if j < 0:
            break
        depth = 0
        k = j
        while k < n - 1:
            if text[k : k + 2] == "{{":
                depth += 1
                k += 2
            elif text[k : k + 2] == "}}":
                depth -= 1
                k += 2
                if depth == 0:
                    yield j, k, text[j:k]
                    i = k
                    break
            else:
                k += 1
        else:
            break


def strip_templates(text: str) -> str:
    spans = list(iter_templates(text))
    if not spans:
        return text
    out = []
    last = 0
    for a, b, _raw in spans:
        out.append(text[last:a])
        last = b
    out.append(text[last:])
    return "".join(out)


def first_star_note(text: str) -> str:
    for _a, _b, raw in iter_templates(text):
        if raw.startswith("{{*|"):
            inner = raw[len("{{*|") :]
            if inner.endswith("}}"):
                inner = inner[:-2]
            return inner.strip()
    return ""


def clean_inline(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = text.replace("\u200b", "")
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("'''", "").replace("''", "")
    return text


def split_source(note: str) -> Tuple[str, str]:
    """'隱公元年 左傳' → (year/note, book)."""
    note = re.sub(r"\s+", " ", note).strip()
    if not note:
        return "", ""
    parts = note.split(" ")
    if len(parts) == 1:
        return "", parts[0]
    book = parts[-1]
    head = " ".join(parts[:-1])
    return head, book


def _classify_line(raw: str) -> str:
    """body / comment / skip."""
    if not raw.strip():
        return "blank"
    stripped = raw.strip()
    if stripped.startswith("=") or re.match(r"^卷[一二三四五六七八九十]", stripped):
        return "skip"
    # 原书评点在维基文库里以半角空格起行；正文要么顶格，要么用全角空格缩进。
    if raw.startswith(" ") or raw.startswith("\t"):
        if stripped.startswith("\u3000"):
            return "body"
        return "comment"
    return "body"


def split_body_and_comment(text: str) -> Tuple[List[str], str]:
    lines = text.splitlines()
    body_lines: List[str] = []
    comment_lines: List[str] = []
    for line in lines:
        kind = _classify_line(line)
        if kind == "blank":
            if body_lines and body_lines[-1] != "":
                body_lines.append("")
            continue
        if kind == "skip":
            continue
        cleaned = re.sub(r"[ \t]+", "", line).strip()
        if not cleaned:
            continue
        if kind == "body":
            body_lines.append(cleaned)
        else:
            comment_lines.append(cleaned)
    # 段落
    paras: List[str] = []
    buf: List[str] = []
    for line in body_lines:
        if line == "":
            if buf:
                paras.append("".join(buf) if _is_prose(buf) else "\n".join(buf))
                buf = []
        else:
            buf.append(line)
    if buf:
        paras.append("".join(buf) if _is_prose(buf) else "\n".join(buf))
    comment = "\n".join(comment_lines).strip()
    return [p.strip() for p in paras if p.strip()], comment


def _is_prose(buf: List[str]) -> bool:
    # 单行或各行都很长：并成一段。短行（赋、铭）保留换行。
    if len(buf) == 1:
        return True
    short = sum(1 for x in buf if len(x) <= 24)
    return short < max(2, len(buf) // 2)


_SENT_SPLIT = re.compile(r"([^。！？；\n]+[。！？；]?|\n)")


def split_sentences(paragraph: str) -> List[str]:
    if "\n" in paragraph:
        parts = []
        for line in paragraph.split("\n"):
            line = line.strip()
            if line:
                parts.extend(_split_prose_sentences(line))
        return parts
    return _split_prose_sentences(paragraph)


def _split_prose_sentences(text: str) -> List[str]:
    # 按句末切，保留标点；引号内的句号仍切开（学习站按朗读停顿，不按引号合并）。
    out: List[str] = []
    buf = []
    for ch in text:
        buf.append(ch)
        if ch in "。！？":
            sent = "".join(buf).strip()
            if sent:
                out.append(sent)
            buf = []
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


# 夹注删掉之后，顿号和句号会粘成「、。」。
# 这两个句号是夹注带出来的，不是正文的句末。
STRAY_PERIOD = re.compile(r"、(\{\{\*\|(?:(?!\}\}).){0,240}\}\})。")

# 古文观止卷页把费祎写成了衣字旁的褘。前出師表作費禕，简体是祎，不是袆。
LOOKALIKE = str.maketrans({"褘": "禕"})

# 「禁罝䍡」的夹注是「作罜、音主」。罝读嗟，是兔网；这里是小网，国语作罜。
# 前面「禁罝罗」的罝读嗟，不改。
JU_FOR_ZHU = re.compile(r"罝(\{\{\*\|作罜)")


def emend_wikitext(text: str) -> str:
    text = STRAY_PERIOD.sub(lambda match: "、" + match.group(1), text)
    return JU_FOR_ZHU.sub(r"罜\1", text)


def emend_plain(text: str) -> str:
    return text.translate(LOOKALIKE)


def parse_volume(volume: int, wikitext: str) -> List[dict]:
    # 去掉页眉模板，避免干扰
    body = emend_wikitext(wikitext)
    sections = re.split(r"(?m)^==\s*([^=]+?)\s*==\s*$", body)
    # sections[0] preamble, then title, content, title, content...
    articles = []
    idx = 1
    i = 1
    while i + 1 < len(sections):
        title = sections[i].strip()
        content = sections[i + 1]
        i += 2
        if title.startswith("卷") and "文" in title and len(title) < 20:
            continue
        note = first_star_note(content)
        source_head, book = split_source(note)
        plain = emend_plain(clean_inline(strip_templates(content)))
        paras, comment = split_body_and_comment(plain)
        vol_title, vol_sub = VOL_META[volume]
        articles.append(
            {
                "id": f"v{volume:02d}-{idx:02d}",
                "volume": volume,
                "volumeTitle": vol_title,
                "volumeSubtitle": vol_sub,
                "index": idx,
                "title": title,
                "sourceHead": source_head,
                "book": book,
                "author": BOOK_AUTHOR.get(book, book or "佚名"),
                "paragraphs": paras,
                "classicComment": comment,
            }
        )
        idx += 1
    return articles


def article_chars(article: dict) -> str:
    parts = [article["title"], article.get("book") or "", article.get("classicComment") or ""]
    parts.extend(article["paragraphs"])
    return "".join(parts)
