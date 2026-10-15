# -*- coding: utf-8 -*-
"""名句和批语分开。名句按通行句子匹配；批语只保留能对上底本的旧注。"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from fill_textbook_gloss import fill_tokens, split_tokens  # noqa: E402
from hanzi import only_han  # noqa: E402

ART = ROOT / "data" / "articles"
PUNCT_SPLIT = set("，。！？；")
RENJIAN_URL = "https://zh.wikisource.org/wiki/人間詞話"
WIKI_DAODE = "https://zh.wikisource.org/wiki/道德經_(王弼本)"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sentence_text(tokens: list[dict]) -> str:
    return "".join((tok.get("s") or tok.get("t") or "") for tok in tokens)


def clauses(tokens: list[dict]) -> list[tuple[str, str]]:
    """返回 (带标点的简体, 纯汉字)。"""
    buf: list[str] = []
    out: list[tuple[str, str]] = []

    def flush() -> None:
        if not buf:
            return
        text = "".join(buf).strip()
        han = only_han(text)
        if han:
            out.append((text, han))
        buf.clear()

    for tok in tokens:
        shown = tok.get("s") or tok.get("t") or ""
        if tok.get("punct") and shown in PUNCT_SPLIT:
            buf.append(shown)
            flush()
        else:
            buf.append(shown)
    flush()
    return out


def iter_units() -> list[dict]:
    units = []
    for path in sorted(ART.glob("*.json")):
        if path.name.count(".") > 1:
            continue
        art = load_json(path)
        pid = art["id"]
        if pid.startswith("d"):
            col = "道德经"
        elif pid.startswith("l"):
            col = "论语"
        elif pid.startswith("z"):
            col = "资治通鉴"
        elif pid.startswith("v"):
            col = "古文观止"
        elif pid.startswith("h"):
            col = "人间词话"
        else:
            col = "其他"
        for para in art.get("paragraphs") or []:
            for sent in para.get("sentences") or []:
                tokens = sent.get("tokens") or []
                text = sentence_text(tokens)
                han = only_han(text)
                if len(han) < 3:
                    continue
                units.append({
                    "id": pid,
                    "col": col,
                    "han": han,
                    "text": text.strip(),
                    "tr": (sent.get("tr") or "").strip(),
                    "volume": art.get("volume") or 1,
                })
    for fname, col in (
        ("data/tang.json", "唐诗"),
        ("data/songci.json", "宋词"),
        ("data/ke.json", "课文"),
    ):
        data = load_json(ROOT / fname)
        for piece in data["pieces"]:
            for line in piece.get("lines") or []:
                for text, han in clauses(line.get("tokens") or []):
                    if len(han) < 3:
                        continue
                    units.append({
                        "id": piece["id"],
                        "col": col,
                        "han": han,
                        "text": text,
                        "tr": "",
                        "volume": 0,
                    })
    return units


def load_quotes() -> list[str]:
    text = (ROOT / "scripts" / "famous_quotes.txt").read_text(encoding="utf-8")
    extra = [
        "道可道非常道",
        "名可名非常名",
        "无名天地之始",
        "有名万物之母",
        "有之以为利",
        "无之以为用",
        "千里之行始于足下",
        "合抱之木生于毫末",
        "所以传道受业解惑也",
        "先天下之忧而忧",
        "后天下之乐而乐",
        "曲则全",
        "枉则直",
    ]
    seen = []
    got = set()
    for raw in list(text.splitlines()) + extra:
        q = only_han(raw)
        if len(q) < 3 or q in got:
            continue
        got.add(q)
        seen.append(q)
    seen.sort(key=len, reverse=True)
    return seen


def fame_of(pid: str, grades: dict) -> str:
    entry = grades.get(pid)
    if not entry:
        return ""
    parts = [entry.get("source") or ""]
    for also in entry.get("also") or []:
        if also.get("source"):
            parts.append(also["source"])
    return "；".join(part for part in parts if part)


def coverage_tokens(tokens: list[dict]) -> tuple[int, int]:
    total = hit = 0
    for tok in tokens:
        if tok.get("punct"):
            continue
        n = len(tok.get("s") or tok.get("t") or "")
        if not n:
            continue
        total += n
        if (tok.get("ctx") or "").strip():
            hit += n
    return hit, total


def piece_coverage(pid: str) -> float:
    path = ART / f"{pid}.json"
    if path.is_file() and path.name.count(".") == 1:
        art = load_json(path)
        h = t = 0
        for para in art.get("paragraphs") or []:
            for sent in para.get("sentences") or []:
                hh, tt = coverage_tokens(sent.get("tokens") or [])
                h += hh
                t += tt
        return h / t if t else 0
    for fname in ("data/tang.json", "data/songci.json", "data/ke.json"):
        data = load_json(ROOT / fname)
        for piece in data["pieces"]:
            if piece["id"] != pid:
                continue
            h = t = 0
            for line in piece.get("lines") or []:
                hh, tt = coverage_tokens(line.get("tokens") or [])
                h += hh
                t += tt
            return h / t if t else 0
    return 0


def daode_notes() -> list[tuple[str, str]]:
    """(简体经文汉字, 简体王弼注)。"""
    from opencc import OpenCC

    cc = OpenCC("t2s")
    parsed = load_json(ROOT / "sources" / "classics" / "parsed.json")
    out = []
    for chapter in parsed["daode"]:
        for item in chapter.get("notes") or []:
            note = (item.get("note") or "").strip()
            if len(only_han(note)) < 8:
                continue
            text = only_han(cc.convert(item.get("text") or ""))
            if len(text) < 4:
                continue
            out.append((text, cc.convert(note)))
    return out


def lunyu_note_index() -> list[tuple[str, str, str, str]]:
    """从已写好的名句批语保留，并在注疏缓存里再找能对上的注。"""
    from opencc import OpenCC

    cc = OpenCC("t2s")
    found = []
    zhushu = ROOT / "sources" / "classics" / "zhushu"
    if not zhushu.is_dir():
        return found
    for path in sorted(zhushu.glob("*.wiki")):
        blob = path.read_text(encoding="utf-8")
        vol = path.stem
        # 注疏夹注：马曰、包曰、孔曰、郑曰、王曰，或直注。
        for match in re.finditer(r"([^。\n]{4,40})。([^。\n]{0,20})(馬曰|包曰|孔曰|鄭曰|王曰|马曰|包曰)([^。]{4,160})。", blob):
            quote = only_han(cc.convert(match.group(1)))
            note = cc.convert(match.group(3) + match.group(4)).strip()
            if len(quote) < 4 or len(note) < 6:
                continue
            found.append((quote, note, vol, "zhushu"))
    return found


def old_comments() -> list[dict]:
    famous = load_json(ROOT / "data" / "famous.json")
    return famous.get("lines") or []


def gwgz_comment(pid: str) -> tuple[str, int]:
    path = ART / f"{pid}.json"
    if not path.is_file():
        return "", 0
    art = load_json(path)
    text = ((art.get("classicComment") or {}).get("s") or "").strip()
    return text, int(art.get("volume") or 0)


def renjian_blobs() -> list[dict]:
    out = []
    for path in sorted(ART.glob("h*.json")):
        if path.name.count(".") > 1:
            continue
        art = load_json(path)
        parts = []
        for para in art.get("paragraphs") or []:
            for sent in para.get("sentences") or []:
                parts.append(sentence_text(sent.get("tokens") or []))
        text = "".join(parts).strip()
        out.append({
            "id": art["id"],
            "title": (art.get("title") or {}).get("s") or "",
            "han": only_han(text),
            "text": text,
        })
    return out


def attach_comment(line: dict, comment: dict) -> None:
    comments = line.setdefault("comments", [])
    key = (comment.get("author"), comment.get("text"))
    if any((item.get("author"), item.get("text")) == key for item in comments):
        return
    comments.append(comment)


def build_lines(units: list[dict], quotes: list[str], grades: dict) -> list[dict]:
    famous_ids = set(load_json(ROOT / "data" / "famous.json")["pieces"])
    buckets: dict[tuple[str, str], dict] = {}
    broad = []
    for quote in quotes:
        if len(quote) < 4:
            hits = [unit for unit in units if unit["han"] == quote]
        else:
            hits = [unit for unit in units if quote in unit["han"]]
        if not hits:
            continue
        if len(hits) > 12:
            broad.append((quote, len(hits)))
            hits = [unit for unit in hits if unit["id"] in famous_ids][:4]
        elif len(hits) > 4:
            hits.sort(key=lambda unit: (unit["id"] not in famous_ids, len(unit["han"])))
            hits = hits[:4]
        for unit in hits:
            if len(quote) < 6 and len(unit["han"]) > max(28, len(quote) * 4):
                if unit["id"] not in famous_ids:
                    continue
            key = (unit["id"], unit["han"])
            row = buckets.get(key)
            if row is None:
                row = {
                    "pieces": [unit["id"]],
                    "quote": quote,
                    "text": unit["text"],
                    "col": unit["col"],
                    "volume": unit["volume"],
                }
                fame = fame_of(unit["id"], grades)
                if fame:
                    row["fame"] = fame
                buckets[key] = row
            elif len(quote) > len(row["quote"]):
                row["quote"] = quote
                row["text"] = unit["text"]
    if broad:
        print("broad", broad[:12])
    return list(buckets.values())


def add_comments(lines: list[dict]) -> None:
    previous = old_comments()
    notes = daode_notes()
    renjian = renjian_blobs()
    # 旧批语：同一篇、引文能对上就保留。
    for line in lines:
        pid = line["pieces"][0]
        han = only_han(line["quote"])
        for old in previous:
            if pid not in (old.get("pieces") or []):
                continue
            old_q = only_han(old.get("quote") or "")
            if not old_q:
                continue
            if old_q in han or han in old_q or old_q in only_han(line.get("text") or ""):
                for comment in old.get("comments") or []:
                    if (comment.get("text") or "").strip() and (comment.get("url") or "").strip():
                        attach_comment(line, comment)
        if line["col"] == "道德经" and not line.get("comments"):
            for scripture, note in notes:
                if han in scripture or scripture in only_han(line.get("text") or ""):
                    attach_comment(line, {
                        "author": "王弼",
                        "source": "《老子道德经注》（华亭张氏本）",
                        "text": note if len(note) <= 240 else note[:240].rsplit("。", 1)[0] + "。",
                        "url": WIKI_DAODE,
                    })
                    break
        if line["col"] == "古文观止" and not line.get("comments"):
            # 一篇只挂一次尾评，挂在最长的那句上，后面再收。
            pass
        if line["col"] != "人间词话" and len(han) >= 6 and not line.get("comments"):
            hosts = [item for item in renjian if han in item["han"]]
            if hosts:
                hosts.sort(key=lambda item: len(item["han"]))
                host = hosts[0]
                text = host["text"]
                if len(text) > 220:
                    cut = text[:220]
                    stop = cut.rfind("。")
                    text = (cut[: stop + 1] if stop > 40 else cut) 
                attach_comment(line, {
                    "author": "王国维",
                    "source": "《人间词话》（《国粹学报》本）「%s」" % host["title"],
                    "text": text,
                    "url": RENJIAN_URL,
                })

    # 古文观止尾评：每篇最长的一条名句挂一次。
    by_piece: dict[str, list[dict]] = defaultdict(list)
    for line in lines:
        if line["col"] == "古文观止":
            by_piece[line["pieces"][0]].append(line)
    for pid, group in by_piece.items():
        if any(item.get("comments") for item in group):
            continue
        comment, volume = gwgz_comment(pid)
        if not comment or not volume:
            continue
        group.sort(key=lambda item: len(item["quote"]), reverse=True)
        attach_comment(group[0], {
            "author": "吴楚材、吴调侯",
            "source": "《古文观止》尾评",
            "text": comment,
            "url": "https://zh.wikisource.org/wiki/古文觀止/卷%d" % volume,
        })
    attach_saved_notes(lines)
    attach_cards(lines)


def attach_saved_notes(lines: list[dict]) -> None:
    """挂已经核对过的维基文库批语。引文对不上的不挂。"""
    path = ROOT / "sources" / "commentary" / "line_notes.json"
    if not path.is_file():
        return
    saved = load_json(path)
    for note in saved:
        targets = set(note.get("pieces") or [])
        want = only_han(note.get("quote") or "")
        comment = {
            "author": note.get("author") or "",
            "source": note.get("source") or "",
            "text": (note.get("text") or "").strip(),
            "url": note.get("url") or "",
        }
        if not want or not comment["text"] or not comment["url"]:
            continue
        for line in lines:
            if line["pieces"][0] not in targets:
                continue
            if only_han(line.get("quote") or "") != want:
                continue
            attach_comment(line, comment)


def attach_cards(lines: list[dict]) -> None:
    """把本站白话、赏析按篇和引文挂回名句。引文对不上就停下，避免下次重建丢掉。"""
    path = ROOT / "sources" / "commentary" / "line_cards.json"
    if not path.is_file():
        raise SystemExit("缺少 sources/commentary/line_cards.json")
    cards = load_json(path)
    by_quote: dict[tuple[str, str], dict] = {}
    by_text: list[dict] = []
    for card in cards:
        pid = card.get("piece") or ""
        quote = only_han(card.get("quote") or "")
        needle = only_han(card.get("text") or "")
        if not pid or not quote:
            continue
        if needle:
            by_text.append(card)
        else:
            by_quote[(pid, quote)] = card
    missing = []
    for line in lines:
        pid = line["pieces"][0]
        quote = only_han(line.get("quote") or "")
        text = only_han(line.get("text") or "")
        card = None
        best_len = -1
        for item in by_text:
            if item.get("piece") != pid or only_han(item.get("quote") or "") != quote:
                continue
            needle = only_han(item.get("text") or "")
            if needle and needle in text and len(needle) > best_len:
                card = item
                best_len = len(needle)
        if card is None:
            card = by_quote.get((pid, quote))
        vernacular = ((card or {}).get("vernacular") or "").strip()
        appreciate = ((card or {}).get("appreciate") or "").strip()
        if not vernacular or not appreciate:
            missing.append("%s %s" % (pid, line.get("quote")))
            continue
        line["vernacular"] = vernacular
        line["appreciate"] = appreciate
    if missing:
        raise SystemExit("名句卡片缺 %d 条：%s" % (len(missing), " | ".join(missing[:16])))


def gloss_piece(pid: str) -> list[str]:
    missing = []
    path = ART / f"{pid}.json"
    if path.is_file() and path.name.count(".") == 1:
        art = load_json(path)
        changed = False
        for para in art.get("paragraphs") or []:
            for sent in para.get("sentences") or []:
                try:
                    before = json.dumps(sent["tokens"], ensure_ascii=False)
                    fill_tokens(sent["tokens"], pid)
                    if json.dumps(sent["tokens"], ensure_ascii=False) != before:
                        changed = True
                except SystemExit as exc:
                    missing.append(str(exc))
        if changed and not missing:
            path.write_text(json.dumps(art, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        return missing
    for fname in ("data/tang.json", "data/songci.json", "data/ke.json"):
        file_path = ROOT / fname
        data = load_json(file_path)
        hit = False
        changed = False
        for piece in data["pieces"]:
            if piece["id"] != pid:
                continue
            hit = True
            for line in piece.get("lines") or []:
                line["tokens"] = split_tokens(line.get("tokens") or [])
                try:
                    before = json.dumps(line["tokens"], ensure_ascii=False)
                    fill_tokens(line["tokens"], pid)
                    if json.dumps(line["tokens"], ensure_ascii=False) != before:
                        changed = True
                except SystemExit as exc:
                    missing.append(str(exc))
        if hit and changed and not missing:
            file_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        if hit:
            return missing
    return missing


def rebuild() -> dict:
    grades = load_json(ROOT / "data" / "grades.json")["pieces"]
    famous = load_json(ROOT / "data" / "famous.json")
    pieces = famous["pieces"]
    units = iter_units()
    quotes = load_quotes()
    lines = build_lines(units, quotes, grades)
    add_comments(lines)
    # 人间词话里本身成为名句的则，收入名篇。通鉴整卷不升成名篇。
    for line in lines:
        pid = line["pieces"][0]
        if line["col"] == "人间词话":
            pieces.setdefault(pid, {"collection": "人间词话"})
        line.pop("col", None)
        line.pop("volume", None)
        if not line.get("comments"):
            line.pop("comments", None)
        if not line.get("fame"):
            line.pop("fame", None)
    # 名篇必须至少有一句。
    hosts = {line["pieces"][0] for line in lines}
    missing = [pid for pid in pieces if pid not in hosts]
    famous_out = {"pieces": pieces, "lines": lines}
    (ROOT / "data" / "famous.json").write_text(
        json.dumps(famous_out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("lines", len(lines), "pieces", len(pieces), "missing", len(missing))
    if missing:
        print("MISSING", missing)
    # 有名句的篇，逐字注补到能盖住。
    need = sorted({line["pieces"][0] for line in lines})
    low = []
    all_missing = []
    for pid in need:
        ratio = piece_coverage(pid)
        if ratio >= 0.95:
            continue
        all_missing.extend(gloss_piece(pid))
        ratio = piece_coverage(pid)
        if ratio < 0.95:
            low.append((pid, round(ratio, 3)))
    print("glossed_low", low[:30], "n", len(low), "missing_senses", len(all_missing))
    if all_missing:
        chars = sorted({item.split("没有释义：", 1)[-1].split("（", 1)[0] for item in all_missing})
        print("chars", "".join(chars[:80]), "count", len(chars))
    from collections import Counter
    cols = Counter()
    comments = 0
    fame = 0
    idcol = {}
    for unit in units:
        idcol[unit["id"]] = unit["col"]
    for line in lines:
        cols[idcol.get(line["pieces"][0], "?")] += 1
        comments += len(line.get("comments") or [])
        if line.get("fame"):
            fame += 1
    print("by", dict(cols))
    print("comments", comments, "fame", fame)
    return famous_out


if __name__ == "__main__":
    rebuild()
