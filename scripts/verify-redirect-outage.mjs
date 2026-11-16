import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base = process.env.M3_BASE_URL || 'http://127.0.0.1:18083';
const source = process.env.M3_FIXTURE_PORT || new URL(base).port;
const fixture = JSON.parse(await readFile(`work/m3-http-${source}.json`,'utf8'));
const row = fixture.created[0];
const recovered = process.argv.includes('--recovered');
async function check(path,status,method='GET',location=null) {
  const response = await fetch(`${base}${path}`,{method,redirect:'manual'});
  assert.equal(response.status,status,`${method} ${path}`);
  assert.equal(response.headers.get('location'),location);
  if (status===503) assert.equal(response.headers.get('retry-after'),'3');
  if (status===405) assert.equal(response.headers.get('allow'),'GET, HEAD');
  if (method==='HEAD') assert.equal(await response.text(),'');
}
if (recovered) {
  await check(`/${row.id}`,302,'GET',row.original_url);
  await check(`/${fixture.missing}`,404);
  console.log('PASS: DB recovery restores existing 302 and absent 404 without rewriting mappings');
} else {
  await check(`/${row.id}`,503);
  await check(`/${row.id}`,503,'HEAD');
  await check(`/${fixture.missing}`,503);
  await check('/bad-id',400);
  await check(`/${row.id}`,405,'POST');
  console.log('PASS: DB outage gives 503 (not 404), HEAD empty, invalid ID400 and method405 remain independent of DB');
}
