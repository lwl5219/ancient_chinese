# 资治通鉴课注写法

为 packet 里的每一项写白话和课注。白话、注释、赏析都要自己写，不要从现成的通鉴白话、译注网站或书里搬句子。

## 写到哪里

- `parts` 为 1：写入 `sources/zztj/lessons/{id}.json`
- `parts` 大于 1：只写译文，写入 `sources/zztj/lessons/parts/{id}-{part}.json`

目录没有就先建。文件是 UTF-8 JSON，缩进 2，不要注释，不要 markdown。

## 整年文件

```json
{
  "id": "z01-02",
  "trs": ["一句白话。", "下一句白话。"],
  "lesson": {
    "background": "至少四十字。写这一年前后发生了什么，人是谁。",
    "theme": "至少四十字。这一年的纪事要让人记住的事。",
    "technique": "至少四十字。司马光这一年怎么写：短编年、对话，还是臣光曰。",
    "keyContentWords": [
      {"word": "必须出现在原文里的词", "reading": "pīn yīn", "note": "在这一句里的意思。"}
    ],
    "keyFunctionWords": [
      {"word": "之", "reading": "zhī", "note": "这里相当于什么。"}
    ],
    "ancientModern": [
      {"word": "崩", "note": "天子死叫崩，不是山崩的时候要分开看。"}
    ],
    "phoneticLoans": [],
    "flexibleUsage": [],
    "specialSyntax": []
  }
}
```

`trs` 的条数必须和 `sentences` 一样，顺序一致。

## 分段文件

```json
{
  "id": "z01-01",
  "part": 1,
  "trs": ["一句白话。"]
}
```

不要在分段文件里写 lesson。

## 译文

- 用简体中文，像在给读者讲这一句。
- 不要跟原文整句相同，也不要只改一两个字。
- 人名、地名、数字保持原样，不要换成人名的别称，除非原文本身在解释。
- 「臣光曰」写成「司马光评论说」。
- 某人「曰」写成「某某说」。
- 引文继续说下去时，按这一句自己的意思翻译，不要把上一句再译一遍。
- 一句原文对应一条译文，不要把两句并成一条，也不要拆开。

## 注释

整年文件里，`keyContentWords`、`keyFunctionWords`、`ancientModern`、`flexibleUsage`、`specialSyntax` 加在一起至少 4 条，而且每条的词和说明都不能空。词必须能在这一年的原文里找到。读音用带声调的拼音，词和读音的音节数要一致。
