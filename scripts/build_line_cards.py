# -*- coding: utf-8 -*-
"""把赏析并进 sources/commentary/line_cards.json，并写回 data/famous.json。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from expand_famous import attach_cards, load_json  # noqa: E402
from hanzi import only_han  # noqa: E402
from line_card_copy import rows  # noqa: E402
from line_card_prose import OVERRIDES  # noqa: E402

ART = ROOT / "data" / "articles"


def sentence_trs() -> dict[str, list[tuple[str, str]]]:
    out: dict[str, list[tuple[str, str]]] = {}
    for path in ART.glob("*.json"):
        if path.name.count(".") > 1:
            continue
        art = load_json(path)
        sents = []
        for para in art.get("paragraphs") or []:
            for sent in para.get("sentences") or []:
                text = "".join((tok.get("s") or tok.get("t") or "") for tok in sent.get("tokens") or [])
                tr = (sent.get("tr") or "").strip()
                han = only_han(text)
                if han and tr:
                    sents.append((han, tr))
        out[art["id"]] = sents
    return out


def best_tr(sents: list[tuple[str, str]], quote: str, text: str) -> str:
    best = ""
    score = -1
    for han, tr in sents:
        if quote not in han and han not in quote and quote not in text:
            continue
        current = 0
        if text and (text in han or han in text):
            current = 1000 + min(len(text), len(han))
        elif quote in han or han in quote:
            current = 10 + min(len(quote), len(han))
        if current > score:
            best = tr
            score = current
    return best


def main() -> None:
    base: dict[tuple[str, str], tuple[str, str]] = {}
    dups = []
    for item in rows():
        pid, quote, vern, appr = item
        key = (pid, only_han(quote))
        if key in base:
            dups.append(key)
            continue
        base[key] = (vern.strip(), appr.strip())
    famous = load_json(ROOT / "data" / "famous.json")
    trs = sentence_trs()
    cards = []
    missing = []
    for line in famous["lines"]:
        pid = line["pieces"][0]
        quote = line["quote"]
        qhan = only_han(quote)
        text = line.get("text") or ""
        than = only_han(text)
        found = base.get((pid, qhan))
        if not found:
            missing.append("%s %s" % (pid, quote))
            continue
        vern, appr = found
        for opid, oquote, needle, overn, oappr in OVERRIDES:
            if opid == pid and only_han(oquote) == qhan and needle in text:
                if overn.strip():
                    vern = overn.strip()
                if oappr.strip():
                    appr = oappr.strip()
        if not vern:
            vern = best_tr(trs.get(pid, []), qhan, than)
        if not vern or not appr:
            missing.append("%s %s" % (pid, quote))
            continue
        cards.append({
            "piece": pid,
            "quote": quote,
            "text": text,
            "vernacular": vern,
            "appreciate": appr,
        })
    if missing:
        raise SystemExit("缺 %d 条：%s" % (len(missing), " | ".join(missing[:20])))
    path = ROOT / "sources" / "commentary" / "line_cards.json"
    path.write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    attach_cards(famous["lines"])
    (ROOT / "data" / "famous.json").write_text(
        json.dumps(famous, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("cards", len(cards), "dup_keys_skipped", len(dups))


if __name__ == "__main__":
    main()
