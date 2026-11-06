import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';

// PORT=0 picks a free port; the log line names the one chosen.
const port = Number(process.env.PORT ?? 4400);

const server = createApp();
server.listen(port, '127.0.0.1', () => {
  const { port: chosen } = server.address() as AddressInfo;
  console.log(`food-truck-postman listening on http://127.0.0.1:${chosen}`);
});
