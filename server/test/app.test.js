"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { createMemoryStore } = require("../src/memory-store");
const { mergeBookmarks, mergeState } = require("../src/merge");
const { createTableStore } = require("../src/store");
const { handleEvent } = require("../index");

const ORIGIN = "https://guwen.lucca.top";
const SECRET = "test-secret-at-least-16";

function world() {
  const store = createMemoryStore();
  const sent = [];
  let clock = 1_000_000;
  const app = createApp({
    store: store,
    mailer: async function (message) { sent.push(message); },
    now: function () { return clock; },
    authSecret: SECRET,
    origins: [ORIGIN, "https://www.lucca.top", "https://lucca.top", "https://maruiduan.github.io"],
  });
  return {
    app: app,
    store: store,
    sent: sent,
    at: function (value) { clock = value; },
    advance: function (ms) { clock += ms; },
  };
}

function call(app, opts) {
  return app({
    method: opts.method || "GET",
    path: opts.path,
    headers: Object.assign({ origin: opts.origin === undefined ? ORIGIN : opts.origin }, opts.headers || {}),
    body: opts.body == null ? "" : (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)),
    ip: opts.ip || "203.0.113.8",
  }).then(function (res) {
    return {
      status: res.status,
      headers: res.headers,
      body: res.body ? JSON.parse(res.body) : null,
    };
  });
}

async function login(w, email, ip) {
  const asked = await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: email }, ip: ip });
  assert.equal(asked.status, 200);
  const code = w.sent[w.sent.length - 1].code;
  const verified = await call(w.app, { method: "POST", path: "/auth/verify", body: { email: email, code: code }, ip: ip });
  assert.equal(verified.status, 200);
  return verified.body.token;
}

test("health and CORS allow only the listed sites", async () => {
  const w = world();
  const health = await call(w.app, { path: "/health", origin: "" });
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.headers["access-control-allow-origin"], undefined);

  const ok = await call(w.app, { method: "OPTIONS", path: "/auth/verify" });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers["access-control-allow-origin"], ORIGIN);
  assert.match(ok.headers["access-control-allow-headers"], /Authorization/);

  const pages = await call(w.app, { path: "/health", origin: "https://maruiduan.github.io" });
  assert.equal(pages.headers["access-control-allow-origin"], "https://maruiduan.github.io");

  const denied = await call(w.app, { method: "POST", path: "/auth/request-code", origin: "https://evil.example", body: { email: "a@b.co" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
  const preflight = await call(w.app, { method: "OPTIONS", path: "/sync", origin: "https://evil.example" });
  assert.equal(preflight.status, 403);
});

test("request-code stores a hash, rate limits email and IP, and expires", async () => {
  const w = world();
  const bad = await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: "not-an-email" } });
  assert.equal(bad.status, 400);

  const first = await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: "Reader@Example.com" } });
  assert.equal(first.status, 200);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, "reader@example.com");
  assert.match(w.sent[0].code, /^\d{6}$/);
  const stored = await w.store.getCode("reader@example.com");
  assert.notEqual(stored.hash, w.sent[0].code);
  assert.equal(stored.hash.includes(w.sent[0].code), false);

  const soon = await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: "reader@example.com" } });
  assert.equal(soon.status, 429);
  w.advance(60 * 1000);
  for (let i = 0; i < 4; i += 1) {
    w.advance(60 * 1000);
    const again = await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: "reader@example.com" } });
    assert.equal(again.status, 200);
  }
  w.advance(60 * 1000);
  const capped = await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: "reader@example.com" } });
  assert.equal(capped.status, 429);

  w.at(1_000_000);
  for (let n = 0; n < 20; n += 1) {
    const sent = await call(w.app, {
      method: "POST",
      path: "/auth/request-code",
      body: { email: "ip" + n + "@example.com" },
      ip: "198.51.100.9",
    });
    assert.equal(sent.status, 200);
  }
  const blocked = await call(w.app, {
    method: "POST",
    path: "/auth/request-code",
    body: { email: "overflow@example.com" },
    ip: "198.51.100.9",
  });
  assert.equal(blocked.status, 429);
});

