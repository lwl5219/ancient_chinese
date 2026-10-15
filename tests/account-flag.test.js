"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function bootSource() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const marker = "window.API_BASE =";
  const start = html.indexOf(marker);
  assert.notEqual(start, -1);
  const from = html.indexOf("(function () {", start);
  const end = html.indexOf("</script>", from);
  return html.slice(from, end);
}

function runBoot(options) {
  const created = [];
  const fetches = [];
  const header = {
    children: [],
    appendChild(node) { this.children.push(node); },
  };
  const storage = Object.assign({ getItem() { return ""; }, setItem() {}, removeItem() {} }, options.storage || {});
  const location = { hash: options.hash || "#/" };
  const window = {
    API_BASE: options.apiBase,
    requestIdleCallback: function (fn) { fn(); },
    addEventListener() {},
  };
  const document = {
    body: { appendChild(node) { created.push(node); } },
    addEventListener() {},
    querySelector(sel) {
      if (sel === "header.top") return header;
      if (sel === ".account-entry") return header.children[0] || null;
      return null;
    },
    createElement() {
      const node = {
        listeners: {},
        addEventListener(type, fn) { node.listeners[type] = fn; },
      };
      created.push(node);
      return node;
    },
  };
  const context = vm.createContext({
    window: window,
    document: document,
    localStorage: storage,
    location: location,
    fetch(url) {
      fetches.push(url);
      return Promise.resolve({ ok: options.healthOk === true });
    },
  });
  vm.runInContext(bootSource(), context, { filename: "index-boot.js" });
  return { created: created, fetches: fetches, header: header, location: location, window: window };
}

test("the page points at the API and still lazy-loads account code", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /window\.API_BASE\s*=\s*"https:\/\/api\.lucca\.top"/);
  assert.match(html, /if\s*\(\s*!API\s*\)\s*return/);
  assert.equal(html.split("js/account.js").length, 2);
  assert.doesNotMatch(html, /<script src="js\/account(?:\.[0-9a-f]{12})?\.js"><\/script>/);
  assert.doesNotMatch(html, /<script src="js\/sync-merge(?:\.[0-9a-f]{12})?\.js"><\/script>/);
});

test("logged-out boot does nothing until health succeeds, then only shows 登录", async () => {
  const off = runBoot({ apiBase: "" });
  assert.equal(off.fetches.length, 0);
  assert.equal(off.created.length, 0);
  assert.equal(off.header.children.length, 0);

  const down = runBoot({ apiBase: "https://api.example", healthOk: false });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.deepEqual(down.fetches, ["https://api.example/health"]);
  assert.equal(down.header.children.length, 0);
  assert.equal(down.created.some(function (node) { return node.src; }), false);

  const up = runBoot({ apiBase: "https://api.example", healthOk: true });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.deepEqual(up.fetches, ["https://api.example/health"]);
  assert.equal(up.header.children.length, 1);
  assert.equal(up.header.children[0].textContent, "登录");
  assert.equal(up.created.some(function (node) { return node.src; }), false);

  up.window.gwgzAccount = { ready: true, route() { up.routed = true; } };
  up.header.children[0].listeners.click({ preventDefault() {} });
  assert.equal(up.created.some(function (node) { return node.src; }), false);
  assert.equal(up.location.hash, "#/login");
});

test("a stored token loads account code without waiting for health", () => {
  const booted = runBoot({
    apiBase: "https://api.example",
    storage: { getItem() { return "session-token-value"; } },
  });
  assert.equal(booted.fetches.length, 0);
  assert.equal(booted.created.some(function (node) { return node.src === "js/account.js"; }), true);
  assert.equal(booted.header.children.length, 0);
});

test("the account module does not store or request anything when API_BASE is empty", () => {
  const window = {
    addEventListener() {},
    API_BASE: "",
  };
  let fetched = false;
  let wrote = false;
  const context = vm.createContext({
    window: window,
    document: {
      addEventListener() {},
      querySelector() { return null; },
      getElementById() { return null; },
      createElement() { return { style: {} }; },
    },
    localStorage: {
      getItem() { return null; },
      setItem() { wrote = true; },
      removeItem() { wrote = true; },
    },
    location: { hash: "#/login" },
    fetch() { fetched = true; return Promise.reject(new Error("no")); },
    console: { error() {}, log() {} },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "js/account.js"), "utf8"), context, { filename: "js/account.js" });
  assert.equal(fetched, false);
  assert.equal(wrote, false);
  assert.equal(window.gwgzAccount.route("#/login"), false);
  assert.equal(window.gwgzAccount.route("#/me"), false);
  assert.equal(window.gwgzAccount.ready, false);
});

