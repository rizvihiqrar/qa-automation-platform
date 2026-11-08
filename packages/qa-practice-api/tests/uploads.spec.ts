import { createHash } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PASSWORD } from './admin.ts';

// A57: the form-data endpoint, POST /uploads (src/routes/uploads.ts). Requests are built with
// fetch and FormData, which write a real multipart body; the broken bodies are written by hand.
// Each case: the status, the body, and that a refused upload never reaches the "created" shape.

const MAX = 256 * 1024;
const png = (size = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 7)]);
const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 9)]);
const pdf = (size = 64) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size - 9, 0x20)]);

let token = '';
let baseURL = '';

test.beforeAll(async ({ request }) => {
  token = await register(request);
});

async function register(request: APIRequestContext): Promise<string> {
  const res = await request.post('/auth/register', {
    data: { name: 'Upload Tester', email: `upload.${process.pid}.${Date.now()}@example.com`, password: PASSWORD },
  });
  return (await res.json()).token;
}

test.beforeEach(({ baseURL: url }) => {
  baseURL = url!;
});

const send = (init: RequestInit & { auth?: boolean }) => {
  const { auth = true, headers, ...rest } = init;
  return fetch(`${baseURL}/uploads`, { method: 'POST', ...rest, headers: { Connection: 'close', ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
};

function formWith(bytes: Buffer, filename: string, type = '', extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], filename, { type }));
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  return form;
}

const upload = (bytes: Buffer, filename: string, type = '', extra: Record<string, string> = {}) =>
  send({ body: formWith(bytes, filename, type, extra) });

test.describe('POST /uploads: what is accepted', () => {
  const kinds: [string, Buffer, string][] = [
    ['a PNG', png(), 'image/png'],
    ['a JPEG', jpeg(), 'image/jpeg'],
    ['a PDF', pdf(), 'application/pdf'],
  ];
  for (const [label, bytes, type] of kinds) {
    test(`UP-01 ${label} is created, and the reply describes the bytes received @regression`, async () => {
      const res = await upload(bytes, 'file.bin', type);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        filename: 'file.bin', detectedType: type, size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), description: null,
      });
    });
  }

  test('UP-02 a file sent with no type of its own is judged by its bytes @regression', async () => {
    const res = await upload(png(), 'logo.png', '');
    expect(res.status).toBe(201);
    expect((await res.json()).detectedType).toBe('image/png');
  });

  test('UP-03 the description comes back trimmed, and is null when none is sent @regression', async () => {
    const withText = await (await upload(png(), 'a.png', 'image/png', { description: '  A logo  ' })).json();
    const without = await (await upload(png(), 'a.png', 'image/png')).json();
    expect(withText.description).toBe('A logo');
    expect(without.description).toBeNull();
  });

  test('UP-04 the same bytes give the same checksum every time @regression', async () => {
    const [a, b] = await Promise.all([upload(pdf(500), 'x.pdf', 'application/pdf'), upload(pdf(500), 'y.pdf', 'application/pdf')]);
    expect((await a.json()).sha256).toBe((await b.json()).sha256);
  });

  test('UP-05 the reply is JSON and carries the security headers every response has @regression', async () => {
    const res = await upload(png(), 'a.png', 'image/png');
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

test.describe('POST /uploads: the filename', () => {
  const names: [label: string, sent: string, saved: string][] = [
    ['a path going up folders loses its path', '../../etc/passwd.png', 'passwd.png'],
    ['a Windows path loses its folders', 'C:\\Users\\x\\logo.png', 'logo.png'],
    ['spaces and accents become underscores', 'résumé final.png', 'r_sum__final.png'],
    ['leading dots are dropped, so no hidden file', '...hidden.png', 'hidden.png'],
    ['a name with nothing usable becomes "upload"', '///', 'upload'],
  ];
  for (const [label, sent, saved] of names) {
    test(`UP-06 ${label} @regression`, async () => {
      const res = await upload(png(), sent, 'image/png');
      expect(res.status).toBe(201);
      expect((await res.json()).filename).toBe(saved);
    });
  }

  test('UP-07 a very long name is cut to 100 characters @regression', async () => {
    const res = await upload(png(), `${'a'.repeat(300)}.png`, 'image/png');
    expect((await res.json()).filename).toHaveLength(100);
  });
});

test.describe('POST /uploads: what is refused', () => {
  test('UP-10 no token is a 401 @regression', async () => {
    const res = await send({ auth: false, body: formWith(png(), 'a.png', 'image/png') });
    expect(res.status).toBe(401);
  });

  test('UP-10 a large body with no token is still answered with the 401, not a cut connection @regression', async () => {
    // Found when the 401 was sent before the body was read: a client sending Connection: close
    // got write ECONNABORTED instead (see bufferBody in src/routes/uploads.ts).
    const res = await send({ auth: false, body: formWith(png(200 * 1024), 'a.png', 'image/png') });
    expect(res.status).toBe(401);
  });

  test('UP-11 a JSON body is a 415 @regression', async () => {
    const res = await send({ headers: { 'Content-Type': 'application/json' }, body: '{"file":"x"}' });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Content-Type must be multipart/form-data' });
  });

  test('UP-12 a form with no file is a 400 @regression', async () => {
    const form = new FormData();
    form.append('description', 'nothing attached');
    const res = await send({ body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'file is required' });
  });

  test('UP-13 two files are a 400, not one of them kept @regression', async () => {
    const form = formWith(png(), 'a.png', 'image/png');
    form.append('file', new File([new Uint8Array(png())], 'b.png', { type: 'image/png' }));
    const res = await send({ body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Send exactly one file' });
  });

  test('UP-14 a field the form does not have is a 400 @regression', async () => {
    const res = await upload(png(), 'a.png', 'image/png', { admin: 'true' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unexpected field "admin"' });
  });

  test('UP-15 a text field named file is a 400, not a file @regression', async () => {
    const form = new FormData();
    form.append('file', 'just text');
    const res = await send({ body: form });
    expect(res.status).toBe(400);
  });

  test('UP-16 an empty file is a 400 @regression', async () => {
    const res = await upload(Buffer.alloc(0), 'empty.png', 'image/png');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'file is empty' });
  });

  test('UP-18 a description sent as a file is a 400, not the text "[object File]" @regression', async () => {
    const form = formWith(png(), 'a.png', 'image/png');
    form.append('description', new File(['hello'], 'description.txt', { type: 'text/plain' }));
    const res = await send({ body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'description must be text, not a file' });
  });

  test('UP-17 a description of 201 characters is a 400, 200 is accepted @regression', async () => {
    expect((await upload(png(), 'a.png', 'image/png', { description: 'd'.repeat(201) })).status).toBe(400);
    expect((await upload(png(), 'a.png', 'image/png', { description: 'd'.repeat(200) })).status).toBe(201);
  });
});

test.describe('POST /uploads: the content must be what it says', () => {
  const unsupported: [label: string, bytes: Buffer, type: string][] = [
    ['plain text called a PNG', Buffer.from('this is not an image'), 'image/png'],
    ['a Windows program (MZ) called a PDF', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60)]), 'application/pdf'],
    ['an HTML page called a JPEG', Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg'],
  ];
  for (const [label, bytes, type] of unsupported) {
    test(`UP-20 ${label} is a 415 @regression`, async () => {
      const res = await upload(bytes, 'file', type);
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: 'Unsupported file type: PNG, JPEG and PDF only' });
    });
  }

  test('UP-21 a PNG sent as a JPEG is a 400 that names both types @regression', async () => {
    const res = await upload(png(), 'a.jpg', 'image/jpeg');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'File content is image/png but it was sent as image/jpeg' });
  });

  test('UP-22 a file named .png whose bytes are a PDF is judged by the bytes @regression', async () => {
    const res = await upload(pdf(), 'fake.png', '');
    expect((await res.json()).detectedType).toBe('application/pdf');
  });
});

