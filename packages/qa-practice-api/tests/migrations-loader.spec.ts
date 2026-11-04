import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadMigrations, MigrationError } from '../src/db/migrate.ts';

// The migration folder is checked before any database is touched (src/db/migrate.ts), so a
// bad file stops the start-up with a message that names it. No database needed here; the
// runner itself is tested on Postgres in tests/postgres/migrations.spec.ts.

function folder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const ok = (body = 'SELECT 1;') => `-- up\n${body}\n-- down\nSELECT 2;\n`;

test.describe('migration files', () => {
  test('MG-01 the migrations that ship load: versions count up from 1 in order, each with an up and a down part @regression', () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    migrations.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.up).not.toBe('');
      expect(m.down).not.toBe('');
    });
  });

  test('MG-02 files are read in version order whatever order they were made in, and a Windows line ending changes nothing @regression', () => {
    const dir = folder({ '002_second.sql': ok('SELECT 22;').replace(/\n/g, '\r\n'), '001_first.sql': ok('SELECT 11;') });
    const migrations = loadMigrations(dir);
    expect(migrations.map((m) => [m.version, m.name, m.up, m.down])).toEqual([
      [1, 'first', 'SELECT 11;', 'SELECT 2;'],
      [2, 'second', 'SELECT 22;', 'SELECT 2;'],
    ]);
  });

  test('MG-03 a gap in the numbering is refused, and the message names the version that is missing @regression', () => {
    const dir = folder({ '001_a.sql': ok(), '003_c.sql': ok() });
    expect(() => loadMigrations(dir)).toThrow(/expected 2, found 3/);
  });

  test('MG-04 two files with the same version are refused @regression', () => {
    const dir = folder({ '001_a.sql': ok(), '001_b.sql': ok() });
    expect(() => loadMigrations(dir)).toThrow(/version 1 is used twice/);
  });

  test('MG-05 numbering that does not start at 1 is refused @regression', () => {
    expect(() => loadMigrations(folder({ '002_b.sql': ok() }))).toThrow(/expected 1, found 2/);
  });

  test('MG-06 a file without a down part is refused, so no migration can be applied that cannot be undone @regression', () => {
    const dir = folder({ '001_a.sql': '-- up\nSELECT 1;\n' });
    expect(() => loadMigrations(dir)).toThrow(/001_a\.sql: needs one "-- up" part followed by one "-- down" part/);
  });

  test('MG-07 a down part written before the up part is refused @regression', () => {
    const dir = folder({ '001_a.sql': '-- down\nSELECT 2;\n-- up\nSELECT 1;\n' });
    expect(() => loadMigrations(dir)).toThrow(MigrationError);
  });

  test('MG-08 an empty up or down part is refused @regression', () => {
    expect(() => loadMigrations(folder({ '001_a.sql': '-- up\n-- down\nSELECT 2;\n' }))).toThrow(/must not be empty/);
    expect(() => loadMigrations(folder({ '001_a.sql': '-- up\nSELECT 1;\n-- down\n' }))).toThrow(/must not be empty/);
  });

  test('MG-09 a file that is not named like 001_name.sql is refused @regression', () => {
    expect(() => loadMigrations(folder({ 'init.sql': ok() }))).toThrow(/init\.sql: a migration file is named like 001_name\.sql/);
    expect(() => loadMigrations(folder({ '1_init.sql': ok() }))).toThrow(MigrationError);
  });

  test('MG-10 files that are not .sql are ignored @regression', () => {
    expect(loadMigrations(folder({ '001_a.sql': ok(), 'README.md': 'notes' }))).toHaveLength(1);
  });
});
