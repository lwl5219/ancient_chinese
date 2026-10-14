# -*- coding: utf-8 -*-
"""把唐诗正文改成维基文库《唐诗三百首》页面上的通行文字。

{{另|通行|一作}} 取通行文字。一作记为异文。
全唐诗和通行文字只差异体、或抽取结果混进注文的，不改。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from expand_poetry import piece_new, zhonghua_simp
from hanzi import is_han

WS_PATH = Path("/tmp/canon/ws-tang.json")
INDEX_PATH = Path("/tmp/canon/tang300.wikitext")
TANG_PATH = ROOT / "data" / "tang.json"
NOTES_PATH = ROOT / "data" / "poetry-notes.json"
BODIES_PATH = ROOT / "sources" / "poetry" / "bodies.json"
SEL_PATH = ROOT / "sources" / "poetry" / "selection.json"
LOG_PATH = ROOT / "sources" / "poetry" / "edition-changes.json"

# 简化后仍是同一个字的异体，不改页面。
ORTHO = {
    frozenset("淡澹"),
    frozenset("着著"),
    frozenset("迴回"),
    frozenset("廻回"),
    frozenset("疎疏"),
    frozenset("逕径"),
    frozenset("迳径"),
    frozenset("劍剑"),
    frozenset("劒剑"),
    frozenset("猨猿"),
    frozenset("桮杯"),
    frozenset("壻婿"),
    frozenset("爐炉"),
    frozenset("壚炉"),
    frozenset("鑪炉"),
    frozenset("鵶鸦"),
    frozenset("唯惟"),
    frozenset("牀床"),
    frozenset("羣群"),
    frozenset("爲为"),
    frozenset("為为"),
    frozenset("眾众"),
    frozenset("衆众"),
    frozenset("裡里"),
    frozenset("裏里"),
    frozenset("雁鴈"),
    frozenset("隣邻"),
    frozenset("鄰邻"),
    frozenset("碁棋"),
    frozenset("鶯莺"),
    frozenset("鸎莺"),
    frozenset("鎖锁"),
    frozenset("鏁锁"),
    frozenset("階阶"),
    frozenset("堦阶"),
    frozenset("櫂棹"),
    frozenset("尊樽"),
    frozenset("遶绕"),
    frozenset("繞绕"),
    frozenset("荳豆"),
    frozenset("汚污"),
    frozenset("燄焰"),
    frozenset("荊荆"),
    frozenset("卻却"),
    frozenset("雲云"),
    frozenset("後后"),
    frozenset("餘余"),
    frozenset("馀余"),
    frozenset("祇只"),
    frozenset("徵征"),
    frozenset("徴征"),
    frozenset("尝甞"),
    frozenset("嘗甞"),
    frozenset("慎愼"),
}

# 维基文库这一处和通行注本不一致，不把错字写上页面。
BLOCK_SWAP = {("漱", "嗽"), ("紗", "沙"), ("纱", "沙")}

NORM = {"觧": "解"}


def keep_char(old: str, new: str) -> str:
    new = NORM.get(new, new)
    if (old, new) in BLOCK_SWAP:
        return old
    if frozenset((zhonghua_simp(old), zhonghua_simp(new))) in ORTHO:
        return old
    return new


# 抽取混进了注文，或把两首拼在一起。这些不自动改。
SKIP = {
    "t037",
    "t054",
    "t055",
    "t061",
    "t077",
    "t080",
    "t085",
    "t101",
    "t167",
    "t193",
    "t199",
    "t214",
    "t300",
    "wangyue",
}


def han(text: str) -> str:
    return "".join(ch for ch in text if is_han(ch))


def strip_templates(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        name = match.group(1)
        args = match.group(2)
        parts: list[str] = []
        buf = ""
        depth = 0
        for ch in args:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            if ch == "|" and depth == 0:
                parts.append(buf)
                buf = ""
            else:
                buf += ch
        parts.append(buf)
        parts = [part.strip() for part in parts]
        if name in ("另", "另2"):
            return parts[0] if parts else ""
        return ""

    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"\{\{([^{}|]+)\|([^{}]*)\}\}", repl, text)
        text = re.sub(r"\{\{[^{}]+\}\}", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<[^>]+>", "", text)
    return text


def strip_converter(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        inner = match.group(1)
        hant = re.search(r"zh-hant\s*:\s*([^;}\n]+)", inner)
        if hant:
            return hant.group(1).strip()
        hans = re.findall(r"[\u4e00-\u9fff]", inner)
        return "".join(hans)

    return re.sub(r"-{(.+?)}-", repl, text)


def apply_han_edits(old_lines: list[str], new_lines: list[str]) -> list[str] | None:
    """只替换对得上的汉字，保留原来的断行和标点。"""
    old = "".join(old_lines)
    new = "".join(new_lines)
    old_i = [i for i, ch in enumerate(old) if is_han(ch)]
    new_i = [i for i, ch in enumerate(new) if is_han(ch)]
    if len(old_i) != len(new_i):
        return None
    chars = list(old)
    changed = False
    for left, right in zip(old_i, new_i):
        chosen = keep_char(chars[left], new[right])
        if chars[left] != chosen:
            chars[left] = chosen
            changed = True
    if not changed:
        return None
    text = "".join(chars)
    if len(text) != len(old):
        return None
    out = []
    cursor = 0
    for line in old_lines:
        out.append(text[cursor : cursor + len(line)])
        cursor += len(line)
    return out


def anthology_lines(wikitext: str) -> list[str]:
    section = re.search(r"==+\s*唐詩三百首\s*==+\s*(.*?)(?=\n==+|\Z)", wikitext, re.S)
    chunk = section.group(1) if section else wikitext
    blocks = re.findall(r"<poem[^>]*>(.*?)</poem>", chunk, re.S)
    if not section:
        included = re.search(r"<onlyinclude>(.*?)</onlyinclude>", wikitext, re.S)
        if included:
            blocks = re.findall(r"<poem[^>]*>(.*?)</poem>", included.group(1), re.S) or blocks[:1]
        else:
            blocks = blocks[:1]
    lines: list[str] = []
    for block in blocks:
        cleaned = strip_templates(block)
        for line in cleaned.splitlines():
            line = line.strip()
            if line:
                lines.append(strip_converter(line))
    return lines


def piece_trad(piece: dict) -> list[str]:
    lines = []
    for line in piece["lines"]:
        lines.append("".join(tok["t"] for tok in line["tokens"]))
    return lines


def simp_han(lines: list[str]) -> str:
    return han(zhonghua_simp("".join(lines)))


def index_titles() -> list[str]:
    titles = []
    for line in INDEX_PATH.read_text(encoding="utf-8").splitlines():
        if not line.startswith("#"):
            continue
        found = re.search(r"\[\[([^|\]]+)", line)
        if found:
            titles.append(found.group(1).strip())
    return titles


def retokenize(piece: dict, lines: list[str]) -> dict:
    spec = {"id": piece["id"], "display": piece["title"]["t"]}
    fresh = piece_new(spec, piece["author"]["t"], lines, {})
    fresh["title"] = piece["title"]
    fresh["author"] = piece["author"]
    return fresh


def add_note(notes: dict, pid: str, old_lines: list[str], new_lines: list[str]) -> None:
    entry = notes["pieces"].get(pid)
    if not entry:
        return
    bits = []
    for old, new in zip(old_lines, new_lines):
        if zhonghua_simp(old) != zhonghua_simp(new):
            bits.append(zhonghua_simp(old))
    gloss_s = "全唐诗作" + "，".join("「%s」" % bit for bit in bits) + "。"
    note = {
        "term": {"s": "异文", "t": "異文"},
        "gloss": {
            "s": gloss_s + "这里用《唐诗三百首》和课文通行的文字。",
            "t": "全唐詩文字不同。這裡用《唐詩三百首》和課文通行的文字。",
        },
    }
    entry["notes"] = [item for item in entry["notes"] if item["term"]["s"] != "异文"]
    entry["notes"].append(note)
    if pid == "jingyesi":
        entry["notes"] = [
            item for item in entry["notes"] if item["term"]["s"] not in ("看月光", "山月")
        ]
        entry["vernacular"] = [
            {"s": "床前铺着明亮的月光，", "t": "床前鋪着明亮的月光，"},
            {"s": "好像地上结了一层霜。", "t": "好像地上結了一層霜。"},
            {"s": "抬起头，望见天上的明月，", "t": "抬起頭，望見天上的明月，"},
            {"s": "低下头，想起故乡。", "t": "低下頭，想起故鄉。"},
        ]
        entry["analysis"] = {
            "s": "月光先被看成霜，冷的感觉在乡思前面。接着一抬头、一低头，视线从明月落到故乡。全篇几乎不解释情绪，只把夜色和这两个动作留下。",
            "t": "月光先被看成霜，冷的感覺在鄉思前面。接着一抬頭、一低頭，視線從明月落到故鄉。全篇幾乎不解釋情緒，只把夜色和這兩個動作留下。",
        }
        entry["background"] = {
            "s": "李白的绝句，写夜里见月而想家。诗里没有年月和地点。这里用《唐诗三百首》和今天课文的文字：「床前明月光……举头望明月」。全唐诗一系作「床前看月光……举头望山月」，记在异文里。",
            "t": "李白的絕句，寫夜裏見月而想家。詩裏沒有年月和地點。這裡用《唐詩三百首》和今天課文的文字。全唐詩一系文字不同，記在異文裡。",
        }


def main() -> int:
    write = "--write" in sys.argv
    ws = json.loads(WS_PATH.read_text(encoding="utf-8"))
    tang = json.loads(TANG_PATH.read_text(encoding="utf-8"))
    notes = json.loads(NOTES_PATH.read_text(encoding="utf-8"))
    bodies = json.loads(BODIES_PATH.read_text(encoding="utf-8"))
    sel = json.loads(SEL_PATH.read_text(encoding="utf-8"))
    by_id = {piece["id"]: piece for piece in tang["pieces"]}
    order = {row["order"]: row["id"] for row in sel["tang"]}
    titles = index_titles()
    changes = []
    skipped = []
    for index, title in enumerate(titles, 1):
        pid = order[index]
        piece = by_id[pid]
        lines = anthology_lines(ws[title]["wikitext"])
        if not lines:
            skipped.append({"id": pid, "reason": "没有抽到正文", "page": title})
            continue
        old = piece_trad(piece)
        edited = apply_han_edits(old, lines)
        if edited is None:
            old_h = simp_han(old)
            new_h = simp_han(lines)
            if old_h != new_h:
                skipped.append({
                    "id": pid,
                    "title": piece["title"]["s"],
                    "reason": "字数对不上，不改断行",
                    "old": old_h,
                    "new": new_h,
                })
            continue
        if pid in SKIP:
            skipped.append({"id": pid, "title": piece["title"]["s"], "reason": "跳过"})
            continue
        joined = "".join(edited)
        if "另" in joined or "㡬" in joined or "-{" in joined:
            skipped.append({"id": pid, "title": piece["title"]["s"], "reason": "抽取残留"})
            continue
        try:
            fresh = retokenize(piece, edited)
        except SystemExit as exc:
            skipped.append({"id": pid, "title": piece["title"]["s"], "reason": str(exc)})
            continue
        lines = edited
        changes.append({
            "id": pid,
            "title": piece["title"]["s"],
            "author": piece["author"]["s"],
            "old": [zhonghua_simp(line) for line in old],
            "new": [zhonghua_simp(line) for line in lines],
        })
        if write:
            by_id[pid].clear()
            by_id[pid].update(fresh)
            if pid in bodies:
                bodies[pid]["trad"] = lines
            add_note(notes, pid, old, lines)
    print("changes", len(changes), "skipped", len(skipped))
    for item in changes:
        print("CHANGE", item["id"], item["title"])
        for old, new in zip(item["old"], item["new"]):
            if old != new:
                print("  -", old)
                print("  +", new)
    print("--- skipped ---")
    for item in skipped:
        print(item["id"], item.get("title", ""), item["reason"])
    if write:
        notes["credit"]["s"] = (
            "赏析、注释、背景和白话是本书编写的。史实依据两《唐书》《宋史》和常见文学史里的公共记载；"
            "词的小序只撮述时间和事由，不整段移录。不转录现代赏析网站的原文。"
            "唐诗正文用《唐诗三百首》页面上的通行文字，和全唐诗不同的记为异文；课文篇目再跟课文。"
            "宋词正文用朱孝臧重编《宋词三百首》。简体按《简化字总表》的通行归并。"
        )
        notes["credit"]["t"] = (
            "賞析、註釋、背景和白話是本書編寫的。史實依據兩《唐書》《宋史》和常見文學史裏的公共記載。"
            "唐詩正文用《唐詩三百首》的通行文字，和全唐詩不同的記為異文。宋詞正文用重編《宋詞三百首》。"
        )
        TANG_PATH.write_text(json.dumps(tang, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        NOTES_PATH.write_text(json.dumps(notes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        BODIES_PATH.write_text(json.dumps(bodies, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        LOG_PATH.write_text(json.dumps({"changes": changes, "skipped": skipped}, ensure_ascii=False, indent=2), encoding="utf-8")
        print("wrote", len(changes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
