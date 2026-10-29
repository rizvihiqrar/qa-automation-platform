// Reading and writing history.json. A missing file means a first run; a file that exists but cannot
// be read is an error, because carrying on from an empty history would overwrite 30 days of data.
import fs from 'node:fs';
import path from 'node:path';
import type { History } from './history.ts';

export function readHistory(file: string): History {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { runs: [] };
    throw err;
  }
  const parsed = JSON.parse(text) as Partial<History>;
  if (!Array.isArray(parsed.runs)) throw new Error(`${file} has no "runs" list`);
  return { runs: parsed.runs };
}

/** Written to a temporary file and renamed, so an interrupted write cannot leave half a file. */
export function writeFileAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}
