'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const download = require('../scripts/previous_release.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);

function release() {
  const body = '{"volumes":[]}';
  const asset = `data/catalog.${hash(body)}.json`;
  const map = `window.ASSET_URLS = ${JSON.stringify({ 'data/catalog.json': asset })};\nwindow.SITE_BUILD = "abc123";\n`;
  const mapRef = `js/asset-urls.${hash(map)}.js`;
  const files = { 'version.json': '{"build":"abc123"}', [asset]: body, [mapRef]: map,
    'index.html': `<html data-build="abc123"><script src="${mapRef}"></script></html>` };
  const requests = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.headers, undefined);
    const rel = new URL(url).pathname.slice('/site/'.length); requests.push(rel);
    const value = files[rel];
    return { ok: value !== undefined, status: value === undefined ? 404 : 200,
      arrayBuffer: async () => Buffer.from(value) };
  };
  return { files, asset, mapRef, requests, fetchImpl };
}
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'previous-release-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, 'previous');
}
test('downloads actual public release and validates every hash without credentials', async t => {
  const f = release(), output = await directory(t);
  assert.equal(await download('https://example.test/site/', output, f.fetchImpl), true);
  assert.equal(await fs.readFile(path.join(output, f.asset), 'utf8'), f.files[f.asset]);
  assert.equal(f.requests.filter(x => x === 'version.json').length, 2);
});
test('first deployment with no version falls back to checkout without output', async t => {
  const f = release(), output = await directory(t); delete f.files['version.json'];
  assert.equal(await download('https://example.test/site/', output, f.fetchImpl), false);
  await assert.rejects(fs.access(output));
});
test('corrupt previous resource aborts before exposing an output directory', async t => {
  const f = release(), output = await directory(t); f.files[f.asset] = 'corrupted';
  await assert.rejects(download('https://example.test/site/', output, f.fetchImpl), /hash disagrees/);
  await assert.rejects(fs.access(output));
});
test('missing previous resource blocks silent loss of compatibility', async t => {
  const f = release(), output = await directory(t); delete f.files[f.asset];
  await assert.rejects(download('https://example.test/site/', output, f.fetchImpl), /HTTP 404/);
});
test('missing hash can be restored only from identical real canonical bytes', async t => {
  const f = release(), output = await directory(t);
  f.files['data/catalog.json'] = f.files[f.asset]; delete f.files[f.asset];
  assert.equal(await download('https://example.test/site/', output, f.fetchImpl), true);
  assert.equal(await fs.readFile(path.join(output, f.asset), 'utf8'), f.files['data/catalog.json']);
});
test('a changed canonical file cannot stand in for an unavailable old hash', async t => {
  const f = release(), output = await directory(t);
  f.files['data/catalog.json'] = '{"changed":true}'; delete f.files[f.asset];
  await assert.rejects(download('https://example.test/site/', output, f.fetchImpl), /hash disagrees/);
});
test('release changes during download require a new coherent snapshot', async t => {
  const f = release(), output = await directory(t); let reads = 0;
  const fetchImpl = async (url, opts) => {
    if (url.endsWith('version.json') && ++reads === 2) f.files['version.json'] = '{"build":"changed"}';
    return f.fetchImpl(url, opts);
  };
  await assert.rejects(download('https://example.test/site/', output, fetchImpl), /changed during download/);
});
test('only HTTPS is accepted', async t => {
  await assert.rejects(download('http://example.test/site/', await directory(t), release().fetchImpl), /HTTPS/);
});
