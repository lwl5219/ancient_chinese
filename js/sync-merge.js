(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.gwgzMerge = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var BOOKMARK_ID = /^[a-z0-9:_-]{1,120}$/;
  var PROGRESS_ID = /^[vhdzl]\d{2}-\d{2}$/;
  var MAX_BOOKMARKS = 500;

  function cleanBookmark(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var id = typeof raw.id === "string" ? raw.id : "";
    if (!BOOKMARK_ID.test(id)) return null;
    if (raw.kind !== "piece" && raw.kind !== "sentence") return null;
    var href = typeof raw.href === "string" ? raw.href : "";
    if (href.indexOf("#/") !== 0 || href.length > 200 || href.indexOf(" ") >= 0) return null;
    var title = typeof raw.title === "string" ? raw.title.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!title) return null;
    var quote = typeof raw.quote === "string" ? raw.quote.replace(/\s+/g, "").slice(0, 80) : "";
    var at = Number.isFinite(raw.at) && raw.at > 0 ? raw.at : 0;
    var item = { id: id, kind: raw.kind, href: href, title: title, at: at };
    if (quote) item.quote = quote;
    if (raw.deleted) item.deleted = true;
    return item;
  }

  function mergeBookmarks(local, server) {
    var map = new Map();
    function take(list) {
      (Array.isArray(list) ? list : []).forEach(function (raw) {
        var item = cleanBookmark(raw);
        if (!item) return;
        var prev = map.get(item.id);
        if (!prev || item.at >= prev.at) map.set(item.id, item);
      });
    }
    take(server);
    take(local);
    return Array.from(map.values()).sort(function (a, b) {
      return b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }).slice(0, MAX_BOOKMARKS);
  }

  function cleanState(raw) {
    var src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var learned = {};
    Object.keys(src.learned || {}).forEach(function (id) {
      if (PROGRESS_ID.test(id) && Number.isFinite(src.learned[id]) && src.learned[id] > 0) learned[id] = src.learned[id];
    });
    var collections = {};
    ["tang", "ci", "ke"].forEach(function (kind) {
      var id = src.collections && src.collections[kind];
      if (typeof id === "string" && /^[a-z0-9-]+$/.test(id)) collections[kind] = id;
    });
    var updatedAt = Number.isFinite(src.updatedAt) && src.updatedAt > 0 ? src.updatedAt : 0;
    return {
      learned: learned,
      collections: collections,
      font: src.font === "t" ? "t" : "s",
      mode: src.mode === "study" ? "study" : "read",
      sentenceSet: !!src.sentenceSet,
      sentence: src.sentenceSet ? !!src.sentence : true,
      pinyinSet: !!src.pinyinSet,
      pinyin: src.pinyinSet ? !!src.pinyin : true,
      last: typeof src.last === "string" && src.last.length <= 80 ? src.last : "",
      updatedAt: updatedAt,
    };
  }

  function mergeState(localRaw, serverRaw) {
    var local = cleanState(localRaw);
    var server = cleanState(serverRaw);
    var newer = local.updatedAt >= server.updatedAt ? local : server;
    var older = newer === local ? server : local;
    var learned = {};
    Object.keys(older.learned).forEach(function (id) { learned[id] = older.learned[id]; });
    Object.keys(newer.learned).forEach(function (id) {
      learned[id] = Math.max(learned[id] || 0, newer.learned[id]);
    });
    return {
      learned: learned,
      collections: newer.collections,
      font: newer.font,
      mode: newer.mode,
      sentenceSet: newer.sentenceSet,
      sentence: newer.sentence,
      pinyinSet: newer.pinyinSet,
      pinyin: newer.pinyin,
      last: newer.last,
      updatedAt: Math.max(local.updatedAt, server.updatedAt),
    };
  }

  return {
    cleanBookmark: cleanBookmark,
    mergeBookmarks: mergeBookmarks,
    cleanState: cleanState,
    mergeState: mergeState,
  };
});
