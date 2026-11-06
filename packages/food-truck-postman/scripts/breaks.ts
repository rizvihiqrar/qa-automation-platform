import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApi } from './api.ts';
import { PLANS, ROOT, runPass } from './newman-run.ts';

// Puts each planted bug into a throwaway copy of the source and checks that the test
// meant to catch it goes red. A green suite says little until it has been seen to fail.
// The real code has no test switches: if a line below stops matching, this fails, so a
// refactor can't quietly turn a planted bug into a no-op.

export interface Break {
  name: string;
  file: string;
  from: string;
  to: string;
  suite: 'postman' | 'node';
  caughtBy: string;
}

export const BREAKS: Break[] = [
  {
    name: 'tax rounded per item instead of per order',
    file: 'money.ts',
    from: 'const tax_cents = taxOn(subtotal_cents + delivery_fee_cents);',
    to: 'const tax_cents = lines.reduce((sum, line) => sum + line.quantity * taxOn(line.unit_price_cents), 0) + taxOn(delivery_fee_cents);',
    suite: 'postman',
    caughtBy: 'Tax is rounded once per order, not per item',
  },
  {
    name: 'a declined card still marks the order paid',
    file: 'shop.ts',
    from: "if (result.outcome === 'declined') return [402,",
    to: "if (result.outcome === 'declined') order.status = 'paid';\n    if (result.outcome === 'declined') return [402,",
    suite: 'postman',
    caughtBy: 'Declined order is still unpaid',
  },
  {
    name: 'the same Idempotency-Key is treated as a new payment',
    file: 'shop.ts',
    from: 'const earlier = this.remembered.get(scoped);',
    to: 'const earlier = undefined as Remembered | undefined;',
    suite: 'postman',
    caughtBy: 'Same key and body returns the first result',
  },
  {
    name: 'a refund over the paid total is accepted',
    file: 'shop.ts',
    from: "if (amount_cents > refundable || refundable === 0) throw new HttpError(422, 'refund_exceeds_paid', `only ${refundable} cents can still be refunded`, { refundable_cents: refundable });",
    to: '',
    suite: 'postman',
    caughtBy: 'Refund more than is left',
  },
  {
    name: "a customer reads another customer's order",
    file: 'shop.ts',
    from: "if (!order || (user.role !== 'staff' && order.customer_id !== user.id))",
    to: 'if (!order)',
    suite: 'postman',
    caughtBy: 'Another customer cannot read it',
  },
  {
    name: 'cancel allowed after preparing',
    file: 'status.ts',
    from: "case 'preparing': return ['ready'];",
    to: "case 'preparing': return ['ready', 'cancelled'];",
    suite: 'postman',
    caughtBy: 'Cancel after preparing has started',
  },
  {
    name: 'a sold-out item can be ordered',
    file: 'shop.ts',
    from: "if (item.sold_out) throw new HttpError(409, 'sold_out', `${item.name} is sold out`);",
    to: '',
    suite: 'postman',
    caughtBy: 'Order a sold-out item',
  },
  {
    name: 'an order shows a field the schema does not know',
    file: 'app.ts',
    from: 'function view({ driver_steps: _steps, ...order }: Order): Omit<Order, \'driver_steps\'> {\n  return order;',
    to: 'function view(order: Order): Order {\n  return order;',
    suite: 'postman',
    caughtBy: 'Create an order',
  },
  {
    name: 'the second charge is kept when the provider charges twice',
    file: 'shop.ts',
    from: 'for (const charge of extra) this.provider.void(charge);',
    to: '',
    suite: 'node',
    caughtBy: 'the provider charges twice: one charge stays, the other is voided',
  },
];

const MAX_NODE_FAILURES = 3;

function plant(item: Break, dir: string): void {
  const file = join(dir, 'src', item.file);
  const source = readFileSync(file, 'utf8');
  if (!source.includes(item.from)) throw new Error(`"${item.name}": the line to change is gone from src/${item.file}`);
  writeFileSync(file, source.replace(item.from, item.to));
}

// A request that got no answer means the planted API died, which proves nothing about
// the test, and the time limit isn't what the named test is there for.
async function postmanFailures(dir: string): Promise<string[]> {
  const api = await startApi(join(dir, 'src'));
  try {
    const [everyFolder] = PLANS.all!;
    const { failed, requestErrors } = await runPass(everyFolder!, api.baseUrl, { quiet: true });
    if (requestErrors > 0) throw new Error(`${requestErrors} requests got no answer: the planted API stopped`);
    return failed.filter((failure) => !failure.endsWith(': finishes within the time limit'));
  } finally {
    api.stop();
  }
}

// The planted copy runs the same test file from a folder of its own.
function nodeFailures(dir: string): string[] {
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/payments.test.ts'], { cwd: dir, encoding: 'utf8' });
  return [...run.stdout.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => `${match[1]}`);
}

// Postman failures read "request: test", and a node failure is the test's own name.
const isNamedCheck = (failure: string, item: Break): boolean => (item.suite === 'postman' ? failure.startsWith(`${item.caughtBy}: `) : failure === item.caughtBy);

async function run(): Promise<void> {
  let missed = 0;
  for (const item of BREAKS) {
    const dir = mkdtempSync(join(tmpdir(), 'food-truck-break-'));
    try {
      for (const part of ['src', 'test', 'package.json']) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
      plant(item, dir);
      const failures = item.suite === 'postman' ? await postmanFailures(dir) : nodeFailures(dir);
      // One planted bug should turn a few tests red. All of them red means the suite broke.
      const caught = failures.some((failure) => isNamedCheck(failure, item)) && (item.suite === 'postman' || failures.length <= MAX_NODE_FAILURES);
      console.log(`${caught ? 'caught' : 'MISSED'}: ${item.name} (${failures.length} failed, ${item.suite}: ${item.caughtBy})`);
      if (!caught) missed += 1;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(`${BREAKS.length - missed} of ${BREAKS.length} planted bugs caught`);
  if (missed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
