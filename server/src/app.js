"use strict";

const crypto = require("node:crypto");

const DEFAULT_ORIGINS = [
  "https://guwen.lucca.top",
  "https://lucca.top",
  "https://www.lucca.top",
  "https://maruiduan.github.io",
];
const CODE_TTL = 10 * 60 * 1000;
const SESSION_TTL = 180 * 24 * 60 * 60 * 1000;
const EMAIL_GAP = 60 * 1000;
const EMAIL_HOUR = 5;
const IP_HOUR = 20;
const MAX_ATTEMPTS = 5;
const HOUR = 60 * 60 * 1000;
const MAX_SESSIONS = 8;
const MAX_EVENTS = 20;
const USER_EVENTS_HOUR = 120;
const IP_EVENTS_HOUR = 200;

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizeEmail(input) {
  if (typeof input !== "string") return "";
  const email = input.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return "";
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(email)) return "";
  return email;
}

function userIdFor(email) {
  return sha256("user\n" + email).slice(0, 32);
}

function defaultCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function defaultToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function defaultEventNonce() {
  return crypto.randomBytes(3).toString("hex");
}

function cleanEvent(raw, nowMs) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(type)) return null;
  let pieceId = "";
  if (raw.pieceId != null && raw.pieceId !== "") {
    if (typeof raw.pieceId !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/.test(raw.pieceId)) return null;
    pieceId = raw.pieceId;
  }
  let payload = {};
  if (raw.payload != null) {
    if (typeof raw.payload !== "object" || Array.isArray(raw.payload)) return null;
    let json = "";
    try { json = JSON.stringify(raw.payload); } catch (_) { return null; }
    if (json.length > 800) return null;
    payload = JSON.parse(json);
  }
  let clientTs = Number(raw.ts);
  if (!Number.isFinite(clientTs)) clientTs = nowMs;
  if (clientTs < nowMs - 24 * HOUR || clientTs > nowMs + 5 * 60 * 1000) clientTs = nowMs;
  return { type: type, pieceId: pieceId, payload: payload, clientTs: clientTs };
}

function lowerHeaders(headers) {
  const out = {};
  Object.keys(headers || {}).forEach(function (key) {
    const value = headers[key];
    out[String(key).toLowerCase()] = Array.isArray(value) ? value[0] : value;
  });
  return out;
}

function clientIp(headers, fallback) {
  const forwarded = String((headers && headers["x-forwarded-for"]) || "");
  const first = forwarded.split(",")[0].trim();
  const ip = first || String(fallback || "unknown");
  return ip.slice(0, 64) || "unknown";
}

function readJson(body) {
  if (body == null || body === "") return {};
  if (typeof body === "object") return body;
  if (typeof body !== "string") return null;
  if (body.length > 200000) return { __tooBig: true };
  try { return JSON.parse(body); } catch (_) { return null; }
}

function bearer(headers) {
  const value = String((headers && headers.authorization) || "");
  const match = /^Bearer\s+([A-Za-z0-9_\-.~+/]+=*)$/.exec(value);
  if (!match) return "";
  if (match[1].length < 20 || match[1].length > 200) return "";
  return match[1];
}

