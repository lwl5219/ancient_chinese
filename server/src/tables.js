"use strict";

const TABLES = [
  { tableName: "users", primaryKey: [{ name: "email", type: "STRING" }] },
  { tableName: "codes", primaryKey: [{ name: "email", type: "STRING" }] },
  { tableName: "limits", primaryKey: [{ name: "id", type: "STRING" }] },
  { tableName: "sessions", primaryKey: [{ name: "tokenHash", type: "STRING" }] },
  { tableName: "events", primaryKey: [{ name: "userId", type: "STRING" }, { name: "ts", type: "STRING" }] },
];

module.exports = { TABLES };
