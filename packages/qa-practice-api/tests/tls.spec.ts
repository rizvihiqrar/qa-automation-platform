import { request as httpsRequest, type RequestOptions } from 'node:https';
import { readFileSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
import { test, expect } from '@playwright/test';
import { makeFixtures, type CertFiles, type Fixtures } from './tls-fixtures.ts';
import { startFailing, startServer, type Started } from './start-server.ts';

// A59: certificate tests on purpose. The API is started on HTTPS with a certificate that is
// wrong in one way at a time (src/server.ts: HTTPS_KEY_FILE and HTTPS_CERT_FILE), and a client
// that checks certificates, as every real client should, must refuse each one for its own
// reason. The certificates are made at the start of the run (tests/tls-fixtures.ts).

interface Reply {
  status: number;
  body: string;
  authorized: boolean;
  authorizationError?: string;
  protocol: string | null;
}

// GET over HTTPS with Node's own checks on. `agent: false` so no connection outlives its server.
const get = (url: string, path: string, options: RequestOptions = {}) => new Promise<Reply>((resolve, reject) => {
  const req = httpsRequest(`${url}${path}`, { agent: false, ...options }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => {
      const socket = res.socket as TLSSocket;
      resolve({ status: res.statusCode ?? 0, body, authorized: socket.authorized, authorizationError: socket.authorizationError as unknown as string | undefined, protocol: socket.getProtocol() });
    });
  });
  req.on('error', reject);
  req.end();
});

// The error code a client gives for a refused connection.
const refusedWith = (promise: Promise<unknown>) => promise.then(
  () => { throw new Error('the connection was accepted, but the client should have refused it'); },
  (err: NodeJS.ErrnoException) => err,
);

let fx: Fixtures;
let started: Started | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  fx = makeFixtures();
});

test.afterAll(() => {
  fx.remove();
});

test.afterEach(async () => {
  await started?.stop();
  started = undefined;
});

const serve = async (files: CertFiles) => {
  started = await startServer({ HTTPS_KEY_FILE: files.key, HTTPS_CERT_FILE: files.cert });
  return started;
};
const ca = () => [readFileSync(fx.caCert)];

test.describe('a good certificate', () => {
  test('TLS-01 is accepted by a client that trusts its authority, and the API answers over it @regression', async () => {
    const { url } = await serve(fx.valid);
    const health = await get(url, '/health', { ca: ca() });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body).status).toBe('ok');
    expect(health.authorized).toBe(true);
    expect(health.protocol).toMatch(/^TLSv1\.[23]$/);
    const products = await get(url, '/products', { ca: ca() });
    expect(products.status).toBe(200);
  });

  test('TLS-02 is served on TLS 1.2 as well as 1.3, and not on 1.1 @regression', async () => {
    const { url } = await serve(fx.valid);
    expect((await get(url, '/health', { ca: ca(), maxVersion: 'TLSv1.2' })).protocol).toBe('TLSv1.2');
    expect((await get(url, '/health', { ca: ca(), minVersion: 'TLSv1.3' })).protocol).toBe('TLSv1.3');
    const err = await refusedWith(get(url, '/health', { ca: ca(), minVersion: 'TLSv1', maxVersion: 'TLSv1.1' }));
    expect(err.code).toBeTruthy();
  });
});

test.describe('a certificate the client must refuse', () => {
  test('TLS-10 one that has expired is refused as expired @regression', async () => {
    const { url } = await serve(fx.expired);
    const err = await refusedWith(get(url, '/health', { ca: ca() }));
    expect(err.code).toBe('CERT_HAS_EXPIRED');
  });

  test('TLS-11 one made for another host name is refused as the wrong host @regression', async () => {
    const { url } = await serve(fx.wrongHost);
    const err = await refusedWith(get(url, '/health', { ca: ca() }));
    expect(err.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(err.message).toContain('other.example');
  });

  test('TLS-12 one signed by itself is refused as untrusted @regression', async () => {
    const { url } = await serve(fx.selfSigned);
    const err = await refusedWith(get(url, '/health'));
    expect(err.code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
  });

  test('TLS-13 one from an authority the client does not trust is refused as untrusted @regression', async () => {
    const { url } = await serve(fx.valid);
    const err = await refusedWith(get(url, '/health')); // the system's own authorities, not ours
    expect(err.code).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  });
});

test.describe('the refusal is for the reason given, and nothing else', () => {
  test('TLS-20 trusting the self-signed certificate itself makes it work: trust is the client\'s choice @regression', async () => {
    const { url } = await serve(fx.selfSigned);
    const res = await get(url, '/health', { ca: [readFileSync(fx.selfSigned.cert)] });
    expect(res.status).toBe(200);
    expect(res.authorized).toBe(true);
  });

  test('TLS-21 with the check switched off, the expired certificate is served and flagged, so the server was up @regression', async () => {
    const { url } = await serve(fx.expired);
    const res = await get(url, '/health', { rejectUnauthorized: false });
    expect(res.status).toBe(200);
    expect(res.authorized).toBe(false);
    expect(res.authorizationError).toBe('CERT_HAS_EXPIRED');
  });

  test('TLS-22 the name is checked as well as the authority: the right authority cannot vouch for another host @regression', async () => {
    const { url } = await serve(fx.wrongHost);
    const unchecked = await get(url, '/health', { ca: ca(), checkServerIdentity: () => undefined });
    expect(unchecked.status).toBe(200); // the chain is good: only the name is wrong
  });
});

test.describe('the server', () => {
  test('TLS-30 logs a refused handshake on one line, and keeps serving @regression', async () => {
    const server = await serve(fx.expired);
    await refusedWith(get(server.url, '/health', { ca: ca() }));
    await expect.poll(() => server.log(), { timeout: 5_000 }).toContain('TLS handshake refused by the client');
    const next = await get(server.url, '/health', { rejectUnauthorized: false });
    expect(next.status).toBe(200);
  });

  test('TLS-31 does not answer plain HTTP on its HTTPS port, and says why in its log @regression', async () => {
    const server = await serve(fx.valid);
    const err = await fetch(server.url.replace('https', 'http') + '/health').then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
    await expect.poll(() => server.log(), { timeout: 5_000 }).toContain('ERR_SSL_HTTP_REQUEST');
  });

  test('TLS-32 refuses to start with a key and no certificate, or a certificate and no key @regression', async () => {
    for (const env of [{ HTTPS_KEY_FILE: fx.valid.key }, { HTTPS_CERT_FILE: fx.valid.cert }] as Record<string, string>[]) {
      const { code, output } = await startFailing(env);
      expect(code).toBe(1);
      expect(output).toContain('Set both HTTPS_KEY_FILE and HTTPS_CERT_FILE, or neither');
    }
  });

  test('TLS-33 refuses to start when the key file is not there @regression', async () => {
    const { code, output } = await startFailing({ HTTPS_KEY_FILE: `${fx.dir}/missing.key`, HTTPS_CERT_FILE: fx.valid.cert });
    expect(code).not.toBe(0);
    expect(output).toContain('Cannot read the HTTPS key or certificate');
    expect(output).toContain('ENOENT');
  });

  test('TLS-34 refuses to start when the certificate file is not a certificate @regression', async () => {
    const { code, output } = await startFailing({ HTTPS_KEY_FILE: fx.valid.key, HTTPS_CERT_FILE: fx.valid.key });
    expect(code).not.toBe(0);
    expect(output).toMatch(/PEM|certificate|ERR_/i);
  });
});
