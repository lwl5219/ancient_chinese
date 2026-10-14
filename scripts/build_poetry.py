# -*- coding: utf-8 -*-
"""按 sources/poetry/selection.json 从 chinese-poetry 缓存生成 data/tang.json 与 data/songci.json。

缓存目录默认 /tmp/poetry：
    tang/tang-*.json   全唐诗，繁体
    ci/ci-*.json       宋词，简体

不把全库提交进仓库。正文保持上游用字，只修正多音字的今读。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import opencc
from pypinyin import Style, pinyin

from hanzi import is_han

CACHE = Path("/tmp/poetry")
SEL = ROOT / "sources" / "poetry" / "selection.json"
T2S = opencc.OpenCC("t2s")
S2T = opencc.OpenCC("s2t")

# 这一批里和现代常用音不同、但全篇一致的字。
CHAR_DEFAULT = {
    "爲": "wéi",
    "為": "wéi",
    "長": "cháng",
    "了": "liǎo",
    "子": "zǐ",
    "泊": "bó",
    "薄": "bó",
    "還": "huán",
    "盡": "jìn",
    "似": "sì",
    "沈": "chén",
    "裳": "cháng",
    "舍": "shè",
}

# 字库不收、或默认音不合这一批的单字。
MANUAL = {
    "胷": "xiōng",
    "縧": "tāo",
    "桮": "bēi",
    "衮": "gǔn",
    "逕": "jìng",
    "忺": "xiān",
    "縢": "téng",
    "黲": "cǎn",
    "煖": "nuǎn",
    "猨": "yuán",
    "擷": "xié",
    "靄": "ǎi",
    "噎": "yē",
    "萋": "qī",
    "鸚": "yīng",
    "鵡": "wǔ",
    "蓑": "suō",
    "笠": "lì",
    "暉": "huī",
    "茱": "zhū",
    "萸": "yú",
    "浣": "huàn",
    "濺": "jiàn",
    "搔": "sāo",
    "渾": "hún",
    "眥": "zì",
}

# 短语覆盖单字。按汉字长度从长到短套用，已改过的位置不再改。
PHRASES = [
    ("遙看", "yáo kān"),
    ("不勝簪", "bù shēng zān"),
    ("石徑斜", "shí jìng xiá"),
    ("夕陽斜", "xī yáng xiá"),
    ("鬢毛衰", "bìn máo cuī"),
    ("一行白鷺", "yī háng bái lù"),
    ("淚千行", "lèi qiān háng"),
    ("萬重山", "wàn chóng shān"),
    ("重陽", "chóng yáng"),
    ("重到", "chóng dào"),
    ("夫如何", "fú rú hé"),
    ("飛將", "fēi jiàng"),
    ("少小", "shào xiǎo"),
    ("少年", "shào nián"),
    ("少駐", "shāo zhù"),
    ("朝辭", "zhāo cí"),
    ("朝雨", "zhāo yǔ"),
    ("朝朝暮暮", "zhāo zhāo mù mù"),
    ("朝天闕", "cháo tiān què"),
    ("春種", "chūn zhòng"),
    ("密密縫", "mì mì féng"),
    ("千載", "qiān zǎi"),
    ("漁父", "yú fǔ"),
    ("返景", "fǎn yǐng"),
    ("綸巾", "guān jīn"),
    ("燕然", "yān rán"),
    ("一曲", "yī qǔ"),
    ("無人省", "wú rén xǐng"),
    ("的盧", "dí lú"),
    ("更那堪", "gèng nǎ kān"),
    ("冷難着", "lěng nán zhuó"),
    ("守著", "shǒu zhe"),
    ("爲賦", "wèi fù"),
    ("爲伊", "wèi yī"),
    ("爲誰", "wèi shuí"),
    ("都護", "dū hù"),
    ("都門", "dū mén"),
    ("名都", "míng dū"),
    ("沒馬蹄", "mò mǎ tí"),
    ("佛狸", "bí lí"),
    ("強說", "qiǎng shuō"),
    ("強樂", "qiǎng lè"),
    ("挑燈", "tiǎo dēng"),
    ("華髮", "huā fà"),
    ("琵琶", "pí pá"),
    ("未勒", "wèi lè"),
    ("縹緲", "piāo miǎo"),
    ("闌干", "lán gān"),
    ("思量", "sī liáng"),
]

# (篇 id, 传统正文里的片段, 这段的今读)
CHECKS = [
    ("jingyesi", "看月光", "kàn yuè guāng"),
    ("jingyesi", "思故鄉", "sī gù xiāng"),
    ("lushan", "遙看", "yáo kān"),
    ("baidi", "朝辭", "zhāo cí"),
    ("baidi", "一日還", "yī rì huán"),
    ("baidi", "萬重山", "wàn chóng shān"),
    ("chunxiao", "不覺曉", "bù jué xiǎo"),
    ("chunxiao", "多少", "duō shǎo"),
    ("guanque", "更上", "gèng shàng"),
    ("chusai", "人未還", "rén wèi huán"),
    ("chusai", "飛將", "fēi jiàng"),
    ("chusai", "不教", "bù jiào"),
    ("huixiang", "少小", "shào xiǎo"),
    ("huixiang", "鬢毛衰", "bìn máo cuī"),
    ("jiuyue", "爲異客", "wéi yì kè"),
    ("jiuyue", "少一人", "shǎo yī rén"),
    ("weicheng", "朝雨", "zhāo yǔ"),
    ("weicheng", "更盡", "gèng jìn"),
    ("luzhai", "返景", "fǎn yǐng"),
    ("wangyue", "夫如何", "fú rú hé"),
    ("wangyue", "未了", "wèi liǎo"),
    ("chunwang", "不勝簪", "bù shēng zān"),
    ("chunyu", "花重", "huā zhòng"),
    ("jueju", "一行", "yī háng"),
    ("jueju", "門泊", "mén bó"),
    ("huanghelou", "千載", "qiān zǎi"),
    ("fengqiao", "漁父", "yú fǔ"),
    ("youzi", "遊子", "yóu zǐ"),
    ("youzi", "密密縫", "mì mì féng"),
    ("minnong-chun", "春種", "chūn zhòng"),
    ("minnong-chun", "農夫", "nóng fū"),
    ("shanxing", "石徑斜", "shí jìng xiá"),
    ("qinhuai", "煙籠", "yān lóng"),
    ("qinhuai", "夜泊", "yè bó"),
    ("yeyu", "漲秋", "zhǎng qiū"),
    ("wuyi", "夕陽斜", "xī yáng xiá"),
    ("wuyi", "堂前燕", "táng qián yàn"),
    ("baixue", "冷難着", "lěng nán zhuó"),
    ("baixue", "琵琶", "pí pá"),
    ("qiantang", "賈亭", "jiǎ tíng"),
    ("qiantang", "新燕", "xīn yàn"),
    ("qiantang", "沒馬蹄", "mò mǎ tí"),
    ("shuidiao", "宮闕", "gōng què"),
    ("shuidiao", "不勝寒", "bù shèng hán"),
    ("shuidiao", "長久", "cháng jiǔ"),
    ("niannu", "綸巾", "guān jīn"),
    ("niannu", "華髮", "huā fà"),
    ("niannu", "嫁了", "jià liǎo"),
    ("niannu", "還酹", "huán lèi"),
    ("niannu", "英發", "yīng fā"),
    ("jiangcheng", "還鄉", "huán xiāng"),
    ("jiangcheng", "千行", "qiān háng"),
    ("chounu", "少年", "shào nián"),
    ("chounu", "爲賦", "wèi fù"),
    ("chounu", "強說", "qiǎng shuō"),
    ("chounu", "還休", "huán xiū"),
    ("shengsheng", "還寒", "huán hán"),
    ("shengsheng", "將息", "jiāng xī"),
    ("shengsheng", "守著", "shǒu zhe"),
    ("shengsheng", "了得", "liǎo dé"),
    ("rumeng", "知否", "zhī fǒu"),
    ("rumeng", "應是", "yīng shì"),
    ("xiting", "興盡", "xìng jìn"),
    ("yulin", "都門", "dū mén"),
    ("yulin", "更那堪", "gèng nǎ kān"),
    ("yulin", "酒醒", "jiǔ xǐng"),
    ("dielian", "強樂", "qiǎng lè"),
    ("dielian", "爲伊", "wèi yī"),
    ("pozhen", "挑燈", "tiǎo dēng"),
    ("pozhen", "的盧", "dí lú"),
    ("pozhen", "了卻", "liǎo què"),
    ("yongyu", "佛狸", "bí lí"),
    ("yongyu", "飯否", "fàn fǒu"),
    ("yujia", "燕然", "yān rán"),
    ("yujia", "征夫", "zhēng fū"),
    ("queqiao", "朝朝暮暮", "zhāo zhāo mù mù"),
    ("queqiao", "勝卻", "shèng què"),
    ("huanxi", "一曲", "yī qǔ"),
    ("huanxi", "燕歸", "yàn guī"),
    ("yangzhou", "名都", "míng dū"),
    ("yangzhou", "少駐", "shāo zhù"),
    ("yangzhou", "都在", "dōu zài"),
    ("yangzhou", "重到", "chóng dào"),
    ("yangzhou", "爲誰", "wèi shuí"),
    ("manjiang", "怒髮", "nù fà"),
    ("manjiang", "白了", "bái liǎo"),
    ("manjiang", "少年", "shào nián"),
    ("manjiang", "朝天闕", "cháo tiān què"),
    ("zuihua", "重陽", "chóng yáng"),
    ("busuan", "無人省", "wú rén xǐng"),
    ("qingyu", "更吹", "gèng chuī"),
    ("yongliu", "似剪刀", "sì jiǎn dāo"),
    ("shuidiao", "何似", "hé sì"),
    ("weicheng", "客舍", "kè shè"),
    ("xiting", "沈醉", "chén zuì"),
    ("yulin", "沈沈", "chén chén"),
    ("yijian", "羅裳", "luó cháng"),
    ("yujia", "未勒", "wèi lè"),
    ("busuan", "縹緲", "piāo miǎo"),
    ("baixue", "闌干", "lán gān"),
    ("jiangcheng", "思量", "sī liáng"),
]


def load_dir(folder: Path, pattern: str) -> list[dict]:
    files = sorted(folder.glob(pattern))
    if not files:
        raise SystemExit("没有找到 %s 。先把 chinese-poetry 的 JSON 放到这个目录。" % folder)
    rows: list[dict] = []
    for path in files:
        rows.extend(json.loads(path.read_text(encoding="utf-8")))
    return rows


def han_only(text: str) -> str:
    return "".join(ch for ch in text if is_han(ch))


def match_tang(poems: list[dict], spec: dict) -> dict:
    hits = []
    for poem in poems:
        if poem.get("author") != spec["author"]:
            continue
        title = poem.get("title") or ""
        if "title" in spec and title != spec["title"]:
            continue
        if "title_has" in spec and spec["title_has"] not in title:
            continue
        paras = poem.get("paragraphs") or []
        if "start" in spec and (not paras or not paras[0].startswith(spec["start"])):
            continue
        hits.append(poem)
    if len(hits) != 1:
        raise SystemExit("%s 匹配到 %d 首（作者 %s）" % (spec["id"], len(hits), spec["author"]))
    return hits[0]


def match_ci(poems: list[dict], spec: dict) -> dict:
    hits = []
    for poem in poems:
        if poem.get("author") != spec["author"]:
            continue
        if spec["tune"] not in (poem.get("rhythmic") or ""):
            continue
        blob = "".join(poem.get("paragraphs") or [])
        if spec["contains"] not in blob:
            continue
        hits.append(poem)
    if len(hits) != 1:
        raise SystemExit("%s 匹配到 %d 首（%s %s）" % (spec["id"], len(hits), spec["author"], spec["tune"]))
    return hits[0]


def base_py(ch: str) -> str:
    if ch in MANUAL and MANUAL[ch]:
        return MANUAL[ch]
    if ch in CHAR_DEFAULT:
        return CHAR_DEFAULT[ch]
    got = pinyin(ch, style=Style.TONE, errors="ignore")
    py = got[0][0] if got and got[0] else ""
    if not py or py == ch:
        raise SystemExit("没有拼音：%s" % ch)
    return py


def apply_phrases(text: str, pys: list[str], used: dict[str, int]) -> None:
    han_idx = [i for i, ch in enumerate(text) if is_han(ch)]
    han = "".join(text[i] for i in han_idx)
    fixed = [False] * len(text)
    ordered = sorted(PHRASES, key=lambda item: len(han_only(item[0])), reverse=True)
    for phrase, reading in ordered:
        target = han_only(phrase)
        parts = reading.split()
        if len(parts) != len(target):
            raise SystemExit("短语拼音数量不对：%s" % phrase)
        start = 0
        while True:
            found = han.find(target, start)
            if found < 0:
                break
            for offset, py in enumerate(parts):
                idx = han_idx[found + offset]
                if not fixed[idx]:
                    pys[idx] = py
                    fixed[idx] = True
            used[phrase] = used.get(phrase, 0) + 1
            start = found + len(target)


def line_readings(text: str, used: dict[str, int]) -> list[str]:
    pys = [base_py(ch) if is_han(ch) else "" for ch in text]
    apply_phrases(text, pys, used)
    return pys


def tokens_for(trad: str, simp: str, pys: list[str]) -> list[dict]:
    if len(trad) != len(simp) or len(trad) != len(pys):
        raise SystemExit("简繁长度不一致：%s / %s" % (trad, simp))
    tokens: list[dict] = []
    buf_t = ""
    buf_s = ""
    buf_py: list[str] = []

    def flush() -> None:
        nonlocal buf_t, buf_s, buf_py
        if not buf_t:
            return
        tokens.append(
            {
                "t": buf_t,
                "s": buf_s,
                "py": " ".join(buf_py),
                "ctx": "",
                "pos": "",
                "extra": "",
                "level": "dict",
            }
        )
        buf_t = ""
        buf_s = ""
        buf_py = []

    for ct, cs, py in zip(trad, simp, pys):
        if is_han(ct) or is_han(cs):
            if not (is_han(ct) and is_han(cs)):
                raise SystemExit("简繁汉字对不齐：%s / %s" % (trad, simp))
            buf_t += ct
            buf_s += cs
            buf_py.append(py)
        else:
            flush()
            tokens.append({"t": ct, "s": cs, "punct": True})
    flush()
    return tokens


def piece_from_paragraphs(spec: dict, author_t: str, author_s: str, paragraphs: list[str], simp_from_trad: bool, used: dict[str, int]) -> dict:
    display_t = spec["display"]
    display_s = T2S.convert(display_t)
    lines = []
    for para in paragraphs:
        trad = para if not simp_from_trad else S2T.convert(para)
        simp = T2S.convert(trad) if not simp_from_trad else para
        if len(trad) != len(simp):
            raise SystemExit("%s 简繁长度不一致：%s / %s" % (spec["id"], trad, simp))
        pys = line_readings(trad, used)
        lines.append({"tokens": tokens_for(trad, simp, pys)})
    return {
        "id": spec["id"],
        "title": {"t": display_t, "s": display_s},
        "author": {"t": author_t, "s": author_s},
        "lines": lines,
    }


def han_text(piece: dict) -> str:
    chars = []
    for line in piece["lines"]:
        for tok in line["tokens"]:
            if not tok.get("punct"):
                chars.append(tok["t"])
    return "".join(chars)


def py_text(piece: dict) -> str:
    parts = []
    for line in piece["lines"]:
        for tok in line["tokens"]:
            if not tok.get("punct"):
                parts.append(tok["py"])
    return " ".join(parts)


def check(pieces: list[dict]) -> None:
    by_id = {piece["id"]: piece for piece in pieces}
    for pid, snippet, reading in CHECKS:
        piece = by_id[pid]
        han = han_text(piece)
        py = py_text(piece).split()
        if len(han) != len(py):
            raise SystemExit("%s 拼音数量 %d 不等于汉字 %d" % (pid, len(py), len(han)))
        at = han.find(snippet)
        if at < 0:
            raise SystemExit("%s 里没有「%s」" % (pid, snippet))
        got = " ".join(py[at : at + len(snippet)])
        if got != reading:
            raise SystemExit("%s 「%s」读成 %s，期望 %s" % (pid, snippet, got, reading))


def source_note(sel: dict) -> str:
    return (
        "正文取自 chinese-poetry（%s，commit %s），MIT，Copyright (c) 2016 JackeyGao。"
        "古籍原文为公有领域。站点保持该提交的用字，不改成课本通行本。拼音是现代汉语今读。"
        % (sel["repo"], sel["commit"])
    )


def main() -> None:
    sel = json.loads(SEL.read_text(encoding="utf-8"))
    tang_src = load_dir(CACHE / "tang", "tang-*.json")
    ci_src = load_dir(CACHE / "ci", "ci-*.json")
    used: dict[str, int] = {}
    tang_pieces = []
    for spec in sel["tang"]:
        poem = match_tang(tang_src, spec)
        tang_pieces.append(
            piece_from_paragraphs(
                spec,
                poem["author"],
                T2S.convert(poem["author"]),
                poem["paragraphs"],
                False,
                used,
            )
        )
    ci_pieces = []
    for spec in sel["ci"]:
        poem = match_ci(ci_src, spec)
        ci_pieces.append(
            piece_from_paragraphs(
                spec,
                S2T.convert(poem["author"]),
                poem["author"],
                poem["paragraphs"],
                True,
                used,
            )
        )
    check(tang_pieces + ci_pieces)
    unused = [phrase for phrase, _reading in PHRASES if phrase not in used]
    if unused:
        raise SystemExit("这些读音短语没有用上：%s" % "、".join(unused))
    note = source_note(sel)
    tang = {
        "id": "tang",
        "title": {"t": "唐詩", "s": "唐诗"},
        "source": note,
        "pieces": tang_pieces,
    }
    ci = {
        "id": "ci",
        "title": {"t": "宋詞", "s": "宋词"},
        "source": note,
        "pieces": ci_pieces,
    }
    tang_path = ROOT / "data" / "tang.json"
    ci_path = ROOT / "data" / "songci.json"
    tang_path.write_text(json.dumps(tang, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ci_path.write_text(json.dumps(ci, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    review = []
    for piece in tang_pieces + ci_pieces:
        review.append("[%s] %s · %s" % (piece["id"], piece["title"]["t"], piece["author"]["t"]))
        for line in piece["lines"]:
            chars = []
            pys = []
            for tok in line["tokens"]:
                if tok.get("punct"):
                    chars.append(tok["t"])
                else:
                    chars.append(tok["t"])
                    pys.append(tok["py"])
            review.append("  " + "".join(chars))
            review.append("  " + " ".join(pys))
    (CACHE / "review.txt").write_text("\n".join(review) + "\n", encoding="utf-8")
    print("wrote %s (%d) and %s (%d)" % (tang_path.name, len(tang_pieces), ci_path.name, len(ci_pieces)))


if __name__ == "__main__":
    main()