test("account code sends events only after login", async () => {
  const calls = [];
  let stored = "";
  const window = {
    addEventListener() {},
    API_BASE: "https://api.example",
  };
  const context = vm.createContext({
    window: window,
    document: {
      addEventListener() {},
      querySelector() { return null; },
      getElementById() { return null; },
      createElement() { return { style: {}, addEventListener() {}, appendChild() {} }; },
    },
    localStorage: {
      getItem() { return stored; },
      setItem(key, value) { stored = value; },
      removeItem() { stored = ""; },
    },
    location: { hash: "#/" },
    fetch(url, options) {
      calls.push({ url: url, body: options && options.body });
      return Promise.resolve({ ok: true, status: 200, json() { return Promise.resolve({ ok: true }); } });
    },
    console: { error() {}, log() {} },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "js/account.js"), "utf8"), context, { filename: "js/account.js" });
  window.gwgzAccount.track({ type: "page_view", pieceId: "v01-01" });
  window.gwgzAccount.track({ type: "char_lookup", pieceId: "v01-01", payload: { ch: "郑" } });
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  assert.equal(calls.length, 0);
  stored = "session-token-value";
  for (let i = 0; i < 8; i += 1) window.gwgzAccount.track({ type: "page_view", pieceId: "v01-01" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example/events");
  assert.equal(calls[0].body.includes("deviceId"), false);
  assert.equal(calls[0].body.includes("page_view"), true);
});

test("event piece ids stay inside the server charset", async () => {
  const calls = [];
  const window = { addEventListener() {}, API_BASE: "https://api.example" };
  const context = vm.createContext({
    window: window,
    document: {
      addEventListener() {},
      querySelector() { return null; },
      getElementById() { return null; },
      createElement() { return { style: {}, addEventListener() {}, appendChild() {} }; },
    },
    localStorage: {
      getItem() { return "session-token-value"; },
      setItem() {},
      removeItem() {},
    },
    location: { hash: "#/" },
    fetch(url, options) {
      calls.push({ url: url, body: options && options.body });
      return Promise.resolve({ ok: true, status: 200, json() { return Promise.resolve({ ok: true }); } });
    },
    console: { error() {}, log() {} },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Math: Math,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "js/account.js"), "utf8"), context, { filename: "js/account.js" });
  const samples = ["v01-01", "tang:t010", "古文/郑伯克段于鄢", "ke/静夜思", "a/b", "郑"];
  samples.forEach(function (pieceId) {
    window.gwgzAccount.track({ type: "page_view", pieceId: pieceId });
    window.gwgzAccount.track({ type: "char_lookup", pieceId: pieceId, payload: { ch: "床" } });
  });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.equal(calls.length, 2);
  const sent = JSON.parse(calls[0].body).events.concat(JSON.parse(calls[1].body).events);
  const seen = {};
  sent.forEach(function (event) {
    assert.match(event.pieceId, /^[A-Za-z0-9:_-]{1,80}$/);
    assert.equal(event.payload == null || event.payload.ch === "床", true);
    if (!seen[event.type]) seen[event.type] = {};
    seen[event.type][event.pieceId] = (seen[event.type][event.pieceId] || 0) + 1;
  });
  assert.equal(sent.filter(function (event) { return event.pieceId === "v01-01"; }).length, 2);
  assert.equal(sent.filter(function (event) { return event.pieceId === "tang:t010"; }).length, 2);
  const odd = sent.filter(function (event) { return event.pieceId.indexOf("id-") === 0; });
  assert.equal(odd.length, 8);
  const distinct = {};
  odd.forEach(function (event) { distinct[event.pieceId] = true; });
  assert.equal(Object.keys(distinct).length, 4);
  Object.keys(distinct).forEach(function (id) {
    assert.equal(odd.filter(function (event) { return event.pieceId === id; }).length, 2);
  });
});
