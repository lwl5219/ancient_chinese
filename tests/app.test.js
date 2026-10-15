'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reader, storage } = require('./reader-harness.cjs');

test('a stale tab saving navigation preserves another tab read marker', () => {
  const shared = storage(), a = reader(shared), b = reader(shared);
  a.app.state.progress.learned['v01-01'] = 123;
  a.app.saveProgress();
  b.app.state.progress.last = 'v02-01';
  b.app.saveProgress();
  assert.equal(b.app.state.progress.learned['v01-01'], 123);
});

test('explicit removal survives a stale legacy tab and a reload', () => {
  const shared = storage({ 'gwgz-progress-v1': JSON.stringify({ learned: { 'v01-01': 123 } }) });
  const a = reader(shared), b = reader(shared);
  delete a.app.state.progress.learned['v01-01']; a.app.saveProgress();
  b.app.state.progress.last = 'v02-01'; b.app.saveProgress();
  assert.equal(shared.data.get('gwgz-progress-v2:learned:v01-01'), 'null');
  assert.equal(reader(shared).app.state.progress.learned['v01-01'], undefined);
});

test('storage events synchronize fields without losing pending writes', () => {
  const shared = storage(), a = reader(shared), b = reader(shared);
  a.app.state.progress.font = 't'; a.app.saveProgress();
  b.window.listeners.storage({ key: 'gwgz-progress-v2:font' });
  assert.equal(b.app.state.progress.font, 't');
  shared.setItem = () => { throw new Error('QuotaExceededError'); };
  b.app.state.progress.learned['v02-01'] = 456; b.app.saveProgress();
  b.window.listeners.storage({ key: 'gwgz-progress-v2:font' });
  assert.equal(b.app.state.progress.learned['v02-01'], 456);
});

test('corrupt stored fields do not prevent startup', () => {
  const shared = storage({ 'gwgz-progress-v1': '{bad json', 'gwgz-progress-v2:font': '"t"',
    'gwgz-progress-v2:learned:v01-01': '{bad json' });
  assert.equal(reader(shared).app.state.progress.font, 't');
});

test('write denial preserves in-memory progress and still renders reading', async () => {
  const shared = storage(); shared.setItem = () => { throw new Error('QuotaExceededError'); };
  const t = reader(shared);
  t.context.fetch = async () => ({ ok: true, json: async () => ({ id: 'v01-01', volume: 1 }) });
  await t.app.showArticle('v01-01');
  assert.equal(t.context.rendered, 'v01-01');
  assert.equal(t.app.state.progress.last, 'v01-01');
  assert.match(t.get('app-notice').textContent, /未能保存/);
});

test('late JSON response body cannot overwrite a newer navigation', async () => {
  const t = reader(); let finishA, startA;
  const bodyA = new Promise(resolve => { finishA = resolve; });
  const startedA = new Promise(resolve => { startA = resolve; });
  t.context.fetch = async url => ({ ok: true, json: () => {
    if (url.includes('v01-01')) { startA(); return bodyA; }
    return Promise.resolve({ id: 'v01-02', volume: 1 });
  } });
  const pendingA = t.app.showArticle('v01-01'); await startedA;
  await t.app.showArticle('v01-02'); finishA({ id: 'v01-01', volume: 1 }); await pendingA;
  assert.equal(t.context.rendered, 'v01-02');
  assert.equal(t.app.state.progress.last, 'v01-02');
});

test('network failure presents a retry that can recover the same article', async () => {
  const t = reader(); t.app.state.catalog = { volumes: [] };
  t.context.location.hash = '#/read/v01-01';
  t.context.fetch = async () => { throw new Error('offline'); };
  await t.app.route();
  const error = t.get('main').children[0];
  assert.equal(error.role, 'alert');
  const retry = error.children.find(child => child.textContent === '重新载入');
  assert.ok(retry);
  t.context.fetch = async () => ({ ok: true, json: async () => ({ id: 'v01-01', volume: 1 }) });
  await retry.listeners.click();
  assert.equal(t.context.rendered, 'v01-01');
});

test('HTTP failure during boot produces a visible retry', async () => {
  const t = reader(); t.context.fetch = async () => ({ ok: false, status: 503 });
  await t.app.startBoot();
  assert.equal(t.get('main').children[0].role, 'alert');
});

test('missing audio in the real manifest never attempts an invented URL', async () => {
  const t = reader(); let plays = 0;
  t.app.state.audioManifest = { 'pù': 'pu4' };
  t.context.Audio = function () { plays += 1; };
  assert.equal(await t.app.playSyllable('cēn'), false);
  assert.equal(plays, 0);
  assert.match(t.get('app-notice').textContent, /暂无录音/);
});

test('existing audio is requested by its manifest key and play errors are visible', async () => {
  const t = reader(); let requested;
  t.app.state.audioManifest = { 'pù': 'pu4' };
  t.context.Audio = function (url) { requested = url; this.play = async () => { throw new Error('blocked'); }; };
  assert.equal(await t.app.playSyllable('pù'), false);
  assert.equal(requested, 'audio/pu4.ogg');
  assert.match(t.get('app-notice').textContent, /无法播放/);
});

test('upstream poem header toggles retain per-field progress and redraw the poem', () => {
  const t = reader();
  t.app.state.view = 'piece'; t.app.state.piece = { id: 'jingyesi' };
  t.get('tool-font').listeners.click();
  assert.equal(t.app.state.progress.font, 't');
  assert.equal(t.context.rendered, 'piece:jingyesi');
  t.get('tool-py').listeners.click();
  assert.equal(t.app.state.progress.pinyin, false);
  assert.equal(JSON.parse(t.localStorage.data.get('gwgz-progress-v2:pinyin')), false);
});
