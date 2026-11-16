import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../work/edge-build/worker.js';

test('root is served from the SSG asset with no backend request', async () => {
  const requested = [];
  const env = {ASSETS:{async fetch(request){requested.push(new URL(request.url).pathname); return new Response('<h1>SSG</h1>');}}};
  const response = await worker.fetch(new Request('http://worker.test/'),env);
  assert.equal(response.status,200);
  assert.equal(await response.text(),'<h1>SSG</h1>');
  assert.deepEqual(requested,['/index.html']);
});

const unitSecret='unit-test-only-proxy-secret-0123456789abcdef';
const allowedLimiter={idFromName:()=> 'global',get:()=>({fetch:async()=>new Response(null,{status:200})})};
const configured=()=>({ASSETS:{async fetch(){return new Response('missing',{status:404});}},
  CREATION_LIMITER:allowedLimiter,
  LOCAL_DEV:'true',UPSTREAM_ORIGIN:'http://127.0.0.1:18081',PROXY_SHARED_SECRET:unitSecret,CREATE_URLS_ENABLED:'true'});
test('limiter denial/failure/missing binding never reaches Railway and disabled creation never calls DO',async()=>{
 let upstream=0,checks=0;
 const request=()=>new Request('http://127.0.0.1/api/urls',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1'},body:'{}'});
 await mockedFetch(async()=>{upstream++;return new Response('unexpected');},async()=>{
  const binding=fn=>({idFromName(name){assert.equal(name,'creation-global-v1');return name;},get:()=>({fetch:async()=>{checks++;return fn();}})});
  for(const [limiter,status] of [[undefined,503],[binding(()=>{throw Error(unitSecret);}),503],[binding(()=>new Response(null,{status:503})),503],[binding(()=>new Response(null,{status:429,headers:{'retry-after':'17'}})),429]]) {
   const r=await worker.fetch(request(),{...configured(),CREATION_LIMITER:limiter});
   assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.ok(Number(r.headers.get('retry-after'))>0);assert.ok(!(await r.text()).includes(unitSecret));
  }
  checks=0;assert.equal((await worker.fetch(request(),{...configured(),CREATE_URLS_ENABLED:'false',CREATION_LIMITER:binding(()=>{throw Error();})})).status,403);assert.equal(checks,0);
 });assert.equal(upstream,0);
});
test('trusted CF IP only: forged forwarding headers ignored; missing IP and untrusted runtime rejected',async()=>{
 const keys=[];let upstream=0;
 const limiter={idFromName:()=> 'global',get:()=>({fetch:async r=>{keys.push((await r.json()).key);return new Response(null,{status:200});}})};
 await mockedFetch(async()=>{upstream++;return new Response('ok');},async()=>{
  const env={...configured(),LOCAL_DEV:'false',UPSTREAM_ORIGIN:'https://upstream.example',CREATION_LIMITER:limiter};
  for(const forged of ['198.51.100.1','203.0.113.2']) {
   const r=new Request('https://worker.example/api/urls',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1','x-forwarded-for':forged},body:'{}'});
   Object.defineProperty(r,'cf',{value:{colo:'TEST'}});assert.equal((await worker.fetch(r,env)).status,200);
  }
  assert.equal(keys[0],keys[1]);assert.match(keys[0],/^[a-f0-9]{64}$/);assert.equal(upstream,2);
  for(const headers of [{},{'x-forwarded-for':'192.0.2.1'},{'cf-connecting-ip':'192.0.2.1'}]) {
   const r=new Request('https://worker.example/api/urls',{method:'POST',headers,body:'{}'});
   assert.equal((await worker.fetch(r,env)).status,503);
  }
  assert.equal(keys.length,2);assert.equal(upstream,2);
 });
});
test('a stalled limiter returns 503 within a bounded deadline without forwarding',async()=>{
 let calls=0;
 await mockedFetch(async()=>{calls++;return new Response('unexpected');},async()=>{
  const response=await worker.fetch(new Request('http://127.0.0.1/api/urls',{method:'POST',body:'{}',headers:{'cf-connecting-ip':'192.0.2.1'}}),{
   ...configured(),CREATION_LIMITER:{idFromName:()=> 'global',get:()=>({fetch:()=>new Promise(()=>{})})},
  });assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'60');assert.equal(calls,0);
 });
});
async function mockedFetch(callback,run) {
  const before=globalThis.fetch; globalThis.fetch=callback;
  try {await run();} finally {globalThis.fetch=before;}
}

test('production and incomplete configurations cannot activate public creation',async()=>{
  let calls=0;
  await mockedFetch(async()=>{calls++;throw new Error('must not call upstream');},async()=>{
    for(const settings of [{CREATE_URLS_ENABLED:undefined,PROXY_SHARED_SECRET:undefined},
      {CREATE_URLS_ENABLED:'true',PROXY_SHARED_SECRET:undefined},
      {CREATE_URLS_ENABLED:'true',PROXY_SHARED_SECRET:'short'},
      {CREATE_URLS_ENABLED:'false'}]) {
      const result=await worker.fetch(new Request('http://worker.test/api/urls',{method:'POST',body:'{}',
        headers:{'x-shortener-proxy-secret':unitSecret,'create-urls-enabled':'true'}}),{...configured(),...settings});
      assert.equal(result.status,403);
    }
  });
  assert.equal(calls,0);
});

test('numeric redirects keep the exact Location without following it or returning private headers',async()=>{
  const location='https://example.com/a%2Fb?q=a+b&encoded=%23#section';
  let calls=0;
  await mockedFetch(async(input,init)=>{
    calls++;
    assert.equal(new URL(input).pathname,'/123');
    assert.equal(new URL(input).search,'?url=https%3A%2F%2Fattacker.example');
    assert.equal(init.redirect,'manual');
    assert.equal(new Headers(init.headers).get('x-shortener-proxy-secret'),null);
    return new Response(null,{status:302,headers:{location,'cache-control':'no-store',
      'connection':'x-hop','x-hop':'remove','set-cookie':'remove','x-shortener-proxy-secret':unitSecret}});
  },async()=>{
    const response=await worker.fetch(new Request('http://worker.test/123?url=https%3A%2F%2Fattacker.example',
      {headers:{accept:'text/html','x-shortener-proxy-secret':'forged'}}),configured());
    assert.equal(response.status,302);
    assert.equal(response.headers.get('location'),location);
    for(const header of ['connection','x-hop','set-cookie','x-shortener-proxy-secret']) assert.equal(response.headers.get(header),null);
  });
  assert.equal(calls,1);
});

test('numeric syntax stays in Rust and upstream error responses remain unchanged',async()=>{
  await mockedFetch(async(input)=>{
    const path=new URL(input).pathname;
    const status=path==='/missing'?404:path==='/offline'?503:path==='/method'?405:400;
    return new Response('upstream body',{status,headers:{'content-type':'text/plain','retry-after':'3','allow':'GET, HEAD'}});
  },async()=>{
    for(const [path,status] of [['/01',400],['/%31',400],['/+1',400],['/9223372036854775808',400],['/abc',400],['/missing',404],['/offline',503],['/method',405]]) {
      const response=await worker.fetch(new Request(`http://worker.test${path}`),configured());
      assert.equal(response.status,status);
      assert.equal(await response.text(),'upstream body');
      assert.equal(response.headers.get('retry-after'),'3');
    }
  });
});

test('unsupported numeric methods are 405 without invoking forbidden Fetch methods',async()=>{
  await mockedFetch(async()=>{throw new Error('must not forward');},async()=>{
    for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','TRACE','CONNECT']) {
      const response=await worker.fetch({url:'http://worker.test/123',method,headers:new Headers(),body:null},configured());
      assert.equal(response.status,405);
      assert.equal(response.headers.get('allow'),'GET, HEAD');
    }
    assert.equal((await worker.fetch(new Request('http://worker.test/api/unknown'),configured())).status,404);
    assert.equal((await worker.fetch(new Request('http://worker.test/123/extra'),configured())).status,404);
  });
});

