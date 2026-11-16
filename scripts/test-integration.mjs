// Disposable LOCAL PostgreSQL + real native Dioxus server. Never targets an existing DB.
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const suffix=randomBytes(5).toString('hex');
const name=`numeric-shortener-final-${suffix}`,volume=`numeric-shortener-final-data-${suffix}`;
const adminPassword=randomBytes(32).toString('hex'),appPassword=randomBytes(32).toString('hex'),proxySecret=randomBytes(32).toString('hex');
const inherited={...process.env};for(const key of Object.keys(inherited))if(/TOKEN|SECRET|PASSWORD|DATABASE_URL/i.test(key))delete inherited[key];
const dockerEnv={...inherited,POSTGRES_PASSWORD:adminPassword};
let containerId,volumeCreated=false,server,appEnv;
const base='http://127.0.0.1:19886';
function docker(args,input,optional=false){
 const result=spawnSync('docker',args,{env:dockerEnv,input,encoding:'utf8',windowsHide:true});
 if(!optional&&result.status!==0){const detail=(result.stderr||'').replaceAll(appPassword,'[fixture-secret]').replaceAll(adminPassword,'[fixture-secret]').replaceAll(proxySecret,'[fixture-secret]');throw Error(`Local Docker fixture ${args[0]} failed (exit ${result.status}): ${detail}`);}
 return result.status===0?result.stdout.trim():null;
}
function test(command,args){
 const result=spawnSync(command,args,{env:appEnv,encoding:'utf8',windowsHide:true});
 const output=(result.stdout||'')+(result.stderr||'');
 console.log(output.replaceAll(appPassword,'[fixture-secret]').replaceAll(adminPassword,'[fixture-secret]').replaceAll(proxySecret,'[fixture-secret]'));
 assert.equal(result.status,0,`${command} ${args.join(' ')} succeeds`);
}
async function readyDatabase(){for(let i=0;i<40;i++){if(docker(['exec',containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d','numeric_shortener'],undefined,true)!==null)return;await new Promise(r=>setTimeout(r,500));}throw Error('Local fixture DB readiness timeout');}
async function startServer(){
 const executable=process.platform==='win32'?'server.exe':'server';
 server=spawn(path.resolve(`target/dx/numeric-shortener/release/web/${executable}`),[],{env:appEnv,stdio:'ignore',windowsHide:true});
 await readyServer();
}
async function readyServer(){for(let i=0;i<40;i++){try{if((await fetch(base+'/healthz',{signal:AbortSignal.timeout(1500)})).status===200)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Local native server readiness timeout');}
async function stopServer(){if(!server)return;const owned=server;server=null;if(owned.exitCode!==null)return;const ended=new Promise(r=>owned.once('exit',r));owned.kill();await ended;}
const existing=docker(['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.State.Status}}','numeric-shortener-m2-postgres'],undefined,true);
try{
 docker(['volume','create','--label','numeric-shortener-fixture=final',volume]);volumeCreated=true;
 containerId=docker(['run','--detach','--name',name,'--label','numeric-shortener-fixture=final','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=numeric_shortener','--publish','127.0.0.1::5432','--mount',`type=volume,source=${volume},target=/var/lib/postgresql/data`,'postgres:17.11-bookworm']);
 assert.match(containerId,/^[a-f0-9]{64}$/);await readyDatabase();
 const binding=docker(['port',containerId,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);const port=binding.split(':')[1];
 const migration=await readFile('migrations/0001_urls.sql','utf8');
 const bootstrap=`CREATE ROLE shortener_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE shortener_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER DATABASE numeric_shortener OWNER TO shortener_migrator;
REVOKE ALL ON DATABASE numeric_shortener FROM PUBLIC;
GRANT CONNECT ON DATABASE numeric_shortener TO shortener_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO shortener_migrator;
SET ROLE shortener_migrator;
${migration}`;
 docker(['exec','-i',containerId,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','numeric_shortener'],bootstrap);
 appEnv={...inherited,DATABASE_URL:`postgres://shortener_app:${appPassword}@127.0.0.1:${port}/numeric_shortener`,PUBLIC_BASE_URL:base,IP:'127.0.0.1',PORT:'19886',APP_ENV:'production',CREATE_URLS_ENABLED:'true',PROXY_SHARED_SECRET:proxySecret,TEST_PROXY_SECRET:proxySecret,TEST_DB_CONTAINER:name,M2_BASE_URL:base,M3_BASE_URL:base};
 test('cargo',['test','--locked','--offline','--no-default-features','--features','server']);
 await startServer();
 for(const script of ['verify-urls.mjs','verify-permissions.mjs','verify-redirect.mjs','verify-redirect-methods.mjs'])test(process.execPath,[`scripts/${script}`]);
 await stopServer();await startServer();test(process.execPath,['scripts/verify-persistence.mjs']);
 docker(['stop','--time','10',containerId]);test(process.execPath,['scripts/verify-redirect-outage.mjs']);
 docker(['start',containerId]);await readyDatabase();
 const rebound=docker(['port',containerId,'5432/tcp']);
 if(rebound!==binding){assert.match(rebound,/^127\.0\.0\.1:\d+$/);const db=new URL(appEnv.DATABASE_URL);db.port=rebound.split(':')[1];appEnv.DATABASE_URL=db.toString();await stopServer();await startServer();console.log('Fixture dynamic host port changed after Docker start; owned native server reconnected.');}else{await readyServer();}
 test(process.execPath,['scripts/verify-redirect-outage.mjs','--recovered']);
 await mkdir('work',{recursive:true});await writeFile('work/final-local-integration.json',JSON.stringify({passed:true,postgresImage:'postgres:17.11-bookworm',isolated:true,existingDatabaseUnchanged:true,serverRestart:true,databaseStopStartRecovery:true,productionAccess:false},null,2));
 console.log('PASS FINAL INTEGRATION: real PostgreSQL, permissions, invalid400, duplicate/concurrency,302/404/405/503, server and DB restart persistence.');
}finally{
 await stopServer();
 if(containerId){const label=docker(['inspect','--format','{{index .Config.Labels "numeric-shortener-fixture"}}',containerId],undefined,true);if(label==='final'){docker(['stop','--time','10',containerId],undefined,true);docker(['rm',containerId]);}}
 if(volumeCreated){const label=docker(['volume','inspect','--format','{{index .Labels "numeric-shortener-fixture"}}',volume],undefined,true);if(label==='final')docker(['volume','rm',volume]);}
 assert.equal(docker(['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.State.Status}}','numeric-shortener-m2-postgres'],undefined,true),existing,'Existing local DB never started or recreated');
}
