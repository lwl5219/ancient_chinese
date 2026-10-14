# 典籍

按原书次序读经典。现在先读《古文观止》：十二卷、二百二十二篇，从卷一《郑伯克段于鄢》开始。点开字，看带声调的拼音、《说文解字》本义和本句意思；卷一十八篇另有系统讲解。下一本是《三字经》，开篇二十二句已经可以读。学习进度记在浏览器本地。

这是一个纯静态网站，不需要构建工具就能打开。手机上从底部切换典籍、观止和三字经；读文章时，底部是上一篇和下一篇。

## 本地运行

在仓库根目录启动任意静态服务器，然后用浏览器打开。不要直接双击 `index.html`，否则浏览器会拦截 `fetch` 本地文件。

```bash
python3 -m http.server 8765
```

打开 <http://127.0.0.1:8765/> 。目录在左侧；手机上点左上角「目录」。

## 怎么读

- 首页是典籍。进入《古文观止》后按卷选择，再点开篇目。
- 拼音默认显示在字的上方。文白对照是卷一的默认读法；系统讲解在篇末的「看系统讲解」。简繁、隐藏拼音和「这篇读完了」也放在篇末，不挡正文。
- 点原文中的字：弹出该字在本句中的读音和义项；下面附《说文》字头的今读参考、反切和本义。未做逐句审定的篇目，弹出的是《说文》本义，并标明还不是核定过的句中义。
- 「这篇读完了」和上次读到的篇目存在 `localStorage`（键名 `gwgz-progress-v1`），只留在这台浏览器里。
- 底本是繁体，简体由 OpenCC 转换。
- 《三字经》开篇在 `#/szj`。字上是现代汉语今读。

## 部署到 GitHub Pages

1. 把本仓库推到 GitHub。
2. 打开仓库 Settings → Pages。
3. Source 选要发布的分支（例如 `master` 或本功能分支），文件夹选 `/ (root)`。
4. 保存后访问 `https://<用户名>.github.io/<仓库名>/`。

站点入口是根目录的 `index.html`，数据在 `data/`。仓库里已放 `.nojekyll`，避免 GitHub Pages 的 Jekyll 处理漏掉文件。

## 数据从哪里来

| 内容 | 来源 | 许可 |
| --- | --- | --- |
| 十二卷二百二十二篇原文 | [维基文库《古文观止》](https://zh.wikisource.org/wiki/古文觀止) | 古籍原文已进入公有领域。维基文库页面文本依其站点条款，使用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。抓取记录在 `sources/wikisource/vol01.wikitext` 至 `vol12.wikitext`。 |
| 字头、今读参考、反切、本义 | [shuowenjiezi/shuowen](https://github.com/shuowenjiezi/shuowen) | [Apache-2.0](https://github.com/shuowenjiezi/shuowen/blob/master/LICENSE)。站点只编入正文里出现的字，见 `data/dict.json`。 |
| 卷一逐句义、白话和系统讲解 | 本仓库 `annotations/v1_01.py` 至 `v1_18.py` | 与本仓库代码一起提供。句中义按该句语境写，不把《说文》本义直接当成句中义。 |

维基文库个别篇目的引号不完整。导入时只补标点，不改汉字。卷一标注与底本逐字对齐，由 `scripts/build_site.py` 在生成时检查。

## 重新生成数据

已生成的 `data/` 可以直接使用。若要改标注或重新抓取：

```bash
python3 scripts/fetch_wikisource.py
git clone --depth 1 https://github.com/shuowenjiezi/shuowen.git /tmp/shuowen
python3 scripts/build_site.py
python3 scripts/build_sanzijing.py
```

依赖：Python 3，以及 `opencc`、`pypinyin`。

```bash
pip install opencc-python-reimplemented pypinyin
```

`scripts/build_site.py` 读取十二卷维基文库文本和 `annotations/volume1.py`。卷一十八篇必须齐全，否则构建会停下。其余二百零四篇写入原文、断句和可点的字，讲解字段留空，方便以后按同一结构补进 `annotations/`。

## 目录

- `index.html`、`css/app.css`、`js/app.js`：阅读界面。
- `data/books.json`：站点上的书。
- `data/catalog.json`：古文观止十二卷目录。
- `data/sanzijing.json`：三字经开篇，由 `sources/sanzijing/text.txt` 生成。
- `data/articles/`：每篇一篇 JSON。
- `data/dict.json`：正文用字的《说文》索引。
- `annotations/`：卷一讲解。
- `scripts/`：抓取、解析和构建。
- `sources/wikisource/`：维基文库原始维基文本。
- `sources/sanzijing/text.txt`：三字经开篇和后续章节的底稿。
- `legacy/`：本仓库原先的词典爬虫。新站点不使用它。

## 关于旧代码

这个仓库原来是一套古代汉语词典爬虫。它和现在的学习站点不是同一件事，所以整目录移到了 `legacy/`，没有在它上面继续改。词典改用 Apache-2.0 的《说文》开源数据。
