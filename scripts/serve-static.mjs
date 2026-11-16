import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
const root = path.resolve(options.root || 'target/dx/numeric-shortener/release/web/public');
const port = Number(options.port || 18082);
const upstream = options.upstream ? new URL(options.upstream) : null;
if (upstream && !['127.0.0.1', 'localhost'].includes(upstream.hostname)) {
  throw new Error('M1 proxy permits only a loopback backend');
}
const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript',
  '.wasm':'application/wasm', '.css':'text/css; charset=utf-8', '.json':'application/json',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    // API and short-link routes go to Rust before any static-file handling.
    // File-shaped paths remain static so missing JS/Wasm/CSS is a real 404.
    const isAsset = url.pathname === '/' || /^\/assets(?:\/|$)/.test(url.pathname)
      || /\.(?:html|js|wasm|css|json|svg|png|ico|map|txt|webp)$/i.test(url.pathname);
    // Fetch forbids TRACE/TRACK. Apply the numeric route's method contract
    // before Fetch can turn a known unsupported method into a proxy error.
    if (!isAsset && url.pathname !== '/api' && !url.pathname.startsWith('/api/')
        && /^\/[^/]+$/.test(url.pathname) && ['TRACE','TRACK'].includes(req.method)) {
      res.writeHead(405, {allow:'GET, HEAD', 'cache-control':'no-store'}); res.end(); return;
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || !isAsset) {
      if (!upstream) { res.writeHead(503); res.end('M1 backend is not connected'); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const name of ['content-type', 'accept', 'x-request-client']) {
        if (req.headers[name]) headers.set(name, req.headers[name]);
      }
      const target = new URL(upstream);
      target.pathname = url.pathname;
      target.search = url.search;
      console.log(`PROXY ${req.method} ${url.pathname}`);
      const response = await fetch(target, {method:req.method, headers, redirect:'manual',
        signal:AbortSignal.timeout(10000),
        body:['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)});
      const outgoing = {};
      for (const name of ['content-type','location','cache-control','retry-after','allow','x-content-type-options']) {
        if (response.headers.has(name)) outgoing[name] = response.headers.get(name);
      }
      res.writeHead(response.status, outgoing);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET','HEAD'].includes(req.method)) {
      res.writeHead(405, {allow:'GET, HEAD'}); res.end(); return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {'content-type':mime[path.extname(file)] || 'application/octet-stream',
      'cache-control':'no-store', 'x-m1-source':'static-file'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 502;
    res.writeHead(status); res.end(`M1 local server: ${status}`);
  }
});
// CONNECT is handled as a transport event by Node, not by the request callback.
// This local verification proxy never opens HTTP tunnels.
server.on('connect', (_req, socket) => socket.end(
  'HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD\r\nCache-Control: no-store\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
server.listen(port, '127.0.0.1', () => console.log(`M1 static server http://127.0.0.1:${port}; root=${root}; upstream=${upstream || 'none'}`));
