import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CreationLimiter } from '../work/edge-build/creation-limiter.js';

// Real SQLite, simulated DO storage/clock. Wrangler runtime is tested separately.
function fixture() {
  const db=new DatabaseSync(':memory:'); let now=120000, fail=false, failIpWrite=false;
  const storage={sql:{exec(query,...args){if(fail || (failIpWrite && query.startsWith('INSERT') && args[0]!=='global'))throw Error('storage failure');const stmt=db.prepare(query);return stmt.columns().length?stmt.all(...args):(stmt.run(...args),[]);}},
    transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const state={storage};
  let limiter=new CreationLimiter(state,{},()=>now);
  return {db,call:async(key)=>limiter.fetch(new Request('https://limiter/consume',{method:'POST',body:JSON.stringify({key:key.repeat(64)})})),
    time:v=>{now=v;},restart:()=>{limiter=new CreationLimiter(state,{},()=>now);},fail:()=>{fail=true;},failWrite:()=>{failIpWrite=true;}};
}
test('IP allows five, rejects sixth without consuming global allowance',async()=>{
 const f=fixture();try{for(let i=0;i<5;i++)assert.equal((await f.call('a')).status,200);assert.equal((await f.call('a')).status,429);
 for(const key of ['b','c','d'])for(let i=0;i<5;i++)assert.equal((await f.call(key)).status,200);
 assert.equal((await f.call('e')).status,429);
 }finally{f.db.close();}
});
test('boundary, lazy expiration, restart, and storage fault fail closed',async()=>{
 const f=fixture();try{
  f.time(179999);for(let i=0;i<5;i++)assert.equal((await f.call('a')).status,200);
  f.restart();let denied=await f.call('a');assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'1');
  f.time(180000);assert.equal((await f.call('b')).status,200);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM counters').get().n,2);
  assert.equal((await f.call('a')).status,200);
  f.fail();const broken=await f.call('a');assert.equal(broken.status,503);assert.equal(broken.headers.get('cache-control'),'no-store');
 }finally{f.db.close();}
});
test('30 concurrent calls admit at most 20; global rejection does not consume IP allowance',async()=>{
 const f=fixture();try{
  const results=await Promise.all(Array.from({length:30},(_,i)=>f.call('abcdef'[i%6])));
  assert.equal(results.filter(r=>r.status===200).length,20);
  assert.equal(results.filter(r=>r.status===429).length,10);
  assert.equal(f.db.prepare("SELECT count FROM counters WHERE key='global'").get().count,20);
  assert.equal(f.db.prepare("SELECT sum(count) AS n FROM counters WHERE key <> 'global'").get().n,20);
 }finally{f.db.close();}
});
test('second counter write failure rolls back the first counter',async()=>{
 const f=fixture();try{assert.equal((await f.call('a')).status,200);f.failWrite();assert.equal((await f.call('b')).status,503);
 assert.equal(f.db.prepare("SELECT count FROM counters WHERE key='global'").get().count,1);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM counters').get().n,2);
 }finally{f.db.close();}
});
