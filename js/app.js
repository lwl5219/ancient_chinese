(function () {
  "use strict";

  const KEY = "gwgz-progress-v1";
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
  };
  let loadToken = 0;

  const main = document.getElementById("main");
  const catalogEl = document.getElementById("catalog");
  const popup = document.getElementById("popup");
  const scrim = document.getElementById("scrim");
  const shell = document.querySelector(".shell");
  const topProgress = document.getElementById("top-progress");
  const meter = document.getElementById("top-meter-fill");

  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      raw.learned = raw.learned || {};
      raw.font = raw.font === "t" ? "t" : "s";
      raw.mode = raw.mode || "read";
      raw.sentenceSet = !!raw.sentenceSet;
      raw.sentence = raw.sentenceSet ? !!raw.sentence : true;
      raw.pinyinSet = !!raw.pinyinSet;
      if (!raw.pinyinSet) raw.pinyin = true;
      else raw.pinyin = !!raw.pinyin;
      raw.collections = raw.collections && typeof raw.collections === "object" ? raw.collections : {};
      return raw;
    } catch (err) {
      return { learned: {}, font: "s", mode: "read", sentence: true, sentenceSet: false, last: "", pinyin: true, pinyinSet: false, collections: {} };
    }
  }

  function saveProgress() {
    localStorage.setItem(KEY, JSON.stringify(state.progress));
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

  function learnedIn(list) {
    return list.filter(function (art) { return state.progress.learned[art.id]; }).length;
  }

  function findArticleMeta(id) {
    const lists = isRenjianId(id) ? [renjianArticles(), flatArticles()] : [flatArticles(), renjianArticles()];
    for (let i = 0; i < lists.length; i += 1) {
      const found = lists[i].find(function (art) { return art.id === id; });
      if (found) return found;
    }
    return null;
  }

  function neighbors(id) {
    const list = isRenjianId(id) ? renjianArticles() : flatArticles();
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
    const [catRes, booksRes, authorsRes, renjianRes] = await Promise.all([
      fetch(assetUrl("data/catalog.json")),
      fetch(assetUrl("data/books.json")),
      fetch(assetUrl("data/prose-authors.json")),
      fetch(assetUrl("data/renjian.json")),
    ]);
    if (!catRes.ok) {
      main.innerHTML = "<p class='empty'>没有读到目录。请在仓库根目录运行本地服务器后再打开本页。</p>";
      return;
    }
    state.catalog = await catRes.json();
    if (booksRes.ok) state.books = await booksRes.json();
    if (authorsRes.ok) state.proseAuthors = await authorsRes.json();
    if (renjianRes.ok) state.renjian = await renjianRes.json();
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
    tang: { file: "data/tang.json", label: "唐诗" },
    ci: { file: "data/songci.json", label: "宋词" },
  };

  function route() {
    const hash = location.hash || "#/";
    const read = hash.match(/^#\/read\/((?:v|h)\d{2}-\d{2})$/);
    const vol = hash.match(/^#\/gwgz\/(\d{1,2})$/);
    const piece = hash.match(/^#\/(tang|ci)\/([a-z0-9-]+)$/);
    if (read) showArticle(read[1]);
    else if (vol) showVolume(Number(vol[1]));
    else if (hash === "#/gwgz") showBook();
    else if (hash === "#/rjch") showRenjian();
    else if (piece) showPiece(piece[1], piece[2]);
    else if (hash === "#/tang" || hash === "#/ci") showCollection(hash.slice(2));
    else showHub();
  }

  function bookList() {
    if (state.books && state.books.books) return state.books.books;
    return [
      { id: "gwgz", title: "古文观止", href: "#/gwgz", meta: "十二卷 · 二百二十二篇", detail: "先读这一本。" },
      { id: "rjch", title: "人间词话", href: "#/rjch", meta: "王国维 · 六十四则", detail: "一九〇八年至一九〇九年《国粹学报》本。" },
      { id: "tang", title: "唐诗", href: "#/tang", meta: "精选名篇", detail: "从《静夜思》读起。" },
      { id: "ci", title: "宋词", href: "#/ci", meta: "精选名篇", detail: "从《水调歌头》读起。" },
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
      const resumeList = isRenjianId(last.id) ? renjianArticles() : flatArticles();
      const resumeBook = isRenjianId(last.id) ? "人间词话" : "古文观止";
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
      hits.slice(0, 40).forEach(function (art) {
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
    if (state.collections[kind]) return true;
    const meta = POETRY[kind];
    skeleton("正在打开" + meta.label);
    syncChrome();
    const res = await fetch(assetUrl(meta.file));
    if (token !== loadToken) return false;
    if (!res.ok) {
      main.innerHTML = "<p class='empty'>" + meta.label + "还没有生成。在仓库根目录运行 python3 scripts/build_poetry.py。</p>";
      return false;
    }
    state.collections[kind] = await res.json();
    return token === loadToken;
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
    lead.textContent = data.pieces.length + " 首。点开一首，字上是今读，底下有译文和赏析。";
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
    const list = document.createElement("div");
    list.className = "piece-list";
    data.pieces.forEach(function (item, index) {
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
      list.appendChild(link);
    });
    wrap.appendChild(list);
    main.replaceChildren(wrap);
    document.title = meta.label + " · 典籍";
    syncChrome();
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
    if (state.notes) return true;
    const res = await fetch(assetUrl("data/poetry-notes.json"));
    if (token !== loadToken) return false;
    state.notes = res.ok ? await res.json() : { authors: {}, pieces: {}, credit: { s: "", t: "" } };
    return token === loadToken;
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

  function addVerseLines(parent, tokens) {
    clauseRows(tokens).forEach(function (row) {
      const p = document.createElement("p");
      p.className = "orig verse-line" + (state.progress.pinyin ? " with-py" : "");
      appendTokens(p, row);
      parent.appendChild(p);
    });
  }

  function renderVerseBody(piece, kind, meta) {
    const body = document.createElement("div");
    body.className = "body verse " + (kind === "tang" ? "shi" : "ci");
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

  function fitVerse(body) {
    if (!body) return;
    const lines = body.querySelectorAll(".verse-line");
    if (!lines.length) return;
    body.style.fontSize = "";
    const limit = body.clientWidth;
    let widest = 0;
    lines.forEach(function (line) {
      widest = Math.max(widest, line.scrollWidth);
    });
    if (widest > limit + 1) {
      const current = parseFloat(getComputedStyle(body).fontSize);
      body.style.fontSize = Math.max(14, current * (limit - 1) / widest) + "px";
    }
  }

  function sentenceMode() {
    return !!state.progress.sentence;
  }

  function syncReadTools(show) {
    const bar = document.getElementById("read-tools");
    if (!bar) return;
    bar.hidden = !show;
    document.querySelector(".top").classList.toggle("has-tools", !!show);
    if (!show) return;
    const py = document.getElementById("tool-py");
    py.classList.toggle("on", !!state.progress.pinyin);
    py.setAttribute("aria-pressed", state.progress.pinyin ? "true" : "false");
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
      return;
    }
    const p = document.createElement("p");
    p.textContent = bi(tab === "analysis" ? meta.analysis : meta.background);
    panel.appendChild(p);
    if (tab === "background") {
      const credit = document.createElement("p");
      credit.className = "sheet-credit";
      credit.textContent = bi(state.notes.credit);
      panel.appendChild(credit);
    }
  }

  function refreshReading() {
    if (state.view === "article") renderArticle(true);
    else renderPiece(true);
  }

  function appendReadingBar(wrap) {
    const bar = document.createElement("nav");
    bar.className = "verse-bar";
    bar.setAttribute("aria-label", "译文和赏析");
    VERSE_TABS.forEach(function (item) {
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
          return { term: item.word, gloss: (item.reading ? item.reading + "　" : "") + item.note };
        })) || any;
        any = addSheetNotes(panel, "虚词", (lesson.keyFunctionWords || []).map(function (item) {
          return { term: item.word, gloss: (item.reading ? item.reading + "　" : "") + item.note };
        })) || any;
        any = addSheetNotes(panel, "古今异义", (lesson.ancientModern || []).map(function (item) {
          return { term: item.word, gloss: item.note };
        })) || any;
        any = addSheetNotes(panel, "通假", (lesson.phoneticLoans || []).map(function (item) {
          return { term: item.word + " / " + item.loan, gloss: item.note };
        })) || any;
        any = addSheetNotes(panel, "活用", (lesson.flexibleUsage || []).map(function (item) {
          return { term: item.word, gloss: item.note };
        })) || any;
        any = addSheetNotes(panel, "句式", (lesson.specialSyntax || []).map(function (item) {
          return { term: item.name, gloss: item.note };
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
      return;
    }
    if (tab === "background") {
      if (lesson && lesson.background) panel.appendChild(sheetP(lesson.background));
      else panel.appendChild(sheetP("本篇选自《" + book + "》·" + head + "。《古文观止》题" + info.name + "。"));
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
    if (isRenjianId(art.id)) {
      credit.textContent = "白话、注释和赏析是本书编写的。正文用王国维《人间词话》一九〇八年至一九〇九年《国粹学报》已刊六十四则。";
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
    wrap.className = "reader " + (kind === "tang" ? "shi-reader" : "ci-reader");
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
    const prefs = document.createElement("div");
    prefs.className = "foot-links";
    prefs.appendChild(textLink(font === "t" ? "看简体" : "看繁体", function () {
      state.progress.font = font === "t" ? "s" : "t";
      saveProgress();
      renderPiece(true);
    }));
    prefs.appendChild(textLink(state.progress.pinyin ? "隐藏拼音" : "显示拼音", function () {
      state.progress.pinyin = !state.progress.pinyin;
      state.progress.pinyinSet = true;
      saveProgress();
      renderPiece(true);
    }));
    foot.appendChild(prefs);
    const turn = document.createElement("p");
    turn.className = "verse-turn";
    turn.appendChild(pieceTurn(kind, nav.prev, "上一首"));
    turn.appendChild(pieceTurn(kind, nav.next, "下一首"));
    foot.appendChild(turn);
    const hint = document.createElement("p");
    hint.className = "py-hint";
    hint.textContent = "点一个字，看《说文》。左右滑动可以换一首。";
    foot.appendChild(hint);
    wrap.appendChild(foot);
    appendReadingBar(wrap);
    const pager = document.createElement("nav");
    pager.className = "pager";
    pager.appendChild(piecePager(kind, nav.prev, "上一首"));
    pager.appendChild(piecePager(kind, nav.next, "下一首"));
    wrap.appendChild(pager);
    main.replaceChildren(wrap);
    fitVerse(body);
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
    const res = await fetch(assetUrl("data/articles/" + id + ".json"));
    if (token !== loadToken) return;
    if (!res.ok) {
      main.innerHTML = "<p class='empty'>没有这一篇。</p>";
      return;
    }
    state.article = await res.json();
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
    const list = isRenjianId(art.id) ? renjianArticles() : flatArticles();
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
        para.sentences.forEach(function (sent) { appendTokens(p, sent.tokens); });
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
        appendTokens(orig, sent.tokens);
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

  const NO_LINE_START = "，。！？；、：」』）】》〉〕〗､";
  const NO_LINE_END = "「『（【《〈〔〖";
  const PUNCT_OPEN = "「『（【《〈〔〖";
  const PUNCT_CLOSE = "」』）】》〉〕〗";
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
      p.textContent = "本篇的系统讲解还没有写入。下面是原文，点开每个字可看《说文》本义。";
      box.appendChild(p);
      return box;
    }
    const lesson = art.lesson;
    addProse(box, "作者与背景", lesson.background);
    addGloss(box, "重点实词", lesson.keyContentWords, function (item) {
      return { term: item.word, reading: item.reading, note: item.note };
    });
    addGloss(box, "重点虚词", lesson.keyFunctionWords, function (item) {
      return { term: item.word, reading: item.reading, note: item.note };
    });
    addGloss(box, "古今异义", lesson.ancientModern, function (item) {
      return { term: item.word, note: item.note };
    });
    addGloss(box, "通假字", lesson.phoneticLoans, function (item) {
      return { term: item.word + " / " + item.loan, note: item.note };
    });
    addGloss(box, "词类活用", lesson.flexibleUsage, function (item) {
      return { term: item.word, note: item.note };
    });
    addGloss(box, "特殊句式", lesson.specialSyntax, function (item) {
      return { term: item.name, note: item.note };
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

  function openPopup(tok, index, anchor) {
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
    const pyEl = document.createElement("p");
    pyEl.className = "py";
    if (syllable) pyEl.textContent = syllable;
    else if (entry.pending) pyEl.textContent = "读音载入中";
    else pyEl.textContent = "读音未收";
    titles.appendChild(h3);
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
    dictSec.appendChild(block);
    popup.appendChild(dictSec);
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
      tab = renjian ? "rjch" : "gwgz";
      crumbs.push({ href: "#/", label: "典籍" });
      if (renjian) {
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
    syncReadTools(onArticle && !!state.article);
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
    const total = onRenjian ? renjianArticles().length : (state.catalog ? state.catalog.articleCount : 0);
    const n = onRenjian ? learnedIn(renjianArticles()) : learnedCount();
    const showMeter = (tab === "gwgz" || tab === "rjch") && total;
    topProgress.textContent = showMeter ? "已读 " + n + " / " + total : "";
    meter.style.width = showMeter ? Math.round((n / total) * 100) + "%" : "0%";
    if (rail === "rj") renderRenjianRail();
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

  document.getElementById("tool-py").addEventListener("click", function () {
    state.progress.pinyin = !state.progress.pinyin;
    state.progress.pinyinSet = true;
    saveProgress();
    if (state.view === "article" && state.article) renderArticle(true);
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

  boot().catch(function (err) {
    main.innerHTML = "<p class='empty'>页面数据没有载入。请用本地服务器打开本站，不要直接双击文件。</p>";
    console.error(err);
  });
})();
