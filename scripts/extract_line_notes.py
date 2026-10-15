# -*- coding: utf-8 -*-
"""从维基文库缓存抽出能对上名句的批语。缓存不在仓库里，结果写进 sources/commentary。"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from hanzi import only_han  # noqa: E402

CC = OpenCC("t2s")
CACHE = Path("/tmp/wiki-cache")
LIT = "句段意起结写篇妙应呼笔文情志法点提过论收伏关神总衬锁眼"
HINT = "曰意此篇句神情妙趣正写评气势"
AUTHORS = {"孔": "孔安国", "包": "包咸", "马": "马融", "郑": "郑玄", "王": "王肃", "周": "周氏"}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def simp(text: str) -> str:
    text = re.sub(r"\{\{[^}]+\}\}", "", text)
    return CC.convert(text).replace("　", "").replace(" ", "").strip()


def clip(text: str, limit: int = 100) -> str:
    text = text.strip()
    n = 0
    out = []
    for ch in text:
        out.append(ch)
        if "\u4e00" <= ch <= "\u9fff":
            n += 1
            if n >= limit:
                break
    clipped = "".join(out).strip()
    if n >= limit and len(only_han(text)) > limit:
        clipped += "……"
    return clipped


def piece_han(piece: dict) -> str:
    parts = []
    for line in piece.get("lines") or []:
        for tok in line.get("tokens") or []:
            if not tok.get("punct"):
                parts.append(tok.get("s") or "")
    return "".join(parts)


def align_tail(line: str, poem: str):
    hans = []
    pos = []
    for index, ch in enumerate(line):
        if "\u4e00" <= ch <= "\u9fff":
            hans.append(ch)
            pos.append(index)
    body = "".join(hans)
    if len(poem) < 8:
        return None
    start = body.find(poem[:8])
    if start < 0:
        start = body.find(poem[:6])
    if start < 0:
        return None
    i = start
    j = 0
    last = start
    skips = 0
    while i < len(body) and j < len(poem):
        if body[i] == poem[j]:
            last = i
            i += 1
            j += 1
            continue
        skips += 1
        if skips > max(6, len(poem) // 6):
            break
        if i + 1 < len(body) and body[i + 1] == poem[j]:
            i += 1
        elif j + 1 < len(poem) and body[i] == poem[j + 1]:
            j += 1
        else:
            i += 1
            j += 1
    if j < len(poem) * 0.75:
        return None
    if last + 1 >= len(pos):
        return ""
    return line[pos[last] + 1 :].strip()


def shichun_notes(famous: dict, tang: dict) -> list[dict]:
    by_id = {piece["id"]: piece for piece in tang["pieces"]}
    # 卷 47 是陆游诗。课文里的《示儿》不在唐诗集，标题又没单独做成锚点。
    ke = load_json(ROOT / "data" / "ke.json")
    ke_ids = set()
    for piece in ke["pieces"]:
        if piece["id"] not in by_id:
            by_id[piece["id"]] = piece
            ke_ids.add(piece["id"])
    quotes: dict[str, list[str]] = {}
    for line in famous["lines"]:
        pid = line["pieces"][0]
        if pid in by_id:
            quotes.setdefault(pid, []).append(only_han(line["quote"]))
    volumes = []
    for path in sorted(CACHE.glob("御選唐宋詩醇*.txt")):
        match = re.search(r"卷(\d+)", path.name)
        raw = path.read_text(encoding="utf-8")
        if not match or len(raw) < 100:
            continue
        parts = re.split(r"\{\{SK anchor\|([^}]+)\}\}", raw)
        blocks = []
        index = 1
        while index + 1 < len(parts):
            blocks.append((parts[index].strip(), parts[index + 1]))
            index += 2
        volumes.append((int(match.group(1)), blocks))
    notes = []
    for pid, bundle in quotes.items():
        piece = by_id[pid]
        title = piece["title"]["s"]
        poem = piece_han(piece)
        found = None
        for vol, blocks in volumes:
            for label, body in blocks:
                titled = only_han(simp(label)) == title
                if not titled:
                    if pid not in ke_ids or len(poem) < 16 or poem[:8] not in only_han(simp(body)):
                        continue
                lines = [simp(row) for row in body.splitlines()]
                lines = [row for row in lines if row]
                for index, row in enumerate(lines):
                    row_han = only_han(row)
                    # 诗题粘在上一条批语末尾时，整首诗单独成行，后面才是批语。
                    bare = len(poem) >= 16 and poem in row_han and len(row_han) <= len(poem) + 2
                    if not titled and not bare:
                        continue
                    if not any(quote in row_han for quote in bundle if len(quote) >= 4):
                        continue
                    tail = align_tail(row, poem)
                    texts = []
                    if tail and len(only_han(tail)) >= 10 and only_han(tail)[:4] not in poem:
                        texts.append(tail)
                    elif index + 1 < len(lines):
                        nxt = lines[index + 1]
                        if (
                            len(only_han(nxt)) >= 10
                            and only_han(nxt)[:4] not in poem
                            and any(mark in nxt for mark in HINT)
                        ):
                            texts.append(nxt)
                    for extra in lines[index + 1 : index + 4]:
                        if "曰" not in extra:
                            break
                        if only_han(extra)[:4] in poem or len(only_han(extra)) < 8:
                            break
                        if extra not in texts:
                            texts.append(extra)
                        if len(texts) >= 2:
                            break
                    if texts:
                        found = (vol, texts[:2])
                        break
                if found:
                    break
            if found:
                break
        if not found:
            continue
        vol, texts = found
        target = max(bundle, key=len)
        for text in texts:
            who = re.match(r"^(.{1,8})曰", text)
            author = "清高宗"
            if who and 1 <= len(only_han(who.group(1))) <= 6:
                author = who.group(1)
            notes.append({
                "pieces": [pid],
                "quote": target,
                "author": author,
                "source": "《御选唐宋诗醇》（四库全书本）",
                "text": clip(text, 140),
                "url": "https://zh.wikisource.org/wiki/御選唐宋詩醇_(四庫全書本)/卷%02d" % vol,
            })
    return notes


def gwgz_notes(famous: dict) -> list[dict]:
    titles = {}
    for path in (ROOT / "data" / "articles").glob("v*.json"):
        if path.name.count(".") > 1:
            continue
        art = load_json(path)
        titles[art["id"]] = art["title"]["s"]
    wiki = {}
    for path in sorted(CACHE.glob("古文觀止_卷*.txt")):
        match = re.search(r"卷(\d+)", path.name)
        raw = path.read_text(encoding="utf-8")
        if not match or len(raw) < 100:
            continue
        parts = re.split(r"\n==\s*([^=]+?)\s*==\s*\n", raw)
        index = 1
        while index + 1 < len(parts):
            wiki[only_han(CC.convert(parts[index]))] = (int(match.group(1)), parts[index + 1])
            index += 2
    notes = []
    for line in famous["lines"]:
        pid = line["pieces"][0]
        if not pid.startswith("v"):
            continue
        hit = wiki.get(only_han(titles.get(pid, "")))
        if not hit:
            continue
        vol, body = hit
        simplified = CC.convert(body)
        quote = only_han(line["quote"])
        hans = []
        pos = []
        for index, ch in enumerate(simplified):
            if "\u4e00" <= ch <= "\u9fff":
                hans.append(ch)
                pos.append(index)
        at = "".join(hans).find(quote)
        if at < 0:
            continue
        window = simplified[pos[at + len(quote) - 1] : pos[at + len(quote) - 1] + 180]
        kept = []
        for item in re.findall(r"\{\{\*\|(.*?)\}\}", window):
            item = simp(item).replace("、", "，")
            parts = [part.strip() for part in item.split("○") if part.strip()]
            for part in parts:
                han = only_han(part)
                if len(han) < 6 or not any(mark in part for mark in LIT):
                    continue
                if "年号" in part:
                    continue
                kept.append(part)
        if not kept:
            continue
        text = clip(kept[0], 120)
        notes.append({
            "pieces": [pid],
            "quote": quote,
            "author": "吴楚材、吴调侯",
            "source": "《古文观止》夹评",
            "text": text,
            "url": "https://zh.wikisource.org/wiki/古文觀止/卷%d" % vol,
        })
    return notes


def lunyu_notes(famous: dict) -> list[dict]:
    pairs = []
    folder = ROOT / "sources" / "classics" / "zhushu"
    for path in sorted(folder.glob("*.wiki")):
        if not path.stem.isdigit():
            continue
        raw = path.read_text(encoding="utf-8")
        for match in re.finditer(r"\{\{yw\|(.*?)\}\}", raw, re.S):
            scripture = only_han(simp(match.group(1)))
            tail = raw[match.end() : match.end() + 500]
            note = ""
            red = re.match(r"\s*\{\{Font color\|darkRed\|text=（(.*?)）\}\}", tail, re.S)
            if red:
                note = red.group(1)
            else:
                plain = re.match(r"\s*（([^（）]{4,180})）", tail, re.S)
                if plain:
                    note = plain.group(1)
            note = simp(note)
            if not note or note.startswith("疏") or "正义曰" in note[:8]:
                continue
            if len(only_han(note)) < 6 or len(scripture) < 4:
                continue
            pairs.append((scripture, note, int(path.stem)))
    notes = []
    for line in famous["lines"]:
        pid = line["pieces"][0]
        if not re.fullmatch(r"l01-\d\d", pid) or line.get("comments"):
            continue
        book = int(pid.split("-")[1])
        quote = only_han(line["quote"])
        cands = [item for item in pairs if item[2] == book and (quote in item[0] or item[0] in quote)]
        if not cands:
            continue
        cands.sort(key=lambda item: len(item[0]))
        scripture, note, vol = cands[0]
        who = re.match(r"^(孔|包|马|郑|王|周)曰", note)
        author = AUTHORS[who.group(1)] if who else "何晏"
        notes.append({
            "pieces": [pid],
            "quote": quote,
            "author": author,
            "source": "何晏《论语集解》，见邢昺《论语注疏》",
            "text": clip(note, 160),
            "url": "https://zh.wikisource.org/wiki/論語註疏/卷%02d" % vol,
        })
    return notes


def main() -> None:
    famous = load_json(ROOT / "data" / "famous.json")
    tang = load_json(ROOT / "data" / "tang.json")
    notes = shichun_notes(famous, tang) + gwgz_notes(famous) + lunyu_notes(famous)
    # 同一篇同一句同一段话只留一次。
    seen = set()
    out = []
    for note in notes:
        key = (note["pieces"][0], note["quote"], note["text"])
        if key in seen:
            continue
        seen.add(key)
        out.append(note)
    dest = ROOT / "sources" / "commentary" / "line_notes.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("notes", len(out), "->", dest)


if __name__ == "__main__":
    main()
