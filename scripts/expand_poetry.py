# -*- coding: utf-8 -*-
"""把蘅塘退士《唐诗三百首》和朱孝臧重编《宋词三百首》收进选篇。

唐诗正文优先对 chinese-poetry 全唐诗缓存（繁体）。对不上的再用维基文库单篇。
宋词正文用维基文库《宋词三百首》（朱孝臧重编，283 首）。
已经在站上的篇目保持原来的正文和拼音，不重新转换。
简体按《简化字总表》的通行归并，不用 OpenCC 的整篇结果当定本。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import opencc

from build_poetry import (
    CACHE,
    CHECKS,
    PHRASES,
    SEL,
    T2S,
    apply_phrases,
    base_py,
    check,
    han_only,
    line_readings,
    load_dir,
    piece_from_paragraphs,
    source_note,
    tokens_for,
)
from hanzi import is_han

TANG_INDEX = Path("/tmp/canon/tang300.wikitext")
CI_INDEX = Path("/tmp/canon/ci300.wikitext")
BODIES = ROOT / "sources" / "poetry" / "bodies.json"
FROZEN = ROOT / "sources" / "poetry" / "frozen.json"

QIAN_NEXT = set("坤谿隆")


def zhonghua_simp(trad: str) -> str:
    """一字对一字。乾、流徵、樊於期、神祇按中华书局简体惯例留原字。"""
    raw = "".join(T2S.convert(ch) for ch in trad)
    if len(raw) != len(trad):
        raise SystemExit("简繁长度不同：%s / %s" % (trad, raw))
    out = []
    for i, (src, dst) in enumerate(zip(trad, raw)):
        prev = trad[i - 1] if i else ""
        nxt = trad[i + 1] if i + 1 < len(trad) else ""
        window = trad[max(0, i - 2) : i + 3]
        if src == "乾":
            dst = "乾" if nxt in QIAN_NEXT or trad[i : i + 2] == "乾隆" else "干"
        elif src == "徵":
            dst = "徵" if prev == "流" else "征"
        elif src == "於":
            dst = "於" if ("樊於期" in window or "於期" in window) else "于"
        elif src == "祇":
            dst = "祇" if prev == "神" else "只"
        elif src in ("禕", "褘"):
            dst = "祎"
        elif src == "餘":
            dst = "余"
        elif src == "雲":
            dst = "云"
        elif src == "後":
            dst = "后"
        elif src in ("裏", "裡"):
            dst = "里"
        elif src == "隻":
            dst = "只"
        elif src == "幹":
            dst = "干"
        elif src == "鑪":
            # OpenCC 收成扩展区的𬬻。中华书局简体通行作炉。
            dst = "炉"
        elif src == "輮":
            # OpenCC 收成扩展区的𫐓。课文保留「輮」。
            dst = "輮"
        out.append(dst)
    return "".join(out)


def norm_title(title: str) -> str:
    title = re.sub(r"[（(].*?[）)]", "", title)
    title = title.replace("並序", "").replace("并序", "")
    title = title.replace(" ", "").replace("·", "")
    return title.strip()


def fold(text: str) -> str:
    """只用于检索。简体折叠，不写进正文。"""
    return T2S.convert(han_only(text))


# 全唐诗题名和三百首题名不一样、首句又能对上的。
TITLE_ALIASES = {
    "琵琶行": ("琵琶引",),
    "下江陵": ("早發白帝城", "早发白帝城"),
    "與高適薛據登慈恩寺浮圖": ("與高適薛據慈恩寺浮圖",),
    "夜歸鹿門歌": ("夜歸鹿門山歌", "夜歸鹿門"),
    "漢江臨眺": ("漢江臨泛",),
    "送杜少府之任蜀州": ("杜少府之任蜀州",),
    "利洲南渡": ("利州南渡",),
    "秋夜寄丘員外": ("秋夜寄邱員外", "秋夜寄丘二十二員外"),
    "尋陸鴻漸不遇": ("尋陸鴻漸不遇",),
    "金縷衣": ("金縷衣",),
}


def parse_tang_index(text: str) -> list[dict]:
    section = ""
    rows = []
    for line in text.splitlines():
        sec = re.match(r"^==\s*(.+?)\s*==\s*$", line)
        if sec:
            section = sec.group(1).strip()
            continue
        item = re.match(r"^#\s+(\S+)\s+\[\[(.+?)\]\](.*)$", line)
        if not item:
            continue
        author, link, tail = item.group(1), item.group(2), item.group(3)
        hint = ""
        if "|" in link:
            target, display = link.split("|", 1)
        else:
            target, display = link, link
        paren = re.search(r"[（(]([^）)]+)[）)]", target)
        if paren:
            hint = paren.group(1)
            target = re.sub(r"\s*[（(][^）)]+[）)]", "", target).strip()
        sub = ""
        sub_m = re.search(r"<sub>(.+?)</sub>", tail)
        if sub_m:
            sub = re.sub(r"<[^>]+>", "", sub_m.group(1))
        display = re.sub(r"\s*[（(][^）)]+[）)]", "", display).strip()
        title = display or target
        if sub:
            title = "%s·%s" % (title, sub)
        rows.append({
            "author": author,
            "title": title,
            "match_title": target,
            "hint": hint,
            "form": section,
            "order": len(rows) + 1,
        })
    return rows


def parse_ci_index(text: str) -> list[dict]:
    parts = re.split(r"\n==", text)
    rows = []
    for part in parts[1:]:
        head, _, rest = part.partition("\n")
        head = head.strip().strip("=").strip()
        author = ""
        auth = re.search(r"\[\[Author:[^|\]]+\|([^\]]+)\]\]", head)
        if auth:
            author = auth.group(1)
        else:
            bare = re.search(r"\[\[([^\]]+)\]\]", head)
            if bare and "（" not in bare.group(1):
                pass
            name = re.search(r"[（(]([^）)]+)[）)]\s*$", re.sub(r"\[\[[^\]]+\]\]", "", head))
            if name:
                author = name.group(1)
        title = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", head)
        title = re.sub(r"[（(][^）)]+[）)]", "", title)
        title = title.replace("'''", "").strip("· ")
        if "{{:青玉案 (辛棄疾)}}" in rest:
            rest = (
                "<poem>\n"
                "東風夜放花千樹，更吹落、星如雨。\n"
                "寶馬雕車香滿路，鳳簫聲動，玉壺光轉，一夜魚龍舞。\n"
                "蛾兒雪柳黃金縷，笑語盈盈暗香去。\n"
                "眾裡尋他千百度；驀然回首，那人卻在，燈火闌珊處。\n"
                "</poem>"
            )
            author = author or "辛棄疾"
            title = "青玉案·元夕"
        poem_m = re.search(r"<poem>(.*?)</poem>", rest, re.S)
        if not poem_m:
            raise SystemExit("没有正文：%s" % head[:40])
        preface = rest[: poem_m.start()]
        preface = re.sub(r"<[^>]+>", "", preface)
        preface = re.sub(r"\s+", "", preface).strip("（）()")
        body = poem_m.group(1).replace("\u3000", "").replace("\xa0", "")
        lines = []
        for raw in body.splitlines():
            raw = raw.strip()
            if raw:
                lines.append(raw)
        if not author and "辛棄疾" in head:
            author = "辛棄疾"
        rows.append({
            "author": author,
            "title": title,
            "preface": preface,
            "lines": lines,
            "order": len(rows) + 1,
        })
    return rows


def load_tang_corpus() -> list[dict]:
    return load_dir(CACHE / "tang", "tang-*.json")


AUTHOR_ALIAS = {
    "杜秋娘": "不詳",
    "僧皎然": "皎然",
    "唐玄宗": "明皇帝",
}

# 三百首题名对不上全唐诗题名时，指定全唐诗里的那一首。作者仍按三百首显示。
MANUAL_TANG = {
    2: ("王昌齡", "同從弟銷南齋玩月憶山陰崔少府"),
    19: ("孟浩然", "宿業師山房期丁大不至"),
    39: ("岑參", "走馬川行奉送出師西征"),
    50: ("李頎", "聽董大彈胡笳聲兼寄語弄房給事"),
    53: ("杜甫", "丹青引贈曹將軍霸"),
    54: ("杜甫", "寄韓諫議"),
    56: ("杜甫", "觀公孫大娘弟子舞劒器行"),
    68: ("王昌齡", "相和歌辭 長信怨 二"),
    70: ("王涯", "秋夜曲"),
    97: ("不詳", "雜曲歌辭 金縷衣"),
    99: ("孟郊", "列女操"),
    102: ("崔顥", "長干曲四首 一"),
    103: ("崔顥", "長干曲四首 二"),
    142: ("杜甫", "天末憶李白"),
    148: ("杜審言", "和晉陵陸丞早春遊望"),
    149: ("沈佺期", "雜詩三首 三"),
    151: ("孟浩然", "留別王侍御維"),
    152: ("孟浩然", "早寒江上有懷"),
    156: ("孟浩然", "望洞庭湖贈張丞相"),
    158: ("孟浩然", "清明日宴梅道士房"),
    162: ("明皇帝", "經鄒魯祭孔子而歎之"),
    164: ("馬戴", "楚江懷古三首 一"),
    165: ("崔塗", "巴山道中除夜書懷"),
    166: ("崔塗", "孤鴈 二"),
    172: ("許渾", "早秋三首 一"),
    174: ("皎然", "尋陸鴻漸不遇"),
    175: ("劉長卿", "尋南溪常山道人隱居"),
    178: ("劉長卿", "送李中丞之襄州"),
    182: ("盧綸", "李端公"),
    185: ("駱賓王", "在嶽詠蟬"),
    186: ("戴叔倫", "客夜與故人偶集"),
    187: ("韓翃", "酬程延秋夜即事見贈"),
    190: ("元稹", "遣悲懷三首 三"),
    192: ("王維", "酬郭給事"),
    213: ("杜甫", "詠懷古跡五首 五"),
    235: ("劉長卿", "自夏口至鸚鵡洲夕望岳陽寄源中丞"),
    243: ("王建", "新嫁娘詞三首 三"),
    253: ("李商隱", "樂遊原"),
    261: ("韋應物", "秋夜寄丘二十二員外"),
    263: ("張祜", "宮詞二首 一"),
    265: ("裴迪", "崔九欲往南山馬上口號與別"),
    266: ("劉長卿", "送靈澈上人"),
    268: ("劉長卿", "送方外上人"),
    269: ("權德輿", "玉臺體十二首 十一"),
    275: ("白居易", "後宮詞"),
    276: ("朱慶餘", "宮詞"),
    277: ("朱慶餘", "近試上張籍水部"),
    285: ("李商隱", "常娥"),
    294: ("杜牧", "遣懷"),
    299: ("柳中庸", "征怨"),
    303: ("張泌", "寄人 一"),
    307: ("張祜", "集靈臺二首 二"),
    309: ("陳陶", "隴西行四首 二"),
    313: ("劉方平", "夜月"),
    316: ("劉禹錫", "和樂天春詞"),
    20: ("丘爲", "尋西山隱者不遇"),
    38: ("白居易", "琵琶引"),
    140: ("杜甫", "至德二載甫自京金光門出問道歸鳳翔乾元初從左拾遺移華州掾與親故別因出此門有悲往事"),
    281: ("李益", "夜上受降城聞笛"),
    319: ("韓偓", "已涼"),
}

# 同题不止一首时，用首句分开。
MANUAL_START = {
    147: "早被嬋娟",
    266: "蒼蒼竹林",
    275: "淚濕羅巾",
    281: "回樂峰前",
    294: "落魄江南",
    319: "碧闌干外",
}


def author_poems(poems: list[dict], author: str) -> list[dict]:
    names = {fold(author)}
    if author in AUTHOR_ALIAS:
        names.add(fold(AUTHOR_ALIAS[author]))
    return [poem for poem in poems if fold(poem.get("author") or "") in names]


def poem_index(title: str) -> str:
    nums = re.findall(r"[一二三四五六七八九十]+", norm_title(title))
    return nums[-1] if nums else ""


def title_bases(want: str) -> tuple[str, str]:
    """去掉「之一」和序，返回 (检索题, 第几首)。"""
    base = norm_title(want)
    num = ""
    matched = re.search(r"之([一二三四五六七八九十]+)$", base)
    if matched:
        num = matched.group(1)
        base = base[: matched.start()]
    return base, num


def title_score(poem_title: str, want: str) -> int:
    title = norm_title(poem_title)
    folded = fold(title)
    base, num = title_bases(want)
    want_f = fold(base)
    if not want_f or not folded:
        return 0
    if num and poem_index(title) != num:
        return 0
    if folded == want_f:
        return 5
    shorter, longer = (folded, want_f) if len(folded) <= len(want_f) else (want_f, folded)
    if longer.startswith(shorter) and len(shorter) >= 2:
        return 4
    if want_f in folded and len(want_f) >= 2:
        return 3
    for alias in TITLE_ALIASES.get(base, ()) + TITLE_ALIASES.get(want, ()):
        alias_f = fold(norm_title(alias))
        if not alias_f:
            continue
        if folded == alias_f or folded.startswith(alias_f):
            return 4
        if alias_f in folded and len(alias_f) >= 3:
            return 3
    return 0


def prefer_plain_title(candidates: list[dict]) -> list[dict]:
    plain = [poem for poem in candidates if not (poem.get("title") or "").startswith(("雜曲", "橫吹", "相和", "清商", "琴曲"))]
    return plain or candidates


def find_exact(poems: list[dict], author: str, title: str) -> dict | None:
    hits = [poem for poem in poems if poem.get("author") == author and poem.get("title") == title]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        plain = prefer_plain_title(hits)
        return plain[0]
    return None


def match_tang_poem(poems: list[dict], row: dict) -> dict | None:
    manual = MANUAL_TANG.get(row["order"])
    if manual:
        found = find_exact(poems, manual[0], manual[1])
        start = MANUAL_START.get(row["order"], "")
        if found is not None and start:
            hits = [
                poem for poem in poems
                if poem.get("author") == manual[0] and poem.get("title") == manual[1]
                and fold((poem.get("paragraphs") or [""])[0]).startswith(fold(start))
            ]
            if len(hits) == 1:
                return hits[0]
            if hits:
                return prefer_plain_title(hits)[0]
        if found is not None:
            return found
    author = row["author"]
    want = norm_title(row["match_title"])
    hint = row["hint"]
    # 括号里常常是作者，用来消歧，不是首句。
    if hint and (hint == author or fold(hint) == fold(author) or len(han_only(hint)) <= 3):
        hint = ""
    hint_f = fold(hint)
    pool = author_poems(poems, author)
    if hint_f and len(hint_f) >= 4:
        by_hint = []
        for poem in pool:
            paras = poem.get("paragraphs") or []
            blob = fold("".join(paras[:2]))
            if blob.startswith(hint_f) or hint_f in blob[: len(hint_f) + 8]:
                by_hint.append(poem)
        by_hint = prefer_plain_title(by_hint)
        if len(by_hint) == 1:
            return by_hint[0]
        if len(by_hint) > 1:
            def sort_key(poem: dict) -> tuple:
                score = title_score(poem.get("title") or "", want)
                extra = abs(len(fold(poem.get("title") or "")) - len(fold(want)))
                return (score, -extra)
            ranked = sorted(by_hint, key=sort_key, reverse=True)
            if sort_key(ranked[0]) > sort_key(ranked[1]):
                return ranked[0]
    ranked = [(title_score(poem.get("title") or "", want), poem) for poem in pool]
    ranked = [item for item in ranked if item[0] > 0]
    if not ranked:
        return None
    ranked.sort(key=lambda item: -item[0])
    best = ranked[0][0]
    chosen = prefer_plain_title([poem for score, poem in ranked if score == best])
    if len(chosen) == 1:
        return chosen[0]
    texts = {fold("".join(poem.get("paragraphs") or [])) for poem in chosen}
    if len(texts) == 1:
        return chosen[0]
    return None


def paragraphs_of(piece: dict) -> list[str]:
    lines = []
    for line in piece["lines"]:
        lines.append("".join(tok["t"] for tok in line["tokens"]))
    return lines


def clean_para(text: str) -> str:
    """全唐诗用方括号标补字。读本收下括号里的字。"""
    return re.sub(r"\[([^\[\]]*)\]", r"\1", text)


def piece_new(spec: dict, author_t: str, paragraphs: list[str], used: dict[str, int]) -> dict:
    simp_paras = []
    trad_paras = []
    for para in paragraphs:
        para = clean_para(para)
        trad = para
        simp = zhonghua_simp(trad)
        if len(trad) != len(simp):
            raise SystemExit("%s 简繁长度不一致" % spec["id"])
        trad_paras.append(trad)
        simp_paras.append(simp)
    # 拼音按繁体。简体用中华书局惯例，不用 piece_from_paragraphs 里的 OpenCC。
    lines = []
    for trad, simp in zip(trad_paras, simp_paras):
        pys = line_readings(trad, used)
        if len(pys) != len(trad):
            raise SystemExit("%s 拼音数量不对" % spec["id"])
        lines.append({"tokens": tokens_for(trad, simp, pys)})
    return {
        "id": spec["id"],
        "title": {"t": spec["display"], "s": T2S.convert(spec["display"])},
        "author": {"t": author_t, "s": T2S.convert(author_t)},
        "lines": lines,
    }


def bind_old(old_pieces: list[dict], sel_rows: list[dict], kind: str) -> dict[str, str]:
    """旧篇 id → 在新目录里对上的键。"""
    bound = {}
    for piece in old_pieces:
        han = han_only("".join(paragraphs_of(piece)))
        author = piece["author"]["t"]
        title = norm_title(piece["title"]["t"])
        hit = None
        for row in sel_rows:
            if kind == "tang" and row["author"] != author:
                continue
            if kind == "ci" and T2S.convert(row["author"]) != piece["author"]["s"] and row["author"] != author:
                continue
            row_title = norm_title(row["title"].split("·")[0])
            if kind == "tang":
                if row_title and (row_title in title or title in row_title or norm_title(row["match_title"]) in title):
                    hit = row
                    break
            else:
                blob = han_only("".join(row["lines"]))
                # 旧篇是简体转出的繁体，和维基文库可能有异体。用前 12 个简体字。
                old_s = han_only("".join(
                    "".join(tok.get("s") or "" for tok in line["tokens"]) for line in piece["lines"]
                ))
                new_s = han_only(zhonghua_simp("".join(row["lines"])))
                if old_s[:12] and old_s[:12] in new_s:
                    hit = row
                    break
                if title and norm_title(row["title"]) == title and author == row["author"]:
                    hit = row
                    break
        if hit is not None:
            key = "%s|%s|%s" % (hit["author"], hit["title"], hit["order"])
            if key not in bound.values():
                bound[piece["id"]] = key
    return bound


def align_checks(pieces: list[dict]) -> None:
    """已收录篇若和核定读音差一个音，改成核定读音，不动别的字。"""
    by_id = {piece["id"]: piece for piece in pieces}
    for pid, snippet, reading in CHECKS:
        piece = by_id.get(pid)
        if piece is None:
            continue
        slots = []
        for line in piece["lines"]:
            for tok in line["tokens"]:
                if tok.get("punct"):
                    continue
                parts = (tok.get("py") or "").split()
                text = tok["t"]
                if len(parts) != len(text):
                    parts = [""] * len(text)
                for index, ch in enumerate(text):
                    slots.append((tok, index, parts, ch))
        han = "".join(item[3] for item in slots)
        at = han.find(snippet)
        if at < 0:
            continue
        expect = reading.split()
        for offset, py in enumerate(expect):
            tok, index, parts, _ch = slots[at + offset]
            parts[index] = py
            tok["py"] = " ".join(parts)


def main() -> None:
    if not TANG_INDEX.is_file() or not CI_INDEX.is_file():
        raise SystemExit("缺少 /tmp/canon 目录索引")
    tang_rows = parse_tang_index(TANG_INDEX.read_text(encoding="utf-8"))
    ci_rows = parse_ci_index(CI_INDEX.read_text(encoding="utf-8"))
    print("index tang", len(tang_rows), "ci", len(ci_rows))
    poems = load_tang_corpus()
    old_sel = json.loads(SEL.read_text(encoding="utf-8"))
    old_tang = json.loads((ROOT / "data" / "tang.json").read_text(encoding="utf-8"))
    old_ci = json.loads((ROOT / "data" / "songci.json").read_text(encoding="utf-8"))
    tang_bind = bind_old(old_tang["pieces"], tang_rows, "tang")
    ci_bind = {}
    for spec in old_sel["ci"]:
        needle = fold(spec.get("contains") or "")
        if len(needle) < 2:
            continue
        for row in ci_rows:
            blob = fold("".join(row["lines"]))
            if needle in blob:
                ci_bind[spec["id"]] = "%s|%s|%s" % (row["author"], row["title"], row["order"])
                break
    print("bound tang", len(tang_bind), "ci", len(ci_bind))
    missing_old_t = [p["id"] for p in old_tang["pieces"] if p["id"] not in tang_bind]
    missing_old_c = [p["id"] for p in old_ci["pieces"] if p["id"] not in ci_bind]
    print("unbound old tang", missing_old_t)
    print("unbound old ci", missing_old_c)

    cache_path = Path("/tmp/canon/tang-hits.json")
    tang_hits = []
    tang_miss = []
    cached_ids = []
    if cache_path.is_file() and "--rematch" not in sys.argv:
        cached_ids = json.loads(cache_path.read_text(encoding="utf-8"))
    by_poem_id = {poem.get("id"): poem for poem in poems if poem.get("id")}
    if len(cached_ids) == len(tang_rows) and all(pid in by_poem_id for pid in cached_ids):
        tang_hits = [(row, by_poem_id[pid]) for row, pid in zip(tang_rows, cached_ids)]
        print("using tang match cache")
    else:
        for row in tang_rows:
            poem = match_tang_poem(poems, row)
            if poem is None:
                tang_miss.append(row)
            else:
                tang_hits.append((row, poem))
        if not tang_miss:
            cache_path.write_text(
                json.dumps([poem.get("id") for _row, poem in tang_hits]),
                encoding="utf-8",
            )
    for row, poem in tang_hits:
        target = fold("".join(poem.get("paragraphs") or []))
        key = "%s|%s|%s" % (row["author"], row["title"], row["order"])
        if key in tang_bind.values():
            continue
        for piece in old_tang["pieces"]:
            if piece["id"] in tang_bind:
                continue
            blob = fold("".join(paragraphs_of(piece)))
            if blob[:12] and blob[:12] in target:
                tang_bind[piece["id"]] = key
                break
    print("tang matched", len(tang_hits), "miss", len(tang_miss))
    for row in tang_miss:
        print("  MISS", row["order"], row["author"], row["title"], row["hint"])

    # 先把匹配结果写出来，正文生成在确认之后由 --write 做。
    if "--write" not in sys.argv:
        return

    used: dict[str, int] = {}
    frozen_tang = {p["id"]: p for p in old_tang["pieces"]}
    frozen_ci = {p["id"]: p for p in old_ci["pieces"]}
    # 让已有篇的短语仍算用过。
    for piece in list(frozen_tang.values()) + list(frozen_ci.values()):
        for para in paragraphs_of(piece):
            line_readings(para, used)

    key_to_old_t = {v: k for k, v in tang_bind.items()}
    key_to_old_c = {v: k for k, v in ci_bind.items()}
    tang_pieces = []
    tang_sel = []
    bodies = {}
    for row, poem in tang_hits:
        key = "%s|%s|%s" % (row["author"], row["title"], row["order"])
        if key in key_to_old_t:
            pid = key_to_old_t[key]
            piece = frozen_tang[pid]
        else:
            pid = "t%03d" % row["order"]
            spec = {"id": pid, "display": row["title"]}
            piece = piece_new(spec, row["author"], poem["paragraphs"], used)
            bodies[pid] = {"trad": poem["paragraphs"], "form": row["form"]}
        tang_pieces.append(piece)
        tang_sel.append({
            "id": piece["id"],
            "author": row["author"],
            "title": row["match_title"],
            "display": piece["title"]["t"],
            "form": row["form"],
            "order": row["order"],
        })
        if row["hint"]:
            tang_sel[-1]["hint"] = row["hint"]

    # 未进入三百首、但原来就在站上的，仍留在目录末尾，避免旧链接失效。
    used_ids = {p["id"] for p in tang_pieces}
    for piece in old_tang["pieces"]:
        if piece["id"] not in used_ids:
            tang_pieces.append(piece)
            tang_sel.append({
                "id": piece["id"],
                "author": piece["author"]["t"],
                "title": piece["title"]["t"],
                "display": piece["title"]["t"],
                "form": "本站原已收录，不在这一版三百首目录里",
                "order": 1000 + len(tang_sel),
            })

    ci_pieces = []
    ci_sel = []
    for row in ci_rows:
        key = "%s|%s|%s" % (row["author"], row["title"], row["order"])
        if key in key_to_old_c:
            pid = key_to_old_c[key]
            piece = frozen_ci[pid]
        else:
            pid = "c%03d" % row["order"]
            spec = {"id": pid, "display": row["title"]}
            piece = piece_new(spec, row["author"], row["lines"], used)
            bodies[pid] = {"trad": row["lines"], "preface": row["preface"], "form": "词"}
        ci_pieces.append(piece)
        ci_sel.append({
            "id": piece["id"],
            "author": row["author"],
            "tune": row["title"],
            "display": piece["title"]["t"],
            "order": row["order"],
        })
        if row["preface"]:
            ci_sel[-1]["preface"] = row["preface"]
    used_c = {p["id"] for p in ci_pieces}
    for piece in old_ci["pieces"]:
        if piece["id"] not in used_c:
            ci_pieces.append(piece)
            ci_sel.append({
                "id": piece["id"],
                "author": piece["author"]["t"],
                "tune": piece["title"]["t"],
                "display": piece["title"]["t"],
                "order": 1000 + len(ci_sel),
            })

    align_checks(tang_pieces + ci_pieces)
    check(tang_pieces + ci_pieces)
    unused = [phrase for phrase, _reading in PHRASES if phrase not in used]
    if unused:
        raise SystemExit("这些读音短语没有用上：%s" % "、".join(unused))

    note = source_note(old_sel)
    note += "《唐诗三百首》目录用蘅塘退士本（维基文库）。已收录的篇保持全唐诗用字，例如《静夜思》作「看月光」「山月」。新收的诗简体按《简化字总表》通行归并，不是 OpenCC 整篇转换。宋词目录用朱孝臧重编《宋词三百首》（维基文库，283 首），即唐圭璋《宋词三百首笺注》所笺的这一系统。"
    tang = {"id": "tang", "title": {"t": "唐詩三百首", "s": "唐诗三百首"}, "source": note, "pieces": tang_pieces}
    ci = {"id": "ci", "title": {"t": "宋詞三百首", "s": "宋词三百首"}, "source": note, "pieces": ci_pieces}
    (ROOT / "data" / "tang.json").write_text(json.dumps(tang, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (ROOT / "data" / "songci.json").write_text(json.dumps(ci, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    old_sel["note"] = "唐诗对照蘅塘退士《唐诗三百首》；已收录篇保持原来的全唐诗用字。宋词对照朱孝臧重编《宋词三百首》。display 是站点上的篇名。"
    old_sel["tang"] = tang_sel
    old_sel["ci"] = ci_sel
    SEL.write_text(json.dumps(old_sel, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    BODIES.write_text(json.dumps(bodies, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote tang", len(tang_pieces), "ci", len(ci_pieces), "bodies", len(bodies))


if __name__ == "__main__":
    main()
