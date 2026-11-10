import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const assets = new Map([
  ['/', ['../web/index.html','text/html; charset=utf-8']],
  ['/app.js',['../web/app.js','text/javascript; charset=utf-8']],
  ['/style.css',['../web/style.css','text/css; charset=utf-8']],
  ['/compare.js',['./compare.js','text/javascript; charset=utf-8']],
  ['/normalize.js',['./normalize.js','text/javascript; charset=utf-8']]
]);
export function serve(report, port = 0) {
  const server = createServer(async (req,res)=> {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    // Reject DNS rebinding and cross-origin reads of private repository content.
    const host = req.headers.host;
    const allowed = `127.0.0.1:${server.address()?.port}`;
    if (host !== allowed || (req.headers.origin && req.headers.origin !== `http://${allowed}`)) { res.writeHead(403).end('Forbidden'); return; }
    if (req.method !== 'GET') { res.writeHead(405).end('Method not allowed'); return; }
    if (req.url === '/api/report') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(report)); return; }
    const asset = assets.get(req.url);
    if (!asset) { res.writeHead(404).end('Not found'); return; }
    try { const data = await readFile(new URL(asset[0],import.meta.url)); res.setHeader('Content-Type',asset[1]); res.end(data); }
    catch { res.writeHead(500).end('Unable to load UI asset'); }
  });
  return new Promise((resolve,reject)=> {
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>resolve(server));
  });
}
