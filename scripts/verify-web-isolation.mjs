import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
const root = 'target/dx/numeric-shortener/release/web/public';
const secrets = [];
for (const file of ['.env','.env.db','.env.migration']) {
  const env = await readFile(file,'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^(DATABASE_URL|MIGRATION_DATABASE_URL|POSTGRES_PASSWORD)=(.+)$/);
    if (!match) continue;
    secrets.push(Buffer.from(match[2]));
    if (match[1].endsWith('DATABASE_URL')) secrets.push(Buffer.from(new URL(match[2]).password));
  }
}
assert.ok(secrets.every(value=>value.length>=16),'scan needs actual dedicated local credentials');
let count = 0;
async function scan(directory) {
  for (const item of await readdir(directory,{withFileTypes:true})) {
    const file = path.join(directory,item.name);
    if (item.isDirectory()) { await scan(file); continue; }
    assert.ok(!item.name.startsWith('.env'),'private env files are not public assets');
    const data = await readFile(file);
    for (const secret of secrets) assert.ok(!data.includes(secret),'private credentials must not occur in public artifacts');
    count++;
  }
}
await scan(root);
const dependencies = await readFile('work/m2-web-dependencies.txt','utf8');
assert.doesNotMatch(dependencies,/^sqlx(?:-|\s)|^postgres\s|^tokio-postgres\s/m);
console.log(`PASS: ${count} public files contain no local DB credentials; Wasm dependency tree excludes SQLx/PostgreSQL driver`);
