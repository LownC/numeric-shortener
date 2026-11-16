import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {mappings, sql} from './db-test-helpers.mjs';
const base = process.env.M3_BASE_URL || 'http://127.0.0.1:18081';
const observations = [];
const cases = [
  ['https://example.com/m3/a%2Fb?q=a+b&x=%23#section', 'https://example.com/m3/a%2Fb?q=a+b&x=%23#section'],
  ['http://example.com/m3/http?x=%2F&q=a+b#part', 'http://example.com/m3/http?x=%2F&q=a+b#part'],
  ['HTTP://EXAMPLE.COM:80/a/../b?q=a+b#x', 'http://example.com/b?q=a+b#x'],
  ['https://bücher.example/한글?q=%2F#x', 'https://xn--bcher-kva.example/%ED%95%9C%EA%B8%80?q=%2F#x'],
];
const created = [];
for (const [original, expected] of cases) {
  const response = await fetch(`${base}/api/urls`,{method:'POST',
    headers:{'content-type':'application/json','x-request-client':'dioxus',...(process.env.TEST_PROXY_SECRET?{'x-shortener-proxy-secret':process.env.TEST_PROXY_SECRET}:{})},
    body:JSON.stringify({original_url:original})});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.status,'created');
  assert.equal(typeof result.id,'string');
  created.push({id:result.id,original_url:expected});
}
// New M3-only fixtures check corrupt stored data. No existing row is changed/deleted.
const corrupt = [
  sql("INSERT INTO public.urls(original_url) VALUES ('javascript:alert(1)') RETURNING id").split('\n')[0].trim(),
  sql("INSERT INTO public.urls(original_url) VALUES (E'https://example.com/\\r\\nX-M3: injected') RETURNING id").split('\n')[0].trim(),
];
const beforeReads = mappings();
const missing = '9223372036854775807';
assert.ok(!beforeReads.some(row=>row.id===missing),'upper BIGINT bound fixture must be absent');
async function check(path,status,method='GET',location=null) {
  const response = await fetch(`${base}${path}`,{method,redirect:'manual'});
  assert.equal(response.status,status,`${method} ${path}`);
  assert.equal(response.headers.get('location'),location,`${method} ${path} Location`);
  if (status===405) assert.equal(response.headers.get('allow'),'GET, HEAD');
  if (status===503) assert.equal(response.headers.get('retry-after'),'3');
  if ([302,400,405,503].includes(status) || path===`/${missing}`) {
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const body=await response.text();
  if (method==='HEAD' || status===302) assert.equal(body,'');
  if (path==='/' && method==='GET') {
    assert.equal((body.match(/<h1\b/g)||[]).length,1,'root has a single app');
    assert.equal((body.match(/initial_dioxus_hydration_data/g)||[]).length,1,'root has one hydration payload');
  }
  observations.push({method,path,status,location});
}
for (const row of created) {
  await check(`/${row.id}`,302,'GET',row.original_url);
  await check(`/${row.id}`,302,'HEAD',row.original_url);
  await check(`/${row.id}?q=must-not-replace&extra=1`,302,'GET',row.original_url);
}
await check(`/${missing}`,404);
await check(`/${missing}`,404,'HEAD');
for (const input of ['0','-1','+1','01','0001','1.0','1e2','NaN','abc','%20','1%20','%31','%2B1',
  '%EF%BC%91','9223372036854775808','999999999999999999999999999999']) {
  await check(`/${input}`,400);
  await check(`/${input}`,400,'HEAD');
}
for (const method of ['POST','PUT','PATCH','DELETE','OPTIONS']) {
  await check(`/${created[0].id}`,405,method);
}
for (const id of corrupt) await check(`/${id}`,503);
await check(`/${created[0].id}/`,404);
await check(`/${created[0].id}/extra`,404);
await check('/api/not-a-server-function',404);
await check('/assets/missing-m3-file.js',404);
await check('/',200);
assert.deepEqual(mappings(),beforeReads,'GET/HEAD/errors must not change any DB mapping');
await mkdir('work',{recursive:true});
await writeFile(`work/m3-http-${new URL(base).port}.json`,JSON.stringify({base,created,corrupt,missing,observations},null,2));
console.log(`PASS: ${observations.length} HTTP checks via ${base}: 302/404/400/503/405, exact Location, HEAD, query isolation, routing and read-only DB`);
