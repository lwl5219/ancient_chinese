'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

function node(tag = 'div') {
  return { tag, children: [], listeners: {}, style: {}, dataset: {}, hidden: true,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(key, value) { this[key] = value; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(key, callback) { this.listeners[key] = callback; },
    querySelectorAll() { return []; }, contains() { return false; },
  };
}

function reader(localStorage = storage()) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const body = node('body');
  const document = { body, getElementById: get, querySelector: get,
    querySelectorAll() { return []; }, createElement: node,
    createTextNode: text => ({ textContent: text }), addEventListener() {},
  };
  const window = { listeners: {}, addEventListener(key, callback) { this.listeners[key] = callback; },
    matchMedia() { return { matches: false }; }, scrollTo() {}, scrollY: 0 };
  const context = vm.createContext({ document, window, localStorage, URL,
    location: { hash: '', reload() {} }, console: { error() {}, log() {} },
    setTimeout, clearTimeout, requestAnimationFrame: fn => fn(),
    fetch: async () => { throw new Error('Unexpected network request in test'); },
  });
  const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  const entry = '  startBoot();\n})();';
  assert.equal(source.split(entry).length, 2, 'Expected exactly one app entry point');
  const exposed = `  globalThis.reader = { state, saveProgress, loadProgress, syncStoredProgress,
    showArticle, route, startBoot, audioPath, playSyllable, loadAudioManifest,
    pagerLink, appendSourceLine, appendProvenance, appendGlossCredit, openLineCard,
    analyticsPath, trackPageview,
    noteReading, markRead, historySnapshot, mergeHistory, applyHistory, historyRev: historyRevCount,
    setHooks(hooks) {
      renderArticle = hooks.renderArticle;
      renderPiece = hooks.renderPiece;
      syncChrome = hooks.syncChrome;
      skeleton = hooks.skeleton;
      closePopup = hooks.closePopup;
    }
  };\n})();`;
  // Evaluate the actual complete application. Only skip automatic network boot
  // and replace layout hooks, so tests remain dependency-free and deterministic.
  vm.runInContext(source.replace(entry, exposed), context, { filename: 'js/app.js' });
  context.reader.setHooks({ syncChrome() {}, closePopup() {},
    skeleton() { context.rendered = 'loading'; },
    renderArticle() { context.rendered = context.reader.state.article.id; },
    renderPiece() { context.rendered = 'piece:' + context.reader.state.piece.id; },
  });
  return { context, app: context.reader, get, body, window, localStorage };
}

module.exports = { reader, storage };