test('request headers cannot override the trusted upstream and invalid configured origins fail closed',async()=>{
  await mockedFetch(async(input,init)=>{
    assert.equal(new URL(input).origin,'http://127.0.0.1:18081');
    assert.equal(new Headers(init.headers).get('x-request-client'),null,'Connection nominated headers are removed');
    return new Response('ok');
  },async()=>{
    const response=await worker.fetch(new Request('https://attacker.example/123?origin=https://attacker.example',{
      headers:{host:'attacker.example',connection:'x-request-client','x-request-client':'dioxus'}}),configured());
    assert.equal(response.status,200);
  });
  await mockedFetch(async()=>{throw new Error('must not call unsafe origin');},async()=>{
    for(const UPSTREAM_ORIGIN of ['http://user:pw@127.0.0.1/','http://127.0.0.1/prefix','http://127.0.0.1/?q=1','https://outside.example']) {
      assert.equal((await worker.fetch(new Request('http://worker.test/1'),{...configured(),UPSTREAM_ORIGIN})).status,503);
    }
    assert.equal((await worker.fetch(new Request('http://worker.test/1'),{...configured(),LOCAL_DEV:'false'})).status,503);
  });
});

test('oversized creation is rejected before any upstream request',async()=>{
  let calls=0;
  await mockedFetch(async()=>{calls++;return new Response('unexpected');},async()=>{
    const response=await worker.fetch(new Request('http://worker.test/api/urls',{method:'POST',body:'a'.repeat(65537)}),configured());
    assert.equal(response.status,413);
  });
  assert.equal(calls,0);
});

