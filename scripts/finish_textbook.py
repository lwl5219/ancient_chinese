# -*- coding: utf-8 -*-
"""课文用字、补篇，以及异文注。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from expand_poetry import piece_new, zhonghua_simp
from textbook_texts import ADDITIONS

TANG_PATH = ROOT / "data" / "tang.json"
CI_PATH = ROOT / "data" / "songci.json"
KE_PATH = ROOT / "data" / "ke.json"
NOTES_PATH = ROOT / "data" / "poetry-notes.json"
BODIES_PATH = ROOT / "sources" / "poetry" / "bodies.json"
SEL_PATH = ROOT / "sources" / "poetry" / "selection.json"
GRADES_PATH = ROOT / "data" / "grades.json"
LOG_PATH = ROOT / "sources" / "poetry" / "text-changes.json"


def piece_lines(piece: dict) -> list[str]:
    return ["".join(tok["t"] for tok in line["tokens"]) for line in piece["lines"]]


def simp_lines(lines: list[str]) -> list[str]:
    return [zhonghua_simp(line) for line in lines]


def retokenize(piece: dict, lines: list[str]) -> dict:
    spec = {"id": piece["id"], "display": piece["title"]["t"]}
    fresh = piece_new(spec, piece["author"]["t"], lines, {})
    fresh["title"] = piece["title"]
    fresh["author"] = piece["author"]
    if piece.get("form"):
        fresh["form"] = piece["form"]
    return fresh


def apply_subs(lines: list[str], subs: list[tuple[str, str]]) -> list[str] | None:
    text = "\n".join(lines)
    for old, new in subs:
        if old not in text:
            raise SystemExit("找不到「%s」" % old)
        text = text.replace(old, new, 1)
    out = text.split("\n")
    if out == lines:
        return None
    return out


def yiwen(kind: str, old_s: list[str], new_s: list[str]) -> dict:
    bits = []
    for old, new in zip(old_s, new_s):
        if old != new:
            bits.append(old)
    if len(old_s) != len(new_s):
        bits = old_s
    label = "全唐诗" if kind == "tang" else "宋词三百首通行文字"
    gloss_s = label + "作" + "，".join("「%s」" % bit for bit in bits if bit) + "。这里用课文和所选注本的通行文字。"
    if kind == "ci":
        gloss_s = "另一通行文字作" + "，".join("「%s」" % bit for bit in bits if bit) + "。课文篇用课文的文字。"
    return {
        "term": {"s": "异文", "t": "異文"},
        "gloss": {"s": gloss_s, "t": "通行文字不同，這裡用課文和注本的通行文字。"},
    }


def set_note(notes: dict, pid: str, note: dict) -> None:
    entry = notes["pieces"].setdefault(pid, {"author": "", "form": {"s": "", "t": ""}, "notes": [], "vernacular": [], "analysis": {"s": "", "t": ""}, "background": {"s": "", "t": ""}})
    entry["notes"] = [item for item in entry.get("notes") or [] if item.get("term", {}).get("s") != "异文"]
    entry["notes"].append(note)


def main() -> None:
    tang = json.loads(TANG_PATH.read_text(encoding="utf-8"))
    ci = json.loads(CI_PATH.read_text(encoding="utf-8"))
    notes = json.loads(NOTES_PATH.read_text(encoding="utf-8"))
    bodies = json.loads(BODIES_PATH.read_text(encoding="utf-8"))
    sel = json.loads(SEL_PATH.read_text(encoding="utf-8"))
    grades = json.loads(GRADES_PATH.read_text(encoding="utf-8"))
    changes = []

    # 空异文（旧字和新字简体相同）删掉。
    for pid, entry in notes["pieces"].items():
        kept = []
        for item in entry.get("notes") or []:
            gloss = (item.get("gloss") or {}).get("s") or ""
            if item.get("term", {}).get("s") == "异文" and gloss.startswith("全唐诗作。"):
                continue
            kept.append(item)
        entry["notes"] = kept

    books = {"tang": {p["id"]: p for p in tang["pieces"]}, "ci": {p["id"]: p for p in ci["pieces"]}}
    lists = {"tang": tang, "ci": ci}

    subs = {
        "tang": {
            "wangyue": [("盪胷生曾雲", "蕩胸生層雲"), ("夫如何，", "夫如何？")],
            "jiangxue": [("萬逕", "萬徑")],
            "denggao": [("猨嘯", "猿嘯"), ("濁酒桮", "濁酒杯")],
            "baidi": [("猨聲啼不盡", "猿聲啼不住")],
            "liangzhou-wang": [("春光不度", "春風不度")],
            "t081": [("投筯", "投箸"), ("拔劒", "拔劍"), ("多岐路", "多歧路"), ("行路難，行路難", "行路難！行路難"), ("今安在。", "今安在？")],
            "t219": [("映堦", "映階")],
            "t214": [("劒外", "劍外")],
            "baixue": [("不煖", "不暖")],
            "t077": [
                ("君不見黃河", "君不見，黃河"),
                ("君不見高堂", "君不見，高堂"),
                ("三百盃", "三百杯"),
                ("君莫停", "杯莫停"),
                ("側耳聽", "傾耳聽"),
                ("不願醒", "不復醒"),
                ("恣讙謔", "恣歡謔"),
            ],
            "t085": [("噫吁戲", "噫吁嚱"), ("猨猱", "猿猱"), ("砅厓", "砯崖"), ("劒閣", "劍閣")],
            "t038": [
                ("秋索索", "秋瑟瑟"),
                ("名蜀教坊", "名屬教坊"),
                ("幽咽泉流水下灘", "幽咽泉流冰下難"),
                ("水泉冷澀弦疑絕，疑絕不通", "冰泉冷澀弦凝絕，凝絕不通"),
                ("銀缾", "銀瓶"),
                ("蝦蟇陵", "蝦蟆陵"),
                ("秋娘妬", "秋娘妒"),
                ("鈿頭雲箆", "鈿頭銀篦"),
                ("羅帬飜", "羅裙翻"),
                ("啼血猨", "啼血猿"),
                ("爲君飜作", "爲君翻作"),
                ("沈吟", "沉吟"),
            ],
        },
        "ci": {
            "zuihua": [("把灑", "把酒"), ("不消魂", "不銷魂"), ("人似黃花", "人比黃花")],
            "shengsheng": [("誰忺摘", "誰堪摘"), ("守著窗兒", "守着窗兒")],
            "dingfeng": [("瀟灑處", "蕭瑟處")],
            "jiangcheng": [("斷腸處", "腸斷處")],
            "busuan": [("時見幽人", "誰見幽人"), ("楓落吳江冷", "寂寞沙洲冷")],
            "yulin": [("沈沈", "沉沉")],
            "niannu": [("強虜", "檣櫓"), ("人間如夢", "人生如夢")],
            "xiting": [("沈醉", "沉醉")],
        },
    }

    for kind, mapping in subs.items():
        for pid, pairs in mapping.items():
            piece = books[kind][pid]
            old = piece_lines(piece)
            new = apply_subs(old, pairs)
            if not new:
                continue
            fresh = retokenize(piece, new)
            books[kind][pid].clear()
            books[kind][pid].update(fresh)
            if pid in bodies and bodies[pid].get("trad"):
                bodies[pid]["trad"] = new
            old_s, new_s = simp_lines(old), simp_lines(new)
            changes.append({"id": pid, "kind": kind, "title": fresh["title"]["s"], "old": old_s, "new": new_s})
            if pid in notes["pieces"]:
                set_note(notes, pid, yiwen(kind, old_s, new_s))

    # 《琵琶行》补课文的序。
    pipa = books["tang"]["t038"]
    preface = "元和十年，予左遷九江郡司馬。明年秋，送客湓浦口，聞舟中夜彈琵琶者，聽其音，錚錚然有京都聲。問其人，本長安倡女，嘗學琵琶於穆、曹二善才，年長色衰，委身為賈人婦。遂命酒，使快彈數曲。曲罷憫然，自敘少小時歡樂事，今漂淪憔悴，轉徙於江湖間。予出官二年，恬然自安，感斯人言，是夕始覺有遷謫意。因為長句，歌以贈之，凡六百一十六言，命曰《琵琶行》。"
    lines = piece_lines(pipa)
    if not lines[0].startswith("元和十年"):
        lines = [preface] + lines
        fresh = retokenize(pipa, lines)
        pipa.clear()
        pipa.update(fresh)
        if "t038" in bodies:
            bodies["t038"]["trad"] = lines
        changes.append({"id": "t038-xu", "kind": "tang", "title": "琵琶行并序", "old": ["（无序）"], "new": simp_lines([preface])})

    qiantang = books["tang"]["qiantang"]
    qiantang["title"] = {"t": "錢塘湖春行", "s": "钱塘湖春行"}
    changes.append({"id": "qiantang-title", "kind": "tang", "title": "钱塘湖春行", "old": ["钱唐湖春行"], "new": ["钱塘湖春行"]})

    # 三百首和课文不同、课文已胜出的，补一条异文；正文不再改。
    kept = {
        "shuidiao": "宋词三百首一系作「惟恐琼楼玉宇」。课文作「又恐琼楼玉宇」，这里从课文。",
        "huanxi": "宋词三百首一系作「去年天气旧池台」。课文作「旧亭台」，这里从课文。",
        "yongyu": "宋词三百首一系作「灯火扬州路」。课文作「烽火扬州路」，这里从课文。",
        "manjiang": "另一通行文字作「臣子憾」。课文作「臣子恨」，这里从课文。",
    }
    for pid, gloss in kept.items():
        set_note(notes, pid, {"term": {"s": "异文", "t": "異文"}, "gloss": {"s": gloss, "t": "課文和另一通行文字不同，這裡從課文。"}})
        changes.append({"id": pid, "kind": "ci", "title": books["ci"][pid]["title"]["s"], "old": [gloss], "new": ["正文保持课文用字"]})

    tang["pieces"] = [books["tang"][p["id"]] for p in tang["pieces"]]
    ci["pieces"] = [books["ci"][p["id"]] for p in ci["pieces"]]

    ke_pieces = []
    order = 2000
    for spec in ADDITIONS:
        author_t = spec["author_t"]
        built = piece_new({"id": spec["id"], "display": spec["title_t"]}, author_t, spec["lines"], {})
        built["title"] = {"t": spec["title_t"], "s": spec["title_s"]}
        built["author"] = {"t": author_t, "s": zhonghua_simp(author_t)}
        built["form"] = spec["form"]
        grades["pieces"][spec["id"]] = spec["grade"]
        if spec["bucket"] == "tang":
            tang["pieces"].append(built)
            sel["tang"].append({
                "id": spec["id"],
                "author": author_t,
                "title": spec["title_t"],
                "display": spec["title_t"],
                "form": "课本收录，不在这一版三百首目录里",
                "order": order,
            })
        elif spec["bucket"] == "ci":
            ci["pieces"].append(built)
            sel["ci"].append({
                "id": spec["id"],
                "author": author_t,
                "tune": spec["title_t"],
                "display": spec["title_t"],
                "order": order,
            })
        else:
            ke_pieces.append(built)
        order += 1
        changes.append({"id": spec["id"], "kind": spec["bucket"], "title": spec["title_s"], "old": [], "new": simp_lines(spec["lines"])})

    sel["note"] = "唐诗对照蘅塘退士《唐诗三百首》和统编课文，课文篇从课文，《静夜思》作床前明月光。宋词对照朱孝臧重编《宋词三百首》，课文篇从课文。display 是站点上的篇名。"
    notes["credit"] = {
        "s": "赏析、注释、背景和白话是本书编写的。史实依据两《唐书》《宋史》和常见文学史里的公共记载；词的小序只撮述时间和事由，不整段移录。不转录现代赏析网站的原文。唐诗正文用《唐诗三百首》和课文的通行文字，和全唐诗不同的记为异文。宋词正文用重编《宋词三百首》，课文篇再跟课文。简体按《简化字总表》的通行归并。",
        "t": "賞析、註釋、背景和白話是本書編寫的。史實依據兩《唐書》《宋史》和常見文學史裏的公共記載。唐詩正文用《唐詩三百首》和課文的通行文字，和全唐詩不同的記為異文。宋詞正文用重編《宋詞三百首》，課文篇再跟課文。",
    }

    ke = {
        "id": "ke",
        "title": {"t": "課文", "s": "课文"},
        "source": "统编语文教材里、唐诗三百首、宋词三百首和古文观止未收的篇目。正文从课文通行文字。",
        "pieces": ke_pieces,
    }

    def dump(path: Path, data: object, pretty: bool = False) -> None:
        if pretty:
            text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        else:
            text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        path.write_text(text, encoding="utf-8")

    dump(TANG_PATH, tang)
    dump(CI_PATH, ci)
    dump(KE_PATH, ke)
    dump(NOTES_PATH, notes, pretty=True)
    dump(BODIES_PATH, bodies, pretty=True)
    dump(SEL_PATH, sel, pretty=True)
    dump(GRADES_PATH, grades, pretty=True)
    dump(LOG_PATH, {"changes": changes}, pretty=True)
    print("tang", len(tang["pieces"]), "ci", len(ci["pieces"]), "ke", len(ke_pieces), "changes", len(changes))


if __name__ == "__main__":
    main()
