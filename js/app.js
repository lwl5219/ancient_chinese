(function () {
  "use strict";

  const KEY = "gwgz-progress-v1";
  const PROGRESS_PREFIX = "gwgz-progress-v2:";
  const PROGRESS_FIELDS = ["font", "mode", "sentence", "sentenceSet", "last", "pinyin", "pinyinSet"];
  const state = {
    catalog: null,
    dict: null,
    article: null,
    progress: loadProgress(),
    query: "",
    openVol: 1,
    popupTok: null,
    view: "hub",
    books: null,
    collections: {},
    piece: null,
    kind: "",
    notes: null,
    verseTab: "",
    proseAuthors: null,
    renjian: null,
    renjianQuery: "",
    zztj: null,
    provenance: null,
    readingPolicy: null,
    glossSources: null,
    grades: null,
    gradeFilter: "",
    famousOnly: false,
    famous: null,
    daode: null,
    lunyu: null,
    listMode: "work",
    audioManifest: null,
  };
  let progressBase = progressFields(state.progress);
  const pendingProgress = {};
  let loadToken = 0;

  const main = document.getElementById("main");
  const catalogEl = document.getElementById("catalog");
  const popup = document.getElementById("popup");
  const scrim = document.getElementById("scrim");
  const shell = document.querySelector(".shell");
  const topProgress = document.getElementById("top-progress");
  const meter = document.getElementById("top-meter-fill");

  function normalizeProgress(value) {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const learned = {};
    Object.keys(raw.learned || {}).forEach(function (id) {
      if (/^[vhdzl]\d{2}-\d{2}$/.test(id) && Number.isFinite(raw.learned[id]) && raw.learned[id] > 0) learned[id] = raw.learned[id];
    });
    const collections = {};
    ["tang", "ci", "ke"].forEach(function (kind) {
      const id = raw.collections && raw.collections[kind];
      if (typeof id === "string" && /^[a-z0-9-]+$/.test(id)) collections[kind] = id;
    });
    return {
      learned: learned, collections: collections,
      font: raw.font === "t" ? "t" : "s", mode: raw.mode === "study" ? "study" : "read",
      sentenceSet: !!raw.sentenceSet, sentence: raw.sentenceSet ? !!raw.sentence : true,
      pinyinSet: !!raw.pinyinSet, pinyin: raw.pinyinSet ? !!raw.pinyin : true,
      last: typeof raw.last === "string" ? raw.last : "",
    };
  }

  function progressFields(progress) {
    const fields = {};
    PROGRESS_FIELDS.forEach(function (key) { fields[key] = progress[key]; });
    ["learned", "collections"].forEach(function (group) {
      Object.keys(progress[group] || {}).forEach(function (id) { fields[group + ":" + id] = progress[group][id]; });
    });
    return fields;
  }

  function applyProgressField(progress, key, value) {
    const parts = key.split(":");
    if (parts.length === 1 && PROGRESS_FIELDS.indexOf(key) >= 0) progress[key] = value;
    else if (parts.length === 2 && (parts[0] === "learned" || parts[0] === "collections") && /^[a-z0-9-]+$/.test(parts[1])) {
      if (value === null) delete progress[parts[0]][parts[1]];
      else progress[parts[0]][parts[1]] = value;
    }
  }

  function loadProgress(fallback) {
    let progress = normalizeProgress(fallback);
    try {
      try { progress = normalizeProgress(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (_) { /* Ignore corrupt legacy data. */ }
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || key.indexOf(PROGRESS_PREFIX) !== 0) continue;
        try { applyProgressField(progress, key.slice(PROGRESS_PREFIX.length), JSON.parse(localStorage.getItem(key))); } catch (_) { /* Isolate a corrupt field. */ }
      }
    } catch (_) { /* Storage can be unavailable; reading remains usable. */ }
    return normalizeProgress(progress);
  }

  function showNotice(message) {
    let notice = document.getElementById("app-notice");
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "app-notice";
      notice.className = "app-notice";
      notice.setAttribute("role", "status");
      document.body.appendChild(notice);
    }
    notice.textContent = message;
  }

  function saveProgress() {
    const current = progressFields(state.progress);
    const keys = new Set(Object.keys(progressBase).concat(Object.keys(current)));
    keys.forEach(function (key) {
      if (current[key] !== progressBase[key]) pendingProgress[key] = current[key] === undefined ? null : current[key];
    });
    const merged = loadProgress(state.progress);
    Object.keys(pendingProgress).forEach(function (key) {
      const value = pendingProgress[key];
      applyProgressField(merged, key, value);
      try {
        // Each field has its own key. Other tabs cannot overwrite unrelated
        // changes; null persists an explicit removal over the legacy snapshot.
        localStorage.setItem(PROGRESS_PREFIX + key, JSON.stringify(value));
        delete pendingProgress[key];
      } catch (_) {
        showNotice("浏览器未能保存进度。本页仍可阅读，未保存的更改暂留在当前页面。");
      }
    });
    state.progress = normalizeProgress(merged);
    progressBase = progressFields(state.progress);
    syncChrome();
  }

  function syncStoredProgress(event) {
    if (event.key !== null && event.key !== KEY && event.key.indexOf(PROGRESS_PREFIX) !== 0) return;
    const merged = loadProgress(state.progress);
    Object.keys(pendingProgress).forEach(function (key) { applyProgressField(merged, key, pendingProgress[key]); });
    state.progress = normalizeProgress(merged);
    progressBase = progressFields(state.progress);
    if (!state.catalog) return;
    if (state.view === "article" && state.article) renderArticle(true);
    else if (state.view === "piece" && state.piece) renderPiece(true);
    else route();
    syncChrome();
  }

  function learnedCount() {
    return Object.keys(state.progress.learned || {}).length;
  }

  function assetUrl(path) {
    const map = window.ASSET_URLS;
    if (map && Object.prototype.hasOwnProperty.call(map, path)) return map[path];
    return path;
  }

  function flatArticles() {
    const list = [];
    (state.catalog.volumes || []).forEach(function (vol) {
      vol.articles.forEach(function (art) { list.push(art); });
    });
    return list;
  }

  function renjianArticles() {
    const vol = state.renjian && state.renjian.volumes && state.renjian.volumes[0];
    return vol ? vol.articles : [];
  }

  function isRenjianId(id) {
    return /^h\d{2}-\d{2}$/.test(id || "");
  }

  function zztjArticles() {
    const list = [];
    ((state.zztj && state.zztj.volumes) || []).forEach(function (vol) {
      vol.articles.forEach(function (art) { list.push(art); });
    });
    return list;
  }

  function isZztjId(id) {
    return /^z\d{2}-\d{2}$/.test(id || "");
  }

  function isDaodeId(id) {
    return /^d\d{2}-\d{2}$/.test(id || "");
  }

  function isLunyuId(id) {
    return /^l\d{2}-\d{2}$/.test(id || "");
  }

  function classicArticles(which) {
    const data = which === "daode" ? state.daode : state.lunyu;
    const list = [];
    ((data && data.volumes) || []).forEach(function (vol) {
      vol.articles.forEach(function (art) { list.push(art); });
    });
    return list;
  }

  function articleList(id) {
    if (isZztjId(id)) return zztjArticles();
    if (isRenjianId(id)) return renjianArticles();
    if (isDaodeId(id)) return classicArticles("daode");
    if (isLunyuId(id)) return classicArticles("lunyu");
    return flatArticles();
  }

  function bookNameFor(id) {
    if (isZztjId(id)) return "资治通鉴";
    if (isRenjianId(id)) return "人间词话";
    if (isDaodeId(id)) return "道德经";
    if (isLunyuId(id)) return "论语";
    return "古文观止";
  }

  function learnedIn(list) {
    return list.filter(function (art) { return state.progress.learned[art.id]; }).length;
  }

  function findArticleMeta(id) {
    const lists = [articleList(id), flatArticles(), renjianArticles(), zztjArticles()];
    for (let i = 0; i < lists.length; i += 1) {
      const found = lists[i].find(function (art) { return art.id === id; });
      if (found) return found;
    }
    return null;
  }

  function neighbors(id) {
    const list = articleList(id);
    const i = list.findIndex(function (art) { return art.id === id; });
    return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
  }

  function skeleton(label) {
    main.innerHTML =
      "<div class='loading' aria-busy='true' aria-live='polite'>" +
      "<div class='sk sk-kicker'></div><div class='sk sk-title'></div>" +
      "<div class='sk sk-line'></div><div class='sk sk-line'></div><div class='sk sk-line short'></div>" +
      "<p>" + label + "</p></div>";
  }

  async function boot() {
    skeleton("正在载入");
    const paths = {
      catalog: "data/catalog.json", books: "data/books.json", proseAuthors: "data/prose-authors.json",
      renjian: "data/renjian.json", zztj: "data/zztj.json", provenance: "data/provenance.json",
      readingPolicy: "data/reading-policy.json", glossSources: "data/gloss-sources.json", grades: "data/grades.json",
      daode: "data/daode.json", lunyu: "data/lunyu.json", famous: "data/famous.json",
    };
    const keys = Object.keys(paths);
    const data = await Promise.all(keys.map(function (key) { return fetchJson(paths[key]); }));
    keys.forEach(function (key, i) { state[key] = data[i]; });
    loadAudioManifest().catch(function () { /* The reader works without audio. */ });
    if (state.progress.last) {
      const meta = findArticleMeta(state.progress.last);
      if (meta) state.openVol = Number(meta.id.slice(1, 3));
    }
    route();
    fetch(assetUrl("data/dict.json"))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.dict = data.chars || {};
        const open = state.popupTok;
        if (state.view === "article" && state.article && state.progress.pinyin) renderArticle(true);
        if (state.view === "piece" && state.piece && state.progress.pinyin) renderPiece(true);
        if (open) {
          const anchor = open.anchor && open.anchor.isConnected ? open.anchor : null;
          openPopup(open.tok, open.index, anchor);
        }
      })
      .catch(function () { state.dict = {}; });
  }

  function renderRail(volumeNumber) {
    const vol = state.catalog.volumes.find(function (item) { return item.volume === volumeNumber; });
    if (!vol) {
      shell.classList.remove("has-rail");
      catalogEl.replaceChildren();
      return;
    }
    shell.classList.add("has-rail");
    const root = document.createElement("div");
    const head = document.createElement("p");
    head.className = "rail-title";
    head.textContent = vol.title + " · " + vol.subtitle;
    root.appendChild(head);
    const list = document.createElement("ol");
    list.className = "vol-list";
    vol.articles.forEach(function (art) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#/read/" + art.id;
      if (state.article && state.article.id === art.id) a.className = "active";
      const idx = document.createElement("span");
      idx.className = "idx";
      idx.textContent = String(art.index);
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = art.title;
      a.appendChild(idx);
      a.appendChild(title);
      if (state.progress.learned[art.id]) {
        const mark = document.createElement("span");
        mark.className = "done";
        mark.textContent = "已读";
        a.appendChild(mark);
      }
      li.appendChild(a);
      list.appendChild(li);
    });
    root.appendChild(list);
    catalogEl.replaceChildren(root);
  }

  function renderRenjianRail() {
    const articles = renjianArticles();
    if (!articles.length) {
      shell.classList.remove("has-rail");
      catalogEl.replaceChildren();
      return;
    }
    shell.classList.add("has-rail");
    const root = document.createElement("div");
    const head = document.createElement("p");
    head.className = "rail-title";
    head.textContent = "人间词话 · 六十四则";
    root.appendChild(head);
    const list = document.createElement("ol");
    list.className = "vol-list";
    articles.forEach(function (art) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#/read/" + art.id;
      if (state.article && state.article.id === art.id) a.className = "active";
      const idx = document.createElement("span");
      idx.className = "idx";
      idx.textContent = String(art.index);
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = art.title;
      a.appendChild(idx);
      a.appendChild(title);
      if (state.progress.learned[art.id]) {
        const mark = document.createElement("span");
        mark.className = "done";
        mark.textContent = "已读";
        a.appendChild(mark);
      }
      li.appendChild(a);
      list.appendChild(li);
    });
    root.appendChild(list);
    catalogEl.replaceChildren(root);
  }

  const POETRY = {
    tang: { file: "data/tang.json", label: "唐诗", unit: "首" },
    ci: { file: "data/songci.json", label: "宋词", unit: "首" },
    ke: { file: "data/ke.json", label: "课文", unit: "篇" },
  };

  async function fetchJson(path) {
    const response = await fetch(assetUrl(path));
    if (!response.ok) throw new Error("HTTP " + response.status + ": " + path);
    return response.json();
  }

  function showLoadError(retry) {
    const box = document.createElement("div");
    box.className = "empty";
    box.setAttribute("role", "alert");
    const message = document.createElement("p");
    message.textContent = "页面数据暂时无法载入，请检查网络后重试。";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "重新载入";
    button.addEventListener("click", retry);
    box.appendChild(message);
    box.appendChild(button);
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "刷新页面";
    refresh.addEventListener("click", function () { location.reload(); });
    box.appendChild(refresh);
    main.replaceChildren(box);
  }

  function trackPageview() {
    try {
      const hash = location.hash || "#/";
      const path = "/" + hash;
      // The library's first hit already records the landing URL, including the hash.
      if (!trackPageview.seen) {
        trackPageview.seen = true;
        trackPageview.last = path;
        return;
      }
      if (path === trackPageview.last) return;
      trackPageview.last = path;
      (window._hmt = window._hmt || []).push(["_trackPageview", path]);
    } catch (err) {}
  }

  async function route() {
    if (!state.catalog) return;
    const hash = location.hash;
    let token = loadToken;
    try {
      const pending = dispatchRoute();
      token = loadToken;
      await pending;
    } catch (err) {
      if (token === loadToken && hash === location.hash) showLoadError(route);
      console.error(err);
    }
    if (token === loadToken && hash === location.hash) trackPageview();
  }

  function dispatchRoute() {
    const hash = location.hash || "#/";
    const read = hash.match(/^#\/read\/((?:v|h|z|d|l)\d{2}-\d{2})$/);
    const vol = hash.match(/^#\/gwgz\/(\d{1,2})$/);
    const zjuan = hash.match(/^#\/zztj\/(\d{1,2})$/);
    const authorPage = hash.match(/^#\/(tang|ci|ke)\/author\/(.+)$/);
    const piece = hash.match(/^#\/(tang|ci|ke)\/([a-z0-9-]+)$/);
    if (read) return showArticle(read[1]);
    else if (vol) return showVolume(Number(vol[1]));
    else if (zjuan) return showZztjJuan(Number(zjuan[1]));
    else if (hash === "#/gwgz") showBook();
    else if (hash === "#/zztj") showZztj();
    else if (hash === "#/rjch") showRenjian();
    else if (hash === "#/daode") return showClassic("daode");
    else if (hash === "#/lunyu") return showClassic("lunyu");
    else if (authorPage) return showAuthor(authorPage[1], decodeURIComponent(authorPage[2]));
    else if (piece) return showPiece(piece[1], piece[2]);
    else if (hash === "#/tang" || hash === "#/ci" || hash === "#/ke") return showCollection(hash.slice(2));
    else showHub();
  }

  function bookList() {
    if (state.books && state.books.books) return state.books.books;
    return [
      { id: "gwgz", title: "古文观止", href: "#/gwgz", meta: "十二卷 · 二百二十二篇", detail: "先读这一本。" },
      { id: "zztj", title: "资治通鉴", href: "#/zztj", meta: "司马光 · 周纪秦纪已收", detail: "汉纪以后待添加。" },
      { id: "daode", title: "道德经", href: "#/daode", meta: "王弼本 · 八十一章", detail: "道经、德经。" },
      { id: "lunyu", title: "论语", href: "#/lunyu", meta: "二十篇", detail: "从《学而》读起。" },
      { id: "tang", title: "唐诗", href: "#/tang", meta: "精选名篇", detail: "从《静夜思》读起。" },
      { id: "ci", title: "宋词", href: "#/ci", meta: "精选名篇", detail: "从《水调歌头》读起。" },
      { id: "rjch", title: "人间词话", href: "#/rjch", meta: "王国维 · 六十四则", detail: "一九〇八年至一九〇九年《国粹学报》本。" },
      { id: "ke", title: "课文", href: "#/ke", meta: "统编教材", detail: "三百首和古文观止未收的课文。" },
    ];
  }

  function showHub() {
    loadToken += 1;
    closePopup();
    state.view = "hub";
    state.article = null;
    const total = state.catalog.articleCount;
    const n = learnedCount();
    const first = state.catalog.volumes[0].articles[0];
    const last = state.progress.last ? findArticleMeta(state.progress.last) : null;
    const wrap = document.createElement("article");
    wrap.className = "home";
    const h1 = document.createElement("h1");
    h1.textContent = (state.books && state.books.title) || "典籍";
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = (state.books && state.books.lead) || "按原书次序读。点开字，看读音和本义。";
    wrap.appendChild(h1);
    wrap.appendChild(lead);

    if (last) {
      const resume = document.createElement("a");
      resume.className = "resume";
      resume.href = "#/read/" + last.id;
      const copy = document.createElement("div");
      const rk = document.createElement("p");
      rk.className = "kicker";
      rk.textContent = "继续读";
      const rh = document.createElement("h2");
      rh.textContent = last.title;
      const rs = document.createElement("p");
      const resumeList = articleList(last.id);
      const resumeBook = bookNameFor(last.id);
      rs.textContent = resumeBook + " · 已读 " + learnedIn(resumeList) + " / " + resumeList.length;
      const go = document.createElement("span");
      go.className = "go";
      go.textContent = "继续";
      copy.appendChild(rk);
      copy.appendChild(rh);
      copy.appendChild(rs);
      resume.appendChild(copy);
      resume.appendChild(go);
      wrap.appendChild(resume);
    }

    const list = document.createElement("div");
    list.className = "book-list";
    bookList().forEach(function (book) {
      const card = document.createElement("a");
      card.className = "book-row";
      card.href = book.href;
      const strong = document.createElement("strong");
      strong.textContent = book.title;
      const meta = document.createElement("span");
      meta.textContent = book.meta;
      const detail = document.createElement("em");
      if (book.id === "gwgz" && !last) detail.textContent = "从《" + first.title + "》开始";
      else detail.textContent = book.detail;
      card.appendChild(strong);
      card.appendChild(meta);
      card.appendChild(detail);
      list.appendChild(card);
    });
    wrap.appendChild(list);
    main.replaceChildren(wrap);
    document.title = "典籍";
    syncChrome();
  }

  function showClassic(which) {
    loadToken += 1;
    closePopup();
    state.view = which;
    state.article = null;
    const data = which === "daode" ? state.daode : state.lunyu;
    const title = which === "daode" ? "道德经" : "论语";
    const wrap = document.createElement("article");
    wrap.className = "home";
    const h1 = document.createElement("h1");
    h1.textContent = title;
    const lead = document.createElement("p");
    lead.className = "lead";
    const articles = classicArticles(which);
    lead.textContent = data
      ? (data.lead || "") + " 已读 " + learnedIn(articles) + " / " + articles.length + "。"
      : "目录还没有载入。";
    wrap.appendChild(h1);
    wrap.appendChild(lead);
    appendCatalogTools(wrap, which);
    if (!data) {
      main.replaceChildren(wrap);
      document.title = title + " · 典籍";
      syncChrome();
      return;
    }
    data.volumes.forEach(function (vol) {
      const block = document.createElement("section");
      block.className = "era-block";
      const h2 = document.createElement("h2");
      h2.textContent = vol.title;
      block.appendChild(h2);
      const list = document.createElement("div");
      list.className = "piece-list";
      vol.articles.filter(function (art) {
        return gradeMatches(art.id) && famousMatches(art.id);
      }).forEach(function (art) {
        list.appendChild(pieceLink(art, false));
      });
      if (!list.childElementCount) {
        const empty = document.createElement("p");
        empty.className = "catalog-empty";
        empty.textContent = "这一卷没有符合筛选的篇目。";
        block.appendChild(empty);
      }
      block.appendChild(list);
      wrap.appendChild(block);
    });
    main.replaceChildren(wrap);
    document.title = title + " · 典籍";
    syncChrome();
  }

  function zztjPiece(art) {
    const a = document.createElement("a");
    a.className = "piece";
    a.href = "#/read/" + art.id;
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(art.index);
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = art.title;
    const date = document.createElement("small");
    date.textContent = art.date || "";
    a.appendChild(idx);
    a.appendChild(title);
    if (date.textContent) a.appendChild(date);
    if (state.progress.learned[art.id]) {
      const mark = document.createElement("span");
      mark.className = "done";
      mark.textContent = "已读";
      a.appendChild(mark);
    }
    return a;
  }

  function showZztj() {
    loadToken += 1;
    closePopup();
    state.view = "zztj";
    state.article = null;
    const data = state.zztj;
    const wrap = document.createElement("article");
    wrap.className = "home";
    const h1 = document.createElement("h1");
    h1.textContent = "资治通鉴";
    const articles = zztjArticles();
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = data
      ? "司马光。周纪、秦纪 " + articles.length + " 年，已读 " + learnedIn(articles) + "。汉纪以后待添加。"
      : "目录还没有载入。";
    wrap.appendChild(h1);
    wrap.appendChild(lead);
    appendCatalogTools(wrap, "zztj");
    if (state.gradeFilter || state.famousOnly) {
      appendGradeHits(wrap, articles, function (art) { return pieceLink(art, false); });
      main.replaceChildren(wrap);
      document.title = "资治通鉴 · 典籍";
      syncChrome();
      return;
    }
    if (!data) {
      main.replaceChildren(wrap);
      document.title = "资治通鉴 · 典籍";
      syncChrome();
      return;
    }
    [
      { era: "zhou", label: "周纪" },
      { era: "qin", label: "秦纪" },
    ].forEach(function (group) {
      const volumes = data.volumes.filter(function (vol) { return vol.era === group.era; });
      if (!volumes.length) return;
      const block = document.createElement("section");
      block.className = "era-block";
      const h2 = document.createElement("h2");
      h2.textContent = group.label;
      block.appendChild(h2);
      const list = document.createElement("div");
      list.className = "vol-rows";
      volumes.forEach(function (vol) {
        const a = document.createElement("a");
        a.className = "vol-row";
        a.href = "#/zztj/" + vol.volume;
        const strong = document.createElement("strong");
        strong.textContent = vol.title;
        const span = document.createElement("span");
        span.textContent = vol.articles[0].title + "起";
        const em = document.createElement("em");
        em.textContent = vol.articles.length + " 年";
        a.appendChild(strong);
        a.appendChild(span);
        a.appendChild(em);
        list.appendChild(a);
      });
      block.appendChild(list);
      wrap.appendChild(block);
    });
    const laterHead = document.createElement("h2");
    laterHead.className = "later-head";
    laterHead.textContent = "以后各纪";
    wrap.appendChild(laterHead);
    const chips = document.createElement("div");
    chips.className = "later-list";
    (data.later || []).forEach(function (era) {
      const chip = document.createElement("span");
      chip.className = "later-chip";
      const name = document.createElement("b");
      name.textContent = era.title;
      const note = document.createElement("span");
      note.textContent = era.note || "待添加";
      chip.appendChild(name);
      chip.appendChild(note);
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    main.replaceChildren(wrap);
    document.title = "资治通鉴 · 典籍";
    syncChrome();
  }

  function showZztjJuan(num) {
    loadToken += 1;
    closePopup();
    state.view = "zjuan";
    state.article = null;
    state.openVol = num;
    const vol = state.zztj && state.zztj.volumes.find(function (item) { return item.volume === num; });
    const wrap = document.createElement("article");
    wrap.className = "home";
    if (!vol) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "没有这一卷。";
      wrap.appendChild(p);
      main.replaceChildren(wrap);
      document.title = "资治通鉴 · 典籍";
      syncChrome();
      return;
    }
    const done = vol.articles.filter(function (art) { return state.progress.learned[art.id]; }).length;
    const h1 = document.createElement("h1");
    h1.textContent = vol.title;
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = vol.subtitle + " · " + vol.articles.length + " 年 · 已读 " + done;
    wrap.appendChild(h1);
    wrap.appendChild(lead);
    const list = document.createElement("div");
    list.className = "piece-list";
    vol.articles.forEach(function (art) { list.appendChild(zztjPiece(art)); });
    wrap.appendChild(list);
    main.replaceChildren(wrap);
    document.title = vol.title + " · 资治通鉴";
    syncChrome();
  }

  function renderZztjRail() {
    const vol = state.zztj && state.zztj.volumes.find(function (item) { return item.volume === state.openVol; });
    if (!vol) {
      shell.classList.remove("has-rail");
      catalogEl.replaceChildren();
      return;
    }
    shell.classList.add("has-rail");
    const root = document.createElement("div");
    const head = document.createElement("p");
    head.className = "rail-title";
    head.textContent = vol.title + " · " + vol.subtitle;
    root.appendChild(head);
    const list = document.createElement("ol");
    list.className = "vol-list";
    vol.articles.forEach(function (art) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#/read/" + art.id;
      if (state.article && state.article.id === art.id) a.className = "active";
      const idx = document.createElement("span");
      idx.className = "idx";
      idx.textContent = String(art.index);
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = art.title;
      a.appendChild(idx);
      a.appendChild(title);
      if (state.progress.learned[art.id]) {
        const mark = document.createElement("span");
        mark.className = "done";
        mark.textContent = "已读";
        a.appendChild(mark);
      }
      li.appendChild(a);
      list.appendChild(li);
    });
    root.appendChild(list);
    catalogEl.replaceChildren(root);
  }

  function showBook() {
    loadToken += 1;
    closePopup();
    state.view = "book";
    state.article = null;
    const total = state.catalog.articleCount;
    const n = learnedCount();
    const last = state.progress.last ? findArticleMeta(state.progress.last) : null;
    const first = state.catalog.volumes[0].articles[0];
    const wrap = document.createElement("article");
    wrap.className = "home";
    const h1 = document.createElement("h1");
    h1.textContent = "古文观止";
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = "十二卷，二百二十二篇。选一卷，再选篇目。已读 " + n + " / " + total + "。";
    wrap.appendChild(h1);
    wrap.appendChild(lead);

    const resume = document.createElement("a");
    resume.className = "resume";
    resume.href = "#/read/" + (last ? last.id : first.id);
    const copy = document.createElement("div");
    const rk = document.createElement("p");
    rk.className = "kicker";
    rk.textContent = last ? "继续这一本" : "从卷一开始";
    const rh = document.createElement("h2");
    rh.textContent = last ? last.title : first.title;
    copy.appendChild(rk);
    copy.appendChild(rh);
    const go = document.createElement("span");
    go.className = "go";
    go.textContent = last ? "继续" : "开始";
    resume.appendChild(copy);
    resume.appendChild(go);
    wrap.appendChild(resume);

    const input = document.createElement("input");
    input.className = "catalog-search";
    input.placeholder = "搜索篇名";
    input.value = state.query;
    input.setAttribute("aria-label", "搜索篇名");
    input.addEventListener("input", function () {
      state.query = input.value;
      showBook();
      const next = main.querySelector(".catalog-search");
      if (next) {
        next.focus();
        const len = next.value.length;
        next.setSelectionRange(len, len);
      }
    });
    wrap.appendChild(input);
    appendCatalogTools(wrap, "gwgz");
    if ((state.gradeFilter || state.famousOnly) && !state.query.trim()) {
      appendGradeHits(wrap, flatArticles(), function (art) {
        return pieceLink(art, true);
      });
      main.replaceChildren(wrap);
      document.title = "古文观止 · 典籍";
      syncChrome();
      return;
    }

    const q = state.query.trim();
    if (q) {
      const hits = flatArticles().filter(function (art) {
        return (art.title + (art.titleT || "") + art.author).indexOf(q) >= 0;
      });
      const box = document.createElement("div");
      box.className = "piece-list";
      if (!hits.length) {
        const empty = document.createElement("p");
        empty.className = "catalog-empty";
        empty.textContent = "没有匹配的篇目。";
        box.appendChild(empty);
      }
      hits.filter(function (art) { return gradeMatches(art.id) && famousMatches(art.id); }).slice(0, 40).forEach(function (art) {
        box.appendChild(pieceLink(art, true));
      });
      wrap.appendChild(box);
    } else {
      const label = document.createElement("p");
      label.className = "section-label";
      label.textContent = "十二卷";
      wrap.appendChild(label);
      const rows = document.createElement("div");
      rows.className = "vol-rows";
      state.catalog.volumes.forEach(function (vol) {
        const done = vol.articles.filter(function (art) { return state.progress.learned[art.id]; }).length;
        const a = document.createElement("a");
        a.className = "vol-row";
        a.href = "#/gwgz/" + vol.volume;
        const strong = document.createElement("strong");
        strong.textContent = vol.title;
        const sub = document.createElement("span");
        sub.textContent = vol.subtitle;
        const count = document.createElement("em");
        count.textContent = done + "/" + vol.articles.length;
        a.appendChild(strong);
        a.appendChild(sub);
        a.appendChild(count);
        rows.appendChild(a);
      });
      wrap.appendChild(rows);
    }
    main.replaceChildren(wrap);
    document.title = "古文观止 · 典籍";
    syncChrome();
  }

  function pieceLink(art, withVol) {
    const a = document.createElement("a");
    a.className = "piece";
    a.href = "#/read/" + art.id;
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(art.index);
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = art.title;
    a.appendChild(idx);
    a.appendChild(title);
    if (withVol) {
      const vol = state.catalog.volumes.find(function (item) { return item.volume === Number(art.id.slice(1, 3)); });
      const sub = document.createElement("small");
      sub.textContent = vol ? vol.title : "";
      a.appendChild(sub);
    }
    appendGradeTag(a, art.id);
    if (state.progress.learned[art.id]) {
      const mark = document.createElement("span");
      mark.className = "done";
      mark.textContent = "已读";
      a.appendChild(mark);
    }
    return a;
  }

  function showVolume(num) {
    loadToken += 1;
    closePopup();
    state.view = "volume";
    state.article = null;
    state.openVol = num;
    const vol = state.catalog.volumes.find(function (item) { return item.volume === num; });
    const wrap = document.createElement("article");
    wrap.className = "home";
    if (!vol) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "没有这一卷。";
      wrap.appendChild(p);
      main.replaceChildren(wrap);
      syncChrome();
      return;
    }
    const done = vol.articles.filter(function (art) { return state.progress.learned[art.id]; }).length;
    const next = vol.articles.find(function (art) { return !state.progress.learned[art.id]; });
    const h1 = document.createElement("h1");
    h1.textContent = vol.title + " · " + vol.subtitle;
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = vol.articles.length + " 篇 · 已读 " + done;
    wrap.appendChild(h1);
    wrap.appendChild(lead);
    const list = document.createElement("div");
    list.className = "piece-list";
    vol.articles.forEach(function (art) {
      const link = pieceLink(art, false);
      if (next && art.id === next.id) {
        link.classList.add("next-up");
        const badge = document.createElement("span");
        badge.className = "up";
        badge.textContent = "接着读";
        link.appendChild(badge);
      }
      list.appendChild(link);
    });
    wrap.appendChild(list);
    main.replaceChildren(wrap);
    document.title = vol.title + " · 古文观止";
    syncChrome();
  }

  function showRenjian() {
    loadToken += 1;
    closePopup();
    state.view = "renjian";
    state.article = null;
    const articles = renjianArticles();
    const wrap = document.createElement("article");
    wrap.className = "home";
    const h1 = document.createElement("h1");
    h1.textContent = "人间词话";
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = articles.length
      ? "王国维 · 六十四则。一九〇八年至一九〇九年刊于《国粹学报》。已读 " + learnedIn(articles) + " / " + articles.length + "。"
      : "目录还没有载入。";
    wrap.appendChild(h1);
    wrap.appendChild(lead);
    appendCatalogTools(wrap, "rjch");
    if (state.gradeFilter || state.famousOnly) {
      appendGradeHits(wrap, articles, function (art) { return pieceLink(art, false); });
      main.replaceChildren(wrap);
      document.title = "人间词话 · 典籍";
      syncChrome();
      return;
    }
    if (!articles.length) {
      main.replaceChildren(wrap);
      document.title = "人间词话 · 典籍";
      syncChrome();
      return;
    }
    const last = state.progress.last && isRenjianId(state.progress.last) ? findArticleMeta(state.progress.last) : null;
    const resume = document.createElement("a");
    resume.className = "resume";
    resume.href = "#/read/" + (last ? last.id : articles[0].id);
    const copy = document.createElement("div");
    const rk = document.createElement("p");
    rk.className = "kicker";
    rk.textContent = last ? "继续这一则" : "从第一则开始";
    const rh = document.createElement("h2");
    rh.textContent = last ? last.title : articles[0].title;
    copy.appendChild(rk);
    copy.appendChild(rh);
    const go = document.createElement("span");
    go.className = "go";
    go.textContent = last ? "继续" : "开始";
    resume.appendChild(copy);
    resume.appendChild(go);
    wrap.appendChild(resume);
    const input = document.createElement("input");
    input.className = "catalog-search";
    input.placeholder = "搜索则目";
    input.value = state.renjianQuery;
    input.setAttribute("aria-label", "搜索则目");
    input.addEventListener("input", function () {
      state.renjianQuery = input.value;
      showRenjian();
      const next = main.querySelector(".catalog-search");
      if (next) {
        next.focus();
        const len = next.value.length;
        next.setSelectionRange(len, len);
      }
    });
    wrap.appendChild(input);
    const q = state.renjianQuery.trim();
    const shown = q ? articles.filter(function (art) {
      return (art.title + (art.titleT || "")).indexOf(q) >= 0;
    }) : articles;
    const list = document.createElement("div");
    list.className = "piece-list";
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.className = "catalog-empty";
      empty.textContent = "没有匹配的则目。";
      list.appendChild(empty);
    }
    shown.forEach(function (art) { list.appendChild(pieceLink(art, false)); });
    wrap.appendChild(list);
    main.replaceChildren(wrap);
    document.title = "人间词话 · 典籍";
    syncChrome();
  }

  async function ensureCollection(kind, token) {
    if (state.collections[kind]) return token === loadToken;
    const meta = POETRY[kind];
    skeleton("正在打开" + meta.label);
    syncChrome();
    const data = await fetchJson(meta.file);
    if (token !== loadToken) return false;
    state.collections[kind] = data;
    return true;
  }

  function gradeOf(id) {
    const pieces = state.grades && state.grades.pieces;
    return pieces ? pieces[id] : null;
  }

  function gradeLabel(entry) {
    if (!entry) return "";
    const grade = entry.grade || "";
    const vol = entry.volume || "";
    if (/^[一二三四五六七八九]$/.test(grade)) return entry.stage + grade + "年级" + vol;
    if (grade) return entry.stage + grade + vol;
    return entry.stage;
  }

  function gradeMatches(id) {
    if (!state.gradeFilter) return true;
    const entry = gradeOf(id);
    if (!entry) return false;
    if (entry.stage === state.gradeFilter) return true;
    return (entry.also || []).some(function (item) { return item.stage === state.gradeFilter; });
  }

  function famousMatches(id) {
    if (!state.famousOnly) return true;
    return !!(state.famous && state.famous.pieces && state.famous.pieces[id]);
  }

  function appendGradeTag(parent, id) {
    const entry = gradeOf(id);
    if (!entry) return;
    const tag = document.createElement("span");
    tag.className = "grade-tag";
    tag.textContent = gradeLabel(entry);
    parent.appendChild(tag);
  }

  function appendGradeHits(wrap, articles, linkFor) {
    const hits = articles.filter(function (art) { return gradeMatches(art.id) && famousMatches(art.id); });
    const box = document.createElement("div");
    box.className = "piece-list";
    if (!hits.length) {
      const empty = document.createElement("p");
      empty.className = "catalog-empty";
      empty.textContent = state.famousOnly && !state.gradeFilter
        ? "没有标成名篇的篇目。"
        : "没有标上「" + (state.gradeFilter || "名篇") + "」的篇目。";
      box.appendChild(empty);
    }
    hits.forEach(function (art) { box.appendChild(linkFor(art)); });
    wrap.appendChild(box);
  }

  function appendCatalogTools(wrap, kind) {
    const bar = document.createElement("div");
    bar.className = "catalog-tools";
    if (kind === "tang" || kind === "ci" || kind === "ke") {
      const mode = document.createElement("div");
      mode.className = "tool-seg";
      [["work", "按作品"], ["author", "按作者"]].forEach(function (item) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = item[1];
        btn.classList.toggle("on", state.listMode === item[0]);
        btn.addEventListener("click", function () {
          state.listMode = item[0];
          renderCollection(kind);
        });
        mode.appendChild(btn);
      });
      bar.appendChild(mode);
    }
    const grades = document.createElement("div");
    grades.className = "grade-seg";
    [["", "全部"], ["小学", "小学"], ["初中", "初中"], ["高中", "高中"]].forEach(function (item) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item[1];
      btn.classList.toggle("on", state.gradeFilter === item[0]);
      btn.addEventListener("click", function () {
        state.gradeFilter = item[0];
        if (kind === "tang" || kind === "ci" || kind === "ke") renderCollection(kind);
        else if (kind === "gwgz") showBook();
        else if (kind === "zztj") showZztj();
        else if (kind === "rjch") showRenjian();
        else if (kind === "daode" || kind === "lunyu") showClassic(kind);
      });
      grades.appendChild(btn);
    });
    bar.appendChild(grades);
    const famousBtn = document.createElement("button");
    famousBtn.type = "button";
    famousBtn.className = "famous-toggle";
    famousBtn.textContent = "名篇";
    famousBtn.classList.toggle("on", !!state.famousOnly);
    famousBtn.addEventListener("click", function () {
      state.famousOnly = !state.famousOnly;
      if (kind === "tang" || kind === "ci" || kind === "ke") renderCollection(kind);
      else if (kind === "gwgz") showBook();
      else if (kind === "zztj") showZztj();
      else if (kind === "rjch") showRenjian();
      else if (kind === "daode" || kind === "lunyu") showClassic(kind);
    });
    bar.appendChild(famousBtn);
    wrap.appendChild(bar);
  }

  function renderAuthorIndex(list, kind, pieces) {
    const groups = [];
    const index = {};
    pieces.forEach(function (item) {
      const name = state.progress.font === "t" ? item.author.t : item.author.s;
      if (!index[name]) {
        index[name] = { name: name, key: item.author.s, items: [] };
        groups.push(index[name]);
      }
      index[name].items.push(item);
    });
    groups.forEach(function (group) {
      const link = document.createElement("a");
      link.className = "piece";
      link.href = "#/" + kind + "/author/" + encodeURIComponent(group.key);
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = group.name;
      const sub = document.createElement("small");
      sub.textContent = group.items.length + " " + (POETRY[kind].unit || "首");
      link.appendChild(title);
      link.appendChild(sub);
      list.appendChild(link);
    });
  }

  async function showCollection(kind) {
    const token = ++loadToken;
    closePopup();
    state.view = "collection";
    state.kind = kind;
    state.article = null;
    state.piece = null;
    if (!(await ensureCollection(kind, token))) return;
    renderCollection(kind);
  }

  function renderCollection(kind) {
    const data = state.collections[kind];
    const font = state.progress.font;
    const meta = POETRY[kind];
    const wrap = document.createElement("article");
    wrap.className = "home";
    const h1 = document.createElement("h1");
    h1.textContent = font === "t" ? data.title.t : data.title.s;
    const lead = document.createElement("p");
    lead.className = "lead";
    const unit = meta.unit || "首";
    lead.textContent = data.pieces.length + " " + unit + "。点开一篇，字上是今读，底下有译文和赏析。";
    wrap.appendChild(h1);
    wrap.appendChild(lead);
    const lastId = state.progress.collections && state.progress.collections[kind];
    const last = lastId ? data.pieces.find(function (item) { return item.id === lastId; }) : null;
    if (last) {
      const resume = document.createElement("a");
      resume.className = "resume";
      resume.href = "#/" + kind + "/" + last.id;
      const copy = document.createElement("div");
      const rk = document.createElement("p");
      rk.className = "kicker";
      rk.textContent = "继续读";
      const rh = document.createElement("h2");
      rh.textContent = font === "t" ? last.title.t : last.title.s;
      const rs = document.createElement("p");
      rs.textContent = meta.label + " · " + (font === "t" ? last.author.t : last.author.s);
      const go = document.createElement("span");
      go.className = "go";
      go.textContent = "继续";
      copy.appendChild(rk);
      copy.appendChild(rh);
      copy.appendChild(rs);
      resume.appendChild(copy);
      resume.appendChild(go);
      wrap.appendChild(resume);
    }
    appendCatalogTools(wrap, kind);
    const list = document.createElement("div");
    list.className = "piece-list";
    const visible = data.pieces.filter(function (item) { return gradeMatches(item.id) && famousMatches(item.id); });
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "catalog-empty";
      empty.textContent = state.famousOnly && !state.gradeFilter
        ? "没有标成名篇的篇目。"
        : "没有标上「" + (state.gradeFilter || "名篇") + "」的篇目。";
      wrap.appendChild(empty);
      main.replaceChildren(wrap);
      document.title = meta.label + " · 典籍";
      syncChrome();
      return;
    }
    if (state.listMode === "author") {
      renderAuthorIndex(list, kind, visible);
      wrap.appendChild(list);
      main.replaceChildren(wrap);
      document.title = meta.label + " · 典籍";
      syncChrome();
      return;
    }
    visible.forEach(function (item, index) {
      const link = document.createElement("a");
      link.className = "piece";
      link.href = "#/" + kind + "/" + item.id;
      const idx = document.createElement("span");
      idx.className = "idx";
      idx.textContent = String(index + 1);
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = font === "t" ? item.title.t : item.title.s;
      const sub = document.createElement("small");
      sub.textContent = font === "t" ? item.author.t : item.author.s;
      link.appendChild(idx);
      link.appendChild(title);
      link.appendChild(sub);
      appendGradeTag(link, item.id);
      list.appendChild(link);
    });
    wrap.appendChild(list);
    main.replaceChildren(wrap);
    document.title = meta.label + " · 典籍";
    syncChrome();
  }

  async function showAuthor(kind, name) {
    const token = ++loadToken;
    closePopup();
    state.view = "author";
    state.kind = kind;
    if (!(await ensureCollection(kind, token))) return;
    if (!(await ensureNotes(token))) return;
    const data = state.collections[kind];
    const pieces = data.pieces.filter(function (item) {
      return item.author.s === name || item.author.t === name;
    }).filter(function (item) { return gradeMatches(item.id) && famousMatches(item.id); });
    const wrap = document.createElement("article");
    wrap.className = "home";
    const font = state.progress.font;
    const h1 = document.createElement("h1");
    h1.textContent = pieces[0]
      ? (font === "t" ? pieces[0].author.t : pieces[0].author.s)
      : name;
    wrap.appendChild(h1);
    const author = authorRecord(name);
    if (author) {
      const sub = document.createElement("p");
      sub.className = "lead";
      sub.textContent = [bi(author.era), author.years, bi(author.card)].filter(Boolean).join(" · ");
      const bio = document.createElement("p");
      bio.textContent = bi(author.bio);
      wrap.appendChild(sub);
      wrap.appendChild(bio);
    } else {
      const bio = document.createElement("p");
      bio.className = "lead";
      bio.textContent = "生卒和仕履还没有核定。这里只列出本书收录的作品。";
      wrap.appendChild(bio);
    }
    const back = document.createElement("a");
    back.className = "resume";
    back.href = "#/" + kind;
    back.textContent = "回到目录";
    wrap.appendChild(back);
    const list = document.createElement("div");
    list.className = "piece-list";
    pieces.forEach(function (item) {
      const link = document.createElement("a");
      link.className = "piece";
      link.href = "#/" + kind + "/" + item.id;
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = font === "t" ? item.title.t : item.title.s;
      link.appendChild(title);
      appendGradeTag(link, item.id);
      list.appendChild(link);
    });
    wrap.appendChild(list);
    main.replaceChildren(wrap);
    document.title = name + " · 典籍";
    syncChrome();
  }

  function authorRecord(name) {
    const authors = state.notes && state.notes.authors;
    if (!authors) return null;
    if (authors[name]) return authors[name];
    const keys = Object.keys(authors);
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i] === name) return authors[keys[i]];
    }
    return null;
  }

  async function showPiece(kind, id) {
    const token = ++loadToken;
    closePopup();
    state.view = "piece";
    state.kind = kind;
    state.article = null;
    state.piece = null;
    if (!(await ensureCollection(kind, token))) return;
    if (!(await ensureNotes(token))) return;
    state.verseTab = "";
    const piece = state.collections[kind].pieces.find(function (item) { return item.id === id; });
    if (!piece) {
      state.view = "collection";
      main.innerHTML = "<p class='empty'>没有这一首。</p>";
      syncChrome();
      return;
    }
    state.piece = piece;
    state.progress.collections = state.progress.collections || {};
    state.progress.collections[kind] = id;
    saveProgress();
    renderPiece(false);
  }

  function pieceNeighbors(kind, id) {
    const list = (state.collections[kind] && state.collections[kind].pieces) || [];
    const i = list.findIndex(function (item) { return item.id === id; });
    return {
      prev: i > 0 ? list[i - 1] : null,
      next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
      index: i,
      total: list.length,
    };
  }

  function pieceTitle(item) {
    if (!item) return "";
    return state.progress.font === "t" ? item.title.t : item.title.s;
  }

  const VERSE_TABS = [
    ["vernacular", "译文"],
    ["notes", "注释"],
    ["analysis", "赏析"],
    ["background", "背景"],
    ["author", "作者"],
  ];
  const STANZA_LABELS = {
    s: ["上阕", "下阕"],
    t: ["上闋", "下闋"],
  };

  async function ensureNotes(token) {
    if (state.notes) return token === loadToken;
    const data = await fetchJson("data/poetry-notes.json");
    if (token !== loadToken) return false;
    state.notes = data;
    return true;
  }

  function bi(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    return state.progress.font === "t" ? (node.t || node.s || "") : (node.s || node.t || "");
  }

  function clauseRows(tokens) {
    const rows = [];
    let current = [];
    tokens.forEach(function (tok) {
      current.push(tok);
      if (tok.punct && "，。！？；".indexOf(tok.t) >= 0) {
        rows.push(current);
        current = [];
      }
    });
    if (current.length) rows.push(current);
    return rows;
  }

  function sentenceRows(tokens) {
    const rows = [];
    let current = [];
    tokens.forEach(function (tok) {
      current.push(tok);
      const shown = tok.s || tok.t || "";
      if (tok.punct && "。！？".indexOf(shown) >= 0) {
        rows.push(current);
        current = [];
      }
    });
    if (current.length) rows.push(current);
    return rows;
  }

  function addVerseLines(parent, tokens) {
    const rows = clauseRows(tokens);
    const nodes = rows.map(function (row) {
      const p = document.createElement("p");
      p.className = "orig verse-line" + (state.progress.pinyin ? " with-py" : "");
      const text = document.createElement("span");
      text.className = "verse-text";
      appendTokens(text, row);
      p.appendChild(text);
      parent.appendChild(p);
      return text;
    });
    if (state.piece) decorateFamous(nodes, state.piece.id, "");
  }

  function renderVerseBody(piece, kind, meta) {
    const body = document.createElement("div");
    if (piece.form === "prose") {
      body.className = "body prose";
      piece.lines.forEach(function (line) {
        const p = document.createElement("p");
        p.className = "orig para" + (state.progress.pinyin ? " with-py" : "");
        sentenceRows(line.tokens).forEach(function (row) {
          if (state.piece) appendMarked(p, row, state.piece.id, "");
          else appendTokens(p, row);
        });
        body.appendChild(p);
      });
      return body;
    }
    body.className = "body verse " + (piece.form === "ci" || kind === "ci" ? "ci" : "shi");
    const counts = kind === "ci" && meta && meta.stanzas && meta.stanzas.length > 1 ? meta.stanzas : null;
    if (!counts) {
      piece.lines.forEach(function (line) { addVerseLines(body, line.tokens); });
      return body;
    }
    const labels = STANZA_LABELS[state.progress.font === "t" ? "t" : "s"];
    let cursor = 0;
    counts.forEach(function (count, index) {
      const block = document.createElement("section");
      block.className = "stanza";
      const label = document.createElement("p");
      label.className = "stanza-label";
      label.textContent = labels[index] || "";
      block.appendChild(label);
      piece.lines.slice(cursor, cursor + count).forEach(function (line) {
        addVerseLines(block, line.tokens);
      });
      cursor += count;
      body.appendChild(block);
    });
    return body;
  }

  function placeFamousMarks(body) {
    if (!body) return;
    body.querySelectorAll(".verse-line").forEach(function (line) {
      const text = line.querySelector(".verse-text");
      const mark = line.querySelector(".famous-mark.at-end");
      if (!text || !mark) return;
      const lineBox = line.getBoundingClientRect();
      const anchor = mark._anchor || text;
      const anchorBox = anchor.getBoundingClientRect();
      const zi = text.querySelector(".zi");
      const ziBox = zi ? zi.getBoundingClientRect() : text.getBoundingClientRect();
      if (!ziBox.height || !lineBox.width) return;
      const cs = zi ? getComputedStyle(zi) : null;
      const padTop = cs ? (parseFloat(cs.paddingTop) || 0) : 0;
      const padBot = cs ? (parseFloat(cs.paddingBottom) || 0) : 0;
      const glyphTop = ziBox.top + padTop;
      const glyphH = Math.max(12, ziBox.height - padTop - padBot);
      let left = anchorBox.right - lineBox.left + 2;
      const maxLeft = Math.max(0, line.clientWidth - 44);
      if (left > maxLeft) left = maxLeft;
      mark.style.left = left + "px";
      mark.style.top = (glyphTop - lineBox.top + (glyphH - 44) / 2) + "px";
    });
  }

  function fitVerse(body) {
    if (!body) return;
    const lines = body.querySelectorAll(".verse-line");
    if (!lines.length) return;
    body.style.fontSize = "";
    const limit = body.clientWidth;
    const side = body.querySelector(".famous-mark") ? 48 : 0;
    let widest = 0;
    lines.forEach(function (line) {
      const text = line.querySelector(".verse-text") || line;
      widest = Math.max(widest, text.scrollWidth);
    });
    const room = Math.max(1, limit - side * 2);
    if (widest > room + 1) {
      const current = parseFloat(getComputedStyle(body).fontSize);
      body.style.fontSize = Math.max(14, current * room / widest) + "px";
    }
    placeFamousMarks(body);
  }

  function sentenceMode() {
    return !!state.progress.sentence;
  }

  function syncReadTools(mode) {
    const bar = document.getElementById("read-tools");
    if (!bar) return;
    const show = mode === "article" || mode === "piece";
    bar.hidden = !show;
    bar.classList.toggle("for-article", mode === "article");
    bar.classList.toggle("for-piece", mode === "piece");
    document.querySelector(".top").classList.toggle("has-tools", show);
    if (!show) return;
    const py = document.getElementById("tool-py");
    py.classList.toggle("on", !!state.progress.pinyin);
    py.setAttribute("aria-pressed", state.progress.pinyin ? "true" : "false");
    const fontBtn = document.getElementById("tool-font");
    const trad = state.progress.font === "t";
    fontBtn.classList.toggle("on", trad);
    fontBtn.setAttribute("aria-pressed", trad ? "true" : "false");
    bar.querySelectorAll(".tool-seg button").forEach(function (btn) {
      const on = (btn.dataset.mode === "sentence") === sentenceMode();
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function appendSentenceGloss(pair, translation) {
    if (translation) {
      const vern = document.createElement("p");
      vern.className = "vern";
      const lab = document.createElement("i");
      lab.textContent = "译文";
      vern.appendChild(lab);
      vern.appendChild(document.createTextNode(translation));
      pair.appendChild(vern);
      return;
    }
    const missing = document.createElement("p");
    missing.className = "pair-missing";
    missing.textContent = "这一句还没有译文。";
    pair.appendChild(missing);
  }

  function pieceMeta() {
    const notes = state.notes && state.notes.pieces;
    return notes ? notes[state.piece.id] : null;
  }

  function fillVersePanel(panel, tab) {
    panel.replaceChildren();
    const meta = pieceMeta();
    const author = meta && state.notes.authors[meta.author];
    if (!meta) {
      panel.textContent = "这一首的注释还没有写好。";
      return;
    }
    if (tab === "vernacular") {
      meta.vernacular.forEach(function (line) {
        const p = document.createElement("p");
        p.className = "sheet-line";
        p.textContent = bi(line);
        panel.appendChild(p);
      });
      return;
    }
    if (tab === "notes") {
      const list = document.createElement("ul");
      list.className = "sheet-notes";
      meta.notes.forEach(function (item) {
        const li = document.createElement("li");
        const term = document.createElement("b");
        term.textContent = bi(item.term);
        li.appendChild(term);
        li.appendChild(document.createTextNode(bi(item.gloss)));
        list.appendChild(li);
      });
      panel.appendChild(list);
      return;
    }
    if (tab === "author" && author) {
      const h = document.createElement("h2");
      h.textContent = state.progress.font === "t" ? state.piece.author.t : state.piece.author.s;
      const sub = document.createElement("p");
      sub.className = "sheet-sub";
      sub.textContent = [bi(author.era), author.years, bi(author.card)].filter(Boolean).join(" · ");
      const bio = document.createElement("p");
      bio.textContent = bi(author.bio);
      panel.appendChild(h);
      panel.appendChild(sub);
      panel.appendChild(bio);
      appendProvenance(panel, state.piece.id);
      return;
    }
    const p = document.createElement("p");
    p.textContent = bi(tab === "analysis" ? meta.analysis : meta.background);
    panel.appendChild(p);
    if (meta.review) {
      const flag = document.createElement("p");
      flag.className = "reading-flag";
      flag.textContent = "这一首里有拿不准的字句，已标待复核。";
      panel.appendChild(flag);
    }
    if (tab === "background") {
      const credit = document.createElement("p");
      credit.className = "sheet-credit";
      credit.textContent = bi(state.notes.credit);
      panel.appendChild(credit);
      appendProvenance(panel, state.piece.id);
    }
  }

  function refreshReading() {
    if (state.view === "article") renderArticle(true);
    else renderPiece(true);
  }

  function readingTabs() {
    if (state.view !== "article") return VERSE_TABS;
    return VERSE_TABS.filter(function (item) { return item[0] !== "vernacular"; });
  }

  function appendReadingBar(wrap) {
    const bar = document.createElement("nav");
    bar.className = "verse-bar";
    bar.setAttribute("aria-label", "注释和赏析");
    readingTabs().forEach(function (item) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item[1];
      btn.classList.toggle("on", state.verseTab === item[0]);
      btn.addEventListener("click", function () {
        state.verseTab = state.verseTab === item[0] ? "" : item[0];
        refreshReading();
      });
      bar.appendChild(btn);
    });
    wrap.appendChild(bar);
    const panel = document.createElement("section");
    panel.className = "verse-panel";
    panel.hidden = !state.verseTab;
    if (state.verseTab) {
      if (state.view === "article") fillArticlePanel(panel, state.verseTab);
      else fillVersePanel(panel, state.verseTab);
    }
    wrap.appendChild(panel);
  }

  function sheetP(text) {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  function appendSourceLine(parent, id) {
    const src = state.provenance && state.provenance.pieces && state.provenance.pieces[id];
    if (!src || !src.edition) return;
    const p = document.createElement("p");
    p.className = "source-line";
    p.appendChild(document.createTextNode("出处 "));
    if (src.url) {
      const a = document.createElement("a");
      a.href = src.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = src.edition;
      p.appendChild(a);
    } else {
      p.appendChild(document.createTextNode(src.edition));
    }
    parent.appendChild(p);
  }

  function appendProvenance(panel, id) {
    const src = state.provenance && state.provenance.pieces && state.provenance.pieces[id];
    if (!src) return;
    const p = document.createElement("p");
    p.className = "sheet-credit";
    const b = document.createElement("b");
    b.textContent = "出处 ";
    p.appendChild(b);
    if (src.url) {
      const a = document.createElement("a");
      a.href = src.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = src.edition;
      p.appendChild(a);
    } else {
      p.appendChild(document.createTextNode(src.edition));
    }
    if (src.note) p.appendChild(document.createTextNode(" " + src.note));
    panel.appendChild(p);
    const tr = src.translation;
    if (!tr) return;
    const q = document.createElement("p");
    q.className = "sheet-credit";
    const label = document.createElement("b");
    label.textContent = "译文参考 ";
    q.appendChild(label);
    q.appendChild(document.createTextNode(tr.edition + (tr.status ? "。" + tr.status + "。" : "")));
    panel.appendChild(q);
  }

  function readingNote(ch) {
    const chars = state.readingPolicy && state.readingPolicy.chars;
    return chars ? chars[ch] : null;
  }

  function glossCredit(kind, word) {
    const pieces = state.glossSources && state.glossSources.pieces;
    const art = state.article;
    if (!pieces || !art) return null;
    const piece = pieces[art.id];
    return piece ? piece[kind + "|" + word] : null;
  }

  function appendGlossCredit(parent, kind, word) {
    const src = glossCredit(kind, word);
    if (!src) return;
    const p = document.createElement("p");
    p.className = "gloss-source";
    p.appendChild(document.createTextNode("出处 "));
    if (src.url) {
      const a = document.createElement("a");
      a.href = src.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = src.source;
      p.appendChild(a);
    } else {
      p.appendChild(document.createTextNode(src.source));
    }
    parent.appendChild(p);
  }

  function sheetH(text) {
    const h = document.createElement("h3");
    h.textContent = text;
    return h;
  }

  function addSheetNotes(panel, title, items) {
    if (!items || !items.length) return false;
    panel.appendChild(sheetH(title));
    const list = document.createElement("ul");
    list.className = "sheet-notes";
    items.forEach(function (item) {
      const li = document.createElement("li");
      const term = document.createElement("b");
      term.textContent = item.term;
      li.appendChild(term);
      li.appendChild(document.createTextNode(item.gloss));
      if (item.kind && item.word) appendGlossCredit(li, item.kind, item.word);
      list.appendChild(li);
    });
    panel.appendChild(list);
    return true;
  }

  function proseAuthor(art) {
    const known = state.proseAuthors && state.proseAuthors[art.author];
    return {
      name: known && known.name ? bi(known.name) : art.author,
      years: known && known.years ? known.years : "",
      card: known ? bi(known.card) : "",
      bio: known ? bi(known.bio) : "",
    };
  }

  function fillArticlePanel(panel, tab) {
    panel.replaceChildren();
    const art = state.article;
    const font = state.progress.font;
    const book = font === "t" ? art.book.t : art.book.s;
    const head = font === "t" ? art.sourceHead.t : art.sourceHead.s;
    const info = proseAuthor(art);
    const lesson = art.lesson;
    if (tab === "vernacular") {
      let any = false;
      art.paragraphs.forEach(function (para) {
        const text = para.sentences.map(function (sent) { return sent.tr || ""; }).join("");
        if (!text) return;
        any = true;
        panel.appendChild(sheetP(text));
      });
      if (!any) panel.appendChild(sheetP("这一篇还没有逐句白话。可以先读原文，点开字看《说文》。"));
      return;
    }
    if (tab === "notes") {
      let any = false;
      if (lesson) {
        any = addSheetNotes(panel, "实词", (lesson.keyContentWords || []).map(function (item) {
          return { term: item.word, gloss: (item.reading ? item.reading + "　" : "") + item.note, kind: "实词", word: item.word };
        })) || any;
        any = addSheetNotes(panel, "虚词", (lesson.keyFunctionWords || []).map(function (item) {
          return { term: item.word, gloss: (item.reading ? item.reading + "　" : "") + item.note, kind: "虚词", word: item.word };
        })) || any;
        any = addSheetNotes(panel, "古今异义", (lesson.ancientModern || []).map(function (item) {
          return { term: item.word, gloss: item.note, kind: "古今异义", word: item.word };
        })) || any;
        any = addSheetNotes(panel, "通假", (lesson.phoneticLoans || []).map(function (item) {
          const term = item.loan ? item.word + " / " + item.loan : item.word;
          const gloss = (item.reading ? item.reading + "　" : "") + item.note;
          return { term: term, gloss: gloss, kind: "通假", word: item.word };
        })) || any;
        any = addSheetNotes(panel, "活用", (lesson.flexibleUsage || []).map(function (item) {
          return { term: item.word, gloss: item.note, kind: "活用", word: item.word };
        })) || any;
        any = addSheetNotes(panel, "句式", (lesson.specialSyntax || []).map(function (item) {
          return { term: item.name, gloss: item.note, kind: "句式", word: item.name };
        })) || any;
      }
      if (!any) panel.appendChild(sheetP("这一篇还没有逐句注释。点开字，看《说文》本义，不等于已经核定的句中义。"));
      return;
    }
    if (tab === "author") {
      const h = document.createElement("h2");
      h.textContent = info.name;
      const sub = document.createElement("p");
      sub.className = "sheet-sub";
      sub.textContent = [info.years, book, head].filter(Boolean).join(" · ");
      panel.appendChild(h);
      if (sub.textContent) panel.appendChild(sub);
      panel.appendChild(sheetP(info.bio || ("选本题「" + art.author + "」。")));
      appendProvenance(panel, art.id);
      return;
    }
    if (tab === "background") {
      if (lesson && lesson.background) panel.appendChild(sheetP(lesson.background));
      else panel.appendChild(sheetP("本篇选自《" + book + "》·" + head + "。《古文观止》题" + info.name + "。"));
      appendProvenance(panel, art.id);
      return;
    }
    if (lesson && lesson.theme) panel.appendChild(sheetP(lesson.theme));
    if (lesson && lesson.technique) panel.appendChild(sheetP(lesson.technique));
    const comment = bi(art.classicComment);
    if (comment) {
      panel.appendChild(sheetH("选本评点"));
      panel.appendChild(sheetP(comment));
    }
    const credit = document.createElement("p");
    credit.className = "sheet-credit";
    if (isZztjId(art.id)) {
      credit.textContent = "白话、注释和赏析是本书编写的。正文用司马光《资治通鉴》周纪、秦纪（卷一至卷八）。标明增补或移入的段落没有收。";
    } else if (isRenjianId(art.id)) {
      credit.textContent = "白话、注释和赏析是本书编写的。正文用王国维《人间词话》一九〇八年至一九〇九年《国粹学报》已刊六十四则。";
    } else if (isDaodeId(art.id)) {
      credit.textContent = "白话和逐字注是本书编写的。正文用王弼注所依的华亭张氏本，简体按通行归并。校释参考中华书局楼宇烈《老子道德经注校释》和陈鼓应《老子注译及评介》，没有逐句抄录。";
    } else if (isLunyuId(art.id)) {
      credit.textContent = "白话和逐字注是本书编写的。正文用维基文库《论语》主文。译注参考中华书局杨伯峻《论语译注》，没有逐句抄录。";
    } else {
      credit.textContent = lesson
        ? "主旨、手法和白话是本书编写的。选本评点是《古文观止》所附的旧评，不是现代赏析网站的原文。"
        : "选本评点是《古文观止》所附的旧评，不是现代赏析网站的原文。";
    }
    panel.appendChild(credit);
  }

  function renderPiece(keepScroll) {
    const y = keepScroll ? window.scrollY : 0;
    const piece = state.piece;
    const kind = state.kind;
    const data = state.collections[kind];
    const font = state.progress.font;
    const nav = pieceNeighbors(kind, piece.id);
    const title = pieceTitle(piece);
    const meta = pieceMeta();
    const wrap = document.createElement("article");
    const prose = piece.form === "prose";
    wrap.className = "reader " + (prose ? "prose-reader" : (kind === "tang" || piece.form === "shi" ? "shi-reader" : "ci-reader"));
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = (font === "t" ? data.title.t : data.title.s) + " · " + (nav.index + 1) + " / " + nav.total;
    const h1 = document.createElement("h1");
    h1.textContent = title;
    wrap.appendChild(kicker);
    wrap.appendChild(h1);
    if (meta && state.notes.authors[meta.author]) {
      const author = state.notes.authors[meta.author];
      const card = document.createElement("button");
      card.type = "button";
      card.className = "author-card";
      const name = document.createElement("strong");
      name.textContent = font === "t" ? piece.author.t : piece.author.s;
      const sub = document.createElement("span");
      sub.textContent = [bi(author.era), author.years, bi(meta.form)].filter(Boolean).join(" · ");
      const blurb = document.createElement("em");
      blurb.textContent = bi(author.card);
      card.appendChild(name);
      card.appendChild(sub);
      card.appendChild(blurb);
      card.addEventListener("click", function () {
        state.verseTab = state.verseTab === "author" ? "" : "author";
        refreshReading();
      });
      wrap.appendChild(card);
    }
    const body = renderVerseBody(piece, kind, meta);
    wrap.appendChild(body);
    const foot = document.createElement("div");
    foot.className = "reader-foot";
    const turn = document.createElement("p");
    turn.className = "verse-turn";
    const step = prose ? "篇" : "首";
    turn.appendChild(pieceTurn(kind, nav.prev, "上一" + step));
    turn.appendChild(pieceTurn(kind, nav.next, "下一" + step));
    foot.appendChild(turn);
    const hint = document.createElement("p");
    hint.className = "py-hint";
    hint.textContent = "点一个字，看《说文》。左右滑动可以换一首。";
    foot.appendChild(hint);
    wrap.appendChild(foot);
    appendReadingBar(wrap);
    const pager = document.createElement("nav");
    pager.className = "pager";
    pager.appendChild(piecePager(kind, nav.prev, "上一" + step));
    pager.appendChild(piecePager(kind, nav.next, "下一" + step));
    wrap.appendChild(pager);
    main.replaceChildren(wrap);
    fitVerse(body);
    if (document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(function () {
        if (body.isConnected) fitVerse(body);
      });
    }
    document.title = title + " · 典籍";
    syncChrome();
    window.scrollTo(0, y);
  }

  function pieceTurn(kind, item, label) {
    const a = document.createElement("a");
    a.textContent = item ? label : "";
    if (!item) {
      a.className = "off";
      a.textContent = label;
      return a;
    }
    a.href = "#/" + kind + "/" + item.id;
    return a;
  }

  function piecePager(kind, item, label) {
    const a = document.createElement("a");
    const small = document.createElement("small");
    small.textContent = label;
    a.appendChild(small);
    if (!item) {
      a.href = "#/" + kind;
      a.appendChild(document.createTextNode("返回目录"));
      return a;
    }
    a.href = "#/" + kind + "/" + item.id;
    a.appendChild(document.createTextNode(pieceTitle(item)));
    return a;
  }


  async function showArticle(id) {
    const token = ++loadToken;
    closePopup();
    state.view = "article";
    state.verseTab = "";
    state.article = null;
    state.openVol = Number(id.slice(1, 3));
    skeleton("正在打开篇目");
    syncChrome();
    const article = await fetchJson("data/articles/" + id + ".json");
    if (token !== loadToken) return;
    state.article = article;
    state.progress.last = id;
    state.openVol = state.article.volume;
    saveProgress();
    renderArticle();
  }

  function fontOf(tok) {
    if (tok.punct) return tok.t;
    return state.progress.font === "t" ? tok.t : tok.s;
  }

  function renderArticle(keepScroll) {
    const y = keepScroll ? window.scrollY : 0;
    const art = state.article;
    const font = state.progress.font;
    const title = font === "t" ? art.title.t : art.title.s;
    const book = font === "t" ? art.book.t : art.book.s;
    const head = font === "t" ? art.sourceHead.t : art.sourceHead.s;
    const info = proseAuthor(art);
    const list = articleList(art.id);
    const pos = list.findIndex(function (item) { return item.id === art.id; });
    const nav = neighbors(art.id);
    const wrap = document.createElement("article");
    wrap.className = "reader prose-reader";
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = art.volumeTitle + " · " + art.volumeSubtitle + " · " + (pos + 1) + " / " + list.length;
    const h1 = document.createElement("h1");
    h1.textContent = title;
    wrap.appendChild(kicker);
    wrap.appendChild(h1);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "author-card";
    const name = document.createElement("strong");
    name.textContent = info.name;
    const sub = document.createElement("span");
    sub.textContent = [book, head, info.years].filter(Boolean).join(" · ");
    card.appendChild(name);
    if (sub.textContent) card.appendChild(sub);
    if (info.card) {
      const blurb = document.createElement("em");
      blurb.textContent = info.card;
      card.appendChild(blurb);
    }
    card.addEventListener("click", function () {
      state.verseTab = state.verseTab === "author" ? "" : "author";
      refreshReading();
    });
    wrap.appendChild(card);
    appendSourceLine(wrap, art.id);
    wrap.appendChild(renderProseBody(art));
    wrap.appendChild(readerFoot(art, font, nav));
    appendReadingBar(wrap);
    const pager = document.createElement("nav");
    pager.className = "pager";
    pager.appendChild(pagerLink(nav.prev, "上一篇"));
    pager.appendChild(pagerLink(nav.next, "下一篇"));
    wrap.appendChild(pager);
    main.replaceChildren(wrap);
    document.title = title + " · 典籍";
    syncChrome();
    window.scrollTo(0, y);
    scheduleBalance();
  }

  function textLink(label, fn) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "text-link";
    btn.textContent = label;
    btn.addEventListener("click", fn);
    return btn;
  }

  function readerFoot(art, font, nav) {
    const foot = document.createElement("div");
    foot.className = "reader-foot";
    const learned = !!state.progress.learned[art.id];
    const mark = document.createElement("button");
    mark.type = "button";
    mark.className = "mark" + (learned ? " done" : "");
    mark.textContent = learned ? "已读完" : "这篇读完了";
    mark.addEventListener("click", function () {
      if (state.progress.learned[art.id]) delete state.progress.learned[art.id];
      else state.progress.learned[art.id] = Date.now();
      saveProgress();
      renderArticle(true);
    });
    foot.appendChild(mark);
    const prefs = document.createElement("div");
    prefs.className = "foot-links";
    prefs.appendChild(textLink(font === "t" ? "看简体" : "看繁体", function () {
      state.progress.font = font === "t" ? "s" : "t";
      saveProgress();
      renderArticle(true);
    }));
    foot.appendChild(prefs);
    const turn = document.createElement("p");
    turn.className = "verse-turn";
    turn.appendChild(articleTurn(nav.prev, "上一篇"));
    turn.appendChild(articleTurn(nav.next, "下一篇"));
    foot.appendChild(turn);
    const note = document.createElement("p");
    note.className = "py-hint";
    note.textContent = "点一个字，看《说文》。左右滑动换一篇。";
    foot.appendChild(note);
    return foot;
  }

  function articleTurn(meta, label) {
    const a = document.createElement("a");
    a.textContent = label;
    if (!meta) {
      a.className = "off";
      return a;
    }
    a.href = "#/read/" + meta.id;
    return a;
  }

  function renderProseBody(art) {
    const body = document.createElement("div");
    const hasTr = art.paragraphs.some(function (para) {
      return para.sentences.some(function (sent) { return !!(sent.tr || "").trim(); });
    });
    if (!sentenceMode()) {
      body.className = "body prose";
      art.paragraphs.forEach(function (para) {
        const p = document.createElement("p");
        p.className = "orig para" + (state.progress.pinyin ? " with-py" : "");
        para.sentences.forEach(function (sent) {
          appendMarked(p, sent.tokens, art.id, (sent.tr || "").trim());
        });
        body.appendChild(p);
      });
      return body;
    }
    body.className = "body prose sentence";
    if (!hasTr) {
      const banner = document.createElement("p");
      banner.className = "pair-missing";
      banner.textContent = "这一篇还没有逐句译文。下面按句断开，点开字看《说文》。注释在底部。";
      body.appendChild(banner);
    }
    art.paragraphs.forEach(function (para) {
      para.sentences.forEach(function (sent, index) {
        const pair = document.createElement("div");
        pair.className = "pair" + (index === para.sentences.length - 1 ? " para-end" : "");
        const orig = document.createElement("p");
        orig.className = "orig" + (state.progress.pinyin ? " with-py" : "");
        appendMarked(orig, sent.tokens, art.id, (sent.tr || "").trim());
        if (sent.grade) {
          const tag = document.createElement("span");
          tag.className = "sent-grade";
          tag.textContent = sent.grade;
          orig.appendChild(tag);
        }
        pair.appendChild(orig);
        if (hasTr) appendSentenceGloss(pair, (sent.tr || "").trim());
        body.appendChild(pair);
      });
    });
    return body;
  }

  function renderBody(art, mode) {
    const body = document.createElement("div");
    body.className = "body";
    art.paragraphs.forEach(function (para) {
      if (mode === "parallel") {
        para.sentences.forEach(function (sent) {
          const pair = document.createElement("div");
          pair.className = "pair";
          const orig = document.createElement("p");
          orig.className = "orig" + (state.progress.pinyin ? " with-py" : "");
          appendTokens(orig, sent.tokens);
          pair.appendChild(orig);
          if (sent.tr) {
            const vern = document.createElement("p");
            vern.className = "vern";
            vern.textContent = sent.tr;
            pair.appendChild(vern);
          }
          body.appendChild(pair);
        });
      } else {
        const p = document.createElement("p");
        p.className = "orig para" + (state.progress.pinyin ? " with-py" : "");
        para.sentences.forEach(function (sent) {
          appendTokens(p, sent.tokens);
        });
        body.appendChild(p);
      }
    });
    return body;
  }

  const NO_LINE_START = "，。！？；、：」』）】》〉〕〗､”’";
  const NO_LINE_END = "「『（【《〈〔〖“‘";
  const PUNCT_OPEN = "「『（【《〈〔〖“‘";
  const PUNCT_CLOSE = "」』）】》〉〕〗”’";
  const PUNCT_STOP = "。！？";
  const PUNCT_PAUSE = "，、；：､";

  function classifyPunct(span, text) {
    Array.from(text).forEach(function (ch) {
      if (PUNCT_OPEN.indexOf(ch) >= 0) span.classList.add("punct-open");
      else if (PUNCT_CLOSE.indexOf(ch) >= 0) span.classList.add("punct-close");
      else if (PUNCT_STOP.indexOf(ch) >= 0) span.classList.add("punct-stop");
      else if (PUNCT_PAUSE.indexOf(ch) >= 0) span.classList.add("punct-pause");
    });
  }

  function rubyUnits(orig) {
    const units = [];
    Array.from(orig.children).forEach(function (child) {
      if (!child.classList) return;
      if (child.classList.contains("keep") || child.classList.contains("punct")) {
        units.push(child);
        return;
      }
      if (child.classList.contains("word")) {
        Array.from(child.children).forEach(function (el) {
          if (!el.classList) return;
          if (el.classList.contains("zi") || el.classList.contains("keep") || el.classList.contains("punct")) units.push(el);
        });
      }
    });
    return units;
  }

  function hanziOf(el) {
    if (!el || !el.classList) return 0;
    if (el.classList.contains("zi")) return 1;
    return el.querySelectorAll(".zi").length;
  }

  function hanziSpan(units, start, end) {
    let n = 0;
    for (let i = start; i <= end; i++) n += hanziOf(units[i]);
    return n;
  }

  function lineGroups(units) {
    const lines = [];
    let current = null;
    let bottom = null;
    units.forEach(function (el, index) {
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const y = rect.bottom;
      if (bottom === null || y > bottom + 10) {
        current = [];
        lines.push(current);
        bottom = y;
      } else if (y > bottom) {
        bottom = y;
      }
      current.push(index);
    });
    return lines;
  }

  function shiftOrphan(orig) {
    const units = rubyUnits(orig);
    if (units.length < 4) return false;
    const lines = lineGroups(units);
    if (lines.length < 2) return false;
    const last = lines[lines.length - 1];
    const prev = lines[lines.length - 2];
    const lastHan = hanziSpan(units, last[0], last[last.length - 1]);
    const prevHan = hanziSpan(units, prev[0], prev[prev.length - 1]);
    if (lastHan >= 3 || prevHan < 4) return false;
    const total = prevHan + lastHan;
    let desired = Math.max(3, Math.round(total / 2));
    if (total - desired < 3) desired = total - 3;
    if (desired < 3) return false;
    const need = desired - lastHan;
    if (need < 1) return false;
    let breakAt = last[0];
    let pulled = 0;
    while (breakAt > prev[0] && pulled < need) {
      breakAt -= 1;
      pulled += hanziOf(units[breakAt]);
    }
    if (pulled < 1) return false;
    while (breakAt < last[0] && hanziOf(units[breakAt]) === 0) breakAt += 1;
    if (hanziSpan(units, prev[0], breakAt - 1) < 3) return false;
    const br = document.createElement("br");
    br.className = "balance";
    units[breakAt].before(br);
    return true;
  }

  function balanceOrig(orig) {
    orig.querySelectorAll("br.balance").forEach(function (br) { br.remove(); });
    let guard = 0;
    while (guard < 4 && shiftOrphan(orig)) guard += 1;
  }

  function balanceProse(root) {
    if (!root) return;
    root.querySelectorAll(".body.prose .orig").forEach(balanceOrig);
  }

  let balanceToken = 0;
  function scheduleBalance() {
    const token = ++balanceToken;
    const run = function () {
      if (token !== balanceToken) return;
      if (state.view !== "article") return;
      balanceProse(main);
    };
    const kick = function () { requestAnimationFrame(run); };
    if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(kick);
    else kick();
  }

  function takeEdgeChar(word, edge) {
    if (!word || !word.classList || !word.classList.contains("word")) return null;
    const zi = edge === "last" ? word.lastElementChild : word.firstElementChild;
    if (!zi) return null;
    return zi;
  }

  function bindKinsoku(parent) {
    const puncts = Array.from(parent.querySelectorAll(":scope > .punct"));
    puncts.forEach(function (el) {
      const text = el.textContent || "";
      const chars = Array.from(text);
      const glueLeft = chars.some(function (ch) { return NO_LINE_START.indexOf(ch) >= 0; });
      const glueRight = chars.some(function (ch) { return NO_LINE_END.indexOf(ch) >= 0; });
      if (!glueLeft && !glueRight) return;
      const prev = el.previousElementSibling;
      const next = el.nextElementSibling;
      const left = glueLeft ? takeEdgeChar(prev, "last") : null;
      const right = glueRight ? takeEdgeChar(next, "first") : null;
      if (!left && !right) return;
      const keep = document.createElement("span");
      keep.className = "keep";
      if (left) {
        left.replaceWith(keep);
        keep.appendChild(left);
        if (prev && prev.classList.contains("word") && !prev.childElementCount) prev.remove();
      } else {
        el.replaceWith(keep);
      }
      if (!keep.contains(el)) keep.appendChild(el);
      if (right) {
        keep.appendChild(right);
        if (next && next.classList.contains("word") && !next.childElementCount) next.remove();
      }
    });
  }

  function appendTokens(parent, tokens) {
    tokens.forEach(function (tok) {
      if (tok.punct) {
        const span = document.createElement("span");
        span.className = "punct";
        const text = state.progress.font === "t" ? tok.t : (tok.s || tok.t);
        span.textContent = text;
        classifyPunct(span, text);
        parent.appendChild(span);
        return;
      }
      const word = document.createElement("span");
      word.className = "word";
      const chars = Array.from(tok.t);
      const shown = Array.from(fontOf(tok));
      const glyphs = shown.length ? shown : chars;
      const reading = readingOf(tok);
      const aligned = glyphs.length === chars.length && reading.parts.length === chars.length;
      glyphs.forEach(function (glyph, index) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "zi";
        const simpChars = Array.from(tok.s || tok.t || "");
        btn.dataset.han = simpChars[index] || glyph;
        const syllable = aligned ? reading.parts[index] : "";
        if (state.progress.pinyin && syllable) {
          const ruby = document.createElement("i");
          ruby.className = "py-ruby";
          ruby.textContent = syllable;
          btn.appendChild(ruby);
        }
        btn.appendChild(document.createTextNode(glyph));
        btn.addEventListener("click", function () {
          if (Date.now() - lastSwipeAt < 450) return;
          openPopup(tok, aligned ? index : Math.min(index, chars.length - 1), btn);
        });
        word.appendChild(btn);
      });
      parent.appendChild(word);
    });
    bindKinsoku(parent);
  }

  function renderLesson(art) {
    const box = document.createElement("div");
    box.className = "lesson";
    if (!art.lesson) {
      const p = document.createElement("p");
      p.className = "banner";
      p.textContent = art.annotated
        ? "译文在每一句下面。点开字，看它在这一句里的意思。"
        : "本篇的系统讲解还没有写入。下面是原文，点开每个字可看《说文》本义。";
      box.appendChild(p);
      return box;
    }
    const lesson = art.lesson;
    addProse(box, "作者与背景", lesson.background);
    addGloss(box, "重点实词", lesson.keyContentWords, function (item) {
      return { term: item.word, reading: item.reading, note: item.note, kind: "实词", word: item.word };
    });
    addGloss(box, "重点虚词", lesson.keyFunctionWords, function (item) {
      return { term: item.word, reading: item.reading, note: item.note, kind: "虚词", word: item.word };
    });
    addGloss(box, "古今异义", lesson.ancientModern, function (item) {
      return { term: item.word, note: item.note, kind: "古今异义", word: item.word };
    });
    addGloss(box, "通假字", lesson.phoneticLoans, function (item) {
      return { term: item.loan ? item.word + " / " + item.loan : item.word, note: item.note, kind: "通假", word: item.word };
    });
    addGloss(box, "词类活用", lesson.flexibleUsage, function (item) {
      return { term: item.word, note: item.note, kind: "活用", word: item.word };
    });
    addGloss(box, "特殊句式", lesson.specialSyntax, function (item) {
      return { term: item.name, note: item.note, kind: "句式", word: item.name };
    });
    addProse(box, "文章主旨", lesson.theme);
    addProse(box, "写作手法", lesson.technique);

    const card = document.createElement("section");
    card.className = "note-card";
    const h2 = document.createElement("h2");
    h2.textContent = "逐句白话";
    card.appendChild(h2);
    const ol = document.createElement("ol");
    ol.className = "sentence-list";
    art.paragraphs.forEach(function (para) {
      para.sentences.forEach(function (sent) {
        if (!sent.tr) return;
        const li = document.createElement("li");
        const orig = document.createElement("div");
        orig.className = "orig compact" + (state.progress.pinyin ? " with-py" : "");
        appendTokens(orig, sent.tokens);
        const vern = document.createElement("div");
        vern.className = "vern";
        vern.textContent = sent.tr;
        li.appendChild(orig);
        li.appendChild(vern);
        ol.appendChild(li);
      });
    });
    card.appendChild(ol);
    box.appendChild(card);
    return box;
  }

  function addProse(box, title, text) {
    const sec = document.createElement("section");
    sec.className = "note-card";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const p = document.createElement("p");
    p.textContent = text;
    sec.appendChild(h2);
    sec.appendChild(p);
    box.appendChild(sec);
  }

  function addGloss(box, title, items, map) {
    const sec = document.createElement("section");
    sec.className = "note-card";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const ul = document.createElement("ul");
    ul.className = "gloss-list";
    (items || []).forEach(function (item) {
      const row = map(item);
      const li = document.createElement("li");
      const term = document.createElement("span");
      term.className = "term";
      term.textContent = row.term;
      li.appendChild(term);
      if (row.reading) {
        const reading = document.createElement("span");
        reading.className = "reading";
        reading.textContent = row.reading;
        li.appendChild(reading);
      }
      const note = document.createElement("p");
      note.textContent = row.note;
      li.appendChild(note);
      if (row.kind && row.word) appendGlossCredit(li, row.kind, row.word);
      ul.appendChild(li);
    });
    sec.appendChild(h2);
    sec.appendChild(ul);
    box.appendChild(sec);
  }

  function pagerLink(meta, label) {
    const a = document.createElement("a");
    if (!meta) {
      a.href = "#/";
      a.innerHTML = "<small>" + label + "</small>返回目录";
      return a;
    }
    a.href = "#/read/" + meta.id;
    a.innerHTML = "<small>" + label + "</small>" + meta.title;
    return a;
  }

  function lookup(ch) {
    if (!state.dict) return { pending: true };
    return state.dict[ch] || null;
  }

  function normalizePy(py) {
    return String(py || "").replace(/\u0261/g, "g").replace(/\u014b/g, "ng").replace(/\s+/g, " ").trim();
  }

  const TONE_MARKS = {
    "ā": ["a", "1"], "á": ["a", "2"], "ǎ": ["a", "3"], "à": ["a", "4"],
    "ē": ["e", "1"], "é": ["e", "2"], "ě": ["e", "3"], "è": ["e", "4"],
    "ī": ["i", "1"], "í": ["i", "2"], "ǐ": ["i", "3"], "ì": ["i", "4"],
    "ō": ["o", "1"], "ó": ["o", "2"], "ǒ": ["o", "3"], "ò": ["o", "4"],
    "ū": ["u", "1"], "ú": ["u", "2"], "ǔ": ["u", "3"], "ù": ["u", "4"],
    "ǖ": ["v", "1"], "ǘ": ["v", "2"], "ǚ": ["v", "3"], "ǜ": ["v", "4"],
  };

  function syllableKey(syl) {
    let tone = "5";
    let out = "";
    String(syl || "").toLowerCase().split("").forEach(function (ch) {
      if (TONE_MARKS[ch]) {
        out += TONE_MARKS[ch][0];
        tone = TONE_MARKS[ch][1];
      } else if (ch === "ü") out += "v";
      else out += ch;
    });
    return out + tone;
  }

  let syllableAudio = null;
  let audioManifestPromise = null;

  function audioPath(syl) {
    const key = String(syl || "").normalize("NFC").toLowerCase();
    const manifest = state.audioManifest;
    const file = manifest && Object.prototype.hasOwnProperty.call(manifest, key) ? manifest[key] : "";
    return typeof file === "string" && /^[a-z]+[1-5]$/.test(file) ? "audio/" + file + ".ogg" : "";
  }

  function loadAudioManifest() {
    if (state.audioManifest) return Promise.resolve(state.audioManifest);
    if (!audioManifestPromise) {
      audioManifestPromise = fetchJson("audio/manifest.json").then(function (manifest) {
        state.audioManifest = manifest;
        const open = state.popupTok;
        if (open) openPopup(open.tok, open.index, open.anchor);
        return manifest;
      }).finally(function () { audioManifestPromise = null; });
    }
    return audioManifestPromise;
  }

  async function playSyllable(syl) {
    if (!syl) return false;
    let audio;
    try {
      await loadAudioManifest();
      const url = audioPath(syl);
      if (!url) {
        showNotice("这个读音暂无录音。");
        return false;
      }
      if (syllableAudio) syllableAudio.pause();
      audio = new Audio(url);
      syllableAudio = audio;
      await audio.play();
      return true;
    } catch (_) {
      if (syllableAudio === audio) syllableAudio = null;
      showNotice("录音暂时无法播放，请稍后重试。");
      return false;
    }
  }

  function syllables(py) {
    const n = normalizePy(py);
    if (!n) return [];
    const re = /(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüaeiou]+(?:ng|n|r)?/gi;
    const out = [];
    n.split(/[\s·]+/).filter(Boolean).forEach(function (piece) {
      const found = piece.match(re) || [];
      if (found.length && found.join("") === piece) out.push.apply(out, found);
      else out.push(piece);
    });
    return out;
  }

  function charPinyin(ch) {
    const info = lookup(ch);
    if (!info || info.pending) return "";
    return normalizePy(info.py);
  }

  function readingOf(tok) {
    const chars = Array.from(tok.t);
    const curated = syllables(tok.py);
    if (curated.length === chars.length) {
      const source = tok.level === "sentence" ? "sentence" : "dict";
      return { parts: curated, source: source, text: curated.join(" ") };
    }
    if (chars.length === 1 && curated.length) {
      const text = curated.join(" ");
      const source = tok.level === "sentence" ? "sentence" : "dict";
      return { parts: [text], source: source, text: text };
    }
    if (curated.length && tok.level === "sentence") {
      const parts = chars.map(function (ch, i) { return curated[i] || charPinyin(ch); });
      return { parts: parts, source: "sentence", text: parts.filter(Boolean).join(" ") };
    }
    const parts = chars.map(charPinyin);
    return { parts: parts, source: parts.some(Boolean) ? "dict" : "", text: parts.filter(Boolean).join(" ") };
  }

  function samePy(a, b) {
    return normalizePy(a).toLowerCase() === normalizePy(b).toLowerCase();
  }

  function shownChars(tok) {
    const trad = Array.from(tok.t);
    const simp = Array.from(tok.s || tok.t);
    if (state.progress.font === "t" || simp.length !== trad.length) return trad;
    return simp;
  }

  function simplifiedHan(tokens) {
    return (tokens || []).map(function (tok) {
      if (tok.punct) return "";
      return tok.s || tok.t || "";
    }).join("");
  }

  function matchFamous(pieceId, tokens) {
    const lines = (state.famous && state.famous.lines) || [];
    const han = simplifiedHan(tokens);
    if (!han || han.length < 2) return null;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.pieces && line.pieces.indexOf(pieceId) < 0) continue;
      const quote = String(line.quote || "").replace(/[^\u4e00-\u9fff]/g, "");
      if (quote.length < 3) continue;
      const inside = han.indexOf(quote) >= 0;
      const covers = han.length >= 4 && quote.indexOf(han) >= 0;
      if (!inside && !covers) continue;
      const textHan = String(line.text || "").replace(/[^\u4e00-\u9fff]/g, "");
      let score = quote.length;
      if ((line.comments || []).length) score += 40;
      if (textHan && han.indexOf(textHan) >= 0) score += 4000 + textHan.length;
      else if (textHan && textHan.indexOf(han) >= 0) score += 2000 + han.length;
      if (score > bestScore) {
        best = line;
        bestScore = score;
      }
    }
    return best;
  }

  function appendMarked(parent, tokens, pieceId, translation) {
    const spans = clauseRows(tokens).map(function (row) {
      const span = document.createElement("span");
      span.className = "orig-sent";
      appendTokens(span, row);
      parent.appendChild(span);
      return span;
    });
    decorateFamous(spans, pieceId, translation);
  }

  function combineFamous(hits) {
    if (hits.length === 1) return hits[0];
    const texts = [];
    const verns = [];
    const notes = [];
    const comments = [];
    const seen = {};
    hits.forEach(function (hit) {
      const text = String(hit.text || hit.quote || "").trim();
      if (text && texts.indexOf(text) < 0) texts.push(text);
      const vern = String(hit.vernacular || "").trim();
      if (vern && verns.indexOf(vern) < 0) verns.push(vern);
      const note = String(hit.appreciate || "").trim();
      if (note && notes.indexOf(note) < 0) notes.push(note);
      (hit.comments || []).forEach(function (item) {
        const key = (item.author || "") + "\n" + (item.text || "");
        if (seen[key]) return;
        seen[key] = 1;
        comments.push(item);
      });
    });
    const merged = {};
    const last = hits[hits.length - 1];
    Object.keys(last).forEach(function (key) { merged[key] = last[key]; });
    merged.text = texts.join("");
    merged.quote = merged.text;
    if (verns.length) merged.vernacular = verns.join("");
    if (notes.length) merged.appreciate = notes.join("\n");
    if (comments.length) merged.comments = comments;
    return merged;
  }

  function addFamousButton(anchor, entry, translation) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "famous-mark";
    btn.setAttribute("aria-label", "打开名句赏析");
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openLineCard(entry, translation || "");
    });
    const line = anchor.closest && anchor.closest(".verse-line");
    const text = line && line.querySelector(".verse-text");
    if (line && text && anchorIsLast(anchor, text)) {
      btn.classList.add("at-end");
      btn._anchor = anchor;
      line.appendChild(btn);
      return;
    }
    if (anchor.parentNode) anchor.after(btn);
    else anchor.appendChild(btn);
  }

  function anchorIsLast(anchor, text) {
    const zis = text.querySelectorAll(".zi");
    if (!zis.length) return true;
    const last = zis[zis.length - 1];
    if (anchor === last) return true;
    return !!(anchor.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_PRECEDING);
  }

  function onlyHanText(str) {
    return String(str || "").replace(/[^\u4e00-\u9fff]/g, "");
  }

  function collectInline(root) {
    const nodes = [];
    function walk(el) {
      Array.from(el.children).forEach(function (child) {
        if (!child.classList) return;
        if (child.classList.contains("py-ruby") || child.classList.contains("famous-mark")) return;
        if (child.classList.contains("zi")) {
          nodes.push({ kind: "zi", el: child, ch: child.dataset.han || "" });
          return;
        }
        if (child.classList.contains("punct")) {
          nodes.push({ kind: "punct", el: child });
          return;
        }
        if (child.children.length) walk(child);
      });
    }
    walk(root);
    return nodes;
  }

  function isFlowParent(el) {
    return !!(el && el.classList && (el.classList.contains("word") || el.classList.contains("keep")));
  }

  function dropEmpty(el) {
    while (el && isFlowParent(el) && el.childNodes.length === 0) {
      const parent = el.parentNode;
      el.remove();
      el = parent;
    }
  }

  function liftPhrase(phrase) {
    while (isFlowParent(phrase.parentElement)) {
      const parent = phrase.parentElement;
      const grand = parent.parentNode;
      const afterNodes = [];
      let sibling = phrase.nextSibling;
      while (sibling) {
        afterNodes.push(sibling);
        sibling = sibling.nextSibling;
      }
      const before = phrase.previousSibling;
      if (!before) grand.insertBefore(phrase, parent);
      else grand.insertBefore(phrase, parent.nextSibling);
      if (afterNodes.length) {
        const after = document.createElement("span");
        after.className = parent.className;
        afterNodes.forEach(function (node) { after.appendChild(node); });
        phrase.after(after);
      }
      if (!parent.childNodes.length) parent.remove();
    }
  }

  function wrapQuote(zis, q0, q1, entry, translation) {
    const els = [];
    for (let i = q0; i < q1; i += 1) {
      if (zis[i] && zis[i].el) els.push(zis[i].el);
    }
    if (!els.length) return;
    const phrase = document.createElement("span");
    phrase.className = "famous-phrase";
    const pack = { hit: entry, translation: translation || "" };
    phrase._famous = pack;
    els[0].parentNode.insertBefore(phrase, els[0]);
    const leftovers = [];
    els.forEach(function (el) {
      leftovers.push(el.parentNode);
      el._famous = pack;
      phrase.appendChild(el);
    });
    leftovers.forEach(dropEmpty);
    liftPhrase(phrase);
  }

  function anchorAfterHan(nodes, zis, hanEnd) {
    if (hanEnd <= 0 || !zis[hanEnd - 1]) return null;
    const lastZi = zis[hanEnd - 1].el;
    let anchor = lastZi;
    let seen = false;
    for (let i = 0; i < nodes.length; i += 1) {
      if (!seen) {
        if (nodes[i].el === lastZi) seen = true;
        continue;
      }
      if (nodes[i].kind !== "punct") break;
      anchor = nodes[i].el;
    }
    return anchor;
  }

  function decorateFamous(roots, pieceId, translation) {
    const nodes = [];
    roots.forEach(function (root) {
      collectInline(root).forEach(function (node) { nodes.push(node); });
    });
    const zis = nodes.filter(function (node) { return node.kind === "zi" && node.ch; });
    const hay = zis.map(function (node) { return node.ch; }).join("");
    if (hay.length < 3) return;
    const lines = (state.famous && state.famous.lines) || [];
    const found = [];
    lines.forEach(function (line) {
      if (line.pieces && line.pieces.indexOf(pieceId) < 0) return;
      const quote = onlyHanText(line.quote);
      if (quote.length < 3 || hay.indexOf(quote) < 0) return;
      const text = onlyHanText(line.text || line.quote);
      let from = 0;
      while (from <= hay.length - quote.length) {
        const at = hay.indexOf(quote, from);
        if (at < 0) break;
        let t0 = at;
        let t1 = at + quote.length;
        if (text && text.indexOf(quote) >= 0) {
          const start = at - text.indexOf(quote);
          if (start >= 0 && hay.slice(start, start + text.length) === text) {
            t0 = start;
            t1 = start + text.length;
          }
        }
        found.push({ line: line, q0: at, q1: at + quote.length, t0: t0, t1: t1 });
        from = at + Math.max(quote.length, 1);
      }
    });
    if (!found.length) return;
    found.sort(function (a, b) {
      return a.q0 - b.q0 || (b.t1 - b.t0) - (a.t1 - a.t0);
    });
    const kept = [];
    found.forEach(function (hit) {
      const prev = kept[kept.length - 1];
      if (prev && hit.q0 < prev.q1) return;
      kept.push(hit);
    });
    const groups = [];
    kept.forEach(function (hit) {
      const prev = groups[groups.length - 1];
      if (prev && hit.t0 <= prev.t1) {
        prev.t1 = Math.max(prev.t1, hit.t1);
        prev.parts.push(hit);
      } else {
        groups.push({ t0: hit.t0, t1: hit.t1, parts: [hit] });
      }
    });
    groups.forEach(function (group) {
      const entry = combineFamous(group.parts.map(function (part) { return part.line; }));
      group.parts.forEach(function (part) {
        wrapQuote(zis, part.q0, part.q1, entry, translation);
      });
      const anchor = anchorAfterHan(nodes, zis, group.t1);
      if (anchor) addFamousButton(anchor, entry, translation);
    });
  }

  function closeFamous() {
    const sheet = document.getElementById("famous-sheet");
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    sheet.innerHTML = "";
  }

  function lineSection(label, text, badge) {
    const sec = document.createElement("section");
    sec.className = "line-sec";
    const lab = document.createElement("p");
    lab.className = "pop-label";
    lab.appendChild(document.createTextNode(label));
    if (badge) {
      const tag = document.createElement("span");
      tag.className = "site-note";
      tag.textContent = badge;
      lab.appendChild(tag);
    }
    const p = document.createElement("p");
    p.className = label === "原句" ? "orig-line" : "line-body";
    p.textContent = text;
    sec.appendChild(lab);
    sec.appendChild(p);
    return sec;
  }

  function openLineCard(entry, translation) {
    closePopup();
    const sheet = document.getElementById("famous-sheet");
    sheet.innerHTML = "";
    const head = document.createElement("header");
    const h2 = document.createElement("h2");
    h2.id = "famous-title";
    h2.textContent = "名句";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "text-link";
    close.textContent = "关闭";
    close.addEventListener("click", function () {
      closeFamous();
      if (popup.hidden) scrim.hidden = true;
    });
    head.appendChild(h2);
    head.appendChild(close);
    sheet.appendChild(head);
    sheet.appendChild(lineSection("原句", entry.text || entry.quote || ""));
    const vernacular = (entry.vernacular || translation || "").trim();
    if (vernacular) sheet.appendChild(lineSection("白话", vernacular));
    const appreciate = (entry.appreciate || "").trim();
    if (appreciate) sheet.appendChild(lineSection("赏析", appreciate, "本站赏析"));
    const comments = entry.comments || [];
    if (comments.length) {
      const sec = document.createElement("section");
      sec.className = "line-sec";
      const lab = document.createElement("p");
      lab.className = "pop-label";
      lab.textContent = "名家点评";
      sec.appendChild(lab);
      comments.forEach(function (item) {
        const block = document.createElement("div");
        block.className = "comment";
        const b = document.createElement("b");
        b.textContent = [item.author, item.source].filter(Boolean).join(" · ");
        block.appendChild(b);
        const p = document.createElement("p");
        p.textContent = item.text || "";
        block.appendChild(p);
        if (item.url) {
          const a = document.createElement("a");
          a.href = item.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "出处";
          block.appendChild(a);
        }
        sec.appendChild(block);
      });
      sheet.appendChild(sec);
    }
    sheet.hidden = false;
    scrim.hidden = false;
  }

  function openPopup(tok, index, anchor) {
    closeFamous();
    state.popupTok = { tok: tok, index: index, anchor: anchor };
    document.querySelectorAll(".zi.on").forEach(function (el) { el.classList.remove("on"); });
    if (anchor) anchor.classList.add("on");
    const trad = Array.from(tok.t);
    const shown = shownChars(tok);
    const focus = trad[index] || trad[0];
    const focusShown = shown[index] || shown[0] || focus;
    const entry = lookup(focus) || {};
    const reading = readingOf(tok);
    const syllable = reading.parts[index] || reading.parts[0] || "";
    const dictPy = entry.pending ? "" : normalizePy(entry.py);
    popup.hidden = false;
    scrim.hidden = false;
    popup.innerHTML = "";

    const head = document.createElement("header");
    const titles = document.createElement("div");
    const h3 = document.createElement("h3");
    h3.id = "popup-title";
    h3.textContent = focusShown;
    const speak = document.createElement("button");
    speak.type = "button";
    speak.className = "speak";
    speak.setAttribute("aria-label", syllable ? "朗读 " + syllable : "没有读音");
    speak.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 9.5v5h3.2L12 19V5L7.2 9.5H4z\"/><path d=\"M15.2 9.2a3.6 3.6 0 010 5.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"/><path d=\"M17.4 7a6.2 6.2 0 010 10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"/></svg>";
    const missingAudio = !!state.audioManifest && !audioPath(syllable);
    speak.disabled = !syllable || missingAudio;
    speak.title = !syllable ? "没有读音" : missingAudio ? "这个读音暂无录音" : "朗读 " + syllable;
    speak.setAttribute("aria-label", speak.title);
    speak.addEventListener("click", function (event) {
      event.stopPropagation();
      playSyllable(syllable);
    });
    const nameRow = document.createElement("div");
    nameRow.className = "char-name";
    nameRow.appendChild(h3);
    nameRow.appendChild(speak);
    const pyEl = document.createElement("p");
    pyEl.className = "py";
    if (syllable) pyEl.textContent = syllable;
    else if (entry.pending) pyEl.textContent = "读音载入中";
    else pyEl.textContent = "读音未收";
    if (syllable && missingAudio) pyEl.textContent += " · 暂无录音";
    titles.appendChild(nameRow);
    titles.appendChild(pyEl);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close-x";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", closePopup);
    head.appendChild(titles);
    head.appendChild(close);
    popup.appendChild(head);

    if (trad.length > 1) {
      const wordLine = document.createElement("p");
      wordLine.className = "word-py";
      const lab = document.createElement("span");
      lab.textContent = "词";
      const name = document.createElement("b");
      name.textContent = state.progress.font === "t" ? tok.t : (tok.s || tok.t);
      const wp = document.createElement("i");
      wp.textContent = reading.text || "读音未收";
      wordLine.appendChild(lab);
      wordLine.appendChild(name);
      wordLine.appendChild(wp);
      popup.appendChild(wordLine);

      const row = document.createElement("div");
      row.className = "syl-row";
      trad.forEach(function (ch, i) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "syl" + (i === index ? " on" : "");
        const glyph = document.createElement("b");
        glyph.textContent = shown[i] || ch;
        const syl = document.createElement("i");
        syl.textContent = reading.parts[i] || "·";
        chip.appendChild(glyph);
        chip.appendChild(syl);
        chip.addEventListener("click", function (event) {
          event.stopPropagation();
          openPopup(tok, i, anchor);
        });
        row.appendChild(chip);
      });
      popup.appendChild(row);
    }

    const tags = document.createElement("div");
    tags.className = "tags";
    if (reading.source === "sentence") tags.appendChild(tag("本句读音", "accent"));
    else tags.appendChild(tag("今读参考", ""));
    if (focusShown !== focus) tags.appendChild(tag(focus, ""));
    if (tok.pos) tags.appendChild(tag(tok.pos, ""));
    if (tok.extra) tags.appendChild(tag(tok.extra, "accent"));
    popup.appendChild(tags);

    const sense = document.createElement("section");
    sense.className = "pop-sec";
    const senseLabel = document.createElement("p");
    senseLabel.className = "pop-label";
    senseLabel.textContent = "本句";
    const ctx = document.createElement("p");
    ctx.className = "ctx";
    if (tok.ctx) ctx.textContent = tok.ctx;
    else ctx.textContent = "这一篇还没有逐句审定的义项。下面的《说文》本义用来帮助判断，不等于已经核定的句中义。";
    sense.appendChild(senseLabel);
    sense.appendChild(ctx);
    popup.appendChild(sense);

    const dictSec = document.createElement("section");
    dictSec.className = "pop-sec";
    const dictLabel = document.createElement("p");
    dictLabel.className = "pop-label";
    dictLabel.textContent = "说文";
    dictSec.appendChild(dictLabel);
    const block = document.createElement("div");
    block.className = "char-block focus";
    const h4 = document.createElement("h4");
    h4.textContent = focusShown + (focusShown !== focus ? "（" + focus + "）" : "");
    const sub = document.createElement("p");
    sub.className = "sub";
    const bits = [];
    if (dictPy && !samePy(dictPy, syllable)) bits.push("字书 " + dictPy);
    if (entry.fanqie) bits.push("反切 " + entry.fanqie);
    sub.textContent = bits.join(" · ");
    const ben = document.createElement("p");
    const benText = state.progress.font === "t" ? (entry.ben || "") : (entry.benS || entry.ben || "");
    if (entry.pending) ben.textContent = "字典正在载入。";
    else if (!benText) ben.textContent = "《说文解字》未收此字。";
    else ben.textContent = benText;
    block.appendChild(h4);
    if (bits.length) block.appendChild(sub);
    block.appendChild(ben);
    const note = readingNote(focus);
    if (note && note.status === "review") {
      const flag = document.createElement("p");
      flag.className = "reading-flag";
      flag.textContent = "待复核：汉典文言缓存列了 " + (note.han || []).join("、") + "，说文音 " + (note.shuowen || "") + " 不在其中。这一处仍用现在的读音。";
      block.appendChild(flag);
    }
    dictSec.appendChild(block);
    popup.appendChild(dictSec);
    const famousNode = anchor && anchor.closest(".famous-phrase");
    const famous = famousNode && famousNode._famous;
    if (famous && famous.hit) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "famous-jump";
      jump.textContent = "名句 · 赏析 ›";
      jump.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openLineCard(famous.hit, famous.translation || "");
      });
      popup.insertBefore(jump, popup.firstChild);
    }
    placePopup(anchor);
  }

  function fillDock(btn, small, mainText) {
    btn.replaceChildren();
    const s = document.createElement("small");
    s.textContent = small;
    btn.appendChild(s);
    if (mainText) {
      const b = document.createElement("b");
      b.textContent = mainText;
      btn.appendChild(b);
    }
  }

  function syncChrome() {
    const hash = location.hash || "#/";
    const onArticle = state.view === "article" && /^#\/read\//.test(hash);
    const onPiece = state.view === "piece" && !!state.piece;
    const reading = (onArticle && !!state.article) || onPiece;
    const crumbs = [];
    let rail = 0;
    let tab = "home";
    const poetry = POETRY[state.kind];
    if ((state.view === "collection" || onPiece) && poetry) {
      tab = state.kind;
      crumbs.push({ href: "#/", label: "典籍" });
      if (onPiece) crumbs.push({ href: "#/" + state.kind, label: poetry.label });
    } else if (state.view === "renjian" || hash === "#/rjch") {
      tab = "rjch";
      crumbs.push({ href: "#/", label: "典籍" });
    } else if (state.view === "zztj" || hash === "#/zztj") {
      tab = "zztj";
      crumbs.push({ href: "#/", label: "典籍" });
    } else if (state.view === "daode" || hash === "#/daode") {
      tab = "daode";
      crumbs.push({ href: "#/", label: "典籍" });
    } else if (state.view === "lunyu" || hash === "#/lunyu") {
      tab = "lunyu";
      crumbs.push({ href: "#/", label: "典籍" });
    } else if (state.view === "zjuan") {
      tab = "zztj";
      crumbs.push({ href: "#/", label: "典籍" });
      crumbs.push({ href: "#/zztj", label: "资治通鉴" });
      rail = "z";
    } else if (state.view === "book" || hash === "#/gwgz") {
      tab = "gwgz";
      crumbs.push({ href: "#/", label: "典籍" });
    } else if (state.view === "volume") {
      tab = "gwgz";
      crumbs.push({ href: "#/", label: "典籍" });
      crumbs.push({ href: "#/gwgz", label: "古文观止" });
      rail = state.openVol;
    } else if (onArticle && state.article) {
      const renjian = isRenjianId(state.article.id);
      const tongjian = isZztjId(state.article.id);
      const daode = isDaodeId(state.article.id);
      const lunyu = isLunyuId(state.article.id);
      tab = tongjian ? "zztj" : renjian ? "rjch" : daode ? "daode" : lunyu ? "lunyu" : "gwgz";
      crumbs.push({ href: "#/", label: "典籍" });
      if (daode) {
        crumbs.push({ href: "#/daode", label: "道德经" });
      } else if (lunyu) {
        crumbs.push({ href: "#/lunyu", label: "论语" });
      } else if (tongjian) {
        const vol = state.openVol || 1;
        const volMeta = state.zztj && state.zztj.volumes.find(function (item) { return item.volume === vol; });
        crumbs.push({ href: "#/zztj", label: "资治通鉴" });
        crumbs.push({ href: "#/zztj/" + vol, label: volMeta ? volMeta.title : "本卷" });
        rail = "z";
      } else if (renjian) {
        crumbs.push({ href: "#/rjch", label: "人间词话" });
        rail = "rj";
      } else {
        const vol = state.openVol || 1;
        const volMeta = state.catalog && state.catalog.volumes.find(function (item) { return item.volume === vol; });
        crumbs.push({ href: "#/gwgz", label: "古文观止" });
        crumbs.push({ href: "#/gwgz/" + vol, label: volMeta ? volMeta.title : "本卷" });
        rail = vol;
      }
    }
    const crumbEl = document.getElementById("crumb");
    crumbEl.replaceChildren();
    crumbs.forEach(function (item) {
      const a = document.createElement("a");
      a.href = item.href;
      a.textContent = item.label;
      crumbEl.appendChild(a);
    });
    document.querySelector(".top").classList.toggle("has-back", crumbs.length > 0);
    syncReadTools(onArticle && state.article ? "article" : (onPiece ? "piece" : ""));
    const tabbar = document.getElementById("tabbar");
    const dock = document.getElementById("dock");
    tabbar.hidden = reading;
    dock.hidden = true;
    document.body.classList.toggle("is-reading", reading);
    document.body.classList.toggle("is-piece", onPiece);
    document.body.classList.toggle("sheet-open", reading && !!state.verseTab);
    tabbar.querySelectorAll("a").forEach(function (a) {
      a.classList.toggle("on", a.dataset.tab === tab);
    });
    const onRenjian = tab === "rjch";
    const onZztj = tab === "zztj";
    const onDaode = tab === "daode";
    const onLunyu = tab === "lunyu";
    const total = onZztj ? zztjArticles().length : onRenjian ? renjianArticles().length : onDaode ? classicArticles("daode").length : onLunyu ? classicArticles("lunyu").length : (state.catalog ? state.catalog.articleCount : 0);
    const n = onZztj ? learnedIn(zztjArticles()) : onRenjian ? learnedIn(renjianArticles()) : onDaode ? learnedIn(classicArticles("daode")) : onLunyu ? learnedIn(classicArticles("lunyu")) : learnedIn(flatArticles());
    const showMeter = (tab === "gwgz" || tab === "rjch" || tab === "zztj" || tab === "daode" || tab === "lunyu") && total;
    topProgress.textContent = showMeter ? "已读 " + n + " / " + total : "";
    meter.style.width = showMeter ? Math.round((n / total) * 100) + "%" : "0%";
    if (rail === "rj") renderRenjianRail();
    else if (rail === "z") renderZztjRail();
    else if (rail) renderRail(rail);
    else {
      shell.classList.remove("has-rail");
      catalogEl.replaceChildren();
    }
    if (onPiece) {
      const nav = pieceNeighbors(state.kind, state.piece.id);
      const prev = document.getElementById("dock-prev");
      const next = document.getElementById("dock-next");
      prev.disabled = !nav.prev;
      next.disabled = !nav.next;
      fillDock(prev, "上一首", nav.prev ? pieceTitle(nav.prev) : "");
      fillDock(next, "下一首", nav.next ? pieceTitle(nav.next) : "已是末首");
      prev.onclick = function () {
        if (nav.prev) location.hash = "#/" + state.kind + "/" + nav.prev.id;
      };
      next.onclick = function () {
        if (nav.next) location.hash = "#/" + state.kind + "/" + nav.next.id;
      };
    } else if (reading) {
      const nav = neighbors(state.article.id);
      const prev = document.getElementById("dock-prev");
      const next = document.getElementById("dock-next");
      prev.disabled = !nav.prev;
      next.disabled = !nav.next;
      fillDock(prev, "上一篇", nav.prev ? nav.prev.title : "");
      fillDock(next, "下一篇", nav.next ? nav.next.title : "已是末篇");
      prev.onclick = function () {
        if (nav.prev) location.hash = "#/read/" + nav.prev.id;
      };
      next.onclick = function () {
        if (nav.next) location.hash = "#/read/" + nav.next.id;
      };
    }
  }

  function tag(text, kind) {
    const span = document.createElement("span");
    span.className = "tag" + (kind ? " " + kind : "");
    span.textContent = text;
    return span;
  }

  function placePopup(anchor) {
    if (!anchor || window.matchMedia("(max-width: 860px)").matches) {
      popup.style.left = "0";
      popup.style.top = "auto";
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + width > window.innerWidth - 16) left = window.innerWidth - width - 16;
    if (left < 16) left = 16;
    if (top + height > window.innerHeight - 16) top = Math.max(16, rect.top - height - 8);
    popup.style.left = left + "px";
    popup.style.top = top + "px";
  }

  function closePopup() {
    popup.hidden = true;
    scrim.hidden = true;
    popup.innerHTML = "";
    state.popupTok = null;
    closeFamous();
    document.querySelectorAll(".zi.on").forEach(function (el) { el.classList.remove("on"); });
  }

  scrim.addEventListener("click", closePopup);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closePopup();
  });
  document.addEventListener("click", function (event) {
    if (popup.hidden) return;
    if (popup.contains(event.target)) return;
    if (scrim.contains(event.target)) return;
    if (event.target.closest && event.target.closest(".zi, .word button")) return;
    closePopup();
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("storage", syncStoredProgress);
  window.addEventListener("resize", function () {
    if (!popup.hidden && state.popupTok) placePopup(state.popupTok.anchor);
    fitVerse(document.querySelector(".body.verse"));
    scheduleBalance();
  });

  let swipeX = 0;
  let swipeY = 0;
  let lastSwipeAt = 0;
  main.addEventListener("touchstart", function (event) {
    if (event.touches.length !== 1) return;
    swipeX = event.touches[0].clientX;
    swipeY = event.touches[0].clientY;
  }, { passive: true });
  main.addEventListener("touchend", function (event) {
    const readingPiece = state.view === "piece" && !!state.piece;
    const readingArticle = state.view === "article" && !!state.article;
    if (!readingPiece && !readingArticle) return;
    if (event.target.closest && event.target.closest(".verse-panel, .verse-bar, .author-card, .verse-turn, .foot-links, .mark, .read-tools")) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipeX;
    const dy = touch.clientY - swipeY;
    if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    lastSwipeAt = Date.now();
    if (readingPiece) {
      const nav = pieceNeighbors(state.kind, state.piece.id);
      if (dx < 0 && nav.next) location.hash = "#/" + state.kind + "/" + nav.next.id;
      if (dx > 0 && nav.prev) location.hash = "#/" + state.kind + "/" + nav.prev.id;
      return;
    }
    const nav = neighbors(state.article.id);
    if (dx < 0 && nav.next) location.hash = "#/read/" + nav.next.id;
    if (dx > 0 && nav.prev) location.hash = "#/read/" + nav.prev.id;
  }, { passive: true });

  document.getElementById("tool-font").addEventListener("click", function () {
    state.progress.font = state.progress.font === "t" ? "s" : "t";
    saveProgress();
    if (state.view === "piece" && state.piece) renderPiece(true);
    else if (state.view === "article" && state.article) renderArticle(true);
  });
  document.getElementById("tool-py").addEventListener("click", function () {
    state.progress.pinyin = !state.progress.pinyin;
    state.progress.pinyinSet = true;
    saveProgress();
    if (state.view === "article" && state.article) renderArticle(true);
    else if (state.view === "piece" && state.piece) renderPiece(true);
  });
  document.querySelectorAll("#read-tools .tool-seg button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const next = btn.dataset.mode === "sentence";
      if (sentenceMode() === next) return;
      state.progress.sentence = next;
      state.progress.sentenceSet = true;
      saveProgress();
      if (state.view === "article" && state.article) renderArticle(true);
    });
  });

  function startBoot() {
    return boot().catch(function (err) {
      showLoadError(startBoot);
      console.error(err);
    });
  }
  startBoot();
})();
