# -*- coding: utf-8 -*-
"""把维基文库缓存收成道德经、论语的正文清单。不写站点数据。"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "sources" / "classics"

CN_NUM = {"零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def cn_to_int(text: str) -> int:
    text = text.strip()
    if text.isdigit():
        return int(text)
    if text == "十":
        return 10
    if text.startswith("十"):
        return 10 + CN_NUM[text[1]]
    if "十" in text:
        left, right = text.split("十", 1)
        return CN_NUM[left] * 10 + (CN_NUM[right] if right else 0)
    return CN_NUM[text]


def _balanced_template(text: str, start: int) -> int:
    """start 指向 {{，返回匹配 }} 之后的位置。"""
    depth = 0
    k = start
    while k < len(text) - 1:
        if text[k : k + 2] == "{{":
            depth += 1
            k += 2
            continue
        if text[k : k + 2] == "}}":
            depth -= 1
            k += 2
            if depth == 0:
                return k
            continue
        k += 1
    return len(text)


def _first_arg(body: str) -> str:
    depth = 0
    arg = []
    i = 0
    while i < len(body):
        if body[i : i + 2] == "{{":
            depth += 1
            arg.append(body[i])
            i += 1
            continue
        if body[i : i + 2] == "}}" and depth:
            depth -= 1
        if body[i] == "|" and depth == 0:
            break
        arg.append(body[i])
        i += 1
    return "".join(arg)


def strip_wiki(text: str) -> str:
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.split(r"===\s*校勘[记記]\s*===", text)[0]

    def variant(match: re.Match) -> str:
        body = match.group(1)
        hans = re.search(r"zh-hans:([^;]+)", body)
        if hans:
            return hans.group(1)
        zh = re.search(r"(?:^|;)zh:([^;]+)", body)
        if zh:
            return zh.group(1)
        return body.split(";")[0].split(":")[-1]

    text = re.sub(r"-{([^}]+)}-", variant, text)

    def link(match: re.Match) -> str:
        body = match.group(1)
        return body.split("|")[-1]

    text = re.sub(r"\[\[([^]]+)\]\]", link, text)
    out = []
    i = 0
    while True:
        j = text.find("{{", i)
        if j < 0:
            out.append(text[i:])
            break
        out.append(text[i:j])
        end = _balanced_template(text, j)
        tmpl = text[j + 2 : end - 2] if end >= j + 4 else ""
        name, sep, rest = tmpl.partition("|")
        if sep and name.strip() in ("另", "另2"):
            out.append(_first_arg(rest))
        i = end
    text = "".join(out)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("'''", "").replace("''", "")
    text = text.replace("\u3000", "")
    text = (
        text.replace("﹕", "：")
        .replace("﹗", "！")
        .replace("﹑", "、")
        .replace(",", "，")
        .replace(";", "；")
    )
    text = re.sub(r"\s+", "", text)
    return text


def parse_daode() -> list[dict]:
    raw = (SRC / "wangbi.wiki").read_text(encoding="utf-8")
    parts = re.split(r"\n==([^=\n]+)==\n", raw)
    chapters = []
    for i in range(1, len(parts), 2):
        title = parts[i].strip()
        if not title.endswith("章"):
            continue
        num = cn_to_int(title[:-1])
        body = parts[i + 1]
        lines = []
        notes = []
        pending = ""
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("="):
                continue
            if line.startswith(":"):
                note = ""
                found = re.search(r"\{\{\*\|(.*?)\}\}", line)
                if found:
                    note = strip_wiki(found.group(1)).strip()
                if pending:
                    notes.append({"text": pending, "note": note})
                    lines.append(pending)
                    pending = ""
                continue
            chunk = strip_wiki(line)
            if not chunk:
                continue
            # 章后的晁说之、熊克题记不是经文。
            if chunk.startswith(("王弼老子", "政和乙未", "克伏诵", "克伏誦", "克自此", "三月二十四日")):
                break
            if pending:
                notes.append({"text": pending, "note": ""})
                lines.append(pending)
            pending = chunk
        if pending:
            notes.append({"text": pending, "note": ""})
            lines.append(pending)
        text = "".join(lines)
        text = text.replace(";", "；").replace(",", "，").replace("?", "？").replace("!", "！")
        chapters.append({"n": num, "title": title, "text": text, "notes": notes})
    chapters.sort(key=lambda item: item["n"])
    if [item["n"] for item in chapters] != list(range(1, 82)):
        raise SystemExit("道德经不是八十一章")
    return chapters


def parse_lunyu() -> list[dict]:
    books = []
    names = [
        "学而", "为政", "八佾", "里仁", "公冶长", "雍也", "述而", "泰伯", "子罕", "乡党",
        "先进", "颜渊", "子路", "宪问", "卫灵公", "季氏", "阳货", "微子", "子张", "尧曰",
    ]
    for index in range(1, 21):
        raw = (SRC / "lunyu" / f"{index:02d}.wiki").read_text(encoding="utf-8")
        raw = raw.split("</onlyinclude>")[0]
        raw = re.sub(r"(?s)\{\{header2.*?\}\}", "", raw)
        chunks = re.split(r"<div id=\"[^\"]+\"[^>]*>.*?</div>", raw)
        verses = []
        for chunk in chunks:
            text = strip_wiki(chunk)
            text = re.sub(r"\s+", "", text)
            if not text or text.startswith("*") or "header" in text:
                continue
            if len(text) < 4:
                continue
            verses.append(text)
        # 维基文库有几处把近年异说放在模板前项。通行本仍用后项。
        joined = "\n".join(verses)
        for src, dst in (
            ("藝禮", "執禮"),
            ("疑斯擧", "色斯擧"),
            ("德躬者", "直躬者"),
            ("以德報怨，以德報德", "以直報怨，以德報德"),
        ):
            joined = joined.replace(src, dst)
        verses = joined.split("\n")
        books.append({"n": index, "name": names[index - 1], "verses": verses})
    return books


def main() -> None:
    daode = parse_daode()
    lunyu = parse_lunyu()
    out = {"daode": daode, "lunyu": lunyu}
    (SRC / "parsed.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("daode", len(daode), "chars", sum(len(item["text"]) for item in daode))
    print("lunyu books", len(lunyu), "verses", sum(len(item["verses"]) for item in lunyu))
    for book in lunyu:
        print(f"  {book['n']:02d} {book['name']} {len(book['verses'])}")
    print("--- ch1 ---")
    print(daode[0]["text"])
    print("--- xueer1 ---")
    print(lunyu[0]["verses"][0])


if __name__ == "__main__":
    main()
