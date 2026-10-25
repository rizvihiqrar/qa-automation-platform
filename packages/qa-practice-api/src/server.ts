import app from './app.ts';
import { seedAdmin } from './db/seed.ts';

const admin = await seedAdmin();
if (admin) console.log(`Admin account: ${admin.email}`);

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => console.log(`qa-practice-api running on http://localhost:${PORT}`));

// Keep an idle keep-alive connection open for 65 s. Node's default (5 s plus a 1 s
// buffer) closed sockets that a client still held in its pool: Playwright's request
// pool never drops an idle socket itself, so a burst of parallel requests that picked
// up one idle for about 6 s raced the server's close and failed with "socket hang up"
// (DC-ST-06, CI run 40206566126). 65 s is longer than any test's 30 s timeout.
// tests/keep-alive.spec.ts holds a socket idle past the old limit and checks it is open.
server.keepAliveTimeout = 65_000;

// Log connections that break mid-request, so a reset shows on the server side too.
server.on('clientError', (err: NodeJS.ErrnoException, socket) => {
  console.error(`client connection error: ${err.code ?? err.message}`);
  socket.destroy();
});
