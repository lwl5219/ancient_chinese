# 典籍

按原书次序读经典。先读《古文观止》：十二卷、二百二十二篇，从卷一《郑伯克段于鄢》开始。点开字，看带声调的拼音、《说文解字》本义和本句意思；卷一十八篇另有系统讲解。接着是唐诗三十六首、宋词二十三首，从《静夜思》和《水调歌头》读起。学习进度记在浏览器本地。

这是一个纯静态网站，不需要构建工具就能打开。手机上从底部切换典籍、观止、唐诗和宋词；读文章或诗词时，底部是上一篇和下一篇。

## 本地运行

先生成隔离的预览目录，再启动静态服务器。仓库内首页可能还引用上一版哈希；直接服务原目录不会展示未发布的源码修改。不要直接双击 `index.html`，否则浏览器会拦截 `fetch` 本地文件。

```bash
python3 scripts/stage_site.py /tmp/dianji-preview
python3 -m http.server 8765 --directory /tmp/dianji-preview
```

打开 <http://127.0.0.1:8765/> 。电脑上读《古文观止》的某一卷时，这一卷的篇目在左侧。

## 怎么读

- 首页是典籍。进入《古文观止》后按卷选择，再点开篇目。唐诗、宋词各是一份篇目，点开就能读。
- 拼音默认显示在字的上方。文白对照是卷一的默认读法；系统讲解在篇末的「看系统讲解」。简繁、隐藏拼音和「这篇读完了」也放在篇末，不挡正文。诗词页可以切换简繁和拼音，不记入古文观止的已读篇数。
- 点原文中的字：弹出该字在本句中的读音和义项；下面附《说文》字头的今读参考、反切和本义。未做逐句审定的篇目和诗词，弹出的是《说文》本义，并标明还不是核定过的句中义。诗词字上的拼音是现代汉语今读。
- 「这篇读完了」和上次读到的篇目存在 `localStorage`（保留旧键 `gwgz-progress-v1`，新变更按字段写入 `gwgz-progress-v2:*`），只留在这台浏览器里。
- 底本是繁体，简体由 OpenCC 转换。宋词上游文本是简体，繁体由 OpenCC 转出。

## 验证和发布

