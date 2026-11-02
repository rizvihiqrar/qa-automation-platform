import { test, expect } from '@playwright/test';
import pg from 'pg';
import { makeProduct, signUp } from '../design/helpers.ts';
import { newTrace, spansOf, children, only, SERVER, type FlatSpan } from '../telemetry.ts';

// Only on Postgres (like postgres.spec.ts). tests/telemetry.spec.ts checks the
// spans both stores make; these check what only Postgres has: a span for each SQL
// statement, and a row lock that really waits.

const DATABASE_URL = process.env.DATABASE_URL!;

const sqlSpans = (spans: FlatSpan[], parent: FlatSpan) =>
  children(spans, parent).filter((s) => s.attributes['db.system.name'] === 'postgresql');

test.describe('Postgres traces', () => {
  test('PG-09 an order\'s transaction shows BEGIN, a SELECT ... FOR UPDATE inside each lock, and COMMIT, with no values in the SQL @regression', async ({ request }) => {
    const product = await makeProduct(request, { price: 7.25 });
    const buyer = await signUp(request);
    const { traceId, headers } = newTrace();
    const res = await request.post('/orders', {
      headers: { ...buyer.auth, ...headers }, data: { items: [{ product_id: product.id, quantity: 2 }] },
    });
    expect(res.status()).toBe(201);

    const spans = await spansOf(traceId);
    const create = only(children(spans, spans.find((s) => s.kind === SERVER)!), 'order.create');
    const tx = only(children(spans, create), 'db.transaction');
    const statements = sqlSpans(spans, tx).map((s) => s.name);
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements).toContain('INSERT');
    expect(statements).toContain('UPDATE');

    const lock = only(children(spans, tx), 'db.lock');
    const [select] = sqlSpans(spans, lock);
    expect(select?.attributes['db.query.text']).toMatch(/WHERE t\.id = \$1 FOR UPDATE OF t$/);

    // Values travel apart from the SQL ($1, $2), so no price, quantity, id or email
    // is in it: once the placeholders and findOne's LIMIT 1 are taken out, no digit is left.
    const sql = spans.map((s) => String(s.attributes['db.query.text'] ?? '')).join('\n');
    expect(sql).toMatch(/VALUES \(\$1, \$2/);
    expect(sql.replace(/\$\d+/g, '').replace(/LIMIT 1\b/g, '').match(/.*\d.*/g)).toBeNull();
    expect(sql).not.toContain(buyer.email);
  });

  test('PG-10 the lock span lasts as long as the order waited for a row another transaction held @regression', async ({ request }) => {
    const product = await makeProduct(request, { stock: 5 });
    const buyer = await signUp(request);
    // This test's own transaction takes the product row first and holds it.
    const holder = new pg.Client({ connectionString: DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [product.id]);
      const { rows: [{ pid }] } = await holder.query('SELECT pg_backend_pid() AS pid');

      const { traceId, headers } = newTrace();
      const placing = request.post('/orders', {
        headers: { ...buyer.auth, ...headers }, data: { items: [{ product_id: product.id, quantity: 1 }] },
      });
      // Wait until Postgres says the order is blocked by this transaction, then hold
      // the row 400 ms longer. The order's wait is then at least 400 ms, however
      // slow the machine is.
      await expect.poll(async () => {
        const { rows } = await holder.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid]);
        return rows[0].n;
      }, { timeout: 10_000 }).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await holder.query('COMMIT');

      expect((await placing).status()).toBe(201);
      const spans = await spansOf(traceId);
      const lock = only(spans, 'db.lock');
      expect(lock.attributes['qa.row.id']).toBe(String(product.id));
      expect(lock.durationMs).toBeGreaterThanOrEqual(400);
      // The wait is the SELECT ... FOR UPDATE inside the lock span, not the rest of the order.
      const [select] = sqlSpans(spans, lock);
      expect(select!.durationMs).toBeGreaterThanOrEqual(400);
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      await holder.end();
    }
  });
});
