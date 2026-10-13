# -*- coding: utf-8 -*-
"""汉字判定与抽取。"""

from __future__ import annotations


def is_han(ch: str) -> bool:
    o = ord(ch)
    return (
        0x3400 <= o <= 0x4DBF
        or 0x4E00 <= o <= 0x9FFF
        or 0xF900 <= o <= 0xFAFF
    )


def only_han(text: str) -> str:
    return "".join(ch for ch in text if is_han(ch))
