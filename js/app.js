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
      raw.mode = raw.mode || "parallel";
      raw.pinyin = !!raw.pinyin;
      return raw;
    } catch (err) {
      return { learned: {}, font: "s", mode: "parallel", last: "", pinyin: false };
    }
  }

  function saveProgress() {
    localStorage.setItem(KEY, JSON.stringify(state.progress));
    renderTop();
    renderCatalog();
  }

  function learnedCount() {
    return Object.keys(state.progress.learned || {}).length;
  }

  function flatArticles() {
    const list = [];
    (state.catalog.volumes || []).forEach(function (vol) {
      vol.articles.forEach(function (art) { list.push(art); });
    });
    return list;
  }

  function findArticleMeta(id) {
    return flatArticles().find(function (art) { return art.id === id; }) || null;
  }

  function neighbors(id) {
    const list = flatArticles();
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
    skeleton("正在载入目录");
    const res = await fetch("data/catalog.json");
    if (!res.ok) {
      main.innerHTML = "<p class='empty'>没有读到目录。请在仓库根目录运行本地服务器后再打开本页。</p>";
      return;
    }
    state.catalog = await res.json();
    if (state.progress.last) {
      const meta = findArticleMeta(state.progress.last);
      if (meta) state.openVol = Number(meta.id.slice(1, 3));
    }
    renderTop();
    renderCatalog();
    route();
    fetch("data/dict.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.dict = data.chars || {};
        const open = state.popupTok;
        if (state.article && state.progress.pinyin) renderArticle(true);
        if (open) {
          const anchor = open.anchor && open.anchor.isConnected ? open.anchor : null;
          openPopup(open.tok, open.index, anchor);
        }
      })
      .catch(function () { state.dict = {}; });
  }

  function renderTop() {
    if (!state.catalog) return;
    const n = learnedCount();
    const total = state.catalog.articleCount;
    const pct = total ? Math.round((n / total) * 100) : 0;
    topProgress.textContent = "已读 " + n + " / " + total;
    meter.style.width = pct + "%";
    const btn = document.getElementById("continue-btn");
    btn.textContent = state.progress.last ? "继续阅读" : "从首篇读起";
  }

  function renderCatalog() {
    if (!state.catalog) return;
    const q = state.query.trim();
    const root = document.createElement("div");
    const input = document.createElement("input");
    input.className = "catalog-search";
    input.placeholder = "搜索篇名、作者";
    input.value = state.query;
    input.setAttribute("aria-label", "搜索篇名");
    input.addEventListener("input", function () {
      state.query = input.value;
      renderCatalog();
      const next = catalogEl.querySelector(".catalog-search");
      if (next) {
        next.focus();
        const len = next.value.length;
        next.setSelectionRange(len, len);
      }
    });
    root.appendChild(input);

    state.catalog.volumes.forEach(function (vol) {
      const articles = vol.articles.filter(function (art) {
        if (!q) return true;
        return (art.title + art.author + art.book).indexOf(q) >= 0;
      });
      if (!articles.length) return;
      const box = document.createElement("section");
      box.className = "vol";
      const head = document.createElement("button");
      head.type = "button";
      const done = vol.articles.filter(function (art) { return state.progress.learned[art.id]; }).length;
      const opened = q || state.openVol === vol.volume;
      head.setAttribute("aria-expanded", opened ? "true" : "false");
      if (opened) head.classList.add("open");
      const strong = document.createElement("strong");
      strong.textContent = vol.title + " · " + vol.subtitle;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = done + "/" + vol.articles.length;
      head.appendChild(strong);
      head.appendChild(count);
      const list = document.createElement("ol");
      list.className = "vol-list";
      list.hidden = !opened;
      head.addEventListener("click", function () {
        state.openVol = state.openVol === vol.volume && !q ? 0 : vol.volume;
        renderCatalog();
      });
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
        a.addEventListener("click", closeNav);
        li.appendChild(a);
        list.appendChild(li);
      });
      box.appendChild(head);
      box.appendChild(list);
      root.appendChild(box);
    });
    if (!root.querySelector(".vol")) {
      const empty = document.createElement("p");
      empty.className = "catalog-empty";
      empty.textContent = "没有匹配的篇目。";
      root.appendChild(empty);
    }
    catalogEl.replaceChildren(root);
  }

  function route() {
    const hash = location.hash || "#/";
    const match = hash.match(/^#\/read\/(v\d{2}-\d{2})$/);
    if (match) showArticle(match[1]);
    else showHome();
  }

  function showHome() {
    loadToken += 1;
    closePopup();
    state.article = null;
    const total = state.catalog.articleCount;
    const n = learnedCount();
    const pct = total ? Math.round((n / total) * 100) : 0;
    const first = state.catalog.volumes[0].articles[0];
    const last = state.progress.last ? findArticleMeta(state.progress.last) : null;
    main.innerHTML = "";
    const wrap = document.createElement("article");
    wrap.className = "home";
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = "吴楚材、吴调侯选编 · 十二卷";
    const h1 = document.createElement("h1");
    h1.textContent = "古文观止";
    const lead = document.createElement("p");
    lead.className = "lead";
    lead.textContent = "按原书次序读。点开原文里的字，查看本句意思、带声调的拼音和《说文》本义。卷一十八篇有系统讲解。";
    wrap.appendChild(kicker);
    wrap.appendChild(h1);
    wrap.appendChild(lead);

    const stats = document.createElement("div");
    stats.className = "stats";
    [["全编篇目", total], ["已配讲解", state.catalog.annotatedCount], ["你已读完", n]].forEach(function (pair) {
      const card = document.createElement("div");
      card.className = "stat";
      const b = document.createElement("b");
      b.textContent = String(pair[1]);
      const span = document.createElement("span");
      span.textContent = pair[0];
      card.appendChild(b);
      card.appendChild(span);
      stats.appendChild(card);
    });
    wrap.appendChild(stats);
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.setAttribute("aria-hidden", "true");
    const fill = document.createElement("i");
    fill.style.width = pct + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);

    const resume = document.createElement("section");
    resume.className = "resume";
    const copy = document.createElement("div");
    const rk = document.createElement("p");
    rk.className = "kicker";
    const rh = document.createElement("h2");
    const rs = document.createElement("p");
    if (last) {
      const vol = state.catalog.volumes.find(function (item) {
        return item.volume === Number(String(last.id).slice(1, 3));
      });
      rk.textContent = "继续读";
      rh.textContent = last.title;
      rs.textContent = (vol ? vol.title + " · " + vol.subtitle + " · " : "") + "已读 " + n + " / " + total;
    } else {
      rk.textContent = "从这里开始";
      rh.textContent = first.title;
      rs.textContent = "卷一第一篇。点开每个字，看本句意思和带声调的读音。";
    }
    const go = document.createElement("a");
    go.className = "text-btn primary";
    go.href = "#/read/" + (last ? last.id : first.id);
    go.textContent = last ? "继续" : "开始阅读";
    copy.appendChild(rk);
    copy.appendChild(rh);
    copy.appendChild(rs);
    resume.appendChild(copy);
    resume.appendChild(go);
    wrap.appendChild(resume);

    const label = document.createElement("p");
    label.className = "section-label";
    label.textContent = "按卷进入";
    wrap.appendChild(label);
    const grid = document.createElement("div");
    grid.className = "vol-grid";
    state.catalog.volumes.forEach(function (vol) {
      const done = vol.articles.filter(function (art) { return state.progress.learned[art.id]; }).length;
      const next = vol.articles.find(function (art) { return !state.progress.learned[art.id]; }) || vol.articles[0];
      const card = document.createElement("a");
      card.className = "vol-card";
      card.href = "#/read/" + next.id;
      const strong = document.createElement("strong");
      strong.textContent = vol.title + " · " + vol.subtitle;
      const span = document.createElement("span");
      span.textContent = done + " / " + vol.articles.length + " 已读";
      const em = document.createElement("em");
      em.textContent = done === vol.articles.length ? "再读一遍" : "从《" + next.title + "》";
      card.appendChild(strong);
      card.appendChild(span);
      card.appendChild(em);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    main.appendChild(wrap);
    updateDock();
    renderCatalog();
  }

  async function showArticle(id) {
    const token = ++loadToken;
    closePopup();
    skeleton("正在打开篇目");
    const res = await fetch("data/articles/" + id + ".json");
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
    const mode = state.progress.mode || "parallel";
    const title = font === "t" ? art.title.t : art.title.s;
    const book = font === "t" ? art.book.t : art.book.s;
    const head = font === "t" ? art.sourceHead.t : art.sourceHead.s;
    const list = flatArticles();
    const pos = list.findIndex(function (item) { return item.id === art.id; });
    const wrap = document.createElement("article");
    wrap.className = "reader";
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = art.volumeTitle + " · " + art.volumeSubtitle + " · " + (pos + 1) + " / " + list.length;
    const h1 = document.createElement("h1");
    h1.textContent = title;
    const meta = document.createElement("p");
    meta.className = "meta";
    const metaBits = [book, head, art.author].filter(Boolean);
    if (state.progress.learned[art.id]) metaBits.push("已读完");
    meta.textContent = metaBits.join(" · ");
    wrap.appendChild(kicker);
    wrap.appendChild(h1);
    wrap.appendChild(meta);

    if (!art.annotated) {
      const banner = document.createElement("p");
      banner.className = "banner";
      banner.textContent = "这一篇已收入原文。点字可看《说文》本义。逐句语境义和系统讲解目前做到卷一。";
      wrap.appendChild(banner);
    }

    const tool = document.createElement("div");
    tool.className = "tool";
    tool.appendChild(modeSeg(mode));
    tool.appendChild(fontSeg(font));
    const pyBtn = document.createElement("button");
    pyBtn.type = "button";
    const pyOn = !!state.progress.pinyin;
    pyBtn.textContent = pyOn ? "隐藏拼音" : "显示拼音";
    pyBtn.setAttribute("aria-pressed", pyOn ? "true" : "false");
    if (pyOn) pyBtn.className = "primary";
    pyBtn.addEventListener("click", function () {
      state.progress.pinyin = !state.progress.pinyin;
      saveProgress();
      renderArticle(true);
    });
    tool.appendChild(pyBtn);
    const learn = document.createElement("button");
    learn.type = "button";
    const learned = !!state.progress.learned[art.id];
    learn.textContent = learned ? "已读完" : "标为已读";
    if (learned) learn.className = "primary";
    learn.addEventListener("click", function () {
      if (state.progress.learned[art.id]) delete state.progress.learned[art.id];
      else state.progress.learned[art.id] = Date.now();
      saveProgress();
      renderArticle(true);
    });
    tool.appendChild(learn);
    wrap.appendChild(tool);
    if (pyOn) {
      const hint = document.createElement("p");
      hint.className = "py-hint";
      hint.textContent = art.annotated
        ? "字上的拼音是这一句里的读音，带声调。"
        : "这一篇还没有逐句审定。字上是字书里的今读，破读可能不准，点开字再核对。";
      wrap.appendChild(hint);
    }

    if (mode === "lesson") {
      wrap.appendChild(renderLesson(art));
      if (!art.lesson) wrap.appendChild(renderBody(art, "read"));
    } else {
      wrap.appendChild(renderBody(art, mode));
    }

    const comment = art.classicComment && (font === "t" ? art.classicComment.t : art.classicComment.s);
    if (comment) {
      const box = document.createElement("section");
      box.className = "comment";
      const h2 = document.createElement("h2");
      h2.textContent = "原书评点";
      const p = document.createElement("p");
      p.textContent = comment;
      box.appendChild(h2);
      box.appendChild(p);
      wrap.appendChild(box);
    }

    const nav = neighbors(art.id);
    const pager = document.createElement("nav");
    pager.className = "pager";
    pager.appendChild(pagerLink(nav.prev, "上一篇"));
    pager.appendChild(pagerLink(nav.next, "下一篇"));
    wrap.appendChild(pager);

    main.replaceChildren(wrap);
    updateDock();
    window.scrollTo(0, y);
  }

  function modeSeg(mode) {
    const box = document.createElement("div");
    box.className = "seg";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "阅读视图");
    [["read", "原文"], ["parallel", "文白对照"], ["lesson", "系统讲解"]].forEach(function (pair) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = pair[1];
      if (mode === pair[0]) btn.className = "on";
      btn.addEventListener("click", function () {
        state.progress.mode = pair[0];
        saveProgress();
        renderArticle(true);
      });
      box.appendChild(btn);
    });
    return box;
  }

  function fontSeg(font) {
    const box = document.createElement("div");
    box.className = "seg";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "简繁");
    [["s", "简体"], ["t", "繁体"]].forEach(function (pair) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = pair[1];
      if (font === pair[0]) btn.className = "on";
      btn.addEventListener("click", function () {
        state.progress.font = pair[0];
        saveProgress();
        renderArticle(true);
      });
      box.appendChild(btn);
    });
    return box;
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

  function appendTokens(parent, tokens) {
    tokens.forEach(function (tok) {
      if (tok.punct) {
        const span = document.createElement("span");
        span.className = "punct";
        span.textContent = tok.t;
        parent.appendChild(span);
        return;
      }
      const word = document.createElement("span");
      word.className = "word";
      const chars = Array.from(tok.t);
      const shown = Array.from(fontOf(tok));
      if (shown.length !== chars.length) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "zi";
        const whole = readingOf(tok);
        if (state.progress.pinyin && whole.text) {
          const ruby = document.createElement("i");
          ruby.className = "py-ruby";
          ruby.textContent = whole.text;
          btn.appendChild(ruby);
        }
        btn.appendChild(document.createTextNode(fontOf(tok)));
        btn.addEventListener("click", function () { openPopup(tok, 0, btn); });
        word.appendChild(btn);
      } else {
        const reading = readingOf(tok);
        chars.forEach(function (ch, index) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "zi";
          if (state.progress.pinyin && reading.parts[index]) {
            const ruby = document.createElement("i");
            ruby.className = "py-ruby";
            ruby.textContent = reading.parts[index];
            btn.appendChild(ruby);
          }
          btn.appendChild(document.createTextNode(shown[index]));
          btn.addEventListener("click", function () { openPopup(tok, index, btn); });
          word.appendChild(btn);
        });
      }
      parent.appendChild(word);
    });
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
      return { parts: curated, source: "sentence", text: curated.join(" ") };
    }
    if (chars.length === 1 && curated.length) {
      const text = curated.join(" ");
      return { parts: [text], source: "sentence", text: text };
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
    if (tok.level === "sentence" && tok.ctx) ctx.textContent = tok.ctx;
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

  function updateDock() {
    const dock = document.getElementById("dock");
    const reading = !!(state.article && /^#\/read\//.test(location.hash || ""));
    dock.hidden = !reading;
    document.body.classList.toggle("is-reading", reading);
    if (!reading) return;
    const nav = neighbors(state.article.id);
    const prev = document.getElementById("dock-prev");
    const next = document.getElementById("dock-next");
    const py = document.getElementById("dock-py");
    prev.disabled = !nav.prev;
    next.disabled = !nav.next;
    prev.onclick = function () {
      if (nav.prev) location.hash = "#/read/" + nav.prev.id;
    };
    next.onclick = function () {
      if (nav.next) location.hash = "#/read/" + nav.next.id;
    };
    const on = !!state.progress.pinyin;
    py.setAttribute("aria-pressed", on ? "true" : "false");
    py.classList.toggle("on", on);
    py.onclick = function () {
      state.progress.pinyin = !state.progress.pinyin;
      saveProgress();
      if (state.article) renderArticle(true);
    };
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

  function closeNav() {
    shell.classList.remove("nav-open");
    document.getElementById("nav-toggle").setAttribute("aria-expanded", "false");
    document.getElementById("backdrop").hidden = true;
  }

  document.getElementById("nav-toggle").addEventListener("click", function () {
    const open = shell.classList.toggle("nav-open");
    this.setAttribute("aria-expanded", open ? "true" : "false");
    document.getElementById("backdrop").hidden = !open;
  });
  document.getElementById("backdrop").addEventListener("click", closeNav);
  scrim.addEventListener("click", closePopup);
  document.getElementById("continue-btn").addEventListener("click", function () {
    const id = state.progress.last || (state.catalog && state.catalog.volumes[0].articles[0].id);
    if (id) location.hash = "#/read/" + id;
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closePopup();
      closeNav();
    }
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
  });

  boot().catch(function (err) {
    main.innerHTML = "<p class='empty'>页面数据没有载入。请用本地服务器打开本站，不要直接双击文件。</p>";
    console.error(err);
  });
})();
