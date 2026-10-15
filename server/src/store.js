"use strict";

const { TABLES } = require("./tables");

function fromInt(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

function attributesOf(row) {
  const out = {};
  const cols = row && (row.attributes || row.attributeColumns) || [];
  cols.forEach(function (col) {
    if (Array.isArray(col)) out[col[0]] = col[1];
    else if (col && col.columnName) out[col.columnName] = col.columnValue;
  });
  return out;
}

function rowPresent(data) {
  const pk = data && data.row && data.row.primaryKey;
  return Array.isArray(pk) && pk.length > 0;
}

function call(client, method, params) {
  return new Promise(function (resolve, reject) {
    client[method](params, function (err, data) {
      if (err) reject(err);
      else resolve(data || {});
    });
  });
}

function createTableStore(client, codec) {
  const toInt = codec && codec.toInt ? codec.toInt : function (n) { return n; };
  const readInt = codec && codec.fromInt ? codec.fromInt : fromInt;
  const condition = codec && codec.condition ? codec.condition : function () { return undefined; };

  async function get(tableName, pkName, pkValue) {
    const data = await call(client, "getRow", {
      tableName: tableName,
      primaryKey: [{ [pkName]: pkValue }],
      maxVersions: 1,
    });
    if (!rowPresent(data)) return null;
    return attributesOf(data.row);
  }

  async function put(tableName, pkName, pkValue, columns) {
    const params = {
      tableName: tableName,
      primaryKey: [{ [pkName]: pkValue }],
      attributeColumns: columns,
      condition: condition(),
    };
    await call(client, "putRow", params);
  }

  async function remove(tableName, pkName, pkValue) {
    await call(client, "deleteRow", {
      tableName: tableName,
      primaryKey: [{ [pkName]: pkValue }],
      condition: condition(),
    });
  }

  function userFrom(email, cols) {
    let sessionHashes = [];
    try { sessionHashes = JSON.parse(cols.sessionHashes || "[]"); } catch (_) { sessionHashes = []; }
    if (!Array.isArray(sessionHashes)) sessionHashes = [];
    return {
      email: email,
      userId: String(cols.userId || ""),
      createdAt: readInt(cols.createdAt),
      sessionHashes: sessionHashes,
    };
  }

  return {
    async getUser(email) {
      const cols = await get("users", "email", email);
      return cols ? userFrom(email, cols) : null;
    },
    async putUser(user) {
      await put("users", "email", user.email, [
        { userId: user.userId },
        { createdAt: toInt(user.createdAt || 0) },
        { sessionHashes: JSON.stringify(user.sessionHashes || []) },
      ]);
    },
    async deleteUser(email) { await remove("users", "email", email); },
    async getCode(email) {
      const cols = await get("codes", "email", email);
      if (!cols) return null;
      return {
        hash: String(cols.codeHash || ""),
        expiresAt: readInt(cols.expiresAt),
        attempts: readInt(cols.attempts),
        sentAt: readInt(cols.sentAt),
      };
    },
    async putCode(email, row) {
      await put("codes", "email", email, [
        { codeHash: row.hash },
        { expiresAt: toInt(row.expiresAt || 0) },
        { attempts: toInt(row.attempts || 0) },
        { sentAt: toInt(row.sentAt || 0) },
      ]);
    },
    async deleteCode(email) { await remove("codes", "email", email); },
    async getLimit(id) {
      const cols = await get("limits", "id", id);
      if (!cols) return null;
      return {
        hourStart: readInt(cols.hourStart),
        hourCount: readInt(cols.hourCount),
        lastSent: readInt(cols.lastSent),
      };
    },
    async putLimit(id, row) {
      await put("limits", "id", id, [
        { hourStart: toInt(row.hourStart || 0) },
        { hourCount: toInt(row.hourCount || 0) },
        { lastSent: toInt(row.lastSent || 0) },
      ]);
    },
    async deleteLimit(id) { await remove("limits", "id", id); },
    async getSession(tokenHash) {
      const cols = await get("sessions", "tokenHash", tokenHash);
      if (!cols) return null;
      return {
        userId: String(cols.userId || ""),
        email: String(cols.email || ""),
        expiresAt: readInt(cols.expiresAt),
      };
    },
    async putSession(tokenHash, row) {
      await put("sessions", "tokenHash", tokenHash, [
        { userId: row.userId },
        { email: row.email },
        { expiresAt: toInt(row.expiresAt || 0) },
      ]);
    },
    async deleteSession(tokenHash) { await remove("sessions", "tokenHash", tokenHash); },
    async getSync(userId) {
      const cols = await get("sync", "userId", userId);
      if (!cols) return null;
      let bookmarks = [];
      let state = {};
      try { bookmarks = JSON.parse(cols.bookmarks || "[]"); } catch (_) { bookmarks = []; }
      try { state = JSON.parse(cols.state || "{}"); } catch (_) { state = {}; }
      return { bookmarks: bookmarks, state: state };
    },
    async putSync(userId, row) {
      await put("sync", "userId", userId, [
        { bookmarks: JSON.stringify(row.bookmarks || []) },
        { state: JSON.stringify(row.state || {}) },
      ]);
    },
    async deleteSync(userId) { await remove("sync", "userId", userId); },
  };
}

function createStore(env) {
  if (!env.TABLESTORE_ENDPOINT || !env.TABLESTORE_INSTANCE) {
    throw new Error("TABLESTORE_ENDPOINT and TABLESTORE_INSTANCE are required");
  }
  const TableStore = require("tablestore");
  const client = new TableStore.Client({
    accessKeyId: env.TABLESTORE_ACCESS_KEY_ID || env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    secretAccessKey: env.TABLESTORE_ACCESS_KEY_SECRET || env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    endpoint: env.TABLESTORE_ENDPOINT,
    instancename: env.TABLESTORE_INSTANCE,
  });
  return createTableStore(client, {
    toInt: function (n) { return TableStore.Long.fromNumber(n); },
    fromInt: fromInt,
    condition: function () {
      return new TableStore.Condition(TableStore.RowExistenceExpectation.IGNORE, null);
    },
  });
}

module.exports = {
  TABLES: TABLES,
  createTableStore: createTableStore,
  createStore: createStore,
  fromInt: fromInt,
};
