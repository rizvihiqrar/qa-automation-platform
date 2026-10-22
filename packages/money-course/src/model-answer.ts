// The model answer as code: one check per objective, each sending real requests to a
// banking API and saying what it saw. Against the real API every check passes; against a
// copy with that objective's bug planted, exactly that check fails (test/model-answer.test.ts).
// practical/model-answer.md tells the same six checks in words, for the learner.

export interface Outcome {
  ok: boolean;
  seen: string;   // what the API did, in one line
}

export interface Check {
  id: string;     // the objective, and the bug planted for it
  title: string;
  run(base: string): Promise<Outcome>;
}

interface Reply { status: number; body: any; headers: Headers }

async function call(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const open = async (base: string, owner: string, currency: string): Promise<number> => (await call(base, 'POST', '/accounts', { owner, currency })).body.id;
const deposit = (base: string, id: number, amount: string, currency: string) => call(base, 'POST', `/accounts/${id}/deposits`, { amount, currency });
const balance = async (base: string, id: number): Promise<string> => (await call(base, 'GET', `/accounts/${id}`)).body.balance;

export const CHECKS: Check[] = [
  {
    id: 'O1',
    title: 'An amount with more decimals than the currency has is refused',
    async run(base) {
      const id = await open(base, 'Ada', 'CAD');
      const r = await deposit(base, id, '1.005', 'CAD');
      return { ok: r.status === 400 && r.body.code === 'invalid_amount', seen: `deposit of "1.005" CAD answered ${r.status}${r.status === 201 ? `, balance ${await balance(base, id)}` : ''}` };
    },
  },
  {
    id: 'O2',
    title: 'Yen has no decimals: a whole-yen amount is kept as is, and cents are refused',
    async run(base) {
      const id = await open(base, 'Bo', 'JPY');
      const whole = await deposit(base, id, '1250', 'JPY');
      const cents = await deposit(base, id, '100.50', 'JPY');
      const kept = await balance(base, id);
      return { ok: whole.status === 201 && kept === '1250' && cents.status === 400, seen: `"1250" JPY gave balance ${kept}; "100.50" JPY answered ${cents.status}` };
    },
  },
  {
    id: 'O3',
    title: 'A transfer moves exactly the amount: the two balances add up as before',
    async run(base) {
      const a = await open(base, 'Cy', 'CAD');
      const b = await open(base, 'Di', 'CAD');
      await deposit(base, a, '25.00', 'CAD');
      await call(base, 'POST', '/transfers', { from_account_id: a, to_account_id: b, amount: '10.00', currency: 'CAD' });
      const [from, to] = [await balance(base, a), await balance(base, b)];
      return { ok: from === '15.00' && to === '10.00', seen: `after sending 10.00 from 25.00: sender ${from}, receiver ${to}` };
    },
  },
  {
    id: 'O4',
    title: 'The same Idempotency-Key with a different amount is refused, not replayed',
    async run(base) {
      const a = await open(base, 'Ed', 'CAD');
      const b = await open(base, 'Flo', 'CAD');
      await deposit(base, a, '50.00', 'CAD');
      const key = { 'Idempotency-Key': 'course-key-1' };
      const move = (amount: string) => call(base, 'POST', '/transfers', { from_account_id: a, to_account_id: b, amount, currency: 'CAD' }, key);
      await move('5.00');
      const second = await move('6.00');
      return { ok: second.status === 422 && second.body.code === 'idempotency_key_mismatch', seen: `same key, 5.00 then 6.00: second answer ${second.status}${second.headers.get('idempotent-replayed') ? ' (replayed)' : ''}` };
    },
  },
  {
    id: 'O5',
    title: 'Twenty transfers of 10.00 at once from 100.00: exactly ten go through and the balance never goes below zero',
    async run(base) {
      const a = await open(base, 'Gus', 'CAD');
      const b = await open(base, 'Hal', 'CAD');
      await deposit(base, a, '100.00', 'CAD');
      const replies = await Promise.all(Array.from({ length: 20 }, () => call(base, 'POST', '/transfers', { from_account_id: a, to_account_id: b, amount: '10.00', currency: 'CAD' })));
      const passed = replies.filter((r) => r.status === 201).length;
      const left = await balance(base, a);
      return { ok: passed === 10 && !left.startsWith('-'), seen: `${passed} of 20 went through, sender balance ${left}` };
    },
  },
  {
    id: 'O6',
    title: 'A transfer from an account to itself is refused with 422, not a server error',
    async run(base) {
      const a = await open(base, 'Ivy', 'CAD');
      await deposit(base, a, '10.00', 'CAD');
      const r = await call(base, 'POST', '/transfers', { from_account_id: a, to_account_id: a, amount: '1.00', currency: 'CAD' });
      return { ok: r.status === 422 && r.body.code === 'same_account', seen: `transfer to the same account answered ${r.status} ${r.body.code}` };
    },
  },
];
