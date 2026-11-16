export { CreationLimiter } from './creation-limiter.js';
export interface Env {
  CREATION_LIMITER?: {idFromName(name: string): unknown; get(id: unknown): {fetch(request: Request): Promise<Response>}};
  ASSETS: { fetch(request: Request): Promise<Response> };
  UPSTREAM_ORIGIN?: string;
  PROXY_SHARED_SECRET?: string;
  CREATE_URLS_ENABLED?: string;
  LOCAL_DEV?: string;
  UPSTREAM_TIMEOUT_MS?: string;
}

const SECRET_HEADER = 'x-shortener-proxy-secret';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const HOP_HEADERS = ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];
class BodyLimit extends Error {}

function error(status: number, message: string, allow?: string): Response {
  const headers = new Headers({'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  if (allow) headers.set('allow',allow);
  return new Response(message,{status,headers});
}

function secretValid(secret: string | undefined): secret is string {
  return !!secret && secret.length >= 32 && secret.length <= 256 && /^[\x21-\x7e]+$/.test(secret);
}

async function checkCreationLimit(request: Request, env: Env): Promise<Response | null> {
  const unavailable=()=>new Response('요청 제한 서비스를 사용할 수 없습니다.',{status:503,headers:{'retry-after':'60','cache-control':'no-store','x-content-type-options':'nosniff'}});
  try {
    const url=new URL(request.url);
    const local=env.LOCAL_DEV==='true' && url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    const trusted=env.LOCAL_DEV!=='true' && !!(request as Request & {cf?: unknown}).cf;
    const ip=request.headers.get('CF-Connecting-IP');
    if((!local && !trusted) || !ip || ip.length>45 || !env.CREATION_LIMITER)return unavailable();
    // Canonicalize IPv6; reject lists, ports, whitespace and non-IP host names.
    let canonical: string;
    if(ip.includes(':')) {
      if(!/^[0-9a-f:]+$/i.test(ip))return unavailable();
      canonical=new URL('http://['+ip+']/').hostname;
    } else {
      const parts=ip.split('.');
      if(parts.length!==4 || parts.some(p=>!/^\d{1,3}$/.test(p) || Number(p)>255))return unavailable();
      canonical=parts.map(Number).join('.');
    }
    // Store no raw IP. Only the DO clock determines the window, avoiding edge clock skew.
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
    const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const binding=env.CREATION_LIMITER;
    const controller=new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response;
    try {
      response=await Promise.race([
        binding.get(binding.idFromName('creation-global-v1')).fetch(new Request('https://limiter/consume',{method:'POST',body:JSON.stringify({key}),signal:controller.signal})),
        new Promise<Response>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('limiter timeout'));},2000);}),
      ]);
    } finally {clearTimeout(timer);}
    if(response.status===200)return null;
    if(response.status!==429)return unavailable();
    const retry=response.headers.get('retry-after');
    if(!retry || !/^\d+$/.test(retry) || Number(retry)<1 || Number(retry)>60)return unavailable();
    return new Response('잠시 후 다시 시도해 주세요.',{status:429,headers:{'retry-after':retry,'cache-control':'no-store','x-content-type-options':'nosniff'}});
  } catch {return unavailable();}
}

function hopNames(headers: Headers): Set<string> {
  return new Set([...HOP_HEADERS,...(headers.get('connection') || '').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean)]);
}

function upstreamOrigin(env: Env): URL | null {
  try {
    const origin = new URL(env.UPSTREAM_ORIGIN || '');
    if (!['http:','https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) return null;
    const loopback = ['127.0.0.1','localhost','[::1]'].includes(origin.hostname);
    if (env.LOCAL_DEV === 'true') return loopback ? origin : null;
    return origin.protocol === 'https:' && !loopback ? origin : null;
  } catch { return null; }
}

async function limitedBytes(body: ReadableStream<Uint8Array> | null, limit: number): Promise<ArrayBuffer | undefined> {
  if (!body) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new BodyLimit(); }
    chunks.push(part.value);
  }
  const data = new Uint8Array(size);
  let offset=0;
  for (const chunk of chunks) { data.set(chunk,offset); offset+=chunk.byteLength; }
  return data.buffer;
}

