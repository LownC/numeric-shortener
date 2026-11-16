import assert from 'node:assert/strict';
const base = process.env.M1_BASE_URL || 'http://127.0.0.1:18080';
const response = await fetch(`${base}/api/probe`, {
  method: 'POST',
  headers: {'content-type': 'application/json', 'x-request-client': 'dioxus'},
  body: JSON.stringify({input: 'M1 한글 & + # 확인'}),
});
assert.equal(response.status, 200, 'probe returns HTTP 200');
assert.match(response.headers.get('content-type') || '', /json/);
const result = await response.json();
assert.equal(result.message, 'Rust 서버에서 응답했습니다.');
assert.equal(result.echo, 'M1 한글 & + # 확인');
console.log(`PASS: POST /api/probe round trip via ${base}`);
