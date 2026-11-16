import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
for(const key of Object.keys(process.env))if(key.startsWith('CLOUDFLARE_')||key.startsWith('RAILWAY_'))delete process.env[key];
process.env.WRANGLER_SEND_METRICS='false';process.env.WRANGLER_WRITE_LOGS='false';
const {unstable_dev}=await import('wrangler');
const root=process.cwd(), work=path.join(root,'work','m5a2-'+Date.now());await mkdir(work,{recursive:true});
let forwarded=0,dev;
const upstream=createServer((_req,res)=>{forwarded++;res.writeHead(200,{'content-type':'application/json'});res.end('{"status":"created","id":"fixture"}');});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
config.main=path.join(root,'edge/worker.ts');config.assets.directory=path.join(root,'dist/assets');
config.vars={LOCAL_DEV:'true',CREATE_URLS_ENABLED:'true',PROXY_SHARED_SECRET:'public-local-m5a2-fixture-only-0123456789',UPSTREAM_ORIGIN:`http://127.0.0.1:${upstream.address().port}`};
const configFile=path.join(work,'wrangler.json');await writeFile(configFile,JSON.stringify(config));
const start=async store=>unstable_dev(config.main,{config:configFile,local:true,ip:'127.0.0.1',port:18898,inspectorPort:18998,persist:true,persistTo:path.join(work,store),logLevel:'error',experimental:{forceLocal:true,watch:false,disableDevRegistry:true,disableExperimentalWarning:true}});
const create=async ip=>{const r=await fetch('http://127.0.0.1:18898/api/urls',{method:'POST',headers:{'cf-connecting-ip':ip,'content-type':'application/json'},body:'{"original_url":"https://example.com/fixture"}'});await r.text();return {status:r.status,retry:r.headers.get('retry-after'),cache:r.headers.get('cache-control')};};
try {
 console.log('Starting isolated local Wrangler SQLite fixture.');
 dev=await start('persistent');
 console.log('Local Worker ready.');
 // Keep restart assertions within a single fixed window; no production clock hook.
 if(Date.now()%60000>25000)await new Promise(r=>setTimeout(r,60050-Date.now()%60000));
 for(let i=0;i<5;i++)assert.equal((await create('192.0.2.1')).status,200);
 let denied=await create('192.0.2.1');assert.equal(denied.status,429);assert.equal(denied.cache,'no-store');assert.ok(Number(denied.retry)>0);assert.equal(forwarded,5);
 await dev.stop();dev=undefined;dev=await start('persistent');
 assert.equal((await create('192.0.2.1')).status,429);assert.equal(forwarded,5);
 console.log('PASS REAL WRANGLER: SQLite per-IP 5/6, 429 headers, restart persistence, denied upstream=0');
 await dev.stop();dev=undefined;dev=await start('concurrency');
 const before=forwarded;
 const results=await Promise.all(Array.from({length:30},(_,i)=>create('198.51.100.'+(i+1))));
 assert.equal(results.filter(r=>r.status===200).length,20);assert.equal(results.filter(r=>r.status===429).length,10);assert.equal(forwarded-before,20);
 console.log('PASS REAL WRANGLER: 30 concurrent distinct IPs => 20 allowed / 10 rejected; rejected requests never forwarded');
 const forbidden=await fetch('http://127.0.0.1:18898/consume',{method:'POST',body:'{}'});assert.equal(forbidden.status,405);
 console.log('PASS REAL WRANGLER: no public DO consume route; upstream fixture only, no Rust/DB/remote services');
}finally{if(dev)await dev.stop();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));}
