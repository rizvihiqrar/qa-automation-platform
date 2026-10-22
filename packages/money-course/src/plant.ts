import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The practical's bugs are planted in a COPY of the banking API (a temporary folder), never
// in packages/banking-api. Each bug is one text change that must match exactly once, so a
// change to the banking API that moves the line fails a test here instead of quietly
// planting nothing. All six are the kind of mistake banking-api's own tests were proven to
// catch (its TECHNICAL.md, Deliberate breaks).
export interface Bug {
  id: string;        // the objective it belongs to: O1 to O6
  title: string;
  file: 'src/money.ts' | 'src/ledger.ts' | 'src/app.ts';
  find: string;
  replace: string;
}

export const BUGS: Bug[] = [
  { id: 'O1', title: 'One decimal too many is accepted', file: 'src/money.ts', find: '{1,${decimals}}', replace: '{1,${decimals + 1}}' },
  { id: 'O2', title: 'Yen is given two decimals', file: 'src/money.ts', find: 'JPY: 0', replace: 'JPY: 2' },
  { id: 'O3', title: 'The debit is one minor unit short of the credit', file: 'src/ledger.ts', find: 'entry.run(transferId, fromId, -m.amount, m.currency);', replace: 'entry.run(transferId, fromId, -(m.amount > 1n ? m.amount - 1n : m.amount), m.currency);' },
  { id: 'O4', title: 'The amount is left out of the idempotency key fingerprint', file: 'src/app.ts', find: 'JSON.stringify([m.kind, m.from, m.to, m.amount.toString(), m.currency])', replace: 'JSON.stringify([m.kind, m.from, m.to, m.currency])' },
  { id: 'O5', title: 'Funds are not checked again when the money is written', file: 'src/ledger.ts', find: 'const refusal = this.check(m);', replace: 'const refusal: Refusal | null = null;' },
  { id: 'O6', title: 'A transfer to the same account fails with a 500', file: 'src/ledger.ts', find: "if (from && to && from.id === to.id) return refuse(422, 'same_account', 'cannot transfer from an account to itself');", replace: '' },
];

// Replaces `find` with `replace`, and refuses unless `find` occurs exactly once.
export function replaceOnce(text: string, find: string, replace: string): string {
  const parts = text.split(find);
  if (parts.length !== 2) throw new Error(`expected exactly one match of ${JSON.stringify(find)}, found ${parts.length - 1}`);
  return parts.join(replace);
}

const BANKING = new URL('../../banking-api/', import.meta.url);

// A temporary copy of the banking API with the given bugs planted (ids such as 'O3').
export function plantedCopy(ids: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'money-course-'));
  for (const folder of ['src', 'sql', 'public']) cpSync(new URL(`${folder}/`, BANKING), path.join(dir, folder), { recursive: true });
  for (const id of ids) {
    const bug = BUGS.find((b) => b.id === id);
    if (!bug) throw new Error(`no bug ${id}`);
    const file = path.join(dir, bug.file);
    writeFileSync(file, replaceOnce(readFileSync(file, 'utf8'), bug.find, bug.replace));
  }
  return dir;
}

export interface Variant {
  base: string;
  stop(): Promise<void>;
}

// Starts that copy in this process on a free port (or `port`). `screeningMs` is the
// banking API's own SCREENING_DELAY_MS: how long each movement waits for an outside check,
// the gap in which two requests overlap.
export async function startVariant(ids: string[], { screeningMs = 150, port = 0 }: { screeningMs?: number; port?: number } = {}): Promise<Variant> {
  const dir = plantedCopy(ids);
  const { createApp } = await import(pathToFileURL(path.join(dir, 'src', 'app.ts')).href);
  const { Ledger } = await import(pathToFileURL(path.join(dir, 'src', 'ledger.ts')).href);
  const ledger = new Ledger();
  const server = createApp(ledger, { screen: () => new Promise<void>((resolve) => setTimeout(resolve, screeningMs)) });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: chosen } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${chosen}`,
    stop: () => new Promise<void>((resolve) => { server.close(() => { ledger.close(); resolve(); }); server.closeAllConnections(); }),
  };
}