test.describe('POST /uploads: size', () => {
  test('UP-30 a file of exactly 256 KB is created @regression', async () => {
    const res = await upload(png(MAX), 'big.png', 'image/png');
    expect(res.status).toBe(201);
    expect((await res.json()).size).toBe(MAX);
  });

  test('UP-31 one byte over is a 413 @regression', async () => {
    const res = await upload(png(MAX + 1), 'big.png', 'image/png');
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: `File is too large (limit ${MAX} bytes)` });
  });

  test('UP-32 a 2 MB file is a 413 that is read and refused, and the server still answers @regression', async () => {
    const res = await upload(png(2 * 1024 * 1024), 'huge.png', 'image/png');
    expect(res.status).toBe(413);
    const next = await upload(png(), 'after.png', 'image/png');
    expect(next.status).toBe(201);
  });
});

test.describe('POST /uploads: broken bodies', () => {
  test('UP-40 a multipart type with no boundary is a 400 @regression', async () => {
    const res = await send({ headers: { 'Content-Type': 'multipart/form-data;' }, body: 'anything' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Body is not valid multipart/form-data' });
  });

  test('UP-41 a body cut off before its closing boundary is a 400 @regression', async () => {
    const body = ['--xyz', 'Content-Disposition: form-data; name="file"; filename="a.png"', 'Content-Type: image/png', '', 'PNG...'].join('\r\n');
    const res = await send({ headers: { 'Content-Type': 'multipart/form-data; boundary=xyz' }, body });
    expect(res.status).toBe(400);
  });

  test('UP-42 a body that uses another boundary than the header names is a 400 @regression', async () => {
    const body = ['--other', 'Content-Disposition: form-data; name="file"; filename="a.png"', '', 'x', '--other--', ''].join('\r\n');
    const res = await send({ headers: { 'Content-Type': 'multipart/form-data; boundary=xyz' }, body });
    expect(res.status).toBe(400);
  });
});
