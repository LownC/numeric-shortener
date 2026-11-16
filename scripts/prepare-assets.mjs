// Copies only the HTML and its matching CSS/JS/Wasm. No credentials are loaded.
import {readFile, mkdir, copyFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const source=path.resolve(process.env.SSG_SOURCE || 'target/dx/numeric-shortener/release/web/public');
const destination=path.resolve(process.env.ASSET_DESTINATION || 'dist/assets');
const html=await readFile(path.join(source,'index.html'),'utf8');
assert(html.includes('initial_dioxus_hydration_data'),'Build SSG HTML first');
const js=[...new Set([...html.matchAll(/assets\/(numeric-shortener-[\w.-]+\.js)/g)].map(m=>m[1]))];
const css=[...new Set([...html.matchAll(/assets\/([\w.-]+\.css)/g)].map(m=>m[1]))];
assert.equal(js.length,1);assert.equal(css.length,1);
const code=await readFile(path.join(source,'assets',js[0]),'utf8');
const wasm=[...new Set([...code.matchAll(/(numeric-shortener_bg-[\w.-]+\.wasm)/g)].map(m=>m[1]))];
assert.equal(wasm.length,1);
await mkdir(path.join(destination,'assets'),{recursive:true});
const expected=[...js,...css,...wasm];
for(const entry of await readdir(path.join(destination,'assets')))
  assert(expected.includes(entry),'Destination contains stale files; use a fresh directory');
await copyFile(path.join(source,'index.html'),path.join(destination,'index.html'));
for(const file of expected)await copyFile(path.join(source,'assets',file),path.join(destination,'assets',file));
console.log('Prepared matching SSG HTML, CSS, JS and Wasm; no external changes.');
