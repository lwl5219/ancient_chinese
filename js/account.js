(function () {
  "use strict";

  var API = String(window.API_BASE || "").replace(/\/$/, "");
  var TOKEN_KEY = "gwgz-session-v1";
  var BOOK_KEY = "gwgz-bookmarks-v1";
  var UPDATED_KEY = "gwgz-state-updated-at";
  var enabled = false;
  var applying = false;
  var pushTimer = 0;
  var pushing = false;
  var queued = false;

  window.gwgzAccount = {
    route: function () { return false; },
    onProgress: function () {},
    decorateReader: function () {},
  };
  if (!API) return;

  function bridge() { return window.gwgzAccountBridge || null; }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return ""; }
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
  }

  function readUpdatedAt() {
    try {
      var n = Number(localStorage.getItem(UPDATED_KEY) || 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (_) { return 0; }
  }

  function setUpdatedAt(n) {
    try { localStorage.setItem(UPDATED_KEY, String(n || 0)); } catch (_) {}
  }

  function readBookmarks() {
    try {
      var raw = JSON.parse(localStorage.getItem(BOOK_KEY) || "[]");
      return window.gwgzMerge ? window.gwgzMerge.mergeBookmarks(raw, []) : [];
    } catch (_) { return []; }
  }

  function writeBookmarks(list) {
    try { localStorage.setItem(BOOK_KEY, JSON.stringify(list || [])); } catch (_) {}
  }

  function visibleBookmarks() {
    return readBookmarks().filter(function (item) { return !item.deleted; });
  }

  function hasBookmark(id) {
    return visibleBookmarks().some(function (item) { return item.id === id; });
  }

  function request(method, path, body) {
    var headers = { "Content-Type": "application/json" };
    if (token()) headers.Authorization = "Bearer " + token();
    return fetch(API + path, {
      method: method,
      headers: headers,
      body: body == null ? undefined : JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) {
          clearToken();
          refreshEntry();
        }
        if (!res.ok) {
          var err = new Error((data && data.error) || "请求失败");
          err.status = res.status;
          throw err;
        }
        return data || {};
      });
    });
  }

  function localSnapshot() {
    var api = bridge();
    var progress = api && api.readProgress ? api.readProgress() : {};
    progress.updatedAt = readUpdatedAt();
    return { bookmarks: readBookmarks(), state: progress };
  }

  function applyMerged(data) {
    applying = true;
    try {
      if (data && data.bookmarks) writeBookmarks(data.bookmarks);
      if (data && data.state) {
        setUpdatedAt(data.state.updatedAt || 0);
        var api = bridge();
        if (api && api.applyProgress) api.applyProgress(data.state);
      }
    } finally {
      applying = false;
    }
    refreshEntry();
    if ((location.hash || "") === "#/me") renderMe(true);
    else {
      var api = bridge();
      if (api && api.rerender) api.rerender();
    }
  }

  function push() {
    if (!enabled || !token()) return Promise.resolve();
    if (pushing) {
      queued = true;
      return Promise.resolve();
    }
    pushing = true;
    return request("PUT", "/sync", localSnapshot()).then(applyMerged).catch(function () {}).then(function () {
      pushing = false;
      if (queued) {
        queued = false;
        return push();
      }
    });
  }

  function schedulePush() {
    if (!token()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = 0;
      push();
    }, 1500);
  }

  function onProgress() {
    if (!enabled || applying) return;
    setUpdatedAt(Date.now());
    schedulePush();
  }

  function toggleBookmark(mark) {
    var list = readBookmarks();
    var index = -1;
    list.forEach(function (item, i) { if (item.id === mark.id) index = i; });
    if (index >= 0 && !list[index].deleted) {
      list[index] = {
        id: list[index].id, kind: list[index].kind, href: list[index].href,
        title: list[index].title, quote: list[index].quote, at: Date.now(), deleted: true,
      };
    } else {
      mark.at = Date.now();
      mark.deleted = false;
      if (index >= 0) list[index] = mark;
      else list.push(mark);
    }
    writeBookmarks(window.gwgzMerge.mergeBookmarks(list, []));
    schedulePush();
  }

  function pieceRef() {
    var hash = location.hash || "";
    var read = hash.match(/^#\/read\/((?:v|h|z|d|l)\d{2}-\d{2})$/);
    if (read) return { id: "piece:" + read[1], href: "#/read/" + read[1] };
    var poem = hash.match(/^#\/(tang|ci|ke)\/([a-z0-9-]+)$/);
    if (poem) return { id: "piece:" + poem[1] + ":" + poem[2], href: "#/" + poem[1] + "/" + poem[2] };
    return null;
  }

  function paintPiece(btn, ref) {
    var on = hasBookmark(ref.id);
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "已加书签" : "书签";
  }

  function paintSent(btn) {
    var ref = pieceRef();
    var on = !!(ref && hasBookmark("sent:" + ref.id.slice(6) + ":" + btn.dataset.index));
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "移去这句书签" : "给这句加书签");
    btn.textContent = on ? "★" : "☆";
  }

  function decorateReader() {
    if (!enabled) return;
    var root = document.querySelector("#main article.reader");
    if (!root || root.querySelector(".bookmark-piece")) return;
    var h1 = root.querySelector("h1");
    var ref = pieceRef();
    if (!h1 || !ref) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bookmark-piece";
    paintPiece(btn, ref);
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggleBookmark({ id: ref.id, kind: "piece", href: ref.href, title: h1.textContent || "这篇", at: Date.now() });
      paintPiece(btn, ref);
    });
    h1.insertAdjacentElement("afterend", btn);
    var n = 0;
    root.querySelectorAll(".pair").forEach(function (pair) {
      var index = n;
      n += 1;
      var orig = pair.querySelector(".orig");
      var sent = document.createElement("button");
      sent.type = "button";
      sent.className = "bookmark-sent";
      sent.dataset.index = String(index);
      paintSent(sent);
      sent.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var quote = orig ? String(orig.textContent || "").replace(/\s+/g, "").slice(0, 42) : "";
        toggleBookmark({
          id: "sent:" + ref.id.slice(6) + ":" + index,
          kind: "sentence",
          href: ref.href,
          title: h1.textContent || "这一句",
          quote: quote,
          at: Date.now(),
        });
        paintSent(sent);
      });
      pair.appendChild(sent);
    });
  }

  function refreshEntry() {
    var link = document.querySelector(".account-entry");
    if (!link) return;
    if (token()) {
      link.textContent = "我的";
      link.href = "#/me";
    } else {
      link.textContent = "登录";
      link.href = "#/login";
    }
  }

  function mountEntry() {
    if (document.querySelector(".account-entry")) return refreshEntry();
    var header = document.querySelector("header.top");
    if (!header) return;
    var link = document.createElement("a");
    link.className = "account-entry";
    header.appendChild(link);
    refreshEntry();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function openPage(title, fill) {
    var api = bridge();
    if (api && api.preparePage) api.preparePage();
    var wrap = el("article", "home account-page");
    wrap.appendChild(el("h1", "", title));
    fill(wrap);
    var main = document.getElementById("main");
    if (main) main.replaceChildren(wrap);
    document.title = title + " · 典籍";
  }

  function legalLinks(parent) {
    var p = el("p", "account-links");
    var terms = el("a", "", "用户协议");
    terms.href = "#/terms";
    var privacy = el("a", "", "隐私政策");
    privacy.href = "#/privacy";
    p.appendChild(terms);
    p.appendChild(document.createTextNode(" · "));
    p.appendChild(privacy);
    parent.appendChild(p);
  }

  function note(parent, text) {
    parent.appendChild(el("p", "lead", text));
  }

  function renderLogin() {
    if (token()) {
      location.hash = "#/me";
      return;
    }
    openPage("登录", function (wrap) {
      note(wrap, "登录以后，书签和阅读进度可以在你自己的几台设备之间同步。不登录也可以照常阅读，记录仍只留在这台设备上。");
      var form = el("form", "account-form");
      form.addEventListener("submit", function (event) { event.preventDefault(); });
      var emailLabel = el("label", "", "邮箱");
      emailLabel.setAttribute("for", "account-email");
      var email = el("input");
      email.id = "account-email";
      email.type = "email";
      email.autocomplete = "email";
      email.required = true;
      email.maxLength = 254;
      var codeLabel = el("label", "", "验证码");
      codeLabel.setAttribute("for", "account-code");
      var code = el("input");
      code.id = "account-code";
      code.inputMode = "numeric";
      code.autocomplete = "one-time-code";
      code.maxLength = 6;
      code.hidden = true;
      codeLabel.hidden = true;
      var err = el("p", "account-error", "");
      var actions = el("div", "account-actions");
      var sendBtn = el("button", "text-btn", "发送验证码");
      sendBtn.type = "button";
      var go = el("button", "text-btn", "登录");
      go.type = "button";
      go.hidden = true;
      actions.appendChild(sendBtn);
      actions.appendChild(go);
      form.appendChild(emailLabel);
      form.appendChild(email);
      form.appendChild(codeLabel);
      form.appendChild(code);
      form.appendChild(err);
      form.appendChild(actions);
      wrap.appendChild(form);
      legalLinks(wrap);

      function formMessage(text, failed) {
        err.textContent = text || "";
        err.className = failed ? "account-error" : "meta";
      }
      sendBtn.addEventListener("click", function () {
        formMessage("");
        sendBtn.disabled = true;
        request("POST", "/auth/request-code", { email: email.value }).then(function () {
          code.hidden = false;
          codeLabel.hidden = false;
          go.hidden = false;
          formMessage("验证码已发出，10 分钟内有效。");
          code.focus();
        }).catch(function (error) {
          formMessage(error.message || "没有发出去", true);
        }).then(function () { sendBtn.disabled = false; });
      });
      go.addEventListener("click", function () {
        formMessage("");
        go.disabled = true;
        request("POST", "/auth/verify", { email: email.value, code: code.value }).then(function (data) {
          try { localStorage.setItem(TOKEN_KEY, data.token); } catch (_) {}
          return request("PUT", "/sync", localSnapshot());
        }).then(function (merged) {
          applyMerged(merged);
          location.hash = "#/me";
        }).catch(function (error) {
          formMessage(error.message || "没有登录", true);
        }).then(function () { go.disabled = false; });
      });
    });
  }

  function renderMe(fromSync) {
    if (!token()) {
      location.hash = "#/login";
      return;
    }
    openPage("我的", function (wrap) {
      var who = el("p", "meta", "正在读取账号");
      wrap.appendChild(who);
      var books = el("div");
      var recent = el("div");
      wrap.appendChild(books);
      wrap.appendChild(recent);
      var actions = el("div", "account-actions");
      var out = el("button", "text-btn", "退出登录");
      out.type = "button";
      var del = el("button", "text-btn danger", "删除账号");
      del.type = "button";
      actions.appendChild(out);
      actions.appendChild(del);
      wrap.appendChild(actions);
      var err = el("p", "account-error", "");
      wrap.appendChild(err);
      legalLinks(wrap);
      out.addEventListener("click", function () {
        request("POST", "/auth/logout").catch(function () {}).then(function () {
          clearToken();
          refreshEntry();
          location.hash = "#/login";
        });
      });
      del.addEventListener("click", function () {
        if (!window.confirm("删除账号后，云端的邮箱、书签和阅读进度会清除，不能恢复。这台设备上的阅读记录还会留下。")) return;
        request("DELETE", "/account").then(function () {
          clearToken();
          refreshEntry();
          location.hash = "#/";
        }).catch(function (error) {
          err.textContent = error.message || "没有删除";
        });
      });
      fillBookmarks(books, visibleBookmarks());
      fillRecent(recent);
      var pending = fromSync ? Promise.resolve(null) : push();
      pending.then(function () { return request("GET", "/me"); }).then(function (data) {
        if (!data) return;
        who.textContent = data.email || "";
        fillBookmarks(books, visibleBookmarks());
        fillRecent(recent);
      }).catch(function (error) {
        if (!token()) {
          location.hash = "#/login";
          return;
        }
        who.textContent = "";
        err.textContent = error.message || "没有读到账号";
        fillBookmarks(books, visibleBookmarks());
        fillRecent(recent);
      });
    });
  }

  function fillBookmarks(parent, list) {
    parent.replaceChildren();
    parent.appendChild(el("h2", "", "书签"));
    if (!list.length) {
      parent.appendChild(el("p", "meta", "还没有书签。读一篇时，可以在题目下收藏。逐句阅读时，句末的星号可以收藏那一句。"));
      return;
    }
    var ul = el("ul", "account-list");
    list.forEach(function (item) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = item.href;
      a.textContent = item.title;
      if (item.kind === "sentence" && item.quote) {
        var small = document.createElement("small");
        small.textContent = item.quote;
        a.appendChild(small);
      }
      li.appendChild(a);
      ul.appendChild(li);
    });
    parent.appendChild(ul);
  }

  function fillRecent(parent) {
    parent.replaceChildren();
    parent.appendChild(el("h2", "", "最近阅读"));
    var api = bridge();
    var progress = api && api.readProgress ? api.readProgress() : { learned: {}, last: "" };
    var rows = Object.keys(progress.learned || {}).map(function (id) {
      return { id: id, at: progress.learned[id] };
    }).sort(function (a, b) { return b.at - a.at; }).slice(0, 8);
    if (progress.last && !rows.some(function (row) { return row.id === progress.last; })) {
      rows.unshift({ id: progress.last, at: 0 });
    }
    if (!rows.length) {
      parent.appendChild(el("p", "meta", "还没有读完的篇目。"));
      return;
    }
    var ul = el("ul", "account-list");
    rows.forEach(function (row) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#/read/" + row.id;
      a.textContent = api && api.lookupTitle ? api.lookupTitle(row.id) : row.id;
      li.appendChild(a);
      ul.appendChild(li);
    });
    parent.appendChild(ul);
  }

  function paragraphs(wrap, lines) {
    lines.forEach(function (line) { wrap.appendChild(el("p", "", line)); });
  }

  function renderTerms() {
    openPage("用户协议", function (wrap) {
      paragraphs(wrap, [
        "典籍是一个个人读书网站。不登录可以阅读已经发布的篇目，阅读记录保存在你自己的浏览器里。",
        "登录是可选的，只用来在你自己的设备之间同步书签和阅读进度。请使用你自己的邮箱。验证码只用于登录，不要转给别人。",
        "书签和进度由你自己产生。可以随时在「我的」里退出，或删除账号。删除后，云端保存的邮箱、会话、书签和进度会清除。",
        "网站按现状提供，不保证不中断。继续使用登录功能，即表示你同意本页和隐私政策。",
      ]);
    });
  }

  function renderPrivacy() {
    openPage("隐私政策", function (wrap) {
      paragraphs(wrap, [
        "不登录时，阅读进度、字体、拼音和逐句开关只存在这台设备的本地存储里，不会上传。",
        "登录后，服务器保存：邮箱、登录会话、书签（某一篇或某一句），以及阅读进度（上次读到的篇目、已读篇目、字体、拼音和逐句开关）。",
        "验证码通过阿里云邮件推送发到你的邮箱。验证码是 6 位数字，10 分钟后失效。服务器只保存验证码的哈希，不保存明文。",
        "账号数据存放在阿里云香港的函数计算和表格存储。邮件从邮件推送发出，发信域名是 mail.lucca.top。",
        "会话是一串保存在本机本地存储里的令牌，不放进 Cookie。请不要在公共设备上保持登录。",
        "这些资料不出售，也不用来发广告。网站另有百度统计和不蒜子的访问计数，与账号无关。",
        "在「我的」里删除账号后，云端的用户、会话、验证码和同步数据会删除。浏览器里的本地记录需要你自己清除。",
      ]);
    });
  }

  function route(hash) {
    if (!enabled) return false;
    if (hash === "#/login") { renderLogin(); return true; }
    if (hash === "#/me") { renderMe(); return true; }
    if (hash === "#/terms") { renderTerms(); return true; }
    if (hash === "#/privacy") { renderPrivacy(); return true; }
    return false;
  }

  function enable() {
    if (enabled || !window.gwgzMerge) return;
    enabled = true;
    window.gwgzAccount.route = route;
    window.gwgzAccount.onProgress = onProgress;
    window.gwgzAccount.decorateReader = decorateReader;
    mountEntry();
    if (/^#\/(login|me|terms|privacy)$/.test(location.hash || "")) {
      try { window.dispatchEvent(new HashChangeEvent("hashchange")); } catch (_) { route(location.hash); }
    } else {
      decorateReader();
    }
    if (token()) push();
  }

  document.addEventListener("visibilitychange", function () {
    if (!enabled || document.visibilityState !== "visible" || !token() || pushTimer) return;
    push();
  });
  window.addEventListener("hashchange", refreshEntry);

  fetch(API + "/health", { method: "GET", cache: "no-store" }).then(function (res) {
    if (res && res.ok) enable();
  }).catch(function () {});
})();
