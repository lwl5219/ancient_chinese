"use strict";

const { createApp } = require("./src/app");
const { createStore } = require("./src/store");
const { createMailer } = require("./src/mail");

let app;

function getApp() {
  if (!app) {
    const origins = String(process.env.APP_ORIGINS || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean);
    app = createApp({
      store: createStore(process.env),
      mailer: createMailer(process.env),
      authSecret: process.env.AUTH_SECRET || "",
      origins: origins,
    });
  }
  return app;
}

function parseEvent(event) {
  let parsed = {};
  if (Buffer.isBuffer(event)) {
    try { parsed = JSON.parse(event.toString("utf8") || "{}"); } catch (_) { parsed = {}; }
  } else if (typeof event === "string") {
    try { parsed = JSON.parse(event || "{}"); } catch (_) { parsed = {}; }
  } else if (event && typeof event === "object") {
    parsed = event;
  }
  const http = parsed.requestContext && parsed.requestContext.http || {};
  let path = parsed.rawPath || http.path || parsed.path || "/";
  path = String(path).split("?")[0];
  let body = parsed.body == null ? "" : parsed.body;
  if (parsed.isBase64Encoded && typeof body === "string" && body) {
    body = Buffer.from(body, "base64").toString("utf8");
  }
  const domainName = (parsed.requestContext && parsed.requestContext.domainName) || "";
  return {
    method: http.method || parsed.httpMethod || parsed.method || "GET",
    path: path,
    headers: parsed.headers || {},
    body: body,
    sourceIp: http.sourceIp || "",
    domainName: domainName,
  };
}

async function handleEvent(event, handler) {
  const result = await handler(parseEvent(event));
  return {
    statusCode: result.status,
    headers: result.headers,
    body: result.body,
    isBase64Encoded: false,
  };
}

exports.handler = async function (event) {
  try {
    return await handleEvent(event, getApp());
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ error: "服务未配置完成" }),
      isBase64Encoded: false,
    };
  }
};

exports.parseEvent = parseEvent;
exports.handleEvent = handleEvent;
