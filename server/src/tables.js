"use strict";

const TABLES = [
  { tableName: "users", primaryKey: "email" },
  { tableName: "codes", primaryKey: "email" },
  { tableName: "limits", primaryKey: "id" },
  { tableName: "sessions", primaryKey: "tokenHash" },
  { tableName: "sync", primaryKey: "userId" },
];

module.exports = { TABLES };
