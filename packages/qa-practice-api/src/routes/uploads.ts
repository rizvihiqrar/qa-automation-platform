import { Router, type Request } from 'express';
import { createHash } from 'node:crypto';
import { requireAuth } from '../middleware/auth.ts';
import { handle } from '../middleware/handle.ts';

// A form-data endpoint to test (A57): it checks a file upload and describes what it got.
// Nothing is stored, so the in-memory and Postgres stores behave the same. The parser is
// Node's own (Response.formData), so no package is added.
export const MAX_FILE_BYTES = 256 * 1024;
const MAX_DESCRIPTION = 200;
// The file plus the form's own framing and fields. A body past this is never read into memory.
const MAX_BODY = MAX_FILE_BYTES + 16 * 1024;
// A refused body is read and thrown away so the client gets its 413, up to this much, then the connection is cut.
const DRAIN_LIMIT = 8 * 1024 * 1024;

// The type is read from the first bytes, not from what the sender says it is.
const SIGNATURES: { type: string; bytes: number[] }[] = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

export function detectType(file: Buffer): string | null {
  return SIGNATURES.find(({ bytes }) => bytes.every((b, i) => file[i] === b))?.type ?? null;
}

// Only the last path segment, and only letters, digits, dots, dashes and underscores,
// so "../../etc/passwd" can never name a place on a disk.
export function safeFilename(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  const clean = last.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100);
  return clean || 'upload';
}

async function readBody(req: Request): Promise<Buffer | 'too-large'> {
  const declared = Number(req.headers['content-length']);
  let tooLarge = Number.isFinite(declared) && declared > MAX_BODY;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) tooLarge = true;
    if (tooLarge) {
      if (size > DRAIN_LIMIT) { req.destroy(); break; }
      continue;
    }
    chunks.push(chunk);
  }
  return tooLarge ? 'too-large' : Buffer.concat(chunks);
}

const router = Router();

// The body is read before anything is answered, a 401 included. Answered first, a client that
// asked for Connection: close had its connection cut while it was still sending (write
// ECONNABORTED, "fetch failed" in UP-10, 4 runs in 30) and never saw the 401. The read is
// capped, which bounds the memory but not the time: a slow anonymous sender holds the connection
// until the server's own request timeout. Fine for a practice API; a gateway would refuse it earlier.
// (A JSON body never gets here: the app-wide express.json answers it first, 400 or 413 included.)
const bufferBody = handle(async (req, res, next) => {
  res.locals.body = await readBody(req);
  next();
});

router.post('/', bufferBody, requireAuth, handle(async (req, res) => {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return res.status(415).json({ error: 'Content-Type must be multipart/form-data' });
  }
  const body = res.locals.body as Buffer | 'too-large';
  const tooLarge = () => res.status(413).json({ error: `File is too large (limit ${MAX_FILE_BYTES} bytes)` });
  if (body === 'too-large') return tooLarge();

  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData();
  } catch {
    return res.status(400).json({ error: 'Body is not valid multipart/form-data' });
  }

  for (const name of new Set(form.keys())) {
    if (name !== 'file' && name !== 'description') return res.status(400).json({ error: `Unexpected field "${name}"` });
  }
  const files = form.getAll('file');
  const file = files[0];
  if (file === undefined) return res.status(400).json({ error: 'file is required' });
  if (files.length > 1) return res.status(400).json({ error: 'Send exactly one file' });
  if (typeof file === 'string') return res.status(400).json({ error: 'file must be a file upload, not a text field' });

  const descriptions = form.getAll('description');
  if (descriptions.length > 1) return res.status(400).json({ error: 'Send at most one description' });
  const rawDescription = descriptions[0];
  if (rawDescription !== undefined && typeof rawDescription !== 'string') {
    return res.status(400).json({ error: 'description must be text, not a file' });
  }
  const description = rawDescription?.trim() ?? null;
  if (description !== null && description.length > MAX_DESCRIPTION) {
    return res.status(400).json({ error: `description is at most ${MAX_DESCRIPTION} characters` });
  }

  if (file.size === 0) return res.status(400).json({ error: 'file is empty' });
  if (file.size > MAX_FILE_BYTES) return tooLarge();

  const bytes = Buffer.from(await file.arrayBuffer());
  const detectedType = detectType(bytes);
  if (!detectedType) return res.status(415).json({ error: 'Unsupported file type: PNG, JPEG and PDF only' });
  // No type, or the generic one clients use when they don't know, claims nothing to contradict.
  if (file.type && file.type !== 'application/octet-stream' && file.type !== detectedType) {
    return res.status(400).json({ error: `File content is ${detectedType} but it was sent as ${file.type}` });
  }

  res.status(201).json({
    filename: safeFilename(file.name),
    detectedType,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    description,
  });
}));

export default router;
