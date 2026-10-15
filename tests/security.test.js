'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { reader } = require('./reader-harness.cjs');
const root = path.join(__dirname, '..');
const json = name => JSON.parse(fs.readFileSync(path.join(root, 'data', name + '.json'), 'utf8'));
const walk = node => [node, ...(node.children || []).flatMap(walk)];

function catalogs(t) {
  for (const name of ['catalog', 'renjian', 'zztj', 'daode', 'lunyu']) t.app.state[name] = json(name);
  for (const name of ['tang', 'ci', 'ke']) t.app.state.collections[name] = json(name === 'ci' ? 'songci' : name);
}

test('pager renders hostile title and label as literal text, including the directory fallback', () => {
  const t = reader();
  const title = '<img src=x onerror=alert(1)> & <svg onload=alert(2)>';
  const label = '</small><script>alert(3)</script>';
  const link = t.app.pagerLink({ id: 'v01-01', title }, label);
  assert.equal(link.href, '#/read/v01-01');
  assert.equal(link.innerHTML, undefined);
  assert.equal(link.children[0].tag, 'small');
  assert.equal(link.children[0].textContent, label);
  assert.equal(link.children[1].textContent, title);
  const back = t.app.pagerLink(null, label);
  assert.equal(back.href, '#/');
  assert.equal(back.children[1].textContent, '返回目录');
  assert.equal(back.innerHTML, undefined);
});

function references(value) {
  const t = reader(), parent = t.get('references');
  t.app.state.provenance = { pieces: { sample: { edition: '<b>原本</b>', url: value } } };
  t.app.state.article = { id: 'sample' };
  t.app.state.glossSources = { pieces: { sample: { 'word|字': { source: '释义出处', url: value } } } };
  t.app.appendSourceLine(parent, 'sample');
  t.app.appendProvenance(parent, 'sample');
  t.app.appendGlossCredit(parent, 'word', '字');
  t.app.openLineCard({ text: '原文', comments: [{ text: '评', source: '来源', url: value }] });
  return [...walk(parent), ...walk(t.get('famous-sheet'))];
}

test('all four source renderers keep executable, malformed and relative URLs non-clickable', () => {
  for (const value of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///tmp/test',
    '//example.test/source', '/source', 'https://', 'https://user:password@example.test/',
    'https://example.test/\nsource', {}, null]) {
    const nodes = references(value);
    assert.equal(nodes.filter(n => n.tag === 'a').length, 0, String(value));
    assert.ok(nodes.some(n => n.textContent === '<b>原本</b>'));
  }
});

test('all four source renderers preserve HTTP and HTTPS citations with safe new-tab attributes', () => {
  for (const url of ['https://example.test/source?q=1#section', 'http://example.test/source']) {
    const links = references(url).filter(n => n.tag === 'a');
    assert.equal(links.length, 4);
    for (const a of links) {
      assert.equal(a.href, url);
      assert.equal(a.target, '_blank');
      assert.match(a.rel, /\bnoopener\b/);
      assert.match(a.rel, /\bnoreferrer\b/);
      assert.equal(a.innerHTML, undefined);
    }
  }
});

test('analytics resolves real catalog entries and canonicalizes volume and author aliases', () => {
  const t = reader(); catalogs(t);
  for (const name of ['catalog', 'renjian', 'zztj', 'daode', 'lunyu']) {
    for (const volume of t.app.state[name].volumes) {
      for (const item of volume.articles) assert.equal(t.app.analyticsPath('#/read/' + item.id), '/#/read/' + item.id);
    }
  }
  for (const kind of ['tang', 'ci', 'ke']) {
    for (const piece of t.app.state.collections[kind].pieces) {
      assert.equal(t.app.analyticsPath('#/' + kind + '/' + piece.id), '/#/' + kind + '/' + piece.id);
      assert.equal(t.app.analyticsPath('#/' + kind + '/author/' + encodeURIComponent(piece.author.t)),
        '/#/' + kind + '/author/' + encodeURIComponent(piece.author.s));
    }
  }
  assert.equal(t.app.analyticsPath('#/gwgz/01'), '/#/gwgz/1');
  assert.equal(t.app.analyticsPath('#/zztj/01'), '/#/zztj/1');
  for (const hash of ['', '#/', '#/gwgz', '#/zztj', '#/rjch', '#/daode', '#/lunyu', '#/tang', '#/ci', '#/ke']) {
    assert.equal(t.app.analyticsPath(hash), '/' + (hash || '#/'));
  }
});

test('analytics rejects unknown routes, nonexistent entries, account routes and hash payloads', () => {
  const t = reader(); catalogs(t);
  for (const hash of ['#access_token=private', '#/login', '#/me', '#/privacy', '#/terms',
    '#/unknown', '#/read/v99-99', '#/gwgz/99', '#/zztj/99', '#/tang/private-token',
    '#/tang/author/private-token', '#/tang/author/%E0%A4%A', '#/tang/author/%2561',
    '#/read/v01-01?secret=value', '#/read/v01-01/secret', '#/gwgz#secret', '#/?secret=value']) {
    assert.equal(t.app.analyticsPath(hash), null, hash);
    t.app.trackPageview(hash);
  }
  assert.equal(t.window._hmt, undefined);
});

test('analytics sends the first safe view once and deduplicates canonical aliases', () => {
  const t = reader(); catalogs(t);
  t.context.location.hash = '#access_token=must-not-leave';
  for (const hash of ['#/gwgz/01', '#/gwgz/1', '#/bad?secret=private', '#/read/v01-01']) t.app.trackPageview(hash);
  assert.deepEqual(JSON.parse(JSON.stringify(t.window._hmt)), [
    ['_trackPageview', '/#/gwgz/1'], ['_trackPageview', '/#/read/v01-01'],
  ]);
});

test('failed navigation never records a pageview', async () => {
  const t = reader(); catalogs(t);
  t.context.location.hash = '#/read/v01-01';
  t.context.fetch = async () => { throw new Error('offline'); };
  await t.app.route();
  assert.equal(t.window._hmt, undefined);
});

test('Baidu automatic pageview is disabled before its script loads; statistics stay installed', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m => m[1].includes('hm.baidu.com/hm.js'))[1];
  let inserted = 0;
  const ctx = vm.createContext({ document: {
    createElement: () => ({}), getElementsByTagName: () => [], head: { appendChild(node) {
      assert.equal(ctx._hmt[0][0], '_setAutoPageview');
      assert.equal(ctx._hmt[0][1], false);
      assert.match(node.src, /^https:\/\/hm\.baidu\.com\/hm\.js\?/);
      inserted++;
    } },
  } });
  vm.runInContext(script, ctx);
  assert.equal(inserted, 1);
  assert.match(html, /busuanzi\.pure\.mini\.js/);
});

test('the static homepage reports only its canonical path without reading visitor URL data', () => {
  const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m => m[1].includes('hm.baidu.com/hm.js'))[1];
  const ctx = vm.createContext({
    location: new Proxy({}, { get() { throw new Error('Do not read visitor URL data'); } }),
    document: { createElement: () => ({}), getElementsByTagName: () => [], head: { appendChild() {} } },
  });
  vm.runInContext(script, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx._hmt)), [['_setAutoPageview', false], ['_trackPageview', '/']]);
  assert.match(html, /busuanzi\.pure\.mini\.js/);
  assert.match(html, /https:\/\/guwen\.lucca\.top\/stats\.html/);
});