test("verify accepts one code, locks attempts, and rejects expiry", async () => {
  const w = world();
  await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: "a@example.com" } });
  const code = w.sent[0].code;
  for (let i = 0; i < 4; i += 1) {
    const wrong = await call(w.app, { method: "POST", path: "/auth/verify", body: { email: "a@example.com", code: "000000" } });
    assert.equal(wrong.status, 400);
  }
  const fifth = await call(w.app, { method: "POST", path: "/auth/verify", body: { email: "a@example.com", code: "000000" } });
  assert.equal(fifth.status, 429);
  const locked = await call(w.app, { method: "POST", path: "/auth/verify", body: { email: "a@example.com", code: code } });
  assert.equal(locked.status, 429);

  w.advance(60 * 1000);
  await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: "a@example.com" } });
  const fresh = w.sent[w.sent.length - 1].code;
  w.advance(10 * 60 * 1000 + 1);
  const expired = await call(w.app, { method: "POST", path: "/auth/verify", body: { email: "a@example.com", code: fresh } });
  assert.equal(expired.status, 400);

  w.advance(60 * 1000);
  await call(w.app, { method: "POST", path: "/auth/request-code", body: { email: "a@example.com" } });
  const okCode = w.sent[w.sent.length - 1].code;
  const ok = await call(w.app, { method: "POST", path: "/auth/verify", body: { email: "a@example.com", code: okCode } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.email, "a@example.com");
  const reused = await call(w.app, { method: "POST", path: "/auth/verify", body: { email: "a@example.com", code: okCode } });
  assert.equal(reused.status, 400);
  const me = await call(w.app, { path: "/me", headers: { authorization: "Bearer " + ok.body.token } });
  assert.equal(me.status, 200);
  assert.equal(me.body.email, "a@example.com");
  assert.equal(w.store.dump().sessions.has(ok.body.token), false);
});

test("sync unions bookmarks, keeps the newer state, and unions read marks", async () => {
  const w = world();
  const token = await login(w, "sync@example.com");
  const auth = { authorization: "Bearer " + token };
  const first = await call(w.app, {
    method: "PUT",
    path: "/sync",
    headers: auth,
    body: {
      bookmarks: [{ id: "piece:v01-01", kind: "piece", href: "#/read/v01-01", title: "郑伯克段于鄢", at: 10 }],
      state: { font: "s", updatedAt: 10, learned: { "v01-01": 10 }, last: "v01-01" },
    },
  });
  assert.equal(first.status, 200);
  const second = await call(w.app, {
    method: "PUT",
    path: "/sync",
    headers: auth,
    body: {
      bookmarks: [
        { id: "piece:v01-01", kind: "piece", href: "#/read/v01-01", title: "郑伯克段于鄢", quote: "", at: 12 },
        { id: "sent:v01-01:0", kind: "sentence", href: "#/read/v01-01", title: "郑伯克段于鄢", quote: "初郑武公娶于申", at: 20 },
      ],
      state: { font: "t", updatedAt: 5, learned: { "v01-02": 30 }, last: "v01-02", pinyinSet: true, pinyin: false },
    },
  });
  assert.equal(second.body.bookmarks.map(function (item) { return item.id; }).sort().join(","), "piece:v01-01,sent:v01-01:0");
  assert.equal(second.body.state.font, "s");
  assert.equal(second.body.state.last, "v01-01");
  assert.equal(second.body.state.learned["v01-01"], 10);
  assert.equal(second.body.state.learned["v01-02"], 30);
  assert.equal(second.body.state.updatedAt, 10);

  const newer = await call(w.app, {
    method: "PUT",
    path: "/sync",
    headers: auth,
    body: { bookmarks: [], state: { font: "t", updatedAt: 40, learned: { "v01-01": 4 }, last: "v02-01" } },
  });
  assert.equal(newer.body.state.font, "t");
  assert.equal(newer.body.state.last, "v02-01");
  assert.equal(newer.body.state.learned["v01-01"], 10);
  assert.equal(newer.body.bookmarks.length, 2);

  const anon = await call(w.app, { method: "PUT", path: "/sync", body: { bookmarks: [], state: {} } });
  assert.equal(anon.status, 401);
});

test("logout and delete account drop the session and stored sync", async () => {
  const w = world();
  const token = await login(w, "gone@example.com");
  const auth = { authorization: "Bearer " + token };
  await call(w.app, {
    method: "PUT",
    path: "/sync",
    headers: auth,
    body: { bookmarks: [{ id: "piece:v01-01", kind: "piece", href: "#/read/v01-01", title: "郑伯", at: 1 }], state: { updatedAt: 1 } },
  });
  const out = await call(w.app, { method: "POST", path: "/auth/logout", headers: auth });
  assert.equal(out.status, 200);
  const after = await call(w.app, { path: "/me", headers: auth });
  assert.equal(after.status, 401);

  w.advance(60 * 1000);
  const again = await login(w, "gone@example.com");
  const me = await call(w.app, { path: "/me", headers: { authorization: "Bearer " + again } });
  assert.equal(me.body.bookmarks.length, 1);
  const removed = await call(w.app, { method: "DELETE", path: "/account", headers: { authorization: "Bearer " + again } });
  assert.equal(removed.status, 200);
  const dead = await call(w.app, { path: "/me", headers: { authorization: "Bearer " + again } });
  assert.equal(dead.status, 401);
  assert.equal(await w.store.getUser("gone@example.com"), null);
  assert.equal([...w.store.dump().sync.values()].length, 0);
  assert.equal([...w.store.dump().sessions.values()].length, 0);
});

