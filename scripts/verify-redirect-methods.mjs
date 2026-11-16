import assert from 'node:assert/strict';
import http from 'node:http';
const base=process.env.M3_BASE_URL || 'http://127.0.0.1:18083';
const platform=process.env.M3_METHOD_PLATFORM || 'application';
assert.ok(['application','workers'].includes(platform),'explicit method-contract target');
for (const method of ['TRACE','CONNECT']) {
  const result=await new Promise((resolve,reject)=>{
    const request=http.request(new URL('/1',base),{method,timeout:5000},response=>{
      response.resume();
      response.on('end',()=>resolve({status:response.statusCode,allow:response.headers.allow}));
    });
    request.on('connect',(response,socket)=>{
      resolve({status:response.statusCode,allow:response.headers.allow}); socket.destroy();
    });
    request.on('timeout',()=>request.destroy(new Error('M3 method verification timed out')));
    request.on('error',reject); request.end();
  });
  if(method==='CONNECT' && platform==='workers'){
    assert.equal(result.status,500,'pinned local workerd pre-fetch rejection; other responses require diagnosis');
    console.log(`BLOCKED_BY_PLATFORM: Workers does not support CONNECT; local runtime returned ${result.status}; see verify-m4a-connect.mjs for pre-fetch dispatch evidence`);
    continue;
  }
  assert.equal(result.status,405,`${method} numeric path must be 405`);
  assert.equal(result.allow,'GET, HEAD');
  console.log(`PASS: raw HTTP ${method} returns405 via ${base}`);
}
