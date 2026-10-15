"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSingleSendMail, percentEncode } = require("../src/mail");

test("DirectMail signature is a stable HMAC of the sorted RPC params", () => {
  assert.equal(percentEncode("a b*"), "a%20b%2A");
  const params = buildSingleSendMail({
    DIRECTMAIL_ACCOUNT_NAME: "noreply@mail.lucca.top",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "testid",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "testsecret",
    DIRECTMAIL_FROM_ALIAS: "典籍",
  }, { to: "reader@example.com", code: "123456" }, "nonce-1", new Date("2026-10-15T00:00:00Z"));
  assert.equal(params.Action, "SingleSendMail");
  assert.equal(params.AccountName, "noreply@mail.lucca.top");
  assert.equal(params.ToAddress, "reader@example.com");
  assert.equal(params.Timestamp, "2026-10-15T00:00:00Z");
  assert.equal(params.Signature, "yLzurtyczdxjfI1IdZPauvZfRJk=");
  assert.match(params.TextBody, /123456/);
});
