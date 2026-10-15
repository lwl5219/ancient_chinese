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
    async putEvents(rows) {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        await call(client, "putRow", {
          tableName: "events",
          primaryKey: [{ userId: row.userId }, { ts: row.ts }],
          attributeColumns: [
            { type: row.type },
            { pieceId: row.pieceId || "" },
            { payload: row.payload || "{}" },
            { deviceHash: row.deviceHash || "" },
            { clientTs: toInt(row.clientTs || 0) },
          ],
          condition: condition(),
        });
      }
    },
    async deleteEventsForUser(userId) {
      if (typeof client.getRange !== "function") return;
      const bounds = codec && codec.range || {};
      let start = [{ userId: userId }, { ts: bounds.min }];
      const end = [{ userId: userId }, { ts: bounds.max }];
      for (let round = 0; round < 20; round += 1) {
        const data = await call(client, "getRange", {
          tableName: "events",
          direction: bounds.forward,
          inclusiveStartPrimaryKey: start,
          exclusiveEndPrimaryKey: end,
          limit: 50,
        });
        const found = data.rows || [];
        if (!found.length) return;
        for (let i = 0; i < found.length; i += 1) {
          const pk = (found[i].primaryKey || []).map(function (col) {
            const name = col.name || col.columnName;
            return { [name]: col.value };
          });
          await call(client, "deleteRow", { tableName: "events", primaryKey: pk, condition: condition() });
        }
        if (!data.nextStartPrimaryKey || !data.nextStartPrimaryKey.length) return;
        start = data.nextStartPrimaryKey;
      }
    },
    async getState(userId) {
      const cols = await get("state", "userId", userId);
      if (!cols) return null;
      let recent = [];
      let read = {};
      try { recent = JSON.parse(cols.recent || "[]"); } catch (_) { recent = []; }
      try { read = JSON.parse(cols.read || "{}"); } catch (_) { read = {}; }
      return { recent: recent, read: read };
    },
    async putState(userId, row) {
      await put("state", "userId", userId, [
        { recent: JSON.stringify(row.recent || []) },
        { read: JSON.stringify(row.read || {}) },
      ]);
    },
    async deleteState(userId) { await remove("state", "userId", userId); },
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
    range: {
      min: TableStore.INF_MIN,
      max: TableStore.INF_MAX,
      forward: TableStore.Direction.FORWARD,
    },
  });
}

module.exports = {
  TABLES: TABLES,
  createTableStore: createTableStore,
  createStore: createStore,
  fromInt: fromInt,
};
