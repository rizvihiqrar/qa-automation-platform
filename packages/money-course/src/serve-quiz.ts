import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

// Serves quiz/ on http://127.0.0.1:4300 so the page can fetch questions.json offline
// (browsers block fetch from a file:// page). The published copy is on the dashboard's
// GitHub Pages site, under /course/.
const ROOT = new URL('../quiz/', import.meta.url);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const port = Number(process.env.PORT ?? 4300);

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  const type = TYPES[name.slice(name.lastIndexOf('.'))];
  if (!type || name.includes('..') || name.includes('/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return void res.end('not found');
  }
  try {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(await readFile(new URL(name, ROOT)));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`quiz on http://127.0.0.1:${port}/`));