test('a failed POST is not retried and internal errors do not expose credentials',async()=>{
  let calls=0;
  await mockedFetch(async()=>{calls++;throw new Error(unitSecret);},async()=>{
    const response=await worker.fetch(new Request('http://127.0.0.1/api/urls',{method:'POST',body:'{}',headers:{'cf-connecting-ip':'192.0.2.1'}}),configured());
    assert.equal(response.status,502);
    assert.ok(!(await response.text()).includes(unitSecret));
  });
  assert.equal(calls,1);
});

test('upstream timeout has a clear 504 response without automatic retry',async()=>{
  let calls=0;
  await mockedFetch(async(_input,init)=>{
    calls++;
    return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true}));
  },async()=>{
    const response=await worker.fetch(new Request('http://worker.test/123'),{...configured(),UPSTREAM_TIMEOUT_MS:'50'});
    assert.equal(response.status,504);
  });
  assert.equal(calls,1);
});

test('HEAD and missing static assets keep their real HTTP semantics',async()=>{
  const env={...configured(),ASSETS:{async fetch(request){
    assert.equal(request.headers.get('cookie'),null);
    assert.equal(request.headers.get('x-shortener-proxy-secret'),null);
    return new Response('asset',{status:new URL(request.url).pathname==='/index.html'?200:404});
  }}};
  const head=await worker.fetch(new Request('http://worker.test/',{method:'HEAD',headers:{cookie:'ignored','x-shortener-proxy-secret':'forged'}}),env);
  assert.equal(head.status,200);
  assert.equal(await head.text(),'');
  assert.equal((await worker.fetch(new Request('http://worker.test/assets/missing.js'),env)).status,404);
});

test('health is public and does not receive the proxy secret',async()=>{
  await mockedFetch(async(_input,init)=>{
    assert.equal(new Headers(init.headers).get('x-shortener-proxy-secret'),null);
    return new Response('ok\n');
  },async()=>{
    const response=await worker.fetch(new Request('http://worker.test/healthz'),{...configured(),CREATE_URLS_ENABLED:'false',PROXY_SHARED_SECRET:undefined});
    assert.equal(response.status,200);
    assert.equal(await response.text(),'ok\n');
  });
});

test('creation preserves the POST contract while replacing untrusted credentials and identity headers', async () => {
  const originalFetch=globalThis.fetch;
  const secret='unit-test-only-proxy-secret-0123456789abcdef';
  const body=JSON.stringify({original_url:'https://example.com/test?q=a+b#x'});
  let calls=0;
  globalThis.fetch=async(input,init)=>{
    calls++;
    const outgoing=new Request(input,init);
    assert.equal(outgoing.url,'http://127.0.0.1:18081/api/urls?keep=1');
    assert.equal(outgoing.method,'POST');
    assert.equal(await outgoing.text(),body);
    assert.equal(outgoing.headers.get('x-shortener-proxy-secret'),secret);
    assert.equal(outgoing.headers.get('x-request-client'),'dioxus');
    for(const name of ['cookie','authorization','forwarded','x-forwarded-host','x-real-ip','connection']) assert.equal(outgoing.headers.get(name),null);
    assert.equal(init.redirect,'manual');
    return new Response('{"status":"created","id":"123"}',{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const response=await worker.fetch(new Request('http://127.0.0.1/api/urls?keep=1',{
      method:'POST',headers:{'content-type':'application/json','x-request-client':'dioxus',
        'x-shortener-proxy-secret':'forged','cookie':'ignored','authorization':'ignored',
        'forwarded':'for=untrusted','x-forwarded-host':'attacker.example','x-real-ip':'10.0.0.1','cf-connecting-ip':'192.0.2.1'},body}),{
      CREATION_LIMITER:allowedLimiter,
      ASSETS:{async fetch(){throw new Error('not an asset');}},LOCAL_DEV:'true',
      UPSTREAM_ORIGIN:'http://127.0.0.1:18081',PROXY_SHARED_SECRET:secret,CREATE_URLS_ENABLED:'true',
    });
    assert.equal(response.status,200);
    assert.equal(await response.text(),'{"status":"created","id":"123"}');
    assert.equal(calls,1);
  } finally {globalThis.fetch=originalFetch;}
});
