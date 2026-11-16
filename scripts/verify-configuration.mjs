import assert from 'node:assert/strict';
const base = process.env.M2_BASE_URL || 'http://127.0.0.1:18083';
const response = await fetch(`${base}/api/urls`, {method:'POST',
  headers:{'content-type':'application/json','x-request-client':'dioxus'},
  body:JSON.stringify({original_url:'https://example.com/m2-config-test'})});
assert.equal(response.status,503);
const outcome = await response.json();
assert.equal(outcome.code,503);
console.log('PASS: missing DB configuration gives HTTP503');
