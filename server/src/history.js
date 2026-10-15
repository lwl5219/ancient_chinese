"use strict";

const MAX_RECENT = 24;
const MAX_READ = 400;
const SCOPE = /^(?:v\d{2}-\d{2}|(?:tang|ci):[A-Za-z0-9_-]{1,40})$/;

function hrefFor(id) {
  if (id.indexOf("tang:") === 0) return "#/tang/" + id.slice(5);
  if (id.indexOf("ci:") === 0) return "#/ci/" + id.slice(3);
  return "#/read/" + id;
}

function clampAt(at, nowMs) {
  if (!Number.isFinite(at)) return 0;
  const value = Math.floor(at);
  if (value < 0) return 0;
  if (value > nowMs + 60 * 1000) return nowMs;
  return value;
}

function cleanTitle(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 40);
}

function cleanRecentItem(raw, nowMs) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!SCOPE.test(id)) return null;
  const title = cleanTitle(raw.title);
  if (!title) return null;
  const at = clampAt(Number(raw.at), nowMs);
  if (!at) return null;
  let y = Number(raw.y);
  if (!Number.isFinite(y) || y < 0) y = 0;
  if (y > 200000) y = 200000;
  return { id: id, title: title, at: at, y: Math.floor(y), href: hrefFor(id) };
}

function cleanRead(raw, nowMs) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(function (id) {
    if (!SCOPE.test(id)) return;
    const at = clampAt(Number(raw[id]), nowMs);
    if (!at) return;
    out[id] = at;
  });
  return trimRead(out);
}

function trimRead(read) {
  const ids = Object.keys(read);
  if (ids.length <= MAX_READ) return read;
  ids.sort(function (a, b) { return read[b] - read[a]; });
  const next = {};
  ids.slice(0, MAX_READ).forEach(function (id) { next[id] = read[id]; });
  return next;
}

function mergeHistory(incoming, saved, nowMs) {
  const now = nowMs || Date.now();
  const read = cleanRead(saved && saved.read, now);
  const incomingRead = cleanRead(incoming && incoming.read, now);
  Object.keys(incomingRead).forEach(function (id) {
    if (!read[id] || incomingRead[id] >= read[id]) read[id] = incomingRead[id];
  });
  const recentMap = {};
  function take(list) {
    (Array.isArray(list) ? list : []).forEach(function (item) {
      const clean = cleanRecentItem(item, now);
      if (!clean) return;
      const prev = recentMap[clean.id];
      if (!prev || clean.at >= prev.at) recentMap[clean.id] = clean;
    });
  }
  take(saved && saved.recent);
  take(incoming && incoming.recent);
  const recent = Object.keys(recentMap).map(function (id) { return recentMap[id]; });
  recent.sort(function (a, b) {
    if (b.at !== a.at) return b.at - a.at;
    return a.id < b.id ? -1 : 1;
  });
  return { recent: recent.slice(0, MAX_RECENT), read: trimRead(read) };
}

module.exports = {
  MAX_RECENT: MAX_RECENT,
  MAX_READ: MAX_READ,
  mergeHistory: mergeHistory,
  hrefFor: hrefFor,
};
