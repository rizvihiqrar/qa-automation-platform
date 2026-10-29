// A small site that can misbehave on request, so the monitor can be tested without anybody
// else's site. Every path is a different way a site goes wrong.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const page = (title: string, body = '<h1 id="main">Welcome</h1>') => `<!doctype html><title>${title}</title>${body}`;

export interface FakeSite {
  url: (path: string) => string;
  /** How many times a path was requested. */
  hits: (path: string) => number;
  /** Make /switch fail (true) or answer (false). */
  setBroken: (broken: boolean) => void;
  close: () => Promise<void>;
}

export async function startFakeSite(): Promise<FakeSite> {
  const counts = new Map<string, number>();
  let broken = false;
  const server = http.createServer((req, res) => {
    const p = req.url ?? '/';
    const n = (counts.get(p) ?? 0) + 1;
    counts.set(p, n);
    const html = (status: number, body: string) => { res.writeHead(status, { 'content-type': 'text/html' }); res.end(body); };
    switch (p) {
      case '/ok': return html(200, page('Demo shop'));
      case '/slow': return void setTimeout(() => html(200, page('Demo shop')), 1200);
      case '/500': return html(500, page('Demo shop'));
      case '/404': return html(404, page('Not found'));
      case '/wrong-title': return html(200, page('Maintenance'));
      case '/no-element': return html(200, page('Demo shop', '<p>nothing here</p>'));
      case '/hang': return; // never answers
      case '/drop': return void req.socket.destroy();
      case '/flaky-once': return n === 1 ? html(503, page('Demo shop')) : html(200, page('Demo shop'));
      case '/flaky-always': return html(503, page('Demo shop'));
      case '/switch': return broken ? html(500, page('Demo shop')) : html(200, page('Demo shop'));
      default: return html(404, 'no such path');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (p) => `http://127.0.0.1:${port}${p}`,
    hits: (p) => counts.get(p) ?? 0,
    setBroken: (b) => { broken = b; },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
