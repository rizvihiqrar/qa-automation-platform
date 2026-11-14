// A114's measure: start several workers at once with the same --seed, with and without --run,
// and count the keys (ids, emails, usernames, SKUs) that more than one worker produced.
//   npm run parallel-demo
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findCollisions, type Collision } from './isolation.ts';
import type { DataType } from './types.ts';

const CLI = fileURLToPath(new URL('./index.ts', import.meta.url));

function runCli(args: string[]): Promise<object[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out) as object[]) : reject(new Error(err || `exit ${code}`))));
  });
}

export interface Measurement {
  type: DataType;
  workers: number;
  records: number;
  withoutRun: Collision[];
  withRun: Collision[];
}

/** `workers` processes start together, all with the same seed. */
export async function measure(type: DataType, { workers = 4, count = 25, seed = 42 } = {}): Promise<Measurement> {
  const names = Array.from({ length: workers }, (_, i) => `worker-${i + 1}`);
  const base = ['--type', type, '--count', String(count), '--seed', String(seed)];
  // The workers of one group start together; the two groups run one after the other.
  const plain = await Promise.all(names.map(() => runCli(base)));
  const tagged = await Promise.all(names.map((name) => runCli([...base, '--run', name])));
  return {
    type, workers, records: workers * count,
    withoutRun: findCollisions(Object.fromEntries(names.map((n, i) => [n, plain[i]!]))),
    withRun: findCollisions(Object.fromEntries(names.map((n, i) => [n, tagged[i]!]))),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('4 workers, 25 records each, the same --seed 42\n');
  console.log('| Type | Records | Collisions without --run | Collisions with --run |');
  console.log('|---|---:|---:|---:|');
  for (const type of ['users', 'orders', 'products'] as const) {
    const m = await measure(type);
    console.log(`| ${type} | ${m.records} | ${m.withoutRun.length} | ${m.withRun.length} |`);
  }
}
