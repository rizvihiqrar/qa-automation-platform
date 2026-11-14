// What POST /uploads checks inside an image (A492), beyond the first bytes that say its type.
// Not a decoder: it reads the few places a phone photo or a screenshot gets damaged or needs
// a note for the client (the PNG block structure, the end of a JPEG, the EXIF rotation tag).

const PNG_SIGNATURE_LENGTH = 8;

// HEIC and HEIF photos (an iPhone's default) start with a box: 4 size bytes, "ftyp", a brand.
// The generic brands mif1 and msf1 are left out: AVIF files use them too, and would get the wrong advice.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'heif']);

export function isHeic(file: Buffer): boolean {
  return file.length >= 12 && file.toString('latin1', 4, 8) === 'ftyp' && HEIC_BRANDS.has(file.toString('latin1', 8, 12));
}

export type Inspection<T> = { ok: true; details: T } | { ok: false; error: string };

/**
 * A PNG is blocks: a 13-byte IHDR first, then more, ending with IEND. Each block must fit in the file,
 * so one cut short or with a damaged length is refused. Bytes after IEND are allowed (some tools append
 * them). Colour type 4 or 6, or a tRNS block before the image data, means transparency.
 */
export function inspectPng(file: Buffer): Inspection<{ hasAlpha: boolean }> {
  const damaged = (what: string): Inspection<never> => ({ ok: false, error: `PNG file is damaged: ${what}` });
  const ihdr = PNG_SIGNATURE_LENGTH;
  if (file.length < ihdr + 25 || file.readUInt32BE(ihdr) !== 13 || file.toString('latin1', ihdr + 4, ihdr + 8) !== 'IHDR') {
    return damaged('the header block (IHDR) is missing');
  }
  const colourType = file[ihdr + 8 + 9]!;
  let hasAlpha = colourType === 4 || colourType === 6;
  let seenData = false;
  for (let at = ihdr + 25; ;) {
    if (at + 12 > file.length) return damaged('the end marker (IEND) is missing, the file was cut short');
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > file.length) return damaged('a block runs past the end of the file, it was cut short');
    if (type === 'IEND') break;
    if (type === 'IDAT') seenData = true;
    if (type === 'tRNS' && !seenData) hasAlpha = true;
    at += 12 + length;
  }
  return { ok: true, details: { hasAlpha } };
}

/**
 * A JPEG ends with the end-of-image marker (FF D9), allowing zero padding after it. A photo may carry an
 * EXIF rotation tag (1 to 8).
 */
export function inspectJpeg(file: Buffer): Inspection<{ orientation: number | null }> {
  let end = file.length;
  while (end > 0 && file[end - 1] === 0) end--;
  if (end < 4 || file[end - 2] !== 0xff || file[end - 1] !== 0xd9) {
    return { ok: false, error: 'JPEG file is damaged: the end marker is missing, the file was cut short' };
  }
  return { ok: true, details: { orientation: exifOrientation(file) } };
}

/** The EXIF orientation of a JPEG, 1 to 8, or null when there is no such tag. */
export function exifOrientation(file: Buffer): number | null {
  // Segments after the start marker: 0xFF, a marker byte, a 2-byte length that counts itself.
  let at = 2;
  while (at + 2 <= file.length && file[at] === 0xff) {
    const marker = file[at + 1]!;
    if (marker === 0xff) { at++; continue; }                        // fill bytes before a marker
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }   // markers with no length
    if (marker === 0xda || marker === 0xd9) return null;           // the image data begins: no EXIF before it
    if (at + 4 > file.length) return null;
    const length = file.readUInt16BE(at + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && file.toString('latin1', at + 4, at + 10) === 'Exif\0\0') {
      return orientationInTiff(file.subarray(at + 10, at + 2 + length));
    }
    at += 2 + length;
  }
  return null;
}

function orientationInTiff(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const order = tiff.toString('latin1', 0, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return null;
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      // Only a SHORT (type 3) with one value is an orientation.
      if (u16(entry + 2) !== 3 || u32(entry + 4) !== 1) return null;
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}
