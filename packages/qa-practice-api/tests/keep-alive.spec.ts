import net from 'node:net';
import { test, expect } from '@playwright/test';

// Playwright's request fixture keeps every keep-alive socket in one pool per worker
// and never closes an idle one itself, so only the server decides when an idle socket
// goes. Node's default closes it after 6 s (keepAliveTimeout 5 s plus a 1 s buffer).
// A burst of parallel requests (DC-ST-06 signs up ten customers at once) can pick up
// a socket that has sat idle for about 6 s at the moment the server closes it, and the
// request fails with "socket hang up". src/server.ts keeps idle sockets for 65 s,
// longer than any test (30 s timeout). This holds a raw socket idle past the old
// 6 s cut-off and checks the server still answers on it.

const IDLE_MS = 7000;

const GET_HEALTH = 'GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n';

test('an idle keep-alive connection is still open after 7 s @regression', async ({ baseURL }) => {
  test.setTimeout(20000);
  const { hostname, port } = new URL(baseURL!);
  const socket = net.connect(Number(port), hostname);
  let received = '';
  let closedAt: number | null = null;
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => (received += chunk));
  socket.on('close', () => (closedAt = Date.now()));
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject));

  socket.write(GET_HEALTH);
  await expect.poll(() => received).toContain('"status":"ok"');
  const answeredAt = Date.now();

  await new Promise((r) => setTimeout(r, IDLE_MS));
  expect(closedAt === null ? 'still open' : `closed by the server after ${closedAt - answeredAt} ms idle`).toBe('still open');

  received = '';
  socket.write(GET_HEALTH);
  await expect.poll(() => received).toContain('"status":"ok"');
  socket.destroy();
});
