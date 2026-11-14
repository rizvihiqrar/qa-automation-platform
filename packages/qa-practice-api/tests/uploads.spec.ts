import { createHash } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PASSWORD } from './admin.ts';
import { inspectJpeg, inspectPng } from '../src/routes/image.ts';

// A57: the form-data endpoint, POST /uploads (src/routes/uploads.ts). Requests are built with
// fetch and FormData, which write a real multipart body; the broken bodies are written by hand.
// Each case: the status, the body, and that a refused upload never reaches the "created" shape.

const MAX = 256 * 1024;

// A492: the images are built to the structure the endpoint checks: a PNG has an IHDR block and an IEND
// block, a JPEG ends with FFD9. They are not pictures a viewer could draw, and nothing decodes them.
const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
/** colour type 2 is plain RGB, 6 is RGB with transparency, 4 grey with transparency; trns adds a tRNS block. */
const png = (size = 64, { colour = 2, trns = false } = {}) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = colour;
  const head = Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), ...(trns ? [chunk('tRNS', Buffer.alloc(2))] : [])]);
  const idat = chunk('IDAT', Buffer.alloc(size - head.length - IEND.length - 12, 7));
  return Buffer.concat([head, idat, IEND]);
};
/** An EXIF block with one entry, the orientation tag (value 1 to 8), little or big endian. */
const exif = (orientation: number, bigEndian = false) => {
  const tiff = Buffer.alloc(26);
  tiff.write(bigEndian ? 'MM' : 'II', 0, 'latin1');
  const u16 = (v: number, at: number) => (bigEndian ? tiff.writeUInt16BE(v, at) : tiff.writeUInt16LE(v, at));
  const u32 = (v: number, at: number) => (bigEndian ? tiff.writeUInt32BE(v, at) : tiff.writeUInt32LE(v, at));
  u16(42, 2); u32(8, 4); u16(1, 8);                       // one entry in the first directory
  u16(0x0112, 10); u16(3, 12); u32(1, 14); u16(orientation, 18);
  const body = Buffer.concat([Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0]), tiff]); // "Exif" and two zero bytes
  const length = Buffer.alloc(2); length.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, body]);
};
const jpeg = (size = 64, tag?: Buffer) => {
  const head = Buffer.concat([Buffer.from([0xff, 0xd8]), tag ?? Buffer.alloc(0), Buffer.from([0xff, 0xda])]);
  return Buffer.concat([head, Buffer.alloc(size - head.length - 2, 9), Buffer.from([0xff, 0xd9])]);
};
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
      // A PNG also says whether it has transparency and a JPEG its rotation tag (A492).
      const extra = type === 'image/png' ? { hasAlpha: false } : type === 'image/jpeg' ? { orientation: null } : {};
      expect(await res.json()).toEqual({
        filename: 'file.bin', detectedType: type, size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), description: null, ...extra,
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

test.describe('POST /uploads: images (A492)', () => {
  const heic = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`, 'latin1'), Buffer.alloc(40)]);

  for (const brand of ['heic', 'heix', 'heif']) {
    test(`UP-50 a HEIC photo (brand ${brand}) is a 415 that says to export JPEG or PNG @regression`, async () => {
      const res = await upload(heic(brand), 'IMG_0001.heic', 'image/heic');
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: 'HEIC photos are not supported: export the photo as JPEG or PNG' });
    });
  }

  for (const [brand, name] of [['isom', 'an MP4 video'], ['avif', 'an AVIF image'], ['mif1', 'a generic HEIF-family file']]) {
    test(`UP-51 another ftyp file (${name}) gets the general 415, not the HEIC advice @regression`, async () => {
      const res = await upload(heic(brand!), 'other.bin', '');
      expect(res.status).toBe(415);
      expect((await res.json()).error).toBe('Unsupported file type: PNG, JPEG and PDF only');
    });
  }

  test('UP-60 a PNG with bytes after its end block, and a JPEG with zero padding, are real files and are created @regression', async () => {
    expect((await upload(Buffer.concat([png(200), Buffer.from('trailer-added-by-a-tool')]), 'a.png', 'image/png')).status).toBe(201);
    expect((await upload(Buffer.concat([jpeg(200, exif(6)), Buffer.alloc(16)]), 'a.jpg', 'image/jpeg')).status).toBe(201);
  });

  test('UP-61 a JPEG with a JFIF block first, then the EXIF block, still reports its rotation @regression', async () => {
    const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9)]);
    const fill = Buffer.from([0xff, 0xff]);                    // fill bytes before a marker are allowed
    const res = await upload(jpeg(300, Buffer.concat([app0, fill, exif(8)])), 'p.jpg', 'image/jpeg');
    expect((await res.json()).orientation).toBe(8);
  });

  test('UP-62 a PNG whose block length runs past the end of the file is damaged, even with an end block at the very end @regression', async () => {
    const whole = png(200);
    whole.writeUInt32BE(5000, 8 + 25);                          // the first block after IHDR claims 5000 bytes
    const res = await upload(whole, 'bad.png', 'image/png');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^PNG file is damaged: a block runs past the end/);
  });

  test('UP-63 an orientation entry that is not a single SHORT is ignored, not read as a number @regression', async () => {
    const tag = exif(6);
    tag.writeUInt16LE(2, 4 + 2 + 6 + 10 + 2);                   // entry type 2 (text) instead of 3
    const res = await upload(jpeg(300, tag), 'odd.jpg', 'image/jpeg');
    expect(res.status).toBe(201);
    expect((await res.json()).orientation).toBeNull();
  });

  test('UP-52 a PNG cut short (no end block) is a 400, not a created upload @regression', async () => {
    const whole = png(200);
    const noEnd = await upload(whole.subarray(0, whole.length - 12), 'cut.png', 'image/png');     // only IEND missing
    expect(noEnd.status).toBe(400);
    expect((await noEnd.json()).error).toMatch(/^PNG file is damaged: the end marker/);
    const midBlock = await upload(whole.subarray(0, whole.length - 20), 'cut.png', 'image/png');  // cut inside the image data
    expect(midBlock.status).toBe(400);
    expect((await midBlock.json()).error).toMatch(/^PNG file is damaged: a block runs past the end/);
  });

  test('UP-53 a PNG with the right first bytes but no header block is a 400 @regression', async () => {
    const res = await upload(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(80, 7)]), 'bad.png', 'image/png');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^PNG file is damaged: the header block/);
  });

  test('UP-54 a JPEG cut short (no end marker) is a 400 @regression', async () => {
    const whole = jpeg(200);
    const res = await upload(whole.subarray(0, whole.length - 2), 'cut.jpg', 'image/jpeg');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^JPEG file is damaged: the end marker/);
  });

  for (let tag = 1; tag <= 8; tag++) {
    test(`UP-55 a phone photo with rotation tag ${tag} is created and says so @regression`, async () => {
      const res = await upload(jpeg(300, exif(tag)), 'photo.jpg', 'image/jpeg');
      expect(res.status).toBe(201);
      expect((await res.json()).orientation).toBe(tag);
    });
  }

  test('UP-56 a big-endian EXIF block is read too, and a tag outside 1 to 8 or no EXIF at all is null @regression', async () => {
    expect((await (await upload(jpeg(300, exif(6, true)), 'a.jpg', 'image/jpeg')).json()).orientation).toBe(6);
    expect((await (await upload(jpeg(300, exif(9)), 'b.jpg', 'image/jpeg')).json()).orientation).toBeNull();
    expect((await (await upload(jpeg(300), 'c.jpg', 'image/jpeg')).json()).orientation).toBeNull();
  });

  const transparency: [label: string, bytes: Buffer, hasAlpha: boolean][] = [
    ['an RGB PNG has no transparency', png(120, { colour: 2 }), false],
    ['an RGBA PNG is transparent', png(120, { colour: 6 }), true],
    ['a grey PNG with alpha is transparent', png(120, { colour: 4 }), true],
    ['an RGB PNG with a tRNS block is transparent', png(120, { colour: 2, trns: true }), true],
  ];
  for (const [label, bytes, hasAlpha] of transparency) {
    test(`UP-57 ${label} @regression`, async () => {
      const res = await upload(bytes, 'logo.png', 'image/png');
      expect(res.status).toBe(201);
      expect((await res.json()).hasAlpha).toBe(hasAlpha);
    });
  }

  test('UP-58 a photo of exactly the size limit with a rotation tag is created, one byte over is a 413 @regression', async () => {
    expect((await upload(jpeg(MAX, exif(3)), 'big.jpg', 'image/jpeg')).status).toBe(201);
    expect((await upload(jpeg(MAX + 1, exif(3)), 'big.jpg', 'image/jpeg')).status).toBe(413);
  });

  test('UP-59 no cut of a PNG or a JPEG, at any length, makes the checks throw @regression', async () => {
    const files = [png(200, { colour: 6, trns: true }), jpeg(200, exif(6)), jpeg(200, exif(6, true))];
    for (const file of files) {
      for (let cut = 0; cut <= file.length; cut++) {
        const piece = file.subarray(0, cut);
        const inspect = file === files[0] ? inspectPng : inspectJpeg;
        expect(() => inspect(piece), `cut at ${cut} of ${file.length} bytes`).not.toThrow();
      }
    }
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
