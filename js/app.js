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
  };

  const main = document.getElementById("main");
  const catalogEl = document.getElementById("catalog");
  const popup = document.getElementById("popup");
  const shell = document.querySelector(".shell");
  const topProgress = document.getElementById("top-progress");

  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      raw.learned = raw.learned || {};
      raw.font = raw.font === "t" ? "t" : "s";
      raw.mode = raw.mode || "parallel";
      return raw;
    } catch (err) {
      return { learned: {}, font: "s", mode: "parallel", last: "" };
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

  async function boot() {
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
      .then(function (data) { state.dict = data.chars || {}; })
      .catch(function () { state.dict = {}; });
  }

  function renderTop() {
    if (!state.catalog) return;
    const n = learnedCount();
    const total = state.catalog.articleCount;
    topProgress.textContent = "已读 " + n + " / " + total;
    const btn = document.getElementById("continue-btn");
    btn.textContent = state.progress.last ? "继续阅读" : "从首篇读起";
  }

  function renderCatalog() {
    if (!state.catalog) return;
    const q = state.query.trim();
    const root = document.createElement("div");
    const input = document.createElement("input");
    input.className = "catalog-search";
    input.placeholder = "搜索篇名";
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
      head.innerHTML = "<strong>" + vol.title + " · " + vol.subtitle + "</strong><span>" + done + "/" + vol.articles.length + "</span>";
      const list = document.createElement("ol");
      list.className = "vol-list";
      const opened = q || state.openVol === vol.volume;
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
        a.innerHTML = "<span class='idx'>" + art.index + "</span><span>" + art.title + "</span>";
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
    catalogEl.replaceChildren(root);
  }

  function route() {
    const hash = location.hash || "#/";
    const match = hash.match(/^#\/read\/(v\d{2}-\d{2})$/);
    if (match) showArticle(match[1]);
    else showHome();
  }

  function showHome() {
    state.article = null;
    const total = state.catalog.articleCount;
    const n = learnedCount();
    const pct = total ? Math.round((n / total) * 100) : 0;
    const first = state.catalog.volumes[0].articles[0];
    const last = state.progress.last ? findArticleMeta(state.progress.last) : null;
    main.innerHTML = "";
    const wrap = document.createElement("article");
    wrap.className = "home";
    wrap.innerHTML =
      "<p class='kicker'>吴楚材 · 吴调侯 选编</p>" +
      "<h1>古文观止</h1>" +
      "<p class='lead'>按原书十二卷、二百二十二篇的次序来读。从卷一第一篇《郑伯克段于鄢》开始，点开原文里的字，查看读音、《说文》本义和本句意思。卷一十八篇配有系统讲解；其余篇目已导入原文，可先通读、点字，讲解随后补。</p>" +
      "<div class='stats'>" +
      "<div class='stat'><b>" + total + "</b><span>全编篇目</span></div>" +
      "<div class='stat'><b>" + state.catalog.annotatedCount + "</b><span>已配系统讲解</span></div>" +
      "<div class='stat'><b>" + n + "</b><span>你已读完</span></div>" +
      "</div>" +
      "<div class='bar' aria-hidden='true'><i style='width:" + pct + "%'></i></div>";
    const actions = document.createElement("p");
    const start = document.createElement("a");
    start.className = "text-btn primary";
    start.href = "#/read/" + (last ? last.id : first.id);
    start.textContent = last ? "继续《" + last.title + "》" : "从《" + first.title + "》读起";
    start.style.display = "inline-block";
    actions.appendChild(start);
    wrap.appendChild(actions);
    main.appendChild(wrap);
    renderCatalog();
  }

  async function showArticle(id) {
    main.innerHTML = "<p class='empty'>正在打开篇目…</p>";
    const res = await fetch("data/articles/" + id + ".json");
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

  function renderArticle() {
    const art = state.article;
    const font = state.progress.font;
    const mode = state.progress.mode || "parallel";
    const title = font === "t" ? art.title.t : art.title.s;
    const book = font === "t" ? art.book.t : art.book.s;
    const head = font === "t" ? art.sourceHead.t : art.sourceHead.s;
    const wrap = document.createElement("article");
    wrap.className = "reader";
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = art.volumeTitle + " · " + art.volumeSubtitle + " · 第 " + art.index + " 篇";
    const h1 = document.createElement("h1");
    h1.textContent = title;
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = [book, head, art.author].filter(Boolean).join(" · ");
    wrap.appendChild(kicker);
    wrap.appendChild(h1);
    wrap.appendChild(meta);

    if (!art.annotated) {
      const banner = document.createElement("p");
      banner.className = "banner";
      banner.textContent = "这一篇已收入原文。点字可看《说文》本义和今读参考。逐句语境义和系统讲解目前做到卷一；其余各卷用同一套数据结构，可继续导入。";
      wrap.appendChild(banner);
    }

    const tool = document.createElement("div");
    tool.className = "tool";
    tool.appendChild(segment("原文", "read", mode));
    tool.appendChild(segment("文白对照", "parallel", mode));
    tool.appendChild(segment("系统讲解", "lesson", mode));
    tool.appendChild(segment(font === "t" ? "繁体" : "简体", "font", font));
    const learn = document.createElement("button");
    learn.type = "button";
    const learned = !!state.progress.learned[art.id];
    learn.textContent = learned ? "已读完" : "标为已读";
    learn.className = learned ? "primary" : "";
    learn.addEventListener("click", function () {
      if (state.progress.learned[art.id]) delete state.progress.learned[art.id];
      else state.progress.learned[art.id] = Date.now();
      saveProgress();
      renderArticle();
    });
    tool.appendChild(learn);
    wrap.appendChild(tool);

    if (mode === "lesson") {
      wrap.appendChild(renderLesson(art, font));
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
    window.scrollTo(0, 0);
  }

  function segment(label, kind, current) {
    const box = document.createElement("div");
    box.className = "seg";
    if (kind === "font") {
      ["s", "t"].forEach(function (value) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = value === "s" ? "简体" : "繁体";
        if (current === value) btn.className = "on";
        btn.addEventListener("click", function () {
          state.progress.font = value;
          saveProgress();
          renderArticle();
        });
        box.appendChild(btn);
      });
      return box;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    if (current === kind) btn.className = "on";
    btn.addEventListener("click", function () {
      state.progress.mode = kind;
      saveProgress();
      renderArticle();
    });
    box.appendChild(btn);
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
          orig.className = "orig";
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
        p.className = "orig para";
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
        btn.textContent = fontOf(tok);
        btn.addEventListener("click", function () { openPopup(tok, 0, btn); });
        word.appendChild(btn);
      } else {
        chars.forEach(function (ch, index) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "zi";
          btn.textContent = shown[index];
          btn.addEventListener("click", function () { openPopup(tok, index, btn); });
          word.appendChild(btn);
        });
      }
      parent.appendChild(word);
    });
  }

  function renderLesson(art, font) {
    const box = document.createElement("div");
    box.className = "lesson";
    if (!art.lesson) {
      const p = document.createElement("p");
      p.textContent = "本篇的系统讲解还没有写入。你可以先读原文，点开每个字看《说文》本义。";
      box.appendChild(p);
      return box;
    }
    const lesson = art.lesson;
    addSection(box, "作者与背景", lesson.background);
    addList(box, "重点实词", lesson.keyContentWords, function (item) {
      return item.word + "（" + item.reading + "）：" + item.note;
    });
    addList(box, "重点虚词", lesson.keyFunctionWords, function (item) {
      return item.word + "（" + item.reading + "）：" + item.note;
    });
    addList(box, "古今异义", lesson.ancientModern, function (item) {
      return item.word + "：" + item.note;
    });
    addList(box, "通假字", lesson.phoneticLoans, function (item) {
      return item.word + "通「" + item.loan + "」。" + item.note;
    });
    addList(box, "词类活用", lesson.flexibleUsage, function (item) {
      return item.word + "：" + item.note;
    });
    addList(box, "特殊句式", lesson.specialSyntax, function (item) {
      return item.name + "：" + item.note;
    });
    addSection(box, "文章主旨", lesson.theme);
    addSection(box, "写作手法", lesson.technique);

    const h2 = document.createElement("h2");
    h2.textContent = "逐句白话";
    box.appendChild(h2);
    const ol = document.createElement("ol");
    art.paragraphs.forEach(function (para) {
      para.sentences.forEach(function (sent) {
        if (!sent.tr) return;
        const li = document.createElement("li");
        const orig = document.createElement("div");
        orig.className = "orig";
        orig.style.fontSize = "1.05rem";
        appendTokens(orig, sent.tokens);
        const vern = document.createElement("div");
        vern.className = "vern";
        vern.textContent = sent.tr;
        li.appendChild(orig);
        li.appendChild(vern);
        ol.appendChild(li);
      });
    });
    box.appendChild(ol);
    return box;
  }

  function addSection(box, title, text) {
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(h2);
    box.appendChild(p);
  }

  function addList(box, title, items, format) {
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const ul = document.createElement("ul");
    (items || []).forEach(function (item) {
      const li = document.createElement("li");
      li.textContent = format(item);
      ul.appendChild(li);
    });
    box.appendChild(h2);
    box.appendChild(ul);
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
    if (!state.dict) return null;
    return state.dict[ch] || null;
  }

  function openPopup(tok, index, anchor) {
    const chars = Array.from(tok.t);
    const focus = chars[index] || chars[0];
    const entry = lookup(focus);
    const title = state.progress.font === "t" ? tok.t : (tok.s || tok.t);
    const py = tok.py || (entry && entry.py) || "";
    popup.hidden = false;
    popup.innerHTML = "";
    const head = document.createElement("header");
    const h3 = document.createElement("h3");
    h3.id = "popup-title";
    h3.textContent = title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close-x";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", closePopup);
    head.appendChild(h3);
    head.appendChild(close);
    popup.appendChild(head);

    const pyEl = document.createElement("p");
    pyEl.className = "py";
    pyEl.textContent = py || "（读音未收）";
    popup.appendChild(pyEl);

    const tags = document.createElement("div");
    tags.className = "tags";
    if (tok.level === "sentence") tags.appendChild(tag("本句读音", "seal"));
    else tags.appendChild(tag("今读参考", ""));
    if (tok.pos) tags.appendChild(tag(tok.pos, ""));
    if (tok.extra) tags.appendChild(tag(tok.extra, "seal"));
    popup.appendChild(tags);

    const ctx = document.createElement("p");
    ctx.className = "ctx";
    if (tok.level === "sentence" && tok.ctx) {
      ctx.textContent = "本句义：" + tok.ctx;
    } else {
      ctx.textContent = "本句义：这一篇还没有逐句审定的义项。下面是《说文》本义，用来帮助判断，不等于已经核定的句中义。";
    }
    popup.appendChild(ctx);

    chars.forEach(function (ch, i) {
      const info = lookup(ch) || {};
      const block = document.createElement("section");
      block.className = "char-block";
      if (ch === focus) block.style.background = "#fff6ee";
      const h4 = document.createElement("h4");
      const simp = state.progress.font === "t" ? ch : (info && state.dict ? ch : ch);
      h4.textContent = (state.progress.font === "s" ? Array.from(tok.s || tok.t)[i] || ch : ch) + (ch !== (Array.from(tok.s || "")[i] || ch) ? "（" + ch + "）" : "");
      const sub = document.createElement("p");
      sub.className = "sub";
      const bits = [];
      if (info.py) bits.push(info.py);
      if (info.fanqie) bits.push("反切：" + info.fanqie);
      sub.textContent = bits.join(" · ");
      const ben = document.createElement("p");
      const benText = state.progress.font === "t" ? (info.ben || "") : (info.benS || info.ben || "");
      ben.textContent = info.inShuowen === false || !benText
        ? "《说文解字》未收此字。"
        : "本义：《说文》" + benText;
      block.appendChild(h4);
      if (bits.length) block.appendChild(sub);
      block.appendChild(ben);
      popup.appendChild(block);
    });

    placePopup(anchor);
  }

  function tag(text, kind) {
    const span = document.createElement("span");
    span.className = "tag" + (kind ? " " + kind : "");
    span.textContent = text;
    return span;
  }

  function placePopup(anchor) {
    if (window.matchMedia("(max-width: 860px)").matches) {
      popup.style.left = "0";
      popup.style.top = "auto";
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
    popup.style.left = left + "px";
    popup.style.top = top + "px";
  }

  function closePopup() {
    popup.hidden = true;
    popup.innerHTML = "";
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
    if (event.target.closest && event.target.closest(".zi, .word button")) return;
    closePopup();
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", function () {
    if (!popup.hidden) closePopup();
  });

  boot().catch(function (err) {
    main.innerHTML = "<p class='empty'>页面数据没有载入。请用本地服务器打开本站，不要直接双击文件。</p>";
    console.error(err);
  });
})();
