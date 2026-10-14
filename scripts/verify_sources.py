# -*- coding: utf-8 -*-
"""核对五部书的正文，并标出读音、注释里未能核定的条目。

正文对照仓库里的底本缓存，不是现场去抓网页：

- 古文观止：sources/wikisource/vol01–12.wikitext（维基文库）
- 资治通鉴卷一至卷八：sources/zztj/juan01–08.wikitext（维基文库）
- 人间词话六十四则：sources/renjian/guocui-juan-shang.wikitext（维基文库）
- 唐诗、宋词：sources/poetry/canonical.json
  （chinese-poetry 指定 commit 的选篇缓存）

维基文库是繁体公有领域正文，不是简体定本。简体由规定的转换得到。
中华书局简体注本没有收进仓库，不做逐字对照，也不把没看到的注当成已经改对。
手头若有钟基、李先银、王身钢译注《古文观止》（中华书局，简体横排，
ISBN 978-7-101-07898-5；同人译注的藏书升级版 ISBN 978-7-101-11362-4），
课注和译文以这一本为准。安平秋点校的繁体竖排本，以及《资治通鉴》点校本，
同样没有收进仓库。

读音对照 legacy/dict/out_file/ancient_chinese.json（汉典文言字头）。
这份缓存常常只留下一个音，不能拿来改页面上的今读。
和《说文》对不上的字只写入待复核。课注里对不上的读音也只记录，不改课注。

用法：
    python3 scripts/verify_sources.py           # 检查，正文不一致则失败
    python3 scripts/verify_sources.py --write   # 重写出处、读音政策和报告
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_renjian import CORRECTIONS, WIKI as RENJIAN_WIKI, parse_entries, split_sentences  # noqa: E402
from build_zztj import load_years  # noqa: E402
from hanzi import only_han  # noqa: E402
from parse_wikisource import parse_volume  # noqa: E402

HAN_PATH = ROOT / "legacy" / "dict" / "out_file" / "ancient_chinese.json"
SHUOWEN_PATH = ROOT / "data" / "dict.json"
ARTICLES = ROOT / "data" / "articles"
PROVENANCE_PATH = ROOT / "data" / "provenance.json"
POLICY_PATH = ROOT / "data" / "reading-policy.json"
CANONICAL_PATH = ROOT / "sources" / "poetry" / "canonical.json"
REPORT_PATH = ROOT / "sources" / "verification" / "REPORT.md"
FLAGS_PATH = ROOT / "sources" / "verification" / "flags.json"
SELECTION_PATH = ROOT / "sources" / "poetry" / "selection.json"
POETRY_CACHE = Path("/tmp/poetry")

GWGZ_URL = "https://zh.wikisource.org/wiki/古文觀止/卷{vol}"
ZZTJ_URL = "https://zh.wikisource.org/wiki/資治通鑑/卷{juan:03d}"
RENJIAN_URL = "https://zh.wikisource.org/wiki/人間詞話"
HASHED = re.compile(r"\.[0-9a-f]{12}\.json$")


TONE_FROM = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü"
TONE_TO = "aaaaeeeeiiiioooouuuuvvvvv"
PY_CHARS = set("abcdefghijklmnopqrstuvwxyz" + TONE_FROM)


def norm_py(text: str) -> str:
    text = (text or "").replace("\u0261", "g").replace("\u014b", "ng").replace("u:", "ü")
    text = text.strip().lower()
    return "".join(ch for ch in text if ch in PY_CHARS)


def base_py(text: str) -> str:
    return norm_py(text).translate(str.maketrans(TONE_FROM, TONE_TO))


def py_matches(py: str, readings: list[str]) -> bool:
    """声调齐全时要一致。任一侧没有声调，只比声韵。"""
    got = norm_py(py)
    if not got:
        return False
    if got in readings:
        return True
    got_base = base_py(got)
    got_toneless = got == got_base
    for item in readings:
        item_base = base_py(item)
        if item_base != got_base:
            continue
        if got_toneless or norm_py(item) == item_base:
            return True
    return False


def load_handian() -> dict[str, dict]:
    rows = json.loads(HAN_PATH.read_text(encoding="utf-8"))
    out = {}
    for item in rows:
        readings = []
        for key in item.get("explain") or {}:
            py = norm_py(key)
            if py and py not in readings:
                readings.append(py)
        blob = re.sub(r"<[^>]+>", "", json.dumps(item.get("explain") or {}, ensure_ascii=False))
        out[item["word"]] = {"readings": readings, "url": item.get("url") or "", "text": blob}
    return out


def load_shuowen() -> dict[str, str]:
    chars = json.loads(SHUOWEN_PATH.read_text(encoding="utf-8"))["chars"]
    return {ch: norm_py(info.get("py") or "") for ch, info in chars.items()}


def to_simplified(text: str) -> str:
    from opencc import OpenCC

    cc = getattr(to_simplified, "_cc", None)
    if cc is None:
        cc = OpenCC("t2s")
        to_simplified._cc = cc
    out = []
    for ch in text:
        simp = cc.convert(ch)
        if len(simp) != 1:
            simp = ch
        out.append(simp)
    return "".join(out)


def published_han(article: dict) -> str:
    parts = []
    for para in article["paragraphs"]:
        for sent in para["sentences"]:
            for tok in sent["tokens"]:
                parts.append(tok.get("t") or "")
    return only_han("".join(parts))


def article_files() -> list[Path]:
    return [path for path in sorted(ARTICLES.glob("*.json")) if not HASHED.search(path.name)]


def load_article(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def first_diff(expect: str, got: str) -> str:
    n = min(len(expect), len(got))
    i = 0
    while i < n and expect[i] == got[i]:
        i += 1
    return "第 %d 字：底本「%s」正文「%s」" % (i, expect[max(0, i - 4) : i + 12], got[max(0, i - 4) : i + 12])


def check_gwgz() -> tuple[list[dict], list[dict]]:
    pieces = []
    unexpected = []
    for vol in range(1, 13):
        text = (ROOT / "sources" / "wikisource" / f"vol{vol:02d}.wikitext").read_text(encoding="utf-8")
        for item in parse_volume(vol, text):
            art = load_article(ARTICLES / f"{item['id']}.json")
            expect = only_han("".join(item["paragraphs"]))
            got = published_han(art)
            note = "正文汉字与这一底本一致。白话、注释和赏析是本书编写的。"
            if item["id"] == "v06-15":
                note = "卷页作費褘。正文改从维基文库《前出師表》的費禕。夹注删掉后留下的「三分、。」已去掉句号。白话、注释和赏析是本书编写的。"
            elif item["id"] == "v04-01":
                note = "夹注删掉后留下的「高飛、。」已去掉句号。白话、注释和赏析是本书编写的。"
            elif item["id"] in {"v02-14", "v05-06", "v04-17"}:
                note = "简体不把乾（qián）收成干，也不把乐律流徵收成流征。白话、注释和赏析是本书编写的。"
            elif item["id"] == "v03-06":
                note = "卷页「禁罝䍡」夹注「作罜、音主」。罝是兔网，这里是小网。正文改从维基文库《里革斷罟匡君》的罜。前面「禁罝罗」仍是兔网，不改。白话、注释和赏析是本书编写的。"
            pieces.append({
                "id": item["id"],
                "collection": "古文观止",
                "edition": "维基文库《古文观止》卷%d" % vol,
                "url": GWGZ_URL.format(vol=vol),
                "note": note,
                "chars": len(got),
            })
            if expect != got:
                unexpected.append({"id": item["id"], "title": item["title"], "detail": first_diff(expect, got)})
    return pieces, unexpected


def check_traps() -> list[dict]:
    """OpenCC 和夹注删削造成的错字、错标点。出现就失败。"""
    problems = []
    for path in article_files():
        art = load_article(path)
        trad = []
        simp = []
        for para in art["paragraphs"]:
            for sent in para["sentences"]:
                for tok in sent["tokens"]:
                    trad.append(tok.get("t") or "")
                    simp.append(tok.get("s") or tok.get("t") or "")
                trad.append("\n")
                simp.append("\n")
        trad_text = "".join(trad)
        simp_text = "".join(simp)
        blob = trad_text + simp_text
        if "、。" in blob:
            problems.append({"id": art["id"], "detail": "正文还有「、。」"})
        if "褘" in trad_text or "袆" in simp_text:
            problems.append({"id": art["id"], "detail": "费祎仍作褘/袆"})
        if "乾坤" in trad_text and "干坤" in simp_text:
            problems.append({"id": art["id"], "detail": "乾坤被简成干坤"})
        if "乾谿" in trad_text and "干谿" in simp_text:
            problems.append({"id": art["id"], "detail": "乾谿被简成干谿"})
        if "流徵" in trad_text and "流征" in simp_text:
            problems.append({"id": art["id"], "detail": "流徵被简成流征"})
        if "罝䍡" in trad_text:
            problems.append({"id": art["id"], "detail": "小网仍作罝䍡，应作罜"})
    return problems


def translation_ref(collection: str) -> dict:
    """译文该对哪一本。书不在仓库里的，不写成已经对过。"""
    if collection == "古文观止":
        return {
            "edition": "中华书局钟基、李先银、王身钢译注《古文观止》（简体横排，ISBN 978-7-101-07898-5）",
            "status": "未取得该书，本站译文未按该本逐句核定",
        }
    if collection == "资治通鉴":
        return {
            "edition": "没有可核对的通行白话译本",
            "status": "中华书局点校本是正文校点，不是译文。本站译文未按某一译注本核定",
        }
    if collection == "人间词话":
        return {
            "edition": "未取得中华书局《人间词话》注译本",
            "status": "本站译文未按该本逐句核定",
        }
    if collection == "唐诗":
        return {
            "edition": "顾青编注《唐诗三百首》（中华书局中华经典藏书，ISBN 978-7-101-11354-9；底本为四藤吟社本）",
            "status": "未取得该书，未逐句抄录。本站白话是另写的。拿不准的标待复核",
        }
    if collection == "宋词":
        return {
            "edition": "唐圭璋《宋词三百首笺注》（1958年中华书局上海编辑所重版、上海古籍出版社重印，82家283首）",
            "status": "未逐句抄录笺注。正文用字另对《全宋词》，仓库里的数字文本不是该点校本。拿不准的标待复核",
        }
    return {"edition": "未指定译注本", "status": "译文未核定"}


def audit_simplified() -> tuple[list[dict], list[dict]]:
    """简体按《简化字总表》的通行归并核，不把 OpenCC 整篇结果当定本。

    中华书局简体古籍通常：雲后裏只余于征归并；乾（qián）、乐律徵、樊於期、神祇不归并。
    馀的正条是余，附注说可能混淆时可用馀。没有中华书局该书，馀不改成馀字。
    """
    from collections import Counter

    counts = Counter()
    problems = []
    for path in article_files():
        art = load_article(path)
        chars = []
        for para in art["paragraphs"]:
            for sent in para["sentences"]:
                for tok in sent["tokens"]:
                    if tok.get("punct"):
                        continue
                    trad = tok.get("t") or ""
                    simp = tok.get("s") or ""
                    if len(trad) != len(simp):
                        if any(ch in trad + simp for ch in "乾於徵禕褘雲後裏裡餘馀祇只"):
                            problems.append({"id": art["id"], "detail": "繁简长度不同：%s / %s" % (trad, simp)})
                        continue
                    chars.extend(zip(trad, simp))
        for i, (src, dst) in enumerate(chars):
            prev = chars[i - 1][0] if i else ""
            window = "".join(ch for ch, _ in chars[max(0, i - 1) : i + 2])
            if src == "雲" and dst != "云":
                problems.append({"id": art["id"], "detail": "雲没有作云"})
            elif src == "後" and dst != "后":
                problems.append({"id": art["id"], "detail": "後没有作后"})
            elif src in ("裏", "裡") and dst != "里":
                problems.append({"id": art["id"], "detail": "裏没有作里"})
            elif src == "餘" and dst != "余":
                problems.append({"id": art["id"], "detail": "餘没有作余"})
            elif src == "隻" and dst != "只":
                problems.append({"id": art["id"], "detail": "隻没有作只"})
            elif src == "幹" and dst != "干":
                problems.append({"id": art["id"], "detail": "幹没有作干"})
            elif src == "禕" and dst != "祎":
                problems.append({"id": art["id"], "detail": "禕没有作祎"})
            elif src == "褘" or dst == "袆":
                problems.append({"id": art["id"], "detail": "仍有褘/袆"})
            elif src == "於" and dst == "於" and "樊於期" not in window and "於期" not in window:
                problems.append({"id": art["id"], "detail": "於没有作于"})
            elif src == "於" and dst not in ("于", "於"):
                problems.append({"id": art["id"], "detail": "於简成了%s" % dst})
            elif src == "徵" and dst == "徵" and prev != "流":
                problems.append({"id": art["id"], "detail": "徵没有作征"})
            elif src == "徵" and dst == "征" and prev == "流":
                problems.append({"id": art["id"], "detail": "流徵被简成流征"})
            elif src == "祇" and dst == "只" and prev == "神":
                problems.append({"id": art["id"], "detail": "神祇被简成神只"})
            elif src == "祇" and dst == "祇" and prev != "神":
                problems.append({"id": art["id"], "detail": "祇没有作只"})
            elif src == "乾" and dst not in ("乾", "干"):
                problems.append({"id": art["id"], "detail": "乾简成了%s" % dst})
            if src in ("於", "後", "餘", "雲", "裡", "裏", "徵", "乾", "禕", "隻", "幹", "祇") and src != dst:
                counts[(src, dst)] += 1
            elif src == "祇" and dst == "祇":
                counts[(src, dst)] += 1
            elif src == "徵" and dst == "徵":
                counts[(src, dst)] += 1
            elif src == "乾" and dst == "乾":
                counts[(src, dst)] += 1
            elif src == "於" and dst == "於":
                counts[(src, dst)] += 1
    notes = {
        ("於", "于"): "介词作于",
        ("於", "於"): "樊於期保留於",
        ("後", "后"): "归并",
        ("餘", "余"): "总表正条作余。附注说可能混淆时可用馀。没有中华书局该书，不改成馀",
        ("雲", "云"): "归并",
        ("裡", "里"): "归并",
        ("裏", "里"): "归并",
        ("徵", "征"): "征召、征兆、征逐。不是乐律",
        ("徵", "徵"): "流徵保留徵",
        ("乾", "干"): "干燥作干",
        ("乾", "乾"): "乾坤、乾谿等读 qián，保留乾",
        ("禕", "祎"): "费祎。不从 OpenCC 把褘收成袆",
        ("隻", "只"): "归并",
        ("幹", "干"): "归并",
        ("祇", "只"): "只辱。神祇不在此列",
        ("祇", "祇"): "神祇保留祇",
    }
    rows = []
    for key, num in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        rows.append({"trad": key[0], "simp": key[1], "count": num, "note": notes.get(key, "")})
    return rows, problems


def check_zztj() -> tuple[list[dict], list[dict], list[dict]]:
    pieces = []
    unexpected = []
    for entry in load_years():
        art = load_article(ARTICLES / f"{entry['id']}.json")
        expect = only_han("".join(sent for para in entry["paragraphs_t"] for sent in para))
        got = published_han(art)
        pieces.append({
            "id": entry["id"],
            "collection": "资治通鉴",
            "edition": "维基文库《资治通鉴》卷%d（周纪、秦纪）" % entry["juan"],
            "url": ZZTJ_URL.format(juan=entry["juan"]),
            "note": "正文按 sources/zztj/EDITION.md：不收增补和移入，人名樊於期的於不改成于。白话和注释是本书编写的。",
            "chars": len(got),
        })
        if expect != got:
            unexpected.append({"id": entry["id"], "title": entry["title_s"], "detail": first_diff(expect, got)})
    raw = "".join(
        (ROOT / "sources" / "zztj" / f"juan{juan:02d}.wikitext").read_text(encoding="utf-8")
        for juan in range(1, 9)
    )
    resolved = []
    if "樊於期" in raw:
        resolved.append({
            "id": "z06-28",
            "collection": "资治通鉴",
            "change": "樊於期",
            "resolution": "简体转换会把於收成于。正文改回樊於期，单独的於期也改回。",
        })
    if "取代光狼城" in raw:
        resolved.append({
            "id": "z04-18",
            "collection": "资治通鉴",
            "change": "取代光狼城 → 取代、光狼城",
            "resolution": "代和光狼城是两处。维基文库这一句没有顿号，阅读本补上。",
        })
    supplement = len(re.findall(r"增补|增補|移入|移往", raw))
    resolved.append({
        "id": "zztj",
        "collection": "资治通鉴",
        "change": "增补或移入标记 %d 处" % supplement,
        "resolution": "这些字句不收进正文。阅读本与这条规则下的解析结果一致。",
    })
    return pieces, unexpected, resolved


def check_renjian() -> tuple[list[dict], list[dict], list[dict]]:
    entries = parse_entries(RENJIAN_WIKI.read_text(encoding="utf-8"))
    raw = RENJIAN_WIKI.read_text(encoding="utf-8")
    pieces = []
    unexpected = []
    for entry in entries:
        aid = "h01-%02d" % entry["n"]
        art = load_article(ARTICLES / f"{aid}.json")
        expect = only_han("".join(split_sentences(entry["body_t"])))
        got = published_han(art)
        note = "正文用《国粹学报》已刊六十四则。白话和注释是本书编写的。"
        pieces.append({
            "id": aid,
            "collection": "人间词话",
            "edition": "维基文库《人间词话》卷上（国粹学报本）",
            "url": RENJIAN_URL,
            "note": note,
            "chars": len(got),
        })
        if expect != got:
            unexpected.append({"id": aid, "title": entry["title_t"], "detail": first_diff(expect, got)})
    resolved = []
    labels = {
        ("雞犬不已", "雞鳴不已"): "所引《诗经》是鸡鸣不已，不是鸡犬不已。",
        ("莫之興京", "莫之與京"): "萧统《陶渊明集序》作莫之与京。",
        ("玉固、草窗", "玉田、草窗"): "并列的南宋词家是玉田，不是玉固。",
    }
    for old, new in CORRECTIONS:
        if old in raw:
            resolved.append({
                "id": "renjian",
                "collection": "人间词话",
                "change": "%s → %s" % (old, new),
                "resolution": labels[(old, new)],
            })
    if "沈著" in raw or "沈雄" in raw:
        resolved.append({
            "id": "renjian",
            "collection": "人间词话",
            "change": "沈著、沈雄 → 沉着、沉雄",
            "resolution": "不是姓沈。姓沈的沈伯时不改。",
        })
    return pieces, unexpected, resolved


def poetry_han(piece: dict, field: str) -> str:
    parts = []
    for line in piece["lines"]:
        for tok in line["tokens"]:
            parts.append(tok.get(field) or "")
    return only_han("".join(parts))


def build_canonical() -> dict:
    """汉字以 sources/poetry/bodies.json 里的繁体为准。没有收进 bodies 的，沿用现成阅读本。"""
    from expand_poetry import zhonghua_simp

    sel = json.loads(SELECTION_PATH.read_text(encoding="utf-8"))
    bodies_path = ROOT / "sources" / "poetry" / "bodies.json"
    bodies = json.loads(bodies_path.read_text(encoding="utf-8")) if bodies_path.is_file() else {}
    books = {
        "tang": json.loads((ROOT / "data" / "tang.json").read_text(encoding="utf-8")),
        "ci": json.loads((ROOT / "data" / "songci.json").read_text(encoding="utf-8")),
    }
    pieces = {}
    for kind, label, field in (("tang", "唐诗", "t"), ("ci", "宋词", "s")):
        for piece in books[kind]["pieces"]:
            body = bodies.get(piece["id"])
            if body and body.get("trad"):
                if field == "t":
                    han = only_han("".join(body["trad"]))
                else:
                    han = only_han("".join(zhonghua_simp(line) for line in body["trad"]))
            else:
                han = poetry_han(piece, field)
            pieces[piece["id"]] = {
                "collection": label,
                "script": field,
                "author": piece["author"]["t"],
                "title": piece["title"]["t"],
                "han": han,
            }
    return {
        "repo": sel["repo"],
        "commit": sel["commit"],
        "license": sel["license"],
        "pieces": pieces,
    }


def check_poetry(canonical: dict) -> tuple[list[dict], list[dict]]:
    sel = json.loads(SELECTION_PATH.read_text(encoding="utf-8"))
    commit = canonical["commit"]
    base = "%s/tree/%s" % (canonical["repo"], commit)
    books = {"tang": json.loads((ROOT / "data" / "tang.json").read_text(encoding="utf-8")),
             "ci": json.loads((ROOT / "data" / "songci.json").read_text(encoding="utf-8"))}
    pieces = []
    unexpected = []
    for kind, label in (("tang", "唐诗"), ("ci", "宋词")):
        for piece in books[kind]["pieces"]:
            cached = canonical["pieces"].get(piece["id"])
            field = "s" if kind == "ci" else "t"
            got = poetry_han(piece, field)
            edition = "chinese-poetry %s（commit %s）" % (label, commit[:12])
            if kind == "ci":
                note = "目录是朱孝臧重编《宋词三百首》。正文用这一版的通行文字；和课文不同的，课文篇改从课文，异文另注。注释和赏析是本书编写的。"
            else:
                note = "目录是蘅塘退士《唐诗三百首》。正文用这一版和课文的通行文字，例如《静夜思》作床前明月光、举头望明月。全唐诗不同的字记为异文。注释和赏析是本书编写的。"
            pieces.append({
                "id": piece["id"],
                "collection": label,
                "edition": edition,
                "url": base,
                "note": note,
                "chars": len(got),
            })
            if not cached:
                unexpected.append({"id": piece["id"], "title": piece["title"]["t"], "detail": "缓存里没有这一首"})
            elif cached["han"] != got:
                unexpected.append({"id": piece["id"], "title": piece["title"]["t"], "detail": first_diff(cached["han"], got)})
    if len(pieces) != len(sel["tang"]) + len(sel["ci"]):
        unexpected.append({"id": "poetry", "title": "", "detail": "选篇数量和 selection.json 不一致"})
    return pieces, unexpected


def reading_policy(handian: dict, shuowen: dict) -> tuple[dict, list[dict]]:
    """页面读音不改。只把和汉典对不上的默认音记下来。"""
    shown = {}
    flags = []
    for trad, py in sorted(shuowen.items()):
        if not py:
            continue
        simp = to_simplified(trad)
        entry = handian.get(simp) or handian.get(trad)
        if not entry or py_matches(py, entry["readings"]):
            continue
        readings = entry["readings"]
        if len(readings) == 1:
            flags.append({
                "kind": "reading",
                "where": "字书默认音",
                "id": "",
                "word": trad,
                "reading": py,
                "han": readings[0],
                "ui": "silent",
                "detail": "汉典缓存只列了这一个不同的音。缓存常缺音，页面不改。",
            })
            continue
        shown[trad] = {
            "status": "review",
            "py": "",
            "shuowen": py,
            "han": readings,
        }
        flags.append({
            "kind": "reading",
            "where": "字书默认音",
            "id": "",
            "word": trad,
            "reading": py,
            "han": "、".join(readings),
            "ui": "review",
            "detail": "汉典有多个读音，说文音一个都不在里面。页面仍用说文音，弹层标为待复核。",
        })
    policy = {
        "source": "legacy/dict/out_file/ancient_chinese.json",
        "sourceName": "汉典文言",
        "rule": "不根据这份缓存改读音。汉典有多个读音、而说文音都不在其中的，弹层标为待复核。",
        "chars": shown,
    }
    return policy, flags


def glyphs(word: str) -> list[str]:
    out = []
    for ch in word:
        if ch.isspace() or ch in "/／":
            continue
        if unicodedata.category(ch).startswith("L") and ord(ch) > 127:
            out.append(ch)
    return out


def reading_options(reading: str, nchars: int) -> list[list[str]]:
    parts = [part.strip() for part in re.split(r"[/／]", reading) if part.strip()]
    options = []
    for part in parts:
        syllables = [norm_py(piece) for piece in re.split(r"[\s·]+", part) if norm_py(piece)]
        if syllables:
            options.append(syllables)
    if len(options) > 1 and all(len(item) == nchars for item in options):
        return options
    syllables = [norm_py(piece) for piece in re.split(r"[\s·/／]+", reading) if norm_py(piece)]
    return [syllables] if syllables else []


def handian_entry(handian: dict, ch: str):
    return handian.get(to_simplified(ch)) or handian.get(ch)


def shuowen_py(shuowen: dict, ch: str) -> str:
    return shuowen.get(ch) or shuowen.get(to_simplified(ch)) or ""


def lesson_flags(handian: dict, shuowen: dict) -> tuple[list[dict], dict]:
    """返回需要人看的条目，以及没能对照的字数。"""
    flags = []
    missing_chars: dict[str, int] = {}
    for path in article_files():
        art = load_article(path)
        lesson = art.get("lesson") or {}
        if not lesson:
            continue
        groups = [
            ("实词", lesson.get("keyContentWords") or []),
            ("虚词", lesson.get("keyFunctionWords") or []),
            ("通假", lesson.get("phoneticLoans") or []),
            ("活用", lesson.get("flexibleUsage") or []),
        ]
        for kind, rows in groups:
            for row in rows:
                word = (row.get("word") or "").strip()
                reading = (row.get("reading") or "").strip()
                note = row.get("note") or ""
                if reading:
                    flags.extend(check_reading(art["id"], kind, word, reading, handian, shuowen, missing_chars))
                if kind == "通假":
                    flags.extend(check_loan(art["id"], word, row, note, handian, missing_chars))
    return flags, {"missingChars": len(missing_chars), "missingHits": sum(missing_chars.values())}


def check_reading(aid, kind, word, reading, handian, shuowen, missing_chars) -> list[dict]:
    chars = glyphs(word)
    if not chars:
        return []
    options = reading_options(reading, len(chars))
    if not options or not any(len(item) == len(chars) for item in options):
        return [{
            "kind": "reading",
            "where": kind,
            "id": aid,
            "word": word,
            "reading": reading,
            "han": "",
            "detail": "读音音节数和字数不一致，无法逐字对照汉典。未改课注。",
        }]
    checked = []
    for option in options:
        if len(option) != len(chars):
            continue
        bad = reading_option_bad(chars, option, handian, shuowen, None)
        checked.append(bad)
        if not bad:
            return []
    bad = checked[0] if checked else []
    for ch, _py, _han in bad:
        if not handian_entry(handian, ch):
            missing_chars[ch] = missing_chars.get(ch, 0) + 1
    bad = [item for item in bad if handian_entry(handian, item[0])]
    if not bad:
        return []
    return [{
        "kind": "reading",
        "where": kind,
        "id": aid,
        "word": word,
        "reading": reading,
        "han": "；".join("%s→%s（汉典 %s）" % item for item in bad),
        "detail": "课注这一读音不在汉典缓存里，也不是说文默认音。未改课注。",
    }]


def reading_option_bad(chars, syllables, handian, shuowen, missing_chars):
    bad = []
    for ch, py in zip(chars, syllables):
        entry = handian_entry(handian, ch)
        if not entry:
            if missing_chars is not None:
                missing_chars[ch] = missing_chars.get(ch, 0) + 1
            bad.append((ch, py, ""))
            continue
        if py_matches(py, entry["readings"]):
            continue
        if py_matches(py, [shuowen_py(shuowen, ch)]):
            continue
        bad.append((ch, py, "、".join(entry["readings"])))
    return bad


def check_loan(aid, word, row, note, handian, missing_chars) -> list[dict]:
    loans = []
    if row.get("loan"):
        loans.append(row["loan"])
    loans.extend(re.findall(r"通[「“](.)[」”]", note))
    deduped = []
    for loan in loans:
        if loan and loan not in deduped:
            deduped.append(loan)
    loans = deduped
    chars = glyphs(word)
    if not loans or not chars:
        return []
    ch = chars[0]
    entry = handian_entry(handian, ch)
    if not entry:
        missing_chars[ch] = missing_chars.get(ch, 0) + 1
        return []
    missing = []
    for loan in loans:
        if loan not in entry["text"] and to_simplified(loan) not in entry["text"]:
            missing.append(loan)
    if not missing:
        return []
    return [{
        "kind": "loan",
        "where": "通假",
        "id": aid,
        "word": word,
        "reading": "、".join(missing),
        "han": entry["url"],
        "detail": "汉典这一字头的释文里没有写明通这些字。通假保持原注，标为未核定。",
    }]


def gloss_unverified_count(handian: dict) -> int:
    """整句译文和注释正文没有注本可逐句对照。只计数，不假装已核对。"""
    count = 0
    for path in article_files():
        lesson = (load_article(path).get("lesson") or {})
        for key in ("keyContentWords", "keyFunctionWords", "ancientModern", "phoneticLoans", "flexibleUsage", "specialSyntax"):
            count += len(lesson.get(key) or [])
        if lesson.get("background"):
            count += 1
        if lesson.get("theme"):
            count += 1
        if lesson.get("technique"):
            count += 1
    return count


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def render_report(summary: dict, resolved: list[dict], flags: list[dict]) -> str:
    lines = [
        "# 底本与读音核对",
        "",
        "这一份是机械核对的结果。维基文库底本是繁体，用来对公有领域正文；简体由规定的转换得到，不把繁体字形当成简体定本。",
        "中华书局简体注本没有收进仓库，正文、课注和译文都没有拿它逐字比较。手头若有钟基、李先银、王身钢译注《古文观止》（中华书局，简体横排，ISBN 978-7-101-07898-5；藏书升级版 ISBN 978-7-101-11362-4 同此译注），课注和译文以这一本为准。安平秋点校的繁体竖排本，以及《资治通鉴》点校本，也没有收进仓库。",
        "读音对照的是仓库里的汉典文言缓存（`legacy/dict/out_file/ancient_chinese.json`），不是《古汉语常用字字典》的全文。",
        "白话、注释和赏析是本书编写的。下面标成未核定的，没有改写成看起来正确的句子。",
        "",
        "## 正文",
        "",
        "| 书 | 篇数 | 汉字 | 和底本缓存的差异 |",
        "| --- | ---: | ---: | --- |",
    ]
    for row in summary["texts"]:
        lines.append("| %s | %d | %d | %s |" % (row["collection"], row["pieces"], row["chars"], row["unexpected"]))
    lines.extend(["", "规则内的改动：", ""])
    for item in resolved:
        lines.append("- %s｜%s｜%s｜%s" % (item["collection"], item["id"], item["change"], item["resolution"]))
    if summary["unexpected"]:
        lines.extend(["", "规则外的差异（需要改正文）：", ""])
        for item in summary["unexpected"]:
            lines.append("- %s %s：%s" % (item["id"], item.get("title") or "", item["detail"]))
    review = summary["reviewChars"]
    lines.extend([
        "",
        "## 读音",
        "",
        "页面上的今读没有改。汉典文言这份缓存常常只留下一个音，拿它覆盖说文音会把常见字读错。",
        "汉典有多个读音、说文音又对不上的，有 %d 字。弹层标为待复核，读音仍是说文音。" % review,
        "汉典只列了一个不同的音、因而不能改的，有 %d 字。这些不在弹层里标。" % summary["cacheSingle"],
        "",
        "课注里对不上汉典、又不是说文默认音的，见下表。注没有改。",
        "字头不在这份缓存里的，无法核对，共 %d 个字、%d 次，不逐条列出。" % (summary["missingChars"], summary["missingHits"]),
        "",
        "| 篇 | 类 | 词 | 注音 | 对不上的字 | 说明 |",
        "| --- | --- | --- | --- | --- | --- |",
    ])
    shown = [item for item in flags if item["where"] != "字书默认音"]
    bu_only = [
        item for item in shown
        if item["kind"] == "reading" and item["han"] and item["han"].count("→") == item["han"].count("不→bù")
    ]
    shown = [item for item in shown if item not in bu_only]
    if bu_only:
        lines.append("| 多篇 | 课注 | 不 | bù | 不→bù（汉典 fǒu、bú） | 缓存没有常见音 bù，共 %d 处。未改课注，也不逐篇列出。 |" % len(bu_only))
    if not shown and not bu_only:
        lines.append("|  |  |  |  |  | 没有 |")
    for item in shown:
        lines.append("| %s | %s | %s | %s | %s | %s |" % (
            item["id"], item["where"], item["word"], item["reading"], item["han"], item["detail"],
        ))
    lines.extend(["", "字书默认音待复核（弹层会标）：", ""])
    for item in flags:
        if item.get("ui") == "review":
            lines.append("- %s：说文 %s；汉典 %s。" % (item["word"], item["reading"], item["han"]))
    lines.extend(["", "汉典缓存只列一个不同的音（不改页面）：", ""])
    for item in flags:
        if item.get("ui") == "silent":
            lines.append("- %s：说文 %s；汉典 %s。" % (item["word"], item["reading"], item["han"]))
    lines.extend([
        "",
        "## 译文和注释",
        "",
        "课注条目（实词、虚词、古今异义、通假、活用、句式、背景、主旨、手法）共 %d 条。" % summary["glosses"],
        "古文观止课注里能对上维基文库夹注、汉典文言或《说文》的，记在 `sources/verification/GLOSSES.md`。对不上的留在那份清单里，不改写成另一种说法。",
        "每篇的「译文参考」写在 data/provenance.json 的 translation 里，页面出处下会显示。",
        "古文观止对钟基、李先银、王身钢译注本；唐诗对顾青编注《唐诗三百首》（中华书局，ISBN 978-7-101-11354-9）；宋词对唐圭璋《宋词三百首笺注》（1958年中华书局上海编辑所 / 上海古籍出版社重印本）。书不在仓库里，没有逐句抄对。",
        "",
        "## 简体用字",
        "",
        "按《简化字总表》的通行归并核对正文繁简对。乾（qián）、流徵、樊於期、神祇保留。馀的正条是余；附注允许在可能混淆时用馀。没有中华书局该书，不把余改成馀。",
        "",
        "| 繁 | 简 | 次数 | 说明 |",
        "| --- | --- | ---: | --- |",
    ])
    for row in summary.get("simp") or []:
        lines.append("| %s | %s | %d | %s |" % (row["trad"], row["simp"], row["count"], row["note"]))
    if summary.get("simpProblems"):
        lines.extend(["", "简体不合上表的：", ""])
        for item in summary["simpProblems"]:
            lines.append("- %s：%s" % (item["id"], item["detail"]))
    else:
        lines.extend(["", "没有不合上表的简体。", ""])
    lines.extend([
        "",
        "机器可读的读音清单：`sources/verification/flags.json`。",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    write = "--write" in sys.argv
    if write or not CANONICAL_PATH.is_file():
        if not POETRY_CACHE.is_dir() and not CANONICAL_PATH.is_file():
            raise SystemExit("缺少唐诗宋词缓存。")
        if write and POETRY_CACHE.is_dir():
            canonical = build_canonical()
            dump(CANONICAL_PATH, canonical)
        else:
            canonical = json.loads(CANONICAL_PATH.read_text(encoding="utf-8"))
    else:
        canonical = json.loads(CANONICAL_PATH.read_text(encoding="utf-8"))

    gwgz, gwgz_bad = check_gwgz()
    zztj, zztj_bad, zztj_resolved = check_zztj()
    renjian, renjian_bad, renjian_resolved = check_renjian()
    poetry, poetry_bad = check_poetry(canonical)
    unexpected = gwgz_bad + zztj_bad + renjian_bad + poetry_bad
    resolved = zztj_resolved + renjian_resolved + [
        {
            "id": "v06-15",
            "collection": "古文观止",
            "change": "費褘 → 費禕（简体袆 → 祎）",
            "resolution": "古文观止卷页把费祎写成衣字旁的褘。维基文库《前出師表》作費禕。OpenCC 把褘收成袆，所以和卷页缓存逐字比较看不出错。正文改从《前出師表》。",
        },
        {
            "id": "v06-15",
            "collection": "古文观止",
            "change": "今天下三分、。 → 今天下三分、",
            "resolution": "夹注「蜀、吴、魏」删掉后，顿号和夹注外的句号粘在一起。这一句后面紧接益州，句号去掉。",
        },
        {
            "id": "v04-01",
            "collection": "古文观止",
            "change": "不可以高飛、。 → 不可以高飛、",
            "resolution": "夹注「此句是喻、起下三句」插在顿号和句号之间，删注后剩下「、。」。句号去掉，顿号仍作这一版本的逗号。",
        },
        {
            "id": "v05-06",
            "collection": "古文观止",
            "change": "简体干坤 → 乾坤",
            "resolution": "乾坤的乾读 qián。OpenCC 把所有乾收成干。干是干燥，这里改回乾。",
        },
        {
            "id": "v02-14",
            "collection": "古文观止",
            "change": "简体干谿 → 乾谿",
            "resolution": "地名乾谿读 qián。简体不写作干谿。",
        },
        {
            "id": "v04-17",
            "collection": "古文观止",
            "change": "简体流征 → 流徵",
            "resolution": "流徵是乐律，徵读 zhǐ，不简作征。",
        },
        {
            "id": "v03-06",
            "collection": "古文观止",
            "change": "禁罝䍡 → 禁罜䍡",
            "resolution": "卷页写成罝，夹注「作罜、音主」。罝读嗟，是兔网；这一处是小网。维基文库《里革斷罟匡君》作罜。前面禁罝罗仍是兔网，不改。",
        },
        {
            "id": "v07-19",
            "collection": "古文观止",
            "change": "简体祇辱 → 只辱",
            "resolution": "杂说四「祇辱于奴隶人之手」的祇是只、仅。神祇的祇不在此列，仍作祇。",
        },
    ]
    traps = check_traps()
    simp_rows, simp_problems = audit_simplified()
    traps.extend({"id": item["id"], "detail": item["detail"]} for item in simp_problems)

    handian = load_handian()
    shuowen = load_shuowen()
    policy, dict_flags = reading_policy(handian, shuowen)
    lesson, coverage = lesson_flags(handian, shuowen)
    flags = dict_flags + lesson
    pieces = gwgz + zztj + renjian + poetry
    provenance = {
        "note": "每篇出处。正文对照的是仓库里的底本缓存。译文参考是命名的通行本，不是逐句抄录。",
        "pieces": {
            item["id"]: {
                **{k: item[k] for k in ("collection", "edition", "url", "note")},
                "translation": translation_ref(item["collection"]),
            }
            for item in pieces
        },
    }

    def bundle(rows: list[dict]) -> dict:
        return {
            "collection": rows[0]["collection"] if rows else "",
            "pieces": len(rows),
            "chars": sum(item["chars"] for item in rows),
            "unexpected": "0",
        }

    groups = []
    for name, rows, bad in (
        ("古文观止", gwgz, gwgz_bad),
        ("资治通鉴", zztj, zztj_bad),
        ("人间词话", renjian, renjian_bad),
        ("唐诗", [item for item in poetry if item["collection"] == "唐诗"], [item for item in poetry_bad if item["id"] in {p["id"] for p in poetry if p["collection"] == "唐诗"}]),
        ("宋词", [item for item in poetry if item["collection"] == "宋词"], [item for item in poetry_bad if item["id"] in {p["id"] for p in poetry if p["collection"] == "宋词"}]),
    ):
        groups.append({
            "collection": name,
            "pieces": len(rows),
            "chars": sum(item["chars"] for item in rows),
            "unexpected": "0" if not bad else str(len(bad)),
        })
    summary = {
        "texts": groups,
        "unexpected": unexpected,
        "reviewChars": sum(1 for item in policy["chars"].values() if item["status"] == "review"),
        "cacheSingle": sum(1 for item in dict_flags if item.get("ui") == "silent"),
        "glosses": gloss_unverified_count(handian),
        "lessonFlags": sum(1 for item in flags if item["where"] != "字书默认音"),
        "missingChars": coverage["missingChars"],
        "missingHits": coverage["missingHits"],
        "simp": simp_rows,
        "simpProblems": simp_problems,
    }
    report = render_report(summary, resolved, flags)
    payload = {"summary": summary, "resolved": resolved, "flags": flags}

    if write:
        dump(PROVENANCE_PATH, provenance)
        dump(POLICY_PATH, policy)
        dump(FLAGS_PATH, payload)
        REPORT_PATH.write_text(report, encoding="utf-8")
        print("wrote provenance %d, policy %d, flags %d" % (len(pieces), len(policy["chars"]), len(flags)))
    else:
        problems = []
        for path, data in (
            (PROVENANCE_PATH, provenance),
            (POLICY_PATH, policy),
            (FLAGS_PATH, payload),
        ):
            if not path.is_file() or json.loads(path.read_text(encoding="utf-8")) != data:
                problems.append(str(path.relative_to(ROOT)))
        if not REPORT_PATH.is_file() or REPORT_PATH.read_text(encoding="utf-8") != report:
            problems.append(str(REPORT_PATH.relative_to(ROOT)))
        if problems:
            print("报告和数据不是这次核对的结果：", "、".join(problems))
            print("请运行 python3 scripts/verify_sources.py --write")
            return 1

    print("pieces", len(pieces), "unexpected", len(unexpected), "flags", len(flags))
    for row in groups:
        print(" ", row["collection"], row["pieces"], "chars", row["chars"], "diff", row["unexpected"])
    if unexpected or traps:
        for item in unexpected[:12]:
            print("DIFF", item)
        for item in traps:
            print("TRAP", item)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