test("an expired session is no longer accepted", async () => {
  const w = world();
  const token = await login(w, "old@example.com");
  w.advance(180 * 24 * 60 * 60 * 1000 + 1);
  const me = await call(w.app, { path: "/me", headers: { authorization: "Bearer " + token } });
  assert.equal(me.status, 401);
});

test("mail failure does not leave a usable code", async () => {
  const store = createMemoryStore();
  const app = createApp({
    store: store,
    mailer: async function () { throw new Error("dm down"); },
    now: function () { return 10; },
    authSecret: SECRET,
    origins: [ORIGIN],
  });
  const res = await call(app, { method: "POST", path: "/auth/request-code", body: { email: "a@example.com" } });
  assert.equal(res.status, 502);
  assert.equal(await store.getCode("a@example.com"), null);
});

test("merge helpers prefer the newer snapshot without dropping reads", () => {
  const bookmarks = mergeBookmarks(
    [{ id: "piece:a", kind: "piece", href: "#/read/v01-01", title: "旧", at: 1 }, { id: "nope", kind: "piece" }],
    [{ id: "piece:a", kind: "piece", href: "#/read/v01-01", title: "新", at: 2 }]
  );
  assert.deepEqual(bookmarks.map(function (item) { return item.title; }), ["新"]);
  const removed = mergeBookmarks(
    [{ id: "piece:a", kind: "piece", href: "#/read/v01-01", title: "新", at: 2 }],
    [{ id: "piece:a", kind: "piece", href: "#/read/v01-01", title: "新", at: 4, deleted: true }]
  );
  assert.equal(removed[0].deleted, true);
  const state = mergeState(
    { updatedAt: 5, font: "t", learned: { "v01-01": 9 } },
    { updatedAt: 8, font: "s", learned: { "v01-01": 3, "v01-02": 4 }, last: "v01-02" }
  );
  assert.equal(state.font, "s");
  assert.equal(state.learned["v01-01"], 9);
  assert.equal(state.learned["v01-02"], 4);
  assert.equal(state.last, "v01-02");
});

test("tablestore adapter round-trips rows through a fake client", async () => {
  const rows = new Map();
  function key(params) {
    return params.tableName + "\n" + JSON.stringify(params.primaryKey);
  }
  const client = {
    putRow: function (params, cb) { rows.set(key(params), params.attributeColumns); cb(null, {}); },
    getRow: function (params, cb) {
      const cols = rows.get(key(params));
      if (!cols) return cb(null, { row: {} });
      cb(null, {
        row: {
          primaryKey: [{ name: "email", value: "a@example.com" }],
          attributes: cols.map(function (col) {
            const name = Object.keys(col)[0];
            return { columnName: name, columnValue: col[name] };
          }),
        },
      });
    },
    deleteRow: function (params, cb) { rows.delete(key(params)); cb(null, {}); },
  };
  const store = createTableStore(client);
  await store.putUser({ email: "a@example.com", userId: "u1", createdAt: 7, sessionHashes: ["h1"] });
  await store.putSync("u1", {
    bookmarks: [{ id: "piece:v01-01", kind: "piece", href: "#/read/v01-01", title: "郑伯", at: 1 }],
    state: { font: "t", updatedAt: 7, learned: {} },
  });
  const user = await store.getUser("a@example.com");
  assert.equal(user.userId, "u1");
  assert.deepEqual(user.sessionHashes, ["h1"]);
  const sync = await store.getSync("u1");
  assert.equal(sync.bookmarks[0].title, "郑伯");
  assert.equal(sync.state.font, "t");
  await store.deleteUser("a@example.com");
  assert.equal(await store.getUser("a@example.com"), null);
});

test("the function entry parses an HTTP event and keeps the bearer body", async () => {
  const store = createMemoryStore();
  const sent = [];
  const app = createApp({
    store: store,
    mailer: async function (message) { sent.push(message); },
    now: function () { return 50; },
    authSecret: SECRET,
    origins: [ORIGIN],
  });
  const event = {
    rawPath: "/auth/request-code",
    isBase64Encoded: true,
    body: Buffer.from(JSON.stringify({ email: "a@example.com" }), "utf8").toString("base64"),
    headers: { Origin: ORIGIN, "X-Forwarded-For": "203.0.113.10, 10.0.0.1" },
    requestContext: { http: { method: "POST", path: "/auth/request-code", sourceIp: "10.0.0.4" } },
  };
  const res = await handleEvent(event, app);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.equal(sent[0].to, "a@example.com");
  const limit = await store.getLimit("ip:203.0.113.10");
  assert.equal(limit.hourCount, 1);
});