async function asset(request: Request, env: Env, root: boolean): Promise<Response> {
  const url = new URL(request.url);
  if (root) url.pathname='/index.html';
  const headers = new Headers();
  for (const name of ['accept','if-none-match','if-modified-since','range']) {
    const value=request.headers.get(name); if (value) headers.set(name,value);
  }
  const response = await env.ASSETS.fetch(new Request(url,{method:request.method,headers}));
  const outgoing=new Headers(response.headers);
  outgoing.set('x-shortener-source','assets');
  return new Response(request.method==='HEAD' ? null : response.body,{status:response.status,statusText:response.statusText,headers:outgoing});
}

async function proxy(request: Request, env: Env, creation: boolean): Promise<Response> {
  if (creation && (env.CREATE_URLS_ENABLED !== 'true' || !secretValid(env.PROXY_SHARED_SECRET))) {
    return error(403,'주소 생성이 현재 허용되지 않았습니다.');
  }
  const origin=upstreamOrigin(env);
  if (!origin) return error(503,'서비스 연결 설정이 준비되지 않았습니다.');
  const source=new URL(request.url);
  origin.pathname=source.pathname;
  origin.search=source.search;
  const headers=new Headers();
  const hop=hopNames(request.headers);
  for (const name of ['content-type','accept','x-request-client']) {
    const value=request.headers.get(name);
    if (value && !hop.has(name)) headers.set(name,value);
  }
  // External copies of this header never enter the allowlist.
  if (creation) headers.set(SECRET_HEADER,env.PROXY_SHARED_SECRET!);
  const length=request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length)>MAX_REQUEST_BYTES)) return error(413,'요청이 너무 큽니다.');
  let body: ArrayBuffer | undefined;
  try { body=await limitedBytes(request.body,MAX_REQUEST_BYTES); }
  catch (failure) { return failure instanceof BodyLimit ? error(413,'요청이 너무 큽니다.') : error(400,'요청 본문을 읽을 수 없습니다.'); }
  if(creation) { const denied=await checkCreationLimit(request,env); if(denied)return denied; }
  const configured=Number(env.UPSTREAM_TIMEOUT_MS || 5000);
  const timeout=Number.isFinite(configured) ? Math.max(50,Math.min(10000,configured)) : 5000;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    // One attempt only. The proxy must return 302 rather than following it.
    const response=await fetch(origin,{method:request.method,headers,body,redirect:'manual',signal:controller.signal});
    const bytes=await limitedBytes(response.body,MAX_RESPONSE_BYTES);
    if (controller.signal.aborted) return error(504,'서버 응답 시간이 초과됐습니다.');
    const outgoing=new Headers(response.headers);
    for (const name of hopNames(response.headers)) outgoing.delete(name);
    // Fetch exposes the decoded entity; do not reuse wire framing/encoding.
    for (const name of ['content-length','content-encoding','set-cookie',SECRET_HEADER]) outgoing.delete(name);
    const noBody=request.method==='HEAD' || [204,205,304].includes(response.status);
    return new Response(noBody ? null : bytes,{status:response.status,statusText:response.statusText,headers:outgoing});
  } catch {
    return controller.signal.aborted ? error(504,'서버 응답 시간이 초과됐습니다.') : error(502,'서버에 연결할 수 없습니다.');
  } finally { clearTimeout(timer); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path=new URL(request.url).pathname;
    const read=request.method==='GET' || request.method==='HEAD';
    if (path==='/api/urls' || path==='/api/probe') {
      if (request.method!=='POST') return error(405,'지원하지 않는 메서드입니다.','POST');
      return proxy(request,env,path==='/api/urls');
    }
    if (path==='/healthz') {
      if (!read) return error(405,'지원하지 않는 메서드입니다.','GET, HEAD');
      return proxy(request,env,false);
    }
    const isAsset=path==='/' || path.startsWith('/assets/') || path.startsWith('/wasm/')
      || /^\/[^/]+\.(?:html|js|wasm|css|json|svg|png|ico|map|txt|webp)$/i.test(path);
    if (isAsset) {
      if (!read) return error(405,'지원하지 않는 메서드입니다.','GET, HEAD');
      return asset(request,env,path==='/');
    }
    if (path==='/api' || path==='/assets' || path.startsWith('/api/') || !/^\/[^/]+$/.test(path)) {
      return error(404,'요청한 주소를 찾을 수 없습니다.');
    }
    // Classification only: all numeric syntax/range rules belong to Rust.
    if (!read) return error(405,'지원하지 않는 메서드입니다.','GET, HEAD');
    return proxy(request,env,false);
  },
};
