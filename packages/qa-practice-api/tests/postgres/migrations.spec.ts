import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import pg from 'pg';
import { loadMigrations, migrateUp, migrateDown, appliedVersions, MigrationError, MIGRATIONS_DIR } from '../../src/db/migrate.ts';

// Only on Postgres (npm run test:postgres). The migration runner against a real database: each
// test makes a database of its own on the same server and drops it afterwards, so the tests
// run side by side and never touch the data the API tests use.

const ADMIN_URL = process.env.DATABASE_URL!;
const FIXTURES = path.join(import.meta.dirname, 'migrations-fixtures');

async function withDatabase(work: (db: pg.Client, url: string) => Promise<void>): Promise<void> {
  const name = `mig_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await work(db, url.toString());
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}

// The real 001 plus one fixture as 002.
function migrationsWith(fixture: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(dir, '001_init.sql'));
  fs.copyFileSync(path.join(FIXTURES, fixture), path.join(dir, fixture.replace(/^\d+_/, '002_')));
  return loadMigrations(dir);
}

const columns = async (db: pg.Client, table?: string) => (await db.query(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ${table ? 'AND table_name = $1' : ''}
   ORDER BY table_name, ordinal_position`, table ? [table] : [],
)).rows.map((r) => `${r.table_name}.${r.column_name}`);

const snapshot = async (db: pg.Client) => (await db.query(
  `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY table_name, ordinal_position`,
)).rows.map((r) => `${r.table_name}.${r.column_name} ${r.data_type}${r.is_nullable === 'YES' ? ' null' : ''}`);

const tables = async (db: pg.Client) => (await db.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
)).rows.map((r) => r.table_name);

const EXPECTED_SCHEMA = [
  'discounts.id integer', 'discounts.created_at timestamp with time zone', 'discounts.code text', 'discounts.type text',
  'discounts.value numeric', 'discounts.expires_at text null', 'discounts.max_uses numeric null', 'discounts.min_subtotal numeric',
  'discounts.active boolean',
  'order_items.order_id integer', 'order_items.position integer', 'order_items.product_id integer', 'order_items.name text',
  'order_items.price numeric', 'order_items.quantity numeric',
  'orders.id integer', 'orders.created_at timestamp with time zone', 'orders.user_id integer', 'orders.status text',
  'orders.subtotal numeric', 'orders.discount_code text null', 'orders.discount numeric', 'orders.total numeric',
  'products.id integer', 'products.created_at timestamp with time zone', 'products.name text', 'products.category text',
  'products.price numeric', 'products.stock numeric',
  'users.id integer', 'users.created_at timestamp with time zone', 'users.name text', 'users.email text',
  'users.password text', 'users.role text',
];

const insertProduct = (db: pg.Client, name = 'Pen') => db.query(
  `INSERT INTO products (name, category, price, stock) VALUES ($1, 'office', 2.5, 10)`, [name],
);

