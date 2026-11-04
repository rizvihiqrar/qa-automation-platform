// Versioned schema migrations for the Postgres store. A migration is a file named
// 001_name.sql in a folder, with an "-- up" part and a "-- down" part. The versions applied
// are recorded in schema_migrations, so a start-up only runs what is new.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

// Anything with query(): a pg.Client or a pooled connection.
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export class MigrationError extends Error {
  version?: number;

  constructor(message: string, version?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationError';
    this.version = version;
  }
}

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Same number the schema set-up always used, so two servers starting together take turns.
const LOCK = 49;

// Reads the folder and checks it before anything touches a database: versions start at 1
// and have no gaps or repeats, and every file has both parts.
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((file): Migration => {
    const match = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!match) throw new MigrationError(`${file}: a migration file is named like 001_name.sql`);
    const version = Number(match[1]);
    const parts = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').split(/^-- (up|down)[ \t]*$/m);
    // parts: [text before, 'up', up text, 'down', down text]; the order is fixed.
    if (parts.length !== 5 || parts[1] !== 'up' || parts[3] !== 'down') {
      throw new MigrationError(`${file}: needs one "-- up" part followed by one "-- down" part`, version);
    }
    const [up, down] = [parts[2]!.trim(), parts[4]!.trim()];
    if (!up || !down) throw new MigrationError(`${file}: the up and down parts must not be empty`, version);
    return { version, name: match[2]!, up, down };
  });
  migrations.forEach((m, i) => {
    if (m.version === (migrations[i - 1]?.version ?? 0)) throw new MigrationError(`version ${m.version} is used twice`, m.version);
    if (m.version !== i + 1) throw new MigrationError(`versions must run 1, 2, 3 without gaps: expected ${i + 1}, found ${m.version}`, m.version);
  });
  return migrations;
}

const ensureTable = (db: Queryable) => db.query(
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     version    integer PRIMARY KEY,
     name       text NOT NULL,
     applied_at timestamptz NOT NULL DEFAULT now()
   )`,
);

export async function appliedVersions(db: Queryable): Promise<number[]> {
  await ensureTable(db);
  return (await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map((r) => r.version);
}

// One migration and its bookkeeping row are one transaction: a step that fails halfway
// leaves neither its changes nor its row behind.
async function inTransaction(db: Queryable, version: number, work: () => Promise<void>): Promise<void> {
  await db.query('BEGIN');
  try {
    await work();
    await db.query('COMMIT');
  } catch (err) {
    // A ROLLBACK that fails too (the line broke) must not hide why the step failed.
    await db.query('ROLLBACK').catch(() => undefined);
    throw new MigrationError(`migration ${version} failed and was rolled back: ${(err as Error).message}`, version, { cause: err });
  }
}

// One runner at a time (a second waits here, then finds nothing left to do).
async function exclusive<T>(db: Queryable, work: () => Promise<T>): Promise<T> {
  await db.query('SELECT pg_advisory_lock($1)', [LOCK]);
  let result: T;
  try {
    result = await work();
  } catch (err) {
    // The step's own error matters more than an unlock that fails on a broken line.
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => undefined);
    throw err;
  }
  await db.query('SELECT pg_advisory_unlock($1)', [LOCK]);
  return result;
}

// Applies every migration not yet recorded, in order, up to `target` (default: the newest).
export function migrateUp(db: Queryable, migrations: Migration[] = loadMigrations(), target: number = migrations.length): Promise<number[]> {
  return exclusive(db, async () => {
    const done = new Set(await appliedVersions(db));
    const unknown = [...done].filter((v) => !migrations.some((m) => m.version === v));
    if (unknown.length) throw new MigrationError(`the database has migration ${unknown[0]}, which this server does not know: it is older than the database`, unknown[0]);
    const applied: number[] = [];
    for (const m of migrations) {
      if (m.version > target || done.has(m.version)) continue;
      await inTransaction(db, m.version, async () => {
        await db.query(m.up);
        await db.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name]);
      });
      applied.push(m.version);
    }
    return applied;
  });
}

// Undoes the newest applied migrations, newest first, until `target` is the newest left
// (0 removes them all). The down part can destroy data, such as a dropped table.
export function migrateDown(db: Queryable, migrations: Migration[] = loadMigrations(), target: number = 0): Promise<number[]> {
  return exclusive(db, async () => {
    const done = await appliedVersions(db);
    const undone: number[] = [];
    for (const version of done.filter((v) => v > target).reverse()) {
      const m = migrations.find((x) => x.version === version);
      if (!m) throw new MigrationError(`migration ${version} is applied but has no file to undo it`, version);
      await inTransaction(db, version, async () => {
        await db.query(m.down);
        await db.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      });
      undone.push(version);
    }
    return undone;
  });
}
