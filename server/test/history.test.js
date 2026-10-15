"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeHistory } = require("../src/history");

const NOW = 1_000_000;

test("history merge keeps the newer note per piece and drops everything else", () => {
  const merged = mergeHistory({
    recent: [
      { id: "v01-01", title: "  郑伯克段于鄢  ", at: 80, y: 12, href: "javascript:alert(1)" },
      { id: "tang:jingyesi", title: "静夜思", at: 40, y: 1 },
      { id: "ke:lesson", title: "课文", at: 90, y: 0 },
      { id: "h01-01", title: "词话", at: 90, y: 0 },
      { id: "z01-01", title: "通鉴", at: 90, y: 0 },
      { id: "d01-01", title: "道德经", at: 90, y: 0 },
      { id: "l01-01", title: "论语", at: 90, y: 0 },
      { id: "bad id", title: "不行", at: 90, y: 0 },
      { id: "ci:sumu", title: "", at: 90, y: 0 },
    ],
    read: { "v01-01": 80, "ci:c001": 70, "ke:lesson": 90, "不是": 90 },
  }, {
    recent: [
      { id: "v01-01", title: "旧题", at: 80, y: 3 },
      { id: "tang:jingyesi", title: "静夜思", at: 50, y: 9 },
    ],
    read: { "v01-01": 10, "ci:c001": 90, "tang:jingyesi": 20 },
  }, NOW);

  assert.equal(merged.recent[0].id, "v01-01");
  assert.equal(merged.recent[0].title, "郑伯克段于鄢");
  assert.equal(merged.recent[0].y, 12);
  assert.equal(merged.recent[0].href, "#/read/v01-01");
  assert.equal(merged.recent[1].id, "tang:jingyesi");
  assert.equal(merged.recent[1].title, "静夜思");
  assert.equal(merged.recent[1].y, 9);
  assert.equal(merged.recent[1].href, "#/tang/jingyesi");
  assert.equal(merged.recent.length, 2);
  assert.equal(merged.read["v01-01"], 80);
  assert.equal(merged.read["ci:c001"], 90);
  assert.equal(merged.read["tang:jingyesi"], 20);
  assert.equal(merged.read["ke:lesson"], undefined);
  assert.equal(merged.read["不是"], undefined);
});

test("history merge clamps future times and caps the lists", () => {
  const recent = [];
  const read = {};
  for (let i = 0; i < 30; i += 1) {
    const id = "tang:t" + String(i).padStart(3, "0");
    recent.push({ id: id, title: "诗" + i, at: 1000 + i, y: 0 });
  }
  for (let i = 0; i < 405; i += 1) read["ci:c" + String(i).padStart(3, "0")] = 1000 + i;
  const merged = mergeHistory({
    recent: recent.concat([{ id: "v01-01", title: "未来", at: NOW + 120000, y: -5 }]),
    read: read,
  }, { recent: [], read: {} }, NOW);
  assert.equal(merged.recent.length, 24);
  assert.equal(merged.recent[0].id, "v01-01");
  assert.equal(merged.recent[0].at, NOW);
  assert.equal(merged.recent[0].y, 0);
  assert.equal(Object.keys(merged.read).length, 400);
  assert.equal(merged.read["ci:c404"], 1000 + 404);
  assert.equal(merged.read["ci:c000"], undefined);
});