test.describe('migrations on Postgres', () => {
  test('MG-11 on an empty database the migrations run in order and each version is recorded with its name @regression', async () => {
    await withDatabase(async (db) => {
      expect(await migrateUp(db)).toEqual([1]);
      const { rows } = await db.query('SELECT version, name FROM schema_migrations ORDER BY version');
      expect(rows).toEqual([{ version: 1, name: 'init' }]);
    });
  });

  test('MG-12 the schema the migrations build is exactly the one the API was written against: every table, column, type and null rule @regression', async () => {
    await withDatabase(async (db) => {
      await migrateUp(db);
      expect(await snapshot(db)).toEqual(EXPECTED_SCHEMA);
    });
  });

  test('MG-13 the rules in the schema hold after migrating: no negative stock, no second account with an email @regression', async () => {
    await withDatabase(async (db) => {
      await migrateUp(db);
      await expect(db.query(`INSERT INTO products (name, category, price, stock) VALUES ('x', 'y', 1, -1)`)).rejects.toMatchObject({ code: '23514' });
      const user = `INSERT INTO users (name, email, password, role) VALUES ('a', 'a@example.com', 'x', 'user')`;
      await db.query(user);
      await expect(db.query(user)).rejects.toMatchObject({ code: '23505' });
    });
  });

  test('MG-14 running the migrations again changes nothing: no version applied twice, the first applied_at kept @regression', async () => {
    await withDatabase(async (db) => {
      await migrateUp(db);
      const before = (await db.query('SELECT version, applied_at FROM schema_migrations')).rows;
      expect(await migrateUp(db)).toEqual([]);
      expect((await db.query('SELECT version, applied_at FROM schema_migrations')).rows).toEqual(before);
    });
  });

  test('MG-15 down to 0 removes every table and every recorded version @regression', async () => {
    await withDatabase(async (db) => {
      await migrateUp(db);
      expect(await migrateDown(db)).toEqual([1]);
      expect(await tables(db)).toEqual(['schema_migrations']);
      expect(await appliedVersions(db)).toEqual([]);
    });
  });

  test('MG-16 up, down, up gives the same schema as up once @regression', async () => {
    await withDatabase(async (db) => {
      await migrateUp(db);
      const first = await snapshot(db);
      await migrateDown(db);
      await migrateUp(db);
      expect(await snapshot(db)).toEqual(first);
    });
  });

  test('MG-17 a database made by the server from before migrations existed keeps its rows and only gets its version recorded @regression', async () => {
    await withDatabase(async (db) => {
      // What the old server did: the tables, no schema_migrations.
      await db.query(loadMigrations()[0]!.up);
      await insertProduct(db, 'Old pen');
      expect(await tables(db)).not.toContain('schema_migrations');
      expect(await migrateUp(db)).toEqual([1]);
      expect((await db.query('SELECT name FROM products')).rows).toEqual([{ name: 'Old pen' }]);
      expect(await appliedVersions(db)).toEqual([1]);
    });
  });

  test('MG-18 an upgrade from version 1 to 2 keeps the rows and fills the new column; going back removes the column, not the rows @regression', async () => {
    await withDatabase(async (db) => {
      const migrations = migrationsWith('002_add_sku.sql');
      await migrateUp(db, migrations, 1);
      await insertProduct(db);
      expect(await columns(db, 'products')).not.toContain('products.sku');
      expect(await migrateUp(db, migrations)).toEqual([2]);
      expect((await db.query('SELECT name, sku FROM products')).rows).toEqual([{ name: 'Pen', sku: 'P1' }]);
      expect(await migrateDown(db, migrations, 1)).toEqual([2]);
      expect(await columns(db, 'products')).not.toContain('products.sku');
      expect((await db.query('SELECT name FROM products')).rows).toEqual([{ name: 'Pen' }]);
    });
  });

  test('MG-19 a migration that fails halfway is rolled back whole: no new column, no recorded version, the error names the version @regression', async () => {
    await withDatabase(async (db) => {
      const migrations = migrationsWith('002_failing_up.sql');
      const error = await migrateUp(db, migrations).catch((e) => e);
      expect(error).toBeInstanceOf(MigrationError);
      expect(error.version).toBe(2);
      expect(error.message).toMatch(/migration 2 failed and was rolled back/);
      expect(await columns(db, 'products')).not.toContain('products.sku');
      expect(await appliedVersions(db)).toEqual([1]);
    });
  });

  test('MG-20 a down part that fails halfway is rolled back whole: the column and the recorded version stay @regression', async () => {
    await withDatabase(async (db) => {
      const migrations = migrationsWith('002_failing_down.sql');
      await migrateUp(db, migrations);
      await expect(migrateDown(db, migrations, 1)).rejects.toMatchObject({ version: 2 });
      expect(await columns(db, 'products')).toContain('products.sku');
      expect(await appliedVersions(db)).toEqual([1, 2]);
    });
  });

  test('MG-25 the change and the row that records it stand or fall together: when recording the version fails, the change is undone too @regression', async () => {
    await withDatabase(async (db) => {
      const migrations = migrationsWith('002_records_itself.sql');
      await expect(migrateUp(db, migrations)).rejects.toMatchObject({ version: 2 });
      expect(await columns(db, 'products')).not.toContain('products.sku');
      expect(await appliedVersions(db)).toEqual([1]);
    });
  });

  test('MG-21 two servers starting at the same moment on an empty database both come up, and each version is applied once @regression', async () => {
    await withDatabase(async (db, url) => {
      const other = new pg.Client({ connectionString: url });
      await other.connect();
      try {
        const results = await Promise.all([migrateUp(db), migrateUp(other)]);
        expect(results.flat()).toEqual([1]); // one applied it, the other found nothing left
        expect(await appliedVersions(db)).toEqual([1]);
      } finally {
        await other.end();
      }
    });
  });

  test('MG-22 a server older than the database refuses to start and changes nothing @regression', async () => {
    await withDatabase(async (db) => {
      const migrations = migrationsWith('002_add_sku.sql');
      await migrateUp(db, migrations);
      const error = await migrateUp(db, loadMigrations()).catch((e) => e);
      expect(error).toBeInstanceOf(MigrationError);
      expect(error.message).toMatch(/migration 2, which this server does not know/);
      expect(await appliedVersions(db)).toEqual([1, 2]);
      expect(await columns(db, 'products')).toContain('products.sku');
    });
  });

  test('MG-23 a target stops the run: up to version 1 leaves 2 for later @regression', async () => {
    await withDatabase(async (db) => {
      const migrations = migrationsWith('002_add_sku.sql');
      expect(await migrateUp(db, migrations, 1)).toEqual([1]);
      expect(await appliedVersions(db)).toEqual([1]);
    });
  });

  test('MG-24 the server applied the migrations when it started: the database the API tests use has version 1 recorded @regression', async () => {
    const db = new pg.Client({ connectionString: ADMIN_URL });
    await db.connect();
    try {
      expect(await appliedVersions(db)).toEqual(loadMigrations().map((m) => m.version));
    } finally {
      await db.end();
    }
  });
});
