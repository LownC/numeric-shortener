import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.env.M1_STATIC_ROOT || 'target/dx/numeric-shortener/release/web/public');
const base = process.env.M1_BASE_URL || 'http://127.0.0.1:18083';
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert.ok(html.includes('숫자 URL 서비스'), 'SSG contains initial application HTML');
assert.ok(html.includes('initial_dioxus_hydration_data'), 'SSG contains hydration payload');
assert.equal((html.match(/<h1\b/g) || []).length, 1, 'SSG renders a single application heading');
assert.equal((html.match(/initial_dioxus_hydration_data/g) || []).length, 1, 'SSG has one hydration payload');
const files = [];
async function collect(dir) {
  for (const item of await readdir(dir, {withFileTypes:true})) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await collect(file); else files.push(file);
  }
}
await collect(root);
for (const ext of ['.js','.wasm','.css']) {
  const candidates = files.filter(file => file.endsWith(ext));
  assert.ok(candidates.length, `${ext} artifact exists`);
  for (const file of candidates) {
    const url = `${base}/${path.relative(root,file).split(path.sep).join('/')}`;
    const response = await fetch(url);
    assert.equal(response.status, 200, `${url} is served`);
    if (ext === '.wasm') assert.match(response.headers.get('content-type') || '', /application\/wasm/);
    await response.arrayBuffer();
  }
}
const page = await fetch(base);
assert.equal(page.status, 200, 'Static page returns HTTP 200');
assert.equal(page.headers.get(process.env.M1_SOURCE_HEADER || 'x-m1-source'), process.env.M1_SOURCE_VALUE || 'static-file', 'HTML comes from the verified static provider');
assert.equal(await page.text(), html, 'HTTP HTML matches the inspected SSG file');
for (const [, reference] of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
  if (reference.startsWith('#') || reference.startsWith('data:')) continue;
  const url = new URL(reference.replaceAll('&amp;', '&'), `${base}/`);
  assert.equal(url.origin, new URL(base).origin, 'M1 HTML uses local assets only');
  const response = await fetch(url);
  assert.equal(response.status, 200, `HTML reference resolves: ${reference}`);
  await response.arrayBuffer();
}
const missing = await fetch(`${base}/missing-m1-file.js`);
assert.equal(missing.status, 404, 'No SPA fallback for missing assets');
console.log('PASS: SSG HTML, hydration payload, JS/Wasm/CSS HTTP delivery, static source, asset 404');
console.log('Browser interaction is a separate required verification.');
