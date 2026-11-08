import { readFileSync } from 'node:fs';
import https from 'node:https';
import app from './app.ts';
import { seedAdmin } from './db/seed.ts';

const admin = await seedAdmin();
if (admin) console.log(`Admin account: ${admin.email}`);
console.log(`Store: ${process.env.DATABASE_URL ? 'Postgres (DATABASE_URL)' : 'in memory'}`);

const PORT = process.env.PORT || 4000;

// HTTPS is off unless both files are named (certificate tests, tests/tls.spec.ts). One without
// the other is a mistake that would otherwise leave the API on plain HTTP without a word.
const { HTTPS_KEY_FILE, HTTPS_CERT_FILE } = process.env;
if (Boolean(HTTPS_KEY_FILE) !== Boolean(HTTPS_CERT_FILE)) {
  console.error('Set both HTTPS_KEY_FILE and HTTPS_CERT_FILE, or neither');
  process.exit(1);
}
const scheme = HTTPS_KEY_FILE ? 'https' : 'http';
const onListening = () => console.log(`qa-practice-api running on ${scheme}://localhost:${PORT}`);
function tlsFiles(key: string, cert: string) {
  try {
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } catch (err) {
    console.error(`Cannot read the HTTPS key or certificate: ${(err as Error).message}`);
    process.exit(1);
  }
}
const server = HTTPS_KEY_FILE && HTTPS_CERT_FILE
  ? https.createServer(tlsFiles(HTTPS_KEY_FILE, HTTPS_CERT_FILE), app).listen(PORT, onListening)
  : app.listen(PORT, onListening);

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

// A client that refuses the certificate hangs up during the handshake: that is the client's
// decision, so it is logged on one line, not as a crash.
server.on('tlsClientError', (err: NodeJS.ErrnoException) => {
  console.error(`TLS handshake refused by the client: ${err.code ?? err.message}`);
});
