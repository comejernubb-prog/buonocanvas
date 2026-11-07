import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./index.html', import.meta.url));
const port = Number(process.env.PORT || 3000);
const server = createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('OK');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Allow': 'GET, HEAD' });
    res.end();
    return;
  }
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    if (req.method === 'HEAD') res.end(); else res.end(app);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});
server.listen(port, '0.0.0.0', () => console.log(`buonocanvas v7 listening on ${port}`));
