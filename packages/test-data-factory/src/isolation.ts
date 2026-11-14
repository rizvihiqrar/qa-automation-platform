// A114: test data for parallel runs. Several workers started with the same --seed produce the
// same records, so two workers insert the same id, email or username and one of them fails (or,
// worse, reads the other's rows). `--run <name>` gives each worker its own data:
//   - the seed is mixed with the run name, so every run is different and each is still reproducible;
//   - the keys that must be unique are stamped with a code made from the run name, so two runs with
//     different names do not share one, whatever the random numbers did. Short of a hash collision:
//     the code is 32 bits (about 1 in 4 billion for two names) and, for a SKU, 4 characters (1 in 1.7 million).
// findCollisions is the check: it lists every key value that appears in more than one run.

/** 32-bit FNV-1a: small, fixed, the same on every machine. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// At most 16 characters, so a stamped email and username stay a sensible length.
const RUN_NAME = /^[a-z0-9][a-z0-9-]{0,15}$/;

export function checkRunName(run: string): string {
  if (!RUN_NAME.test(run)) throw new Error(`--run must be 1 to 16 characters: lower-case letters, digits and dashes, got "${run}"`);
  return run;
}

/** The seed a run uses: the shared seed mixed with the run name. */
export function runSeed(seed: number, run: string): number {
  return hash32(`${seed}:${run}`);
}

/** Eight hex characters that stand for the run name. */
export const runCode = (run: string): string => hash32(`run:${run}`).toString(16).padStart(8, '0');

/** A key that must be unique, and the way each one is stamped with the run. */
const STAMPS: Record<string, (value: string, run: string) => string> = {
  id: (v, run) => runCode(run) + v.slice(8),                        // uuid: the first block is the run code
  orderId: (v, run) => runCode(run) + v.slice(8),
  userId: (v, run) => runCode(run) + v.slice(8),
  email: (v, run) => v.replace('@', `.${run}@`),
  username: (v, run) => `${v}.${run}`,
  sku: (v, run) => runCode(run).slice(0, 4).toUpperCase() + v.slice(4), // 8 characters stay 8
};
export const KEY_FIELDS = Object.keys(STAMPS);

export function stampRun<T extends object>(records: readonly T[], run: string): T[] {
  return records.map((record) => {
    const copy: Record<string, unknown> = { ...(record as Record<string, unknown>) };
    for (const [field, stamp] of Object.entries(STAMPS)) {
      if (typeof copy[field] === 'string') copy[field] = stamp(copy[field] as string, run);
    }
    return copy as T;
  });
}

export interface Collision {
  field: string;
  value: string;
  runs: string[];
}

/** Every key value found in more than one run. Repeats inside one run are not collisions between runs. */
export function findCollisions(runs: Record<string, readonly object[]>): Collision[] {
  const seen = new Map<string, Set<string>>();
  for (const [run, records] of Object.entries(runs)) {
    for (const record of records) {
      for (const field of KEY_FIELDS) {
        const value = (record as Record<string, unknown>)[field];
        if (typeof value !== 'string') continue;
        const key = `${field}\u0000${value}`;
        (seen.get(key) ?? seen.set(key, new Set()).get(key)!).add(run);
      }
    }
  }
  return [...seen].filter(([, owners]) => owners.size > 1).map(([key, owners]) => {
    const [field, value] = key.split('\u0000') as [string, string];
    return { field, value, runs: [...owners].sort() };
  });
}
