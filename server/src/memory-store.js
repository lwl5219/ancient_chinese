"use strict";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMemoryStore() {
  const users = new Map();
  const codes = new Map();
  const limits = new Map();
  const sessions = new Map();
  const sync = new Map();
  return {
    async getUser(email) { return clone(users.get(email) || null); },
    async putUser(user) { users.set(user.email, clone(user)); },
    async deleteUser(email) { users.delete(email); },
    async getCode(email) { return clone(codes.get(email) || null); },
    async putCode(email, row) { codes.set(email, clone(row)); },
    async deleteCode(email) { codes.delete(email); },
    async getLimit(id) { return clone(limits.get(id) || null); },
    async putLimit(id, row) { limits.set(id, clone(row)); },
    async deleteLimit(id) { limits.delete(id); },
    async getSession(tokenHash) { return clone(sessions.get(tokenHash) || null); },
    async putSession(tokenHash, row) { sessions.set(tokenHash, clone(row)); },
    async deleteSession(tokenHash) { sessions.delete(tokenHash); },
    async getSync(userId) { return clone(sync.get(userId) || null); },
    async putSync(userId, row) { sync.set(userId, clone(row)); },
    async deleteSync(userId) { sync.delete(userId); },
    dump() {
      return { users: users, codes: codes, limits: limits, sessions: sessions, sync: sync };
    },
  };
}

module.exports = { createMemoryStore };
