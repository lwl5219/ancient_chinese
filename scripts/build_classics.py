# -*- coding: utf-8 -*-
"""由维基文库缓存生成道德经、论语，并写出名篇名句。"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from opencc import OpenCC
from pypinyin import Style, pinyin

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from fill_textbook_gloss import PHRASES, fill_tokens  # noqa: E402
from hanzi import only_han  # noqa: E402

SRC = ROOT / "sources" / "classics"
ART = ROOT / "data" / "articles"
CC = OpenCC("t2s")
PUNCT = set("，。！？；、：·．…—～「」『』（）【】《》〈〉〔〕〖〗､“”‘’")
HAN = re.compile(r"[\u4e00-\u9fff]")

# 课文里读音和今读不同的短语。只改这些，其余用今读参考。
PY_FIX = [
    ("不亦说乎", "bù yì yuè hū"),
    ("孝弟", "xiào tì"),
    ("三省", "sān xǐng"),
    ("传不习", "chuán bù xí"),
    ("鲜矣", "xiǎn yǐ"),
    ("鲜有", "xiǎn yǒu"),
    ("知之者", "zhì zhī zhě"),
    ("好之者", "hào zhī zhě"),
    ("乐之者", "lè zhī zhě"),
    ("不亦乐乎", "bù yì lè hū"),
    ("乐亦在其中", "lè yì zài qí zhōng"),
    ("饭疏食", "fàn shū shí"),
    ("曲肱", "qū gōng"),
    ("不舍昼夜", "bù shě zhòu yè"),
    ("自见者", "zì xiàn zhě"),
    ("自矜", "zì jīn"),
    ("强行", "qiǎng xíng"),
    ("易泮", "yì pàn"),
    ("毂", "gǔ"),
    ("埏埴", "shān zhí"),
    ("户牖", "hù yǒu"),
    ("累土", "lěi tǔ"),
    ("几成", "jī chéng"),
    ("说怿", "yuè yì"),
]

JUNIOR = [
    "学而时习之",
    "吾日三省吾身",
    "吾十有五而志于学",
    "温故而知新",
    "学而不思则罔",
    "贤哉回也",
    "知之者不如好之者",
    "饭疏食饮水",
    "三人行必有我师",
    "逝者如斯夫",
    "三军可夺帅",
    "博学而笃志",
]
SENIOR_LY = [
    "君子食无求饱",
    "人而不仁如礼何",
    "朝闻道夕死可矣",
    "君子喻于义",
    "见贤思齐",
    "质胜文则野",
    "士不可以不弘毅",
    "譬如为山",
    "知者不惑仁者不忧",
    "克己复礼为仁",
    "其恕乎",
    "诗可以兴",
]
DAODE_GRADE = {11, 24, 33, 64}
DAODE_FAMOUS = {1, 2, 8, 11, 22, 24, 33, 40, 42, 64, 76, 78, 80, 81}
DAODE_QUOTES = [
    "道可道非常道",
    "无名天地之始",
    "上善若水",
    "三十辐共一毂",
    "有之以为利",
    "企者不立",
    "知人者智",
    "其安易持",
    "合抱之木",
    "千里之行始于足下",
    "道生一",
    "反者道之动",
    "天下莫柔弱于水",
    "信言不美",
]
PHRASES.extend([
    ("道可道非常道", [("恒常的道。", ""), ("可以。", ""), ("用言语表述。", ""), ("不是。", ""), ("恒常。", ""), ("道。", "")]),
    ("名可名非常名", [("名称。", ""), ("可以。", ""), ("叫出名字。", ""), ("不是。", ""), ("恒常。", ""), ("名。", "")]),
    ("常无欲", [("总是。", ""), ("没有。", ""), ("欲望。", "")]),
    ("常有欲", [("总是。", ""), ("有。", ""), ("欲望。", "")]),
    ("不亦说乎", [("不。", ""), ("也。", ""), ("喜悦。", "yuè"), ("吗。", "")]),
    ("孝弟", [("孝顺父母。", ""), ("敬爱兄长。", "tì")]),
    ("三省吾身", [("表示多次。", ""), ("省察。", "xǐng"), ("我的。", ""), ("自身。", "")]),
    ("传不习乎", [("老师传授的学问。", "chuán"), ("不。", ""), ("复习、实习。", ""), ("吗。", "")]),
    ("鲜矣仁", [("少。", "xiǎn"), ("了。", ""), ("仁德。", "")]),
    ("知之者不如好之者", [("智慧。", "zhì"), ("它。", ""), ("的人。", ""), ("不。", ""), ("如。", ""), ("喜好。", "hào"), ("它。", ""), ("的人。", "")]),
    ("好之者不如乐之者", [("喜好。", "hào"), ("它。", ""), ("的人。", ""), ("不。", ""), ("如。", ""), ("以之为乐。", "lè"), ("它。", ""), ("的人。", "")]),
    ("饭疏食饮水", [("吃。", ""), ("粗。", ""), ("食物。", ""), ("喝。", ""), ("凉水。", "")]),
    ("不舍昼夜", [("不。", ""), ("停止。", "shě"), ("白天。", ""), ("黑夜。", "")]),
    ("自见者不明", [("自己。", ""), ("同“现”，显露。", "xiàn"), ("的人。", ""), ("不。", ""), ("明白。", "")]),
    ("强行者有志", [("勉力。", "qiǎng"), ("实行。", ""), ("的人。", ""), ("有。", ""), ("心志。", "")]),
    ("其脆易泮", [("它。", ""), ("脆弱。", ""), ("容易。", ""), ("消散。", "pàn")]),
    ("几成而败之", [("接近。", "jī"), ("成功。", ""), ("却。", ""), ("搞坏。", ""), ("它。", "")]),
    ("诲女知之", [("教。", ""), ("你。", "rǔ"), ("知道。", ""), ("它。", "")]),
    ("三十辐共一毂", [("三十。", ""), ("十。", ""), ("车轮的辐条。", ""), ("共。", ""), ("一。", ""), ("车轮中心的圆木。", "gǔ")]),
    ("埏埴以为器", [("和泥土。", "shān"), ("黏土。", "zhí"), ("把。", ""), ("做成。", ""), ("器皿。", "")]),
    ("凿户牖以为室", [("开凿。", ""), ("门。", ""), ("窗。", "yǒu"), ("把。", ""), ("做成。", ""), ("房屋。", "")]),
    ("有之以为利无之以为用", [("有。", ""), ("它。", ""), ("把。", ""), ("当作。", ""), ("便利。", ""), ("空无。", ""), ("它。", ""), ("把。", ""), ("当作。", ""), ("功用。", "")]),
])
LY_QUOTES = [
    ("學而時習之", "学而时习之", "01"),
    ("有朋自遠方來", "有朋自远方来", "01"),
    ("人不知而不慍", "人不知而不愠", "01"),
    ("吾日三省吾身", "吾日三省吾身", "01"),
    ("吾十有五而志於學", "吾十有五而志于学", "02"),
    ("溫故而知新", "温故而知新", "02"),
    ("學而不思則罔", "学而不思则罔", "02"),
    ("賢哉，回也", "贤哉回也", "06"),
    ("知之者不如好之者", "知之者不如好之者", "06"),
    ("飯疏食", "饭疏食饮水", "07"),
    ("三人行", "三人行必有我师", "07"),
    ("逝者如斯夫", "逝者如斯夫", "09"),
    ("三軍可奪帥", "三军可夺帅", "09"),
    ("博學而篤志", "博学而笃志", "19"),
    ("君子食無求飽", "君子食无求饱", "01"),
    ("人而不仁", "人而不仁", "03"),
    ("朝聞道", "朝闻道夕死可矣", "04"),
    ("君子喻於義", "君子喻于义", "04"),
    ("見賢思齊", "见贤思齐", "04"),
    ("質勝文則野", "质胜文则野", "06"),
    ("士不可以不弘毅", "士不可以不弘毅", "08"),
    ("譬如爲山", "譬如为山", "09"),
    ("知者不惑", "知者不惑", "09"),
    ("克己復禮", "克己复礼", "12"),
    ("其恕乎", "己所不欲勿施于人", "15"),
    ("可以興", "小子何莫学夫诗", "17"),
]
LY_NAMES = [
    ("学而", "學而"),
    ("为政", "爲政"),
    ("八佾", "八佾"),
    ("里仁", "里仁"),
    ("公冶长", "公冶長"),
    ("雍也", "雍也"),
    ("述而", "述而"),
    ("泰伯", "泰伯"),
    ("子罕", "子罕"),
    ("乡党", "鄉黨"),
    ("先进", "先進"),
    ("颜渊", "顏淵"),
    ("子路", "子路"),
    ("宪问", "憲問"),
    ("卫灵公", "衞靈公"),
    ("季氏", "季氏"),
    ("阳货", "陽貨"),
    ("微子", "微子"),
    ("子张", "子張"),
    ("尧曰", "堯曰"),
]


def to_simplified(text: str) -> str:
    out = []
    prev_han = ""
    for ch in text:
        if ch in PUNCT or not HAN.match(ch):
            out.append(ch)
            continue
        simp = CC.convert(ch)
        simp = {
            "飮": "饮",
            "淸": "清",
            "衞": "卫",
            "愼": "慎",
            "尙": "尚",
            "吿": "告",
            "擧": "举",
            "屛": "屏",
            "昬": "昏",
            "顚": "颠",
            "爲": "为",
        }.get(simp, simp)
        if ch == "乾":
            simp = "乾"
        elif ch == "祇" and prev_han == "神":
            simp = "祇"
        elif ch == "祇":
            simp = "只"
        elif ch == "徵" and prev_han == "流":
            simp = "徵"
        elif ch == "於" and prev_han == "樊":
            simp = "於"
        if len(simp) != 1:
            raise SystemExit(f"简繁不对齐：{ch} -> {simp}")
        out.append(simp)
        prev_han = ch
    return "".join(out)


def load_tr() -> tuple[dict, dict]:
    daode = {}
    lunyu = {}
    for name, bucket in (
        ("tr_daode_a.json", daode),
        ("tr_daode_b.json", daode),
        ("tr_lunyu_a.json", lunyu),
        ("tr_lunyu_b.json", lunyu),
    ):
        path = SRC / name
        if not path.is_file():
            raise SystemExit(f"缺少译文 {path}")
        bucket.update(json.loads(path.read_text(encoding="utf-8")))
    return daode, lunyu


def apply_py(tokens: list[dict]) -> None:
    han = "".join(tok["s"] for tok in tokens if not tok.get("punct"))
    slots = [tok for tok in tokens if not tok.get("punct")]
    taken = [False] * len(slots)
    for phrase, reading in sorted(PY_FIX, key=lambda item: len(item[0]), reverse=True):
        syllables = reading.split()
        if len(syllables) != len(phrase):
            raise SystemExit("读音长度不对：" + phrase)
        start = 0
        while True:
            found = han.find(phrase, start)
            if found < 0:
                break
            if not any(taken[found + i] for i in range(len(phrase))):
                for i, syllable in enumerate(syllables):
                    slots[found + i]["py"] = syllable
                    taken[found + i] = True
            start = found + len(phrase)
    for tok in slots:
        if tok.get("py"):
            continue
        rows = pinyin(tok["s"], style=Style.TONE, errors="ignore")
        tok["py"] = rows[0][0] if rows and rows[0] else ""


def tokens_for(trad: str, simp: str) -> list[dict]:
    if len(trad) != len(simp):
        raise SystemExit(f"简繁长度不一致：{trad} / {simp}")
    rows = []
    for t_ch, s_ch in zip(trad, simp):
        if t_ch in PUNCT or s_ch in PUNCT:
            rows.append({"t": t_ch, "s": s_ch, "punct": True})
        else:
            rows.append({
                "t": t_ch,
                "s": s_ch,
                "py": "",
                "ctx": "",
                "pos": "",
                "extra": "",
                "level": "sentence",
            })
    apply_py(rows)
    return rows


def gloss(tokens: list[dict], pid: str) -> None:
    fill_tokens(tokens, pid)


def daode_id(n: int) -> tuple[str, int, int, str, str]:
    if n <= 37:
        return f"d01-{n:02d}", 1, n, "道经", "道經"
    index = n - 37
    return f"d02-{index:02d}", 2, index, "德经", "德經"


def article(pid, volume, vol_s, vol_t, index, title_s, title_t, author, book_s, book_t, head_s, head_t, sentences) -> dict:
    return {
        "id": pid,
        "volume": volume,
        "volumeTitle": vol_s,
        "volumeSubtitle": head_s,
        "index": index,
        "title": {"t": title_t, "s": title_s},
        "book": {"t": book_t, "s": book_s},
        "sourceHead": {"t": head_t, "s": head_s},
        "author": author,
        "annotated": True,
        "paragraphs": [{"sentences": sentences}],
    }


def han_s(text: str) -> str:
    return only_han(to_simplified(text))


def build_daode(parsed: dict, tr: dict) -> tuple[list[dict], dict]:
    pieces = []
    catalog = []
    for chapter in parsed["daode"]:
        n = chapter["n"]
        pid, volume, index, vol_s, vol_t = daode_id(n)
        sentences = []
        trad_parts = []
        for i, line in enumerate(chapter["notes"], 1):
            key = f"{n:02d}-{i:02d}"
            if key not in tr or not str(tr[key]).strip():
                raise SystemExit("道德经缺译文 " + key)
            trad = line["text"]
            simp = to_simplified(trad)
            trad_parts.append(trad)
            tokens = tokens_for(trad, simp)
            gloss(tokens, pid)
            sent = {"tr": tr[key].strip(), "tokens": tokens}
            plain = only_han(simp)
            if n in DAODE_GRADE:
                sent["grade"] = "选择性必修上"
            sentences.append(sent)
        title_s = f"第{cn(n)}章"
        title_t = title_s
        art = article(
            pid, volume, vol_s, vol_t, index, title_s, title_t, "老子",
            "道德经", "道德經", vol_s, vol_t, sentences,
        )
        pieces.append(art)
        catalog.append({
            "id": pid,
            "volume": volume,
            "index": index,
            "title": title_s,
            "titleT": title_t,
            "author": "老子",
            "text": "".join(trad_parts),
        })
    return pieces, {"catalog": catalog}


def cn(n: int) -> str:
    digits = "零一二三四五六七八九"
    if n <= 10:
        return "十" if n == 10 else digits[n]
    if n < 20:
        return "十" + digits[n - 10]
    if n % 10 == 0:
        return digits[n // 10] + "十"
    return digits[n // 10] + "十" + digits[n % 10]


def build_lunyu(parsed: dict, tr: dict) -> list[dict]:
    pieces = []
    for book in parsed["lunyu"]:
        n = book["n"]
        pid = f"l01-{n:02d}"
        name_s, name_t = LY_NAMES[n - 1]
        sentences = []
        trad_all = []
        for i, trad in enumerate(book["verses"], 1):
            key = f"{n:02d}-{i:02d}"
            if key not in tr or not str(tr[key]).strip():
                raise SystemExit("论语缺译文 " + key)
            simp = to_simplified(trad)
            trad_all.append(trad)
            tokens = tokens_for(trad, simp)
            gloss(tokens, pid)
            plain = only_han(simp)
            sent = {"tr": tr[key].strip(), "tokens": tokens}
            tags = []
            if any(q.replace("，", "") in plain for q in JUNIOR):
                tags.append("七年级上")
            if any(q.replace("，", "") in plain for q in SENIOR_LY):
                tags.append("选择性必修上")
            if tags:
                sent["grade"] = " · ".join(tags)
            sentences.append(sent)
        art = article(
            pid, 1, "论语", "論語", n, name_s, name_t, "孔子及其弟子",
            "论语", "論語", f"{name_s}第{cn(n)}", f"{name_t}第{cn(n)}", sentences,
        )
        art["_trad"] = "".join(trad_all)
        pieces.append(art)
    return pieces


def dump(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def note_after(blob: str, needle: str) -> str:
    idx = blob.find(needle)
    if idx < 0:
        return ""
    window = blob[idx:idx + 800]
    match = re.search(r"darkRed\|text=（(.*?)）", window, flags=re.S)
    if not match:
        match = re.search(r"（([^（）]{4,180})）", window)
    if not match:
        return ""
    text = re.sub(r"\s+", "", match.group(1))
    text = text.replace(":", "：")
    return text


def famous_lines(parsed: dict, daode_pieces: list[dict], lunyu_pieces: list[dict]) -> list[dict]:
    lines = []
    by_n = {item["n"]: item for item in parsed["daode"]}
    id_by_n = {}
    for art in daode_pieces:
        # 第N章 from title
        pass
    for chapter in parsed["daode"]:
        pid, *_rest = daode_id(chapter["n"])
        if chapter["n"] not in DAODE_FAMOUS:
            continue
        for line in chapter["notes"]:
            note = (line.get("note") or "").strip()
            if len(note) < 8:
                continue
            simp = to_simplified(line["text"])
            plain = only_han(simp)
            if not any(q in plain for q in DAODE_QUOTES):
                continue
            quote = to_simplified(line["text"]).strip()
            if len(quote) > 42:
                quote = quote[:42].rstrip("，；") + "……"
            text = to_simplified(note)
            if len(text) > 220:
                cut = text[:220]
                stop = max(cut.rfind("。"), cut.rfind("，"))
                text = (cut[:stop] if stop > 40 else cut) + "……"
            lines.append({
                "pieces": [pid],
                "quote": only_han(to_simplified(line["text"]))[:24],
                "comments": [{
                    "author": "王弼",
                    "source": "《老子道德经注》（华亭张氏本）",
                    "text": text,
                    "url": "https://zh.wikisource.org/wiki/道德經_(王弼本)",
                }],
            })
    zhushu_dir = SRC / "zhushu"
    for trad_q, simp_q, vol in LY_QUOTES:
        blob = ""
        path = zhushu_dir / f"{vol}.wiki"
        if path.is_file():
            blob = path.read_text(encoding="utf-8")
        note = note_after(blob, trad_q) if blob else ""
        if not note:
            continue
        # which lunyu piece contains it
        holder = None
        quote_han = only_han(simp_q)
        trad_han = only_han(to_simplified(trad_q))
        for art in lunyu_pieces:
            plain = []
            for para in art["paragraphs"]:
                for sent in para["sentences"]:
                    for tok in sent["tokens"]:
                        if not tok.get("punct"):
                            plain.append(tok.get("s") or "")
            blob = "".join(plain)
            if quote_han in blob and trad_han in blob:
                holder = art["id"]
                break
        if not holder:
            continue
        author = "何晏"
        if note.startswith("馬曰") or note.startswith("马曰"):
            author = "马融"
        elif note.startswith("包曰"):
            author = "包咸"
        elif note.startswith("孔曰"):
            author = "孔安国"
        elif note.startswith("鄭曰") or note.startswith("郑曰"):
            author = "郑玄"
        elif note.startswith("王曰"):
            author = "王肃"
        speakers = [name for name in ("马曰", "包曰", "孔曰", "郑曰", "王曰") if name in to_simplified(note)]
        if len(speakers) > 1:
            author = "何晏"
        lines.append({
            "pieces": [holder],
            "quote": only_han(simp_q),
            "comments": [{
                "author": author,
                "source": "何晏《论语集解》，见邢昺《论语注疏》",
                "text": to_simplified(note),
                "url": f"https://zh.wikisource.org/wiki/論語註疏/卷{vol}",
            }],
        })
    return lines


def gwgz_lines() -> list[dict]:
    """用篇里已经收录的《古文观止》尾评，不另写评语。"""
    wanted = {
        "郑伯克段于鄢": "多行不义必自毙",
        "曹刿论战": "一鼓作气",
        "邹忌讽齐王纳谏": "吾妻之美我者",
        "唐雎不辱使命": "布衣之怒",
        "诸葛亮前出师表": "受任于败军之际",
        "桃花源记": "土地平旷",
        "陋室铭": "山不在高",
        "爱莲说": "出淤泥而不染",
        "师说": "师者所以传道",
        "岳阳楼记": "先天下之忧而忧",
        "醉翁亭记": "醉翁之意不在酒",
        "阿房宫赋": "灭六国者六国也",
    }
    catalog = json.loads((ROOT / "data" / "catalog.json").read_text(encoding="utf-8"))
    by_title = {}
    for vol in catalog["volumes"]:
        for art in vol["articles"]:
            by_title.setdefault(art["title"], []).append(art["id"])
    lines = []
    for title, quote in wanted.items():
        for pid in by_title.get(title, []):
            path = ART / f"{pid}.json"
            if not path.is_file():
                continue
            art = json.loads(path.read_text(encoding="utf-8"))
            comment = ((art.get("classicComment") or {}).get("s") or "").strip()
            if not comment:
                continue
            plain = ""
            for para in art["paragraphs"]:
                for sent in para["sentences"]:
                    for tok in sent["tokens"]:
                        if not tok.get("punct"):
                            plain += tok.get("s") or ""
            if only_han(quote) not in plain:
                continue
            lines.append({
            "pieces": [pid],
            "quote": only_han(quote),
            "comments": [{
                "author": "吴楚材、吴调侯",
                "source": "《古文观止》尾评",
                "text": comment,
                "url": f"https://zh.wikisource.org/wiki/古文觀止/卷{art['volume']}",
            }],
        })
    return lines


def coverage(art: dict) -> float:
    total = 0
    hit = 0
    for para in art["paragraphs"]:
        for sent in para["sentences"]:
            for tok in sent["tokens"]:
                if tok.get("punct"):
                    continue
                n = len(tok.get("s") or tok.get("t") or "")
                total += n
                if (tok.get("ctx") or "").strip():
                    hit += n
    return hit / total if total else 0


def main() -> None:
    parsed = json.loads((SRC / "parsed.json").read_text(encoding="utf-8"))
    tr_d, tr_l = load_tr()
    daode, _extra = build_daode(parsed, tr_d)
    lunyu = build_lunyu(parsed, tr_l)
    canonical = {}
    daode_vols = {1: [], 2: []}
    for art in daode:
        canonical[art["id"]] = ""
        # rebuild trad from tokens
        trad = []
        for para in art["paragraphs"]:
            for sent in para["sentences"]:
                for tok in sent["tokens"]:
                    trad.append(tok["t"])
        canonical[art["id"]] = only_han("".join(trad))
        vol = art["volume"]
        daode_vols[vol].append({
            "id": art["id"],
            "index": art["index"],
            "title": art["title"]["s"],
            "titleT": art["title"]["t"],
            "author": "老子",
        })
        dump(ART / f"{art['id']}.json", art)
    lunyu_articles = []
    for art in lunyu:
        trad = art.pop("_trad")
        canonical[art["id"]] = only_han(trad)
        lunyu_articles.append({
            "id": art["id"],
            "index": art["index"],
            "title": art["title"]["s"],
            "titleT": art["title"]["t"],
            "author": "孔子及其弟子",
        })
        dump(ART / f"{art['id']}.json", art)
    dump(SRC / "canonical.json", canonical)
    dump(ROOT / "data" / "daode.json", {
        "title": "道德经",
        "lead": "老子。正文用王弼注所依的华亭张氏本。简体按通行归并。译文是本书编写的。",
        "volumes": [
            {"volume": 1, "title": "道经", "articles": daode_vols[1]},
            {"volume": 2, "title": "德经", "articles": daode_vols[2]},
        ],
    })
    dump(ROOT / "data" / "lunyu.json", {
        "title": "论语",
        "lead": "二十篇。正文用维基文库《论语》主文。译注参考杨伯峻《论语译注》，白话是本书另写的。",
        "volumes": [{"volume": 1, "title": "二十篇", "articles": lunyu_articles}],
    })

    grades = json.loads((ROOT / "data" / "grades.json").read_text(encoding="utf-8"))
    for pid in list(grades["pieces"]):
        if pid.startswith("d") or pid.startswith("l"):
            del grades["pieces"][pid]
    for art in daode:
        n = art["index"] if art["volume"] == 1 else art["index"] + 37
        if n in DAODE_GRADE:
            grades["pieces"][art["id"]] = {
                "stage": "高中",
                "grade": "选择性必修",
                "volume": "上",
                "title": art["title"]["s"],
                "source": "统编高中选择性必修上《〈老子〉四章》",
            }
    for art in lunyu:
        tags = []
        for para in art["paragraphs"]:
            for sent in para["sentences"]:
                if sent.get("grade"):
                    tags.append(sent["grade"])
        if not tags:
            continue
        entry = {
            "stage": "初中" if any("七年级" in tag for tag in tags) else "高中",
            "grade": "七" if any("七年级" in tag for tag in tags) else "选择性必修",
            "volume": "上",
            "title": art["title"]["s"],
            "source": "统编教材《〈论语〉十二章》节选",
        }
        if any("七年级" in tag for tag in tags) and any("选择性必修" in tag for tag in tags):
            entry["also"] = [{
                "stage": "高中",
                "grade": "选择性必修",
                "volume": "上",
                "source": "统编高中选择性必修上《〈论语〉十二章》节选",
            }]
        elif any("选择性必修" in tag for tag in tags) and entry["stage"] == "初中":
            pass
        elif any("选择性必修" in tag for tag in tags):
            entry["stage"] = "高中"
            entry["grade"] = "选择性必修"
        grades["pieces"][art["id"]] = entry
    dump(ROOT / "data" / "grades.json", grades)

    authors = json.loads((ROOT / "data" / "prose-authors.json").read_text(encoding="utf-8"))
    authors["老子"] = {
        "name": {"s": "老子", "t": "老子"},
        "years": "春秋",
        "card": {"s": "道家。通行本称《道德经》。", "t": "道家。通行本稱《道德經》。"},
        "bio": {"s": "旧题李耳，又称老聃，楚国苦县人。《道德经》五千言，今本分八十一章。本书正文用王弼注所依的本子。", "t": "舊題李耳，又稱老聃，楚國苦縣人。《道德經》五千言，今本分八十一章。本書正文用王弼注所依的本子。"},
    }
    authors["孔子及其弟子"] = {
        "name": {"s": "孔子及其弟子", "t": "孔子及其弟子"},
        "years": "春秋",
        "card": {"s": "《论语》二十篇，弟子和再传弟子记录。", "t": "《論語》二十篇，弟子和再傳弟子記錄。"},
        "bio": {"s": "孔子，名丘，字仲尼，鲁国陬邑人。本书二十篇用通行本正文。杨伯峻《论语译注》用来核对读法和章旨，白话不是逐句抄那一本。", "t": "孔子，名丘，字仲尼，魯國陬邑人。本書二十篇用通行本正文。楊伯峻《論語譯注》用來核對讀法和章旨，白話不是逐句抄那一本。"},
    }
    dump(ROOT / "data" / "prose-authors.json", authors)

    pieces = {}
    for pid, entry in grades["pieces"].items():
        pieces[pid] = {"collection": entry.get("source") or entry.get("title") or ""}
    for art in daode:
        n = art["index"] if art["volume"] == 1 else art["index"] + 37
        if n in DAODE_FAMOUS:
            pieces[art["id"]] = {"collection": "道德经"}
    lines = famous_lines(parsed, daode, lunyu) + gwgz_lines()
    # 名句所在篇也算名篇
    for line in lines:
        for pid in line["pieces"]:
            pieces.setdefault(pid, {"collection": ""})
    famous_path = ROOT / "data" / "famous.json"
    if famous_path.is_file():
        old_pieces = json.loads(famous_path.read_text(encoding="utf-8")).get("pieces") or {}
        merged = dict(old_pieces)
        merged.update(pieces)
        pieces = merged
    famous = {"pieces": pieces, "lines": lines}
    dump(famous_path, famous)
    from expand_famous import rebuild
    rebuild()

    low = []
    for art in daode + lunyu:
        ratio = coverage(art)
        if ratio < 0.95:
            low.append((art["id"], ratio))
    print("daode", len(daode), "lunyu", len(lunyu), "famous pieces", len(pieces), "lines", len(lines))
    if low:
        print("LOW", low[:20])
        raise SystemExit("逐字注不足")


if __name__ == "__main__":
    main()
