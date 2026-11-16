import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mappings} from './db-test-helpers.mjs';
const saved = JSON.parse(await readFile('work/m2-http-results.json','utf8'));
const current = mappings();
for (const item of saved.created) assert.deepEqual(current.find(row=>row.id===item.id),item);
console.log(`PASS: ${saved.created.length} mappings retained across server restart`);
