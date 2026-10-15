"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

test("login stays off unless API_BASE is set", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /window\.API_BASE\s*=\s*""/);
  assert.match(html, /if\s*\(\s*!window\.API_BASE\s*\)\s*return/);
  assert.doesNotMatch(html, /<script src="js\/account(?:\.[0-9a-f]{12})?\.js"><\/script>/);
  assert.doesNotMatch(html, /<script src="js\/sync-merge(?:\.[0-9a-f]{12})?\.js"><\/script>/);
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
});
