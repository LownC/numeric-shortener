// Real Dioxus HTTP boundary, isolated synthetic configuration, no PostgreSQL service used.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
const base='http://127.0.0.1:19884',secret='a'.repeat(64);
const env={};for(const name of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[name])env[name]=process.env[name];
Object.assign(env,{IP:'127.0.0.1',PORT:'19884',APP_ENV:'production',CREATE_URLS_ENABLED:'true',PROXY_SHARED_SECRET:secret,DATABASE_URL:'postgres://synthetic:synthetic@127.0.0.1:1/synthetic',PUBLIC_BASE_URL:'https://short.example'});
const exe=process.env.TEST_SERVER_EXE||'target/dx/numeric-shortener/release/web/server.exe';
const child=spawn(path.resolve(exe),[],{env,stdio:'ignore',windowsHide:true});let exited=false;child.once('exit',()=>{exited=true;});
try{
 let ready=false;for(let i=0;i<40&&!exited;i++){try{if((await fetch(base,{signal:AbortSignal.timeout(1000)})).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'Native test server starts');
 const cases=[['empty',''],['scheme','ftp://example.com/file'],['host','https://'],['internal','http://127.0.0.1/private'],['control','https://example.com/a\r\nInjected:yes'],['length',`https://example.com/${'a'.repeat(8192)}`]];
 for(const [name,original_url] of cases){const r=await fetch(base+'/api/urls',{method:'POST',headers:{'content-type':'application/json','x-shortener-proxy-secret':secret},body:JSON.stringify({original_url}),signal:AbortSignal.timeout(5000)});assert.equal(r.status,400,`${name}: actual API status`);const value=await r.json();assert.equal(value.code,400);assert(value.message);assert(!JSON.stringify(value).includes('synthetic'));assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');console.log(`PASS HTTP400: ${name}`);}
 const outage=await fetch(base+'/api/urls',{method:'POST',headers:{'content-type':'application/json','x-shortener-proxy-secret':secret},body:JSON.stringify({original_url:'https://example.com/database-outage'}),signal:AbortSignal.timeout(6000)});assert.equal(outage.status,503);assert.equal((await outage.json()).code,503);console.log('PASS HTTP503: unreachable synthetic database, no production/local DB touched');
}finally{child.kill();await new Promise(resolve=>{if(exited)resolve();else child.once('exit',resolve);});}
