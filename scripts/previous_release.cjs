'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const HASH = /\.([0-9a-f]{12})\.[A-Za-z0-9]+$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);

async function previousRelease(baseUrl, output, fetchImpl = fetch) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (base.protocol !== 'https:') throw new Error('Previous release must use public HTTPS');
  const resolve = rel => {
    const url = new URL(rel, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || rel.includes('..')) {
      throw new Error(`Unsafe previous asset URL: ${rel}`);
    }
    return url.href;
  };
  async function read(rel, allowMissing = false) {
    // No authorization headers, cookies or tokens are sent to the public site.
    const response = await fetchImpl(resolve(rel), { cache: 'no-store', credentials: 'omit',
      redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Previous release HTTP ${response.status}: ${rel}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const versionBytes = await read('version.json', true);
  if (versionBytes === null) {
    console.log('No previous public version.json; stage will retain verified checkout hashes.');
    return false;
  }
  const version = JSON.parse(versionBytes);
  const indexBytes = await read('index.html');
  const index = indexBytes.toString('utf8');
  if (!index.includes(`data-build="${version.build}"`)) throw new Error('Previous entry/version disagree');
  const refs = [...index.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => match[1]);
  const mapRef = refs.find(rel => /^js\/asset-urls\.[0-9a-f]{12}\.js$/.test(rel));
  if (!mapRef) throw new Error('Previous entry is missing its hashed resource map');
  const mapBytes = await read(mapRef);
  if (digest(mapBytes) !== mapRef.match(HASH)[1]) throw new Error('Previous resource map hash disagrees');
  const mapText = mapBytes.toString('utf8');
  if (!mapText.includes(`window.SITE_BUILD = "${version.build}";`)) throw new Error('Previous map/version disagree');
  const urls = JSON.parse(mapText.split('window.ASSET_URLS = ')[1].split(';\n')[0]);
  const assets = [...new Set([...Object.values(urls), ...refs].filter(rel => HASH.test(rel)))];
  for (const rel of assets) resolve(rel);
  if (assets.length > 10000) throw new Error('Unexpected previous release size');
  const absolute = path.resolve(output);
  try { await fs.access(absolute); throw new Error('Previous output already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temp = await fs.mkdtemp(path.join(path.dirname(absolute), '.previous-'));
  let cursor = 0;
  const write = async (rel, bytes) => {
    const dest = path.resolve(temp, rel);
    if (!dest.startsWith(`${temp}${path.sep}`)) throw new Error(`Unsafe file path: ${rel}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bytes);
  };
  try {
    const workers = Array.from({ length: Math.min(8, assets.length) }, async () => {
      while (cursor < assets.length) {
        const rel = assets[cursor++];
        let bytes = rel === mapRef ? mapBytes : await read(rel, true);
        if (bytes === null) {
          const canonical = Object.keys(urls).find(key => urls[key] === rel);
          if (!canonical) throw new Error(`Previous release HTTP 404: ${rel}`);
          bytes = await read(canonical);
        }
        if (digest(bytes) !== rel.match(HASH)[1]) throw new Error(`Previous asset hash disagrees: ${rel}`);
        await write(rel, bytes);
      }
    });
    const results = await Promise.allSettled(workers);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const latest = JSON.parse(await read('version.json'));
    const latestIndex = (await read('index.html')).toString('utf8');
    if (latest.build !== version.build || !latestIndex.includes(`data-build="${version.build}"`)) {
      throw new Error('Previous release changed during download; retry against the new release');
    }
    await write('version.json', versionBytes);
    await write('index.html', indexBytes);
    await write('js/asset-urls.js', mapBytes);
    await fs.rename(temp, absolute);
    console.log(`Verified previous public build ${version.build}: ${assets.length} hashed assets`);
    return true;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

module.exports = previousRelease;
if (require.main === module) {
  if (process.argv.length !== 4) { console.error('Usage: node scripts/previous_release.cjs <public-pages-url> <new-output>'); process.exitCode = 2; }
  else previousRelease(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