GitHub Pages 的 Source 是 **GitHub Actions**（`build_type=workflow`），不是 Deploy from a branch。这样不会再有一条把 `master` 原文直接发出去的 `pages-build-deployment`，和审计发布抢着写同一个站点。
`Audit and release` 在 `master` 上先执行 Python、Node 回归和三项内容审计，再生成并校验同一份打过戳的站点产物。只有审计成功才发布：Pages 用 `configure-pages`、`upload-pages-artifact` 和 `deploy-pages`，OSS 上传同一份产物。两边都和这份产物逐字节核对，最后再确认两个公开 `version.json` 是同一个 build。`codex/reader-fixes-*` 分支仅运行检查和打包，不发布；PR 同样只检查。工作流不再修改或回推源码。

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
python3 scripts/audit_content.py
python3 scripts/verify_sources.py
python3 scripts/verify_glosses.py
python3 scripts/stage_site.py /tmp/site-new
```

Python 依赖版本锁定在 `requirements-dev.txt`；CI 使用 Python 3.12 和 Node 22。前端回归运行实际 `js/app.js`，以最小 DOM/存储/网络桩验证竞态、跨标签页、断网、存储失败和音频反馈；它不替代真实浏览器布局检查。CI 明确检查 `tests/app.test.js` 存在，避免通配符未匹配时误报零测试通过。

`stage_site.py` 只写新的输出目录，校验哈希、入口引用、文章目录和音频 manifest 中的真实录音。OSS 先完成全部资源上传，再依次上传首页和 `version.json`；任何资源失败都不会切换入口，旧远端哈希不删除。音频缺失时显示“暂无录音”，不生成虚构音频。

Pages 产物保留**上一版成功发布的活动哈希资源**，不递归积累更早版本。发布前从公开 Pages 入口读取当前版本、资源映射及真实资源，逐文件验证 SHA-256，并再次检查版本以防下载期间发生切换；不读取或扩展任何凭据权限。第一次迁移若没有公开版本文件，则使用 checkout 的活动哈希。仅在哈希一致时，才能从真实 canonical 文件恢复 checkout 中缺失的哈希副本。`compatibility.json` 记录兼容版本和文件列表，审核产物保留 90 天供追溯。

本地复现两版兼容：

```bash
python3 scripts/stage_site.py /tmp/site-next --previous-site /tmp/site-previous
```

兼容窗口为前一版，连续发布两次后更早的标签页可能需要刷新。若上一版公开资源不可用或摘要不符，CI 明确失败；确认可以结束旧版兼容后，可手动运行工作流并选择 `reset-compatibility`，会使用 checkout 中仍可验证的哈希。默认不重置。源码与已审计产物是回滚依据：撤销问题提交后重新运行相同审计发布流程，不直接覆盖生产资源。

## 数据从哪里来

| 内容 | 来源 | 许可 |
| --- | --- | --- |
| 十二卷二百二十二篇原文 | [维基文库《古文观止》](https://zh.wikisource.org/wiki/古文觀止) | 古籍原文已进入公有领域。维基文库页面文本依其站点条款，使用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。抓取记录在 `sources/wikisource/vol01.wikitext` 至 `vol12.wikitext`。 |
| 字头、今读参考、反切、本义 | [shuowenjiezi/shuowen](https://github.com/shuowenjiezi/shuowen) | [Apache-2.0](https://github.com/shuowenjiezi/shuowen/blob/master/LICENSE)。站点只编入正文里出现的字，见 `data/dict.json`。 |
| 卷一逐句义、白话和系统讲解 | 本仓库 `annotations/v1_01.py` 至 `v1_18.py` | 与本仓库代码一起提供。句中义按该句语境写，不把《说文》本义直接当成句中义。 |
| 唐诗三十六首、宋词二十三首 | [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) commit `b8594f81` | 古籍原文为公有领域。JSON 汇编为 [MIT](sources/poetry/chinese-poetry-LICENSE.txt)，Copyright (c) 2016 JackeyGao。篇目清单在 `sources/poetry/selection.json`。正文保持该提交的用字，不改成课本通行本。 |

维基文库个别篇目的引号不完整。导入时只补标点，不改汉字。卷一标注与底本逐字对齐，由 `scripts/build_site.py` 在生成时检查。

## 安全更新原文和讲解

已发布的 `data/` 包含后续章节的译文、校订和逐句释义，不能从最初的卷一生成器直接覆盖。默认 `python3 scripts/build_site.py` 保留既有篇目、其他典籍、字典扩展和哈希文件；输入变化会明确失败。`data/build-inputs.json` 保存每篇原文和 annotations 的输入摘要，初始基准为 `b789040e52e9d81a1c0cd7647e5eedb239942c07`；不要删除或自动重建该文件来绕过检查。

更新流程：

1. 修改 `sources/wikisource/` 或 `annotations/` 后，运行 `python3 scripts/build_site.py --plan-update /tmp/guwen-review`。它不修改发布数据，只生成变化篇目的 `.published.json`（现有校订）、`.generated.json`（生成器草稿）、`.reviewed.json`（待人工合并）和 `plan.json`。
2. 对照原文和两份版本，编辑 `.reviewed.json`。它默认从现有发布数据开始，保留后续章节译注；不要把缺少译注的 generated 草稿整份覆盖进去。原文与卷一标注不对齐时，生成计划即失败。
3. 运行 `python3 scripts/build_site.py --summarize-update /tmp/guwen-review/plan.json`。核对输出对应的实际差异，再把该篇的 `reviewed_sha256`、`approved_field_changes` 填入 `plan.json`，填写 `review_note`。输出仅帮助核对，不会自动批准或修改计划。每个变更的既有顶层字段都要求前后摘要，包括正文、译注、讲解和自定义校订字段；仅新增字段无需覆盖批准。
4. 运行 `python3 scripts/build_site.py --apply-update /tmp/guwen-review/plan.json`。输入或发布数据在审阅后又变化、正文无效、摘要不符、译注变更未批准，都会在写入前失败。通过后同步更新文章、目录和输入基线。再次执行默认构建应稳定。
5. 运行本页的回归、三项内容审计和打包命令，审阅 Git 差异，再提交。

删除篇目不会自动应用，必须同时审阅目录及输入基线。审阅更新中新引入的字才需要 `build_dict.py` 的既有《说文》数据来源；已有字典条目和其他典籍用字保持不变。已发布文章没有输入变更时，不调用外部字典，也不自动填补既有字典缺口。写入前会序列化并解析全部输出，单文件替换是原子的；它不是跨文件系统事务，磁盘故障后应先检查 Git 差异再重试。

`build_poetry.py` 是单独的诗词生成流程，读取 `/tmp/poetry/` 外部底本和 `sources/poetry/selection.json`；本次输入保护只覆盖 `build_site.py` 的古文观止流程。不要将多个生成器未经审查的输出直接部署。

## 目录

- `index.html`、`css/app.css`、`js/app.js`：阅读界面。
- `data/books.json`：站点上的书。
- `data/catalog.json`：古文观止十二卷目录。
- `data/tang.json`、`data/songci.json`：唐诗、宋词这一批。
- `data/articles/`：古文观止每篇一篇 JSON。
- `data/dict.json`：正文用字的《说文》索引。
- `annotations/`：卷一讲解。
- `scripts/`：抓取、解析和构建。
- `sources/wikisource/`：维基文库原始维基文本。
- `sources/poetry/`：唐诗宋词的选篇清单，以及 chinese-poetry 的 MIT 许可文本。
- `legacy/`：本仓库原先的词典爬虫。新站点不使用它。

## 关于旧代码

这个仓库原来是一套古代汉语词典爬虫。它和现在的学习站点不是同一件事，所以整目录移到了 `legacy/`，没有在它上面继续改。词典改用 Apache-2.0 的《说文》开源数据。

发布后 CI 会从公开 Pages 和 OSS 逐一读取入口、版本、哈希资源（含兼容窗口内旧资源）及录音样本，与通过审计的产物逐字节摘要比较。此检查不发送凭据，也不替代真实浏览器的视觉和交互验收。每次审计另产出 `repair-patches-*` 下载包，包含固定基准补丁、应用检查和 SHA256SUMS。
