"use strict";

const crypto = require("node:crypto");
const https = require("node:https");
const querystring = require("node:querystring");

const DM_HOST = "dm.aliyuncs.com";
const DM_VERSION = "2015-11-23";

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

function canonicalQuery(params) {
  return Object.keys(params).sort().map(function (key) {
    return percentEncode(key) + "=" + percentEncode(params[key]);
  }).join("&");
}

function signRpc(params, accessKeySecret) {
  const stringToSign = "POST&" + percentEncode("/") + "&" + percentEncode(canonicalQuery(params));
  return crypto.createHmac("sha1", accessKeySecret + "&").update(stringToSign).digest("base64");
}

function timestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildSingleSendMail(env, message, nonce, date) {
  const accountName = env.DIRECTMAIL_ACCOUNT_NAME || "";
  const params = {
    Action: "SingleSendMail",
    Format: "JSON",
    Version: DM_VERSION,
    AccessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID || env.TABLESTORE_ACCESS_KEY_ID || "",
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: nonce,
    Timestamp: timestamp(date),
    AccountName: accountName,
    AddressType: "1",
    ReplyToAddress: "false",
    ToAddress: message.to,
    Subject: "典籍登录验证码",
    FromAlias: env.DIRECTMAIL_FROM_ALIAS || "典籍",
    ClickTrace: "0",
    TextBody: "你的验证码是 " + message.code + "，10 分钟内有效。如果这不是你本人的操作，忽略这封邮件即可。",
  };
  const secret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || env.TABLESTORE_ACCESS_KEY_SECRET || "";
  params.Signature = signRpc(params, secret);
  return params;
}

function postForm(params) {
  const body = querystring.stringify(params);
  return new Promise(function (resolve, reject) {
    const req = https.request({
      host: DM_HOST,
      method: "POST",
      path: "/",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
      },
    }, function (res) {
      const chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(text);
        else reject(new Error("DirectMail " + res.statusCode + " " + text.slice(0, 300)));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function createMailer(env, transport) {
  return async function send(message) {
    if (typeof transport === "function") return transport(message);
    if (!env.DIRECTMAIL_ACCOUNT_NAME) throw new Error("DIRECTMAIL_ACCOUNT_NAME is required");
    const params = buildSingleSendMail(env, message, crypto.randomUUID(), new Date());
    return postForm(params);
  };
}

module.exports = {
  percentEncode: percentEncode,
  canonicalQuery: canonicalQuery,
  signRpc: signRpc,
  buildSingleSendMail: buildSingleSendMail,
  createMailer: createMailer,
};
