import { test, expect } from '@playwright/test';
import { migrateUp, migrateDown, MigrationError, type Migration, type Queryable } from '../src/db/migrate.ts';

// The runner on a connection that breaks (src/db/migrate.ts). A real database can't be made to
// fail on cue, so these use a stand-in connection that answers every query with no rows and
// throws for the ones a test names. The point is which error the caller gets back: the step's own.

const step: Migration = { version: 1, name: 'init', up: 'CREATE TABLE a (id int)', down: 'DROP TABLE a' };

function connection(failing: Record<string, string>): Queryable & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async query(text: string) {
      sent.push(text.split(/\s/, 1)[0]!);
      for (const [start, message] of Object.entries(failing)) {
        if (text.startsWith(start)) throw new Error(message);
      }
      return { rows: [] };
    },
  };
}

test.describe('the runner on a connection that breaks', () => {
  test('MG-26 when the step fails and the ROLLBACK fails too, the error is still the step\'s, with its version and cause @regression', async () => {
    const db = connection({ 'CREATE TABLE a': 'the step failed', ROLLBACK: 'the line broke' });
    const error = await migrateUp(db, [step]).catch((e) => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect(error.version).toBe(1);
    expect(error.message).toContain('the step failed');
    expect(error.message).not.toContain('the line broke');
    expect((error.cause as Error).message).toBe('the step failed');
  });

  test('MG-27 when the step fails and the unlock fails too, the error is still the step\'s @regression', async () => {
    const db = connection({ 'CREATE TABLE a': 'the step failed', 'SELECT pg_advisory_unlock': 'the line broke' });
    const error = await migrateUp(db, [step]).catch((e) => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect(error.message).toContain('the step failed');
  });

  test('MG-28 the same holds going down @regression', async () => {
    const db = connection({ 'DROP TABLE a': 'the step failed', ROLLBACK: 'the line broke', 'SELECT pg_advisory_unlock': 'also broke' });
    // Pretend version 1 is applied: the stand-in answers the list of versions with one row.
    const query = db.query.bind(db);
    db.query = async (text: string, values?: unknown[]) => (text.startsWith('SELECT version') ? { rows: [{ version: 1 }] } : query(text, values));
    const error = await migrateDown(db, [step]).catch((e) => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect(error.message).toContain('the step failed');
  });

  test('MG-29 a step that works is committed and the lock is let go, in that order @regression', async () => {
    const db = connection({});
    expect(await migrateUp(db, [step])).toEqual([1]);
    expect(db.sent.filter((w) => ['SELECT', 'BEGIN', 'COMMIT', 'INSERT', 'CREATE'].includes(w))).toEqual([
      'SELECT', // take the lock
      'CREATE', // schema_migrations, if missing
      'SELECT', // the applied versions
      'BEGIN', 'CREATE', 'INSERT', 'COMMIT', // CREATE is the step; the version row is written before COMMIT
      'SELECT', // let the lock go
    ]);
  });
});
