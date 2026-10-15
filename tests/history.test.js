"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { reader, storage } = require("./reader-harness.cjs");
const { mergeHistory } = require("../server/src/history");

test("local reading history does not touch the network", () => {
  const shared = storage();
  const t = reader(shared);
  let syncs = 0;
  t.window.gwgzAccount = { onHistory() { syncs += 1; } };
  t.app.noteReading("ke:lesson", "课文", 1_700_000_000_000);
  t.app.noteReading("h01-01", "词话", 1_700_000_000_000);
  t.app.noteReading("z01-01", "通鉴", 1_700_000_000_000);
  assert.equal(shared.getItem("gwgz-history-v1"), null);
  assert.equal(syncs, 0);

  t.app.noteReading("tang:jingyesi", "静夜思", 1_700_000_000_000);
  t.app.markRead("tang:jingyesi", 1_700_000_000_100);
  t.app.noteReading("ci:sumu", "水调歌头", 1_700_000_000_050);
  const saved = JSON.parse(shared.getItem("gwgz-history-v1"));
  assert.deepEqual(saved.recent.map(function (item) { return item.id; }), ["ci:sumu", "tang:jingyesi"]);
  assert.equal(saved.recent[1].title, "静夜思");
  assert.equal(saved.recent[1].href, "#/tang/jingyesi");
  assert.equal(saved.read["tang:jingyesi"], 1_700_000_000_100);
  assert.equal(saved.read["ci:sumu"], undefined);
  assert.equal(syncs, 3);
  assert.equal(t.body.children.length, 0);

  const before = t.app.historyRev();
  t.app.applyHistory({
    recent: [{ id: "v01-01", title: "郑伯克段于鄢", at: 1_700_000_000_200, y: 12, href: "javascript:alert(1)" }],
    read: { "v01-01": 1_700_000_000_200, "z01-01": 1_700_000_000_200 },
  });
  assert.equal(t.app.historyRev(), before);
  assert.equal(syncs, 3);
  const snap = t.app.historySnapshot();
  assert.equal(snap.recent[0].id, "v01-01");
  assert.equal(snap.recent[0].href, "#/read/v01-01");
  assert.equal(snap.recent[0].y, 12);
  assert.equal(snap.read["v01-01"], 1_700_000_000_200);
  assert.equal(snap.read["z01-01"], undefined);
  assert.equal(snap.read["tang:jingyesi"], 1_700_000_000_100);
});

test("a full local store does not raise a notice", () => {
  const shared = storage();
  shared.setItem = function () { throw new Error("QuotaExceededError"); };
  const t = reader(shared);
  t.app.noteReading("v01-01", "郑伯克段于鄢", 1_700_000_000_000);
  assert.equal(t.app.historySnapshot().recent[0].title, "郑伯克段于鄢");
  assert.equal(t.body.children.length, 0);
});

test("client merge matches the server for the same snapshot", () => {
  const incoming = {
    recent: [
      { id: "v01-01", title: "郑伯克段于鄢", at: 80, y: 4, href: "nope" },
      { id: "ke:x", title: "课文", at: 90, y: 0 },
    ],
    read: { "tang:jingyesi": 10, "d01-01": 90 },
  };
  const saved = {
    recent: [{ id: "tang:jingyesi", title: "静夜思", at: 70, y: 2 }],
    read: { "tang:jingyesi": 40 },
  };
  const t = reader();
  assert.deepEqual(
    JSON.parse(JSON.stringify(t.app.mergeHistory(incoming, saved, 1_000_000))),
    mergeHistory(incoming, saved, 1_000_000)
  );
});

function bootAccount(options) {
  const fetches = [];
  const applied = [];
  const later = [];
  const storage = new Map(Object.entries(options.storage || {}));
  const window = {
    API_BASE: options.apiBase,
    gwgzAccountBridge: options.bridge || null,
    addEventListener() {},
  };
  const document = {
    addEventListener() {},
    querySelector() { return null; },
    getElementById() { return null; },
    createElement() { return { style: {}, appendChild() {}, addEventListener() {} }; },
  };
  const context = vm.createContext({
    window: window,
    document: document,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : ""; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    location: { hash: options.hash || "#/" },
    fetch(url, init) {
      fetches.push({ url: url, method: init.method, body: init.body, headers: init.headers });
      const status = options.status || 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status: status,
        json() { return Promise.resolve(options.reply || { recent: [], read: {} }); },
      });
    },
    setTimeout(fn) { later.push(fn); return later.length; },
    clearTimeout() {},
    console: { error() {}, log() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/account.js"), "utf8"), context, { filename: "js/account.js" });
  return { fetches: fetches, applied: applied, later: later, window: window };
}

test("logged-out account code does not request reading state", () => {
  const booted = bootAccount({ apiBase: "https://api.lucca.top" });
  assert.equal(booted.fetches.length, 0);
  booted.window.gwgzAccount.onHistory();
  assert.equal(booted.fetches.length, 0);
  assert.equal(booted.later.length, 0);
});

test("a stored token pulls state and a later change pushes the local snapshot", async () => {
  const applied = [];
  const booted = bootAccount({
    apiBase: "https://api.lucca.top",
    storage: { "gwgz-session-v1": "token-1" },
    reply: { recent: [{ id: "ci:sumu", title: "水调歌头", at: 20, y: 0 }], read: {} },
    bridge: {
      historySnapshot() {
        return { recent: [{ id: "v01-01", title: "郑伯克段于鄢", at: 30, y: 0, href: "#/read/v01-01" }], read: { "v01-01": 30 } };
      },
      historyRev() { return 1; },
      applyHistory(remote) { applied.push(remote); },
    },
  });
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(booted.fetches.length, 1);
  assert.equal(booted.fetches[0].method, "GET");
  assert.equal(booted.fetches[0].url, "https://api.lucca.top/state");
  assert.equal(booted.fetches[0].headers.Authorization, "Bearer token-1");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].recent[0].id, "ci:sumu");
  assert.equal(booted.later.length, 1);
  booted.later[0]();
  await new Promise(function (resolve) { setImmediate(resolve); });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(booted.fetches.length, 2);
  assert.equal(booted.fetches[1].method, "PUT");
  assert.equal(booted.fetches[1].url, "https://api.lucca.top/state");
  assert.equal(JSON.parse(booted.fetches[1].body).recent[0].id, "v01-01");
});
