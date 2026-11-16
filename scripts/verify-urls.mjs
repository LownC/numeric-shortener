import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {mappings} from './db-test-helpers.mjs';
const base = process.env.M2_BASE_URL || 'http://127.0.0.1:18080';
const run = randomUUID();
async function create(original_url, expectedStatus = 200) {
  // Exactly one POST per test case; never retry a failed/uncertain create.
  const response = await fetch(`${base}/api/urls`, {method:'POST',
    headers:{'content-type':'application/json','x-request-client':'dioxus',...(process.env.TEST_PROXY_SECRET?{'x-shortener-proxy-secret':process.env.TEST_PROXY_SECRET}:{})},
    body:JSON.stringify({original_url})});
  assert.equal(response.status, expectedStatus, 'actual API HTTP status');
  return response.json();
}
const created = [];
for (const original of [`http://example.com/${run}?a=1#one`, `https://example.com/${run}?a=1#two`,
  `https://example.com/${run}?a=1#two`, `https://www.example.com/${run}?different=yes`]) {
  const result = await create(original);
  assert.equal(result.status,'created');
  assert.equal(typeof result.id,'string');
  assert.match(result.id,/^[1-9]\d*$/);
  assert.equal(result.short_url,`${base}/${result.id}`);
  created.push({id:result.id,original_url:original});
}
assert.equal(new Set(created.map(item=>item.id)).size,4,'duplicate and distinct URLs receive distinct IDs');
const before = mappings();
const invalid = ['', 'bad URL', '/relative', 'ftp://example.com/file', 'https://user:pw@example.com/',
  'https://@example.com/', 'http://localhost/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/',
  'http://0x7f000001/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.1/',
  'http://172.16.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/',
  'https://example.com/\r\nInjected:yes', 'https://example.com/%0d%0a',
  `https://example.com/${'a'.repeat(8192)}`, `https://example.com/${'한'.repeat(2800)}`];
for (const original of invalid) assert.equal((await create(original,400)).code,400);
assert.deepEqual(mappings(), before, 'all validation failures leave DB unchanged');
const originals = Array.from({length:32},(_,i)=>`https://example.com/${run}/parallel/${i%24}?q=a+b&encoded=%23#part`);
const concurrent = await Promise.all(originals.map(async original_url=>{
  const result = await create(original_url);
  assert.equal(result.status,'created');
  assert.equal(typeof result.id,'string');
  return {id:result.id,original_url};
}));
assert.equal(new Set(concurrent.map(item=>item.id)).size,32,'32 concurrent successful IDs unique');
const after = mappings();
for (const item of [...created,...concurrent]) {
  assert.deepEqual(after.find(row=>row.id===item.id),item,'committed ID maps to correct original');
}
for (const old of before) assert.deepEqual(after.find(row=>row.id===old.id),old,'existing mappings unchanged');
assert.equal(after.length,before.length+32);
await mkdir('work',{recursive:true});
await writeFile('work/m2-http-results.json',JSON.stringify({base,created:[...created,...concurrent]},null,2));
console.log(`PASS: HTTP/HTTPS, duplicates, string IDs, 21 invalid inputs/no writes, 32 concurrent unique mappings via ${base}`);
