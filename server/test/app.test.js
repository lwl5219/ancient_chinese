"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { createMemoryStore } = require("../src/memory-store");
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

test("events accept a batch for a user or an anonymous device and enforce limits", async () => {
  const w = world();
  const token = await login(w, "read@example.com");
  const auth = { authorization: "Bearer " + token };
  const missing = await call(w.app, { method: "POST", path: "/events", body: { events: [{ type: "page_view", pieceId: "v01-01", ts: 5 }] } });
  assert.equal(missing.status, 400);
  const bad = await call(w.app, {
    method: "POST",
    path: "/events",
    headers: auth,
    body: { deviceId: "device-1234", events: [{ type: "Not Valid", pieceId: "v01-01" }] },
  });
  assert.equal(bad.status, 400);
  const ok = await call(w.app, {
    method: "POST",
    path: "/events",
    headers: auth,
    body: {
      deviceId: "device-1234",
      events: [
        { type: "page_view", pieceId: "v01-01", ts: 1000000, payload: { href: "#/read/v01-01" } },
        { type: "char_lookup", pieceId: "tang:t010", payload: { ch: "床" } },
      ],
    },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.accepted, 2);
  const me = await call(w.app, { path: "/me", headers: auth });
  const stored = w.store.dump().events.filter(function (row) { return row.userId === me.body.userId; });
  assert.equal(stored.length, 2);
  assert.deepEqual(stored.map(function (row) { return row.type; }), ["page_view", "char_lookup"]);
  assert.equal(stored[0].ts < stored[1].ts, true);
  assert.equal(stored[0].payload.includes("床") || stored[1].payload.includes("床"), true);
  assert.equal(stored[0].deviceHash.includes("device-1234"), false);

  const anon = await call(w.app, {
    method: "POST",
    path: "/events",
    body: { deviceId: "device-1234", events: [{ type: "page_view", pieceId: "v01-02" }] },
  });
  assert.equal(anon.status, 200);
  assert.equal(w.store.dump().events.some(function (row) { return row.userId.indexOf("anon:") === 0; }), true);

  const huge = { type: "page_view", pieceId: "v01-01", payload: { note: "x".repeat(900) } };
  const tooBig = await call(w.app, { method: "POST", path: "/events", headers: auth, body: { events: [huge] } });
  assert.equal(tooBig.status, 400);

  w.at(1_000_000 + 60 * 60 * 1000);
  for (let n = 0; n < 6; n += 1) {
    const batch = [];
    for (let i = 0; i < 20; i += 1) batch.push({ type: "page_view", pieceId: "v01-01" });
    const sent = await call(w.app, { method: "POST", path: "/events", headers: auth, body: { events: batch } });
    assert.equal(sent.status, 200);
  }
  const capped = await call(w.app, {
    method: "POST",
    path: "/events",
    headers: auth,
    body: { events: [{ type: "page_view", pieceId: "v01-01" }] },
  });
  assert.equal(capped.status, 429);
});

test("logout and delete account drop the session and that user's events", async () => {
  const w = world();
  const token = await login(w, "gone@example.com");
  const auth = { authorization: "Bearer " + token };
  await call(w.app, {
    method: "POST",
    path: "/events",
    headers: auth,
    body: { events: [{ type: "page_view", pieceId: "v01-01" }] },
  });
  const out = await call(w.app, { method: "POST", path: "/auth/logout", headers: auth });
  assert.equal(out.status, 200);
  const after = await call(w.app, { path: "/me", headers: auth });
  assert.equal(after.status, 401);

  w.advance(60 * 1000);
  const again = await login(w, "gone@example.com");
  const me = await call(w.app, { path: "/me", headers: { authorization: "Bearer " + again } });
  assert.equal(me.body.email, "gone@example.com");
  assert.equal(w.store.dump().events.filter(function (row) { return row.userId === me.body.userId; }).length, 1);
  const removed = await call(w.app, { method: "DELETE", path: "/account", headers: { authorization: "Bearer " + again } });
  assert.equal(removed.status, 200);
  const dead = await call(w.app, { path: "/me", headers: { authorization: "Bearer " + again } });
  assert.equal(dead.status, 401);
  assert.equal(await w.store.getUser("gone@example.com"), null);
  assert.equal(w.store.dump().events.length, 0);
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
  await store.putEvents([{
    userId: "u1", ts: "0000000001000-00-ab", type: "page_view", pieceId: "v01-01",
    payload: "{}", deviceHash: "abc", clientTs: 1000,
  }]);
  const user = await store.getUser("a@example.com");
  assert.equal(user.userId, "u1");
  assert.deepEqual(user.sessionHashes, ["h1"]);
  const eventKey = [...rows.keys()].find(function (item) { return item.indexOf("events") === 0; });
  assert.match(eventKey, /userId/);
  assert.match(eventKey, /0000000001000-00-ab/);
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
