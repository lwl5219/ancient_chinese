"use strict";

const { TABLES } = require("../src/tables");

async function main() {
  if (!process.env.TABLESTORE_ENDPOINT || !process.env.TABLESTORE_INSTANCE) {
    throw new Error("Set TABLESTORE_ENDPOINT and TABLESTORE_INSTANCE first");
  }
  const TableStore = require("tablestore");
  const client = new TableStore.Client({
    accessKeyId: process.env.TABLESTORE_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    secretAccessKey: process.env.TABLESTORE_ACCESS_KEY_SECRET || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    endpoint: process.env.TABLESTORE_ENDPOINT,
    instancename: process.env.TABLESTORE_INSTANCE,
  });
  for (const table of TABLES) {
    const params = {
      tableMeta: {
        tableName: table.tableName,
        primaryKey: [{ name: table.primaryKey, type: "STRING" }],
      },
      reservedThroughput: { capacityUnit: { read: 0, write: 0 } },
      tableOptions: { timeToLive: -1, maxVersions: 1 },
    };
    await new Promise(function (resolve, reject) {
      client.createTable(params, function (err) {
        if (err && !/AlreadyExist/i.test(String(err.code || err.message || err))) reject(err);
        else resolve();
      });
    });
    console.log("ready " + table.tableName + " pk " + table.primaryKey);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