function createApp(options) {
  const store = options.store;
  const mailer = options.mailer;
  const now = options.now || Date.now;
  const authSecret = options.authSecret || "";
  const origins = (options.origins && options.origins.length ? options.origins : DEFAULT_ORIGINS).slice();
  const randomCode = options.randomCode || defaultCode;
  const randomToken = options.randomToken || defaultToken;
  const randomEventNonce = options.randomEventNonce || defaultEventNonce;
  const allowed = new Set(origins);

  function cors(origin) {
    if (!origin || !allowed.has(origin)) return {};
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  }

  function send(status, payload, origin) {
    return {
      status: status,
      headers: Object.assign({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }, cors(origin)),
      body: payload == null ? "" : JSON.stringify(payload),
    };
  }

  function hashCode(email, code) {
    return sha256(authSecret + "\ncode\n" + email + "\n" + code);
  }

  function hashToken(token) {
    return sha256(authSecret + "\ntoken\n" + token);
  }

  async function loadLimit(id, nowMs) {
    const row = (await store.getLimit(id)) || { hourStart: nowMs, hourCount: 0, lastSent: 0 };
    if (!row.hourStart || nowMs - row.hourStart >= HOUR) {
      return { hourStart: nowMs, hourCount: 0, lastSent: row.lastSent || 0 };
    }
    return {
      hourStart: row.hourStart,
      hourCount: row.hourCount || 0,
      lastSent: row.lastSent || 0,
    };
  }

  async function userFromToken(headers) {
    const token = bearer(headers);
    if (!token) return null;
    const session = await store.getSession(hashToken(token));
    const tokenHash = hashToken(token);
    if (!session || !session.email || session.expiresAt <= now()) {
      await store.deleteSession(tokenHash);
      if (session && session.email) {
        const owner = await store.getUser(session.email);
        if (owner) {
          owner.sessionHashes = (owner.sessionHashes || []).filter(function (item) { return item !== tokenHash; });
          await store.putUser(owner);
        }
      }
      return null;
    }
    const user = await store.getUser(session.email);
    if (!user) return null;
    return { user: user, tokenHash: tokenHash };
  }

  async function openSession(user) {
    const token = randomToken();
    const tokenHash = hashToken(token);
    const hashes = Array.isArray(user.sessionHashes) ? user.sessionHashes.slice() : [];
    hashes.push(tokenHash);
    while (hashes.length > MAX_SESSIONS) {
      const old = hashes.shift();
      await store.deleteSession(old);
    }
    user.sessionHashes = hashes;
    await store.putUser(user);
    await store.putSession(tokenHash, {
      userId: user.userId,
      email: user.email,
      expiresAt: now() + SESSION_TTL,
    });
    return token;
  }

  async function requestCode(req, body) {
    const email = normalizeEmail(body.email);
    if (!email) return send(400, { error: "请填写有效的邮箱" }, req.origin);
    const nowMs = now();
    const ipKey = "ip:" + req.ip;
    const emailKey = "email:" + email;
    const ipLimit = await loadLimit(ipKey, nowMs);
    if (ipLimit.hourCount >= IP_HOUR) {
      return send(429, { error: "发送次数过多，请稍后再试" }, req.origin);
    }
    ipLimit.hourCount += 1;
    await store.putLimit(ipKey, ipLimit);
    const emailLimit = await loadLimit(emailKey, nowMs);
    if ((emailLimit.lastSent && nowMs - emailLimit.lastSent < EMAIL_GAP) || emailLimit.hourCount >= EMAIL_HOUR) {
      return send(429, { error: "发送太频繁，请稍后再试" }, req.origin);
    }
    const code = randomCode();
    if (!/^\d{6}$/.test(code)) return send(500, { error: "服务未配置完成" }, req.origin);
    await store.putCode(email, {
      hash: hashCode(email, code),
      expiresAt: nowMs + CODE_TTL,
      attempts: 0,
      sentAt: nowMs,
    });
    try {
      await mailer({ to: email, code: code });
    } catch (err) {
      await store.deleteCode(email);
      console.error(err);
      return send(502, { error: "邮件暂时没发出去，请稍后再试" }, req.origin);
    }
    emailLimit.hourCount += 1;
    emailLimit.lastSent = nowMs;
    await store.putLimit(emailKey, emailLimit);
    return send(200, { ok: true }, req.origin);
  }

  async function verify(req, body) {
    const email = normalizeEmail(body.email);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!email || !/^\d{6}$/.test(code)) {
      return send(400, { error: "邮箱或验证码不正确" }, req.origin);
    }
    const row = await store.getCode(email);
    const nowMs = now();
    if (!row || row.expiresAt <= nowMs) {
      if (row) await store.deleteCode(email);
      return send(400, { error: "验证码已过期，请重新获取" }, req.origin);
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return send(429, { error: "尝试次数过多，请重新获取验证码" }, req.origin);
    }
    row.attempts += 1;
    await store.putCode(email, row);
    if (!safeEqual(row.hash, hashCode(email, code))) {
      if (row.attempts >= MAX_ATTEMPTS) {
        return send(429, { error: "尝试次数过多，请重新获取验证码" }, req.origin);
      }
      return send(400, { error: "验证码不正确" }, req.origin);
    }
    await store.deleteCode(email);
    let user = await store.getUser(email);
    if (!user) {
      user = { email: email, userId: userIdFor(email), createdAt: nowMs, sessionHashes: [] };
    }
    const token = await openSession(user);
    return send(200, { token: token, email: email, userId: user.userId }, req.origin);
  }

  async function logout(req) {
    const auth = await userFromToken(req.headers);
    if (!auth) return send(401, { error: "请先登录" }, req.origin);
    await store.deleteSession(auth.tokenHash);
    const hashes = (auth.user.sessionHashes || []).filter(function (item) { return item !== auth.tokenHash; });
    auth.user.sessionHashes = hashes;
    await store.putUser(auth.user);
    return send(200, { ok: true }, req.origin);
  }

  async function removeAccount(req) {
    const auth = await userFromToken(req.headers);
    if (!auth) return send(401, { error: "请先登录" }, req.origin);
    const hashes = auth.user.sessionHashes || [];
    for (let i = 0; i < hashes.length; i += 1) await store.deleteSession(hashes[i]);
    await store.deleteSession(auth.tokenHash);
    await store.deleteUser(auth.user.email);
    await store.deleteCode(auth.user.email);
    await store.deleteEventsForUser(auth.user.userId);
    await store.deleteLimit("email:" + auth.user.email);
    await store.deleteLimit("evuser:" + auth.user.userId);
    return send(200, { ok: true }, req.origin);
  }

  async function me(req) {
    const auth = await userFromToken(req.headers);
    if (!auth) return send(401, { error: "请先登录" }, req.origin);
    return send(200, { email: auth.user.email, userId: auth.user.userId }, req.origin);
  }

  async function postEvents(req, body) {
    if (body.__tooBig) return send(413, { error: "事件太大" }, req.origin);
    const auth = await userFromToken(req.headers);
    if (!auth) return send(401, { error: "请先登录" }, req.origin);
    const list = Array.isArray(body.events) ? body.events : null;
    if (!list || !list.length || list.length > MAX_EVENTS) return send(400, { error: "事件格式不正确" }, req.origin);
    const nowMs = now();
    const cleaned = [];
    for (let i = 0; i < list.length; i += 1) {
      const item = cleanEvent(list[i], nowMs);
      if (!item) return send(400, { error: "事件格式不正确" }, req.origin);
      cleaned.push(item);
    }
    const userId = auth.user.userId;
    const ipLimit = await loadLimit("evip:" + req.ip, nowMs);
    const actorLimit = await loadLimit("evuser:" + userId, nowMs);
    if (ipLimit.hourCount + cleaned.length > IP_EVENTS_HOUR || actorLimit.hourCount + cleaned.length > USER_EVENTS_HOUR) {
      return send(429, { error: "记录太频繁，请稍后再试" }, req.origin);
    }
    const nonce = randomEventNonce();
    const rows = cleaned.map(function (item, index) {
      return {
        userId: userId,
        ts: String(nowMs).padStart(13, "0") + "-" + String(index).padStart(2, "0") + "-" + nonce,
        type: item.type,
        pieceId: item.pieceId,
        payload: JSON.stringify(item.payload),
        deviceHash: "",
        clientTs: item.clientTs,
      };
    });
    await store.putEvents(rows);
    ipLimit.hourCount += cleaned.length;
    actorLimit.hourCount += cleaned.length;
    await store.putLimit("evip:" + req.ip, ipLimit);
    await store.putLimit("evuser:" + userId, actorLimit);
    return send(200, { ok: true, accepted: cleaned.length }, req.origin);
  }

  return async function handle(raw) {
    const headers = lowerHeaders(raw.headers);
    const origin = String(raw.origin || headers.origin || "").trim();
    const req = {
      method: raw.method,
      path: raw.path,
      headers: headers,
      body: raw.body,
      origin: origin,
      ip: raw.ip || clientIp(headers, raw.sourceIp),
    };
    if (!authSecret || authSecret.length < 16) return send(500, { error: "服务未配置完成" }, origin);
    if (origin && !allowed.has(origin)) return send(403, { error: "这个网站不能调用账号接口" }, origin);
    const method = String(req.method || "GET").toUpperCase();
    const path = String(req.path || "/").split("?")[0].replace(/\/+$/, "") || "/";
    if (method === "OPTIONS") {
      if (origin && !allowed.has(origin)) return send(403, { error: "这个网站不能调用账号接口" }, origin);
      return {
        status: 204,
        headers: Object.assign({ "cache-control": "no-store" }, cors(origin)),
        body: "",
      };
    }
    const body = method === "GET" || method === "DELETE" ? {} : readJson(req.body);
    if (body == null) return send(400, { error: "请求格式不正确" }, origin);
    try {
      if (method === "GET" && path === "/health") return send(200, { ok: true }, origin);
      if (method === "POST" && path === "/auth/request-code") return await requestCode(Object.assign({ origin: origin }, req), body);
      if (method === "POST" && path === "/auth/verify") return await verify(Object.assign({ origin: origin }, req), body);
      if (method === "POST" && path === "/auth/logout") return await logout(Object.assign({ origin: origin }, req));
      if (method === "DELETE" && path === "/account") return await removeAccount(Object.assign({ origin: origin }, req));
      if (method === "GET" && path === "/me") return await me(Object.assign({ origin: origin }, req));
      if (method === "POST" && path === "/events") return await postEvents(Object.assign({ origin: origin }, req), body);
      return send(404, { error: "没有这个接口" }, origin);
    } catch (err) {
      console.error(err);
      return send(500, { error: "服务暂时不可用" }, origin);
    }
  };
}

module.exports = {
  DEFAULT_ORIGINS: DEFAULT_ORIGINS,
  createApp: createApp,
  normalizeEmail: normalizeEmail,
  clientIp: clientIp,
  lowerHeaders: lowerHeaders,
};
