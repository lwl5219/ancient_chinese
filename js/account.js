(function () {
  "use strict";

  var API = String(window.API_BASE || "").replace(/\/$/, "");
  var TOKEN_KEY = "gwgz-session-v1";
  var enabled = false;
  var queue = [];
  var flushTimer = 0;
  var flushing = false;

  window.gwgzAccount = {
    route: function () { return false; },
    track: function () {},
    ready: false,
  };
  if (!API) return;

  function bridge() { return window.gwgzAccountBridge || null; }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return ""; }
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
  }

  function request(method, path, body) {
    var headers = { "Content-Type": "application/json" };
    if (token()) headers.Authorization = "Bearer " + token();
    return fetch(API + path, {
      method: method,
      headers: headers,
      body: body == null ? undefined : JSON.stringify(body),
      keepalive: method === "POST" && path === "/events",
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

  function flush() {
    if (!enabled || !token() || flushing || !queue.length) return;
    var batch = queue.splice(0, 20);
    flushing = true;
    request("POST", "/events", { events: batch }).catch(function () {
      return null;
    }).then(function () {
      flushing = false;
      if (queue.length) flush();
    });
  }

  function track(event) {
    if (!enabled || !token() || !event || !event.type) return;
    var item = { type: event.type, ts: Date.now() };
    if (event.pieceId) item.pieceId = String(event.pieceId).slice(0, 80);
    if (event.payload && typeof event.payload === "object") item.payload = event.payload;
    queue.push(item);
    if (queue.length >= 8) flush();
    else {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 4000);
    }
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

  function renderLogin() {
    if (token()) {
      location.hash = "#/me";
      return;
    }
    openPage("登录", function (wrap) {
      wrap.appendChild(el("p", "lead", "登录是可选的。现在只在这台设备上记住你的账号。不登录也可以照常阅读。"));
      var form = el("form", "account-form");
      form.addEventListener("submit", function (event) { event.preventDefault(); });
      var emailLabel = el("label", "", "邮箱");
      emailLabel.setAttribute("for", "account-email");
      var email = el("input");
      email.id = "account-email";
      email.type = "email";
      email.autocomplete = "email";
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
          refreshEntry();
          location.hash = "#/me";
        }).catch(function (error) {
          formMessage(error.message || "没有登录", true);
        }).then(function () { go.disabled = false; });
      });
    });
  }

  function renderMe() {
    if (!token()) {
      location.hash = "#/login";
      return;
    }
    openPage("我的", function (wrap) {
      var who = el("p", "meta", "正在读取账号");
      wrap.appendChild(who);
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
        if (!window.confirm("删除账号后，云端的邮箱、会话和行为记录会清除，不能恢复。")) return;
        request("DELETE", "/account").then(function () {
          clearToken();
          refreshEntry();
          location.hash = "#/";
        }).catch(function (error) {
          err.textContent = error.message || "没有删除";
        });
      });
      request("GET", "/me").then(function (data) {
        who.textContent = data.email || "";
      }).catch(function (error) {
        if (!token()) {
          location.hash = "#/login";
          return;
        }
        who.textContent = "";
        err.textContent = error.message || "没有读到账号";
      });
    });
  }

  function paragraphs(wrap, lines) {
    lines.forEach(function (line) { wrap.appendChild(el("p", "", line)); });
  }

  function renderTerms() {
    openPage("用户协议", function (wrap) {
      paragraphs(wrap, [
        "典籍是一个个人读书网站。不登录可以阅读已经发布的篇目，阅读记录保存在你自己的浏览器里。",
        "登录是可选的。请使用你自己的邮箱。验证码只用于登录，不要转给别人。",
        "可以随时在「我的」里退出，或删除账号。删除后，云端保存的邮箱、会话和行为记录会清除。",
        "网站按现状提供，不保证不中断。继续使用登录功能，即表示你同意本页和隐私政策。",
      ]);
    });
  }

  function renderPrivacy() {
    openPage("隐私政策", function (wrap) {
      paragraphs(wrap, [
        "不登录时，阅读进度、字体、拼音和逐句开关只存在这台设备的本地存储里，不会上传。",
        "登录后，服务器保存邮箱和登录会话。会话是一串保存在本机本地存储里的令牌，不放进 Cookie。请不要在公共设备上保持登录。",
        "验证码通过阿里云邮件推送发到你的邮箱。验证码是 6 位数字，10 分钟后失效。服务器只保存验证码的哈希，不保存明文。",
        "未登录时，打开篇目和查字都不会上传。登录之后，才会记下两类行为：打开了哪一篇（page_view），以及查了哪个字（char_lookup）。这些记录先暂存在页面里，再成批发给服务器，只挂在你的账号下。",
        "账号和行为数据存放在阿里云香港的函数计算和表格存储。邮件从邮件推送发出，发信域名是 mail.lucca.top。",
        "这些资料不出售，也不用来发广告。网站另有百度统计和不蒜子的访问计数，与账号无关。",
        "在「我的」里删除账号后，云端的用户、会话、验证码和记在该账号下的行为记录会删除。浏览器里的本地阅读进度需要你自己清除。",
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

  function pieceFromHash() {
    var hash = location.hash || "";
    var read = hash.match(/^#\/read\/((?:v|h|z|d|l)\d{2}-\d{2})$/);
    if (read) return read[1];
    var poem = hash.match(/^#\/(tang|ci|ke)\/([a-z0-9-]+)$/);
    if (poem) return poem[1] + ":" + poem[2];
    return "";
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    window.gwgzAccount.route = route;
    window.gwgzAccount.track = track;
    window.gwgzAccount.ready = true;
    mountEntry();
    if (/^#\/(login|me|terms|privacy)$/.test(location.hash || "")) {
      try { window.dispatchEvent(new HashChangeEvent("hashchange")); } catch (_) { route(location.hash); }
    } else if (token()) {
      var id = pieceFromHash();
      if (id) track({ type: "page_view", pieceId: id });
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  window.addEventListener("hashchange", refreshEntry);
  enable();
})();
