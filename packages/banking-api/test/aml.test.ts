import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Ledger } from '../src/ledger.ts';
import { CASH_REPORT_THRESHOLD, CURRENCIES, DEMO_RATE_E4, type Currency } from '../src/money.ts';
import { matchName, normalize, NEAR_MIN_LENGTH } from '../src/sanctions.ts';
import { startApi, startServers, type Api, type Reply } from './helpers.ts';

// Anti-money-laundering rules on the screening step (BK-R42 to BK-R45): a report for
// large cash, the 24-hour rule, a sanctions list and the audit record. Each title starts
// with the rules it checks. Every name here is invented.

const T0 = Date.parse('2026-11-23T12:00:00.000Z');
let clock = new Date(T0).toISOString();
const at = (ms: number) => { clock = new Date(T0 + ms).toISOString(); };
const HOUR = 60 * 60 * 1000;

const api = await startApi({ now: () => clock, aml: true });

const deposit = (id: number, amount: string, currency = 'CAD', target: Api = api) => target.post(`/accounts/${id}/deposits`, { amount, currency });
const withdraw = (id: number, amount: string, currency = 'CAD') => api.post(`/accounts/${id}/withdrawals`, { amount, currency });
const transfer = (from: number, to: number, amount: string, currency = 'CAD') =>
  api.post('/transfers', { from_account_id: from, to_account_id: to, amount, currency });
const rows = async () => (await api.get('/screening-decisions')).body.decisions as any[];
const last = async () => (await rows()).at(-1);
const transfersCount = () => Number((api.ledger.db.prepare('SELECT COUNT(*) AS n FROM transfers').get() as { n: number }).n);

function held(reply: Reply) {
  assert.equal(reply.status, 422, JSON.stringify(reply.body));
  assert.equal(reply.body.code, 'screening_hold');
}

describe('large cash is reported', () => {
  test('BK-R42 a CAD deposit of 9,999.99 is allowed with no report, and 10,000.00 is reported, and the money moves', async () => {
    const id = await api.openAccount('CAD');
    assert.equal((await deposit(id, '9999.99')).status, 201);
    assert.equal((await last()).decision, 'allowed');
    assert.equal((await last()).rule, null);
    const big = await deposit(await api.openAccount('CAD'), '10000.00');
    assert.equal(big.status, 201, JSON.stringify(big.body));
    const row = await last();
    assert.equal(row.decision, 'reported');
    assert.equal(row.rule, 'large_cash');
    assert.equal((await api.get(`/accounts/${big.body.to_account_id}`)).body.balance, '10000.00');
  });

  test('BK-R42 a deposit over 10,000 is reported', async () => {
    assert.equal((await deposit(await api.openAccount('CAD'), '10000.01')).status, 201);
    assert.equal((await last()).rule, 'large_cash');
  });

  for (const [currency, below, exact] of [
    ['CAD', '9999.99', '10000.00'],
    ['USD', '7299.27', '7299.28'],
    ['JPY', '1086956', '1086957'],
    ['KWD', '2247.191', '2247.192'],
  ] as const) {
    test(`BK-R42 in ${currency} the report starts at ${exact}, not at ${below}`, async () => {
      assert.equal((await deposit(await api.openAccount(currency), below, currency)).status, 201);
      assert.equal((await last()).decision, 'allowed');
      assert.equal((await deposit(await api.openAccount(currency), exact, currency)).status, 201);
      assert.equal((await last()).decision, 'reported');
      assert.equal((await last()).rule, 'large_cash');
    });
  }

  test('BK-R42 each threshold is the smallest amount worth CAD 10,000 at the demo rates: it is worth that, and one minor unit less is not', () => {
    for (const currency of Object.keys(CURRENCIES) as Currency[]) {
      const need = 10n ** 8n * 10n ** BigInt(CURRENCIES[currency]); // CAD 10,000 in the rate's ten-thousandths of a minor unit
      const threshold = CASH_REPORT_THRESHOLD[currency];
      assert.ok(threshold * DEMO_RATE_E4[currency] >= need, `${currency}: the threshold is worth less than CAD 10,000`);
      assert.ok((threshold - 1n) * DEMO_RATE_E4[currency] < need, `${currency}: one unit less is already worth CAD 10,000`);
    }
    assert.deepEqual(CASH_REPORT_THRESHOLD, { CAD: 1_000_000n, USD: 729_928n, JPY: 1_086_957n, KWD: 2_247_192n });
  });

  test('BK-R42 a cash withdrawal of 10,000.00 is reported', async () => {
    const id = await api.openAccount('CAD');
    for (let i = 0; i < 2; i++) assert.equal((await deposit(id, '9000.00')).status, 201); // 24-hour reports; not what is tested
    const reply = await withdraw(id, '10000.00');
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    const row = await last();
    assert.equal(row.kind, 'withdrawal');
    assert.equal(row.rule, 'large_cash');
  });

  test('BK-R42 a transfer between customers is not cash: 10,000.00 is allowed with no report', async () => {
    const from = await api.openAccount('CAD');
    await deposit(from, '9000.00');
    await deposit(from, '9000.00');
    const to = await api.openAccount('CAD');
    assert.equal((await transfer(from, to, '10000.00')).status, 201);
    assert.equal((await last()).decision, 'allowed');
  });
});

describe('the 24-hour rule', () => {
  test('BK-R43 three deposits of 4,000.00 in a day: the third takes the total to 12,000.00 and is reported, the first two are not', async () => {
    const id = await api.openAccount('CAD');
    at(0);
    await deposit(id, '4000.00');
    assert.equal((await last()).decision, 'allowed');
    at(HOUR);
    await deposit(id, '4000.00');
    assert.equal((await last()).decision, 'allowed');
    at(2 * HOUR);
    assert.equal((await deposit(id, '4000.00')).status, 201);
    const row = await last();
    assert.equal(row.decision, 'reported');
    assert.equal(row.rule, '24_hour');
  });

  test('BK-R43 the day is the 24 hours before the movement: a deposit made exactly 24 hours before no longer counts, one 1 ms inside does', async () => {
    const outside = await api.openAccount('CAD');
    at(0);
    await deposit(outside, '6000.00');
    at(24 * HOUR);
    await deposit(outside, '4000.00');
    assert.equal((await last()).decision, 'allowed');
    const inside = await api.openAccount('CAD');
    at(0);
    await deposit(inside, '6000.00');
    at(24 * HOUR - 1);
    await deposit(inside, '4000.00');
    assert.equal((await last()).rule, '24_hour');
  });

  test('BK-R43 exactly 10,000.00 in total (6,000.00 and 4,000.00) is reported, and 9,999.99 is not', async () => {
    const total = await api.openAccount('CAD');
    at(0);
    await deposit(total, '6000.00');
    await deposit(total, '4000.00');
    assert.equal((await last()).rule, '24_hour');
    const short = await api.openAccount('CAD');
    await deposit(short, '6000.00');
    await deposit(short, '3999.99');
    assert.equal((await last()).decision, 'allowed');
  });

  test('BK-R43 withdrawals add up the same way: 6,000.00 and then 4,000.00 out in a day is reported', async () => {
    const id = await api.openAccount('CAD');
    at(0);
    for (const amount of ['9000.00', '9000.00']) await deposit(id, amount);
    await withdraw(id, '6000.00');
    assert.equal((await last()).decision, 'allowed');
    assert.equal((await withdraw(id, '4000.00')).status, 201);
    assert.equal((await last()).kind, 'withdrawal');
    assert.equal((await last()).rule, '24_hour');
  });

  test('BK-R43 every later deposit while the day still holds 10,000.00 or more is reported too', async () => {
    const id = await api.openAccount('CAD');
    at(0);
    await deposit(id, '6000.00');
    await deposit(id, '4000.00');
    at(HOUR);
    await deposit(id, '1.00');
    assert.equal((await last()).rule, '24_hour');
  });

  test('BK-R43 other accounts, and withdrawals against deposits, are not added together', async () => {
    at(0);
    const a = await api.openAccount('CAD');
    const b = await api.openAccount('CAD');
    await deposit(a, '6000.00');
    await deposit(b, '4000.00');
    assert.equal((await last()).decision, 'allowed');
    await withdraw(a, '4000.00'); // 6,000 in, 4,000 out: neither side reaches 10,000
    assert.equal((await last()).decision, 'allowed');
    await deposit(a, '3000.00'); // deposits 9,000
    assert.equal((await last()).decision, 'allowed');
  });

  test('BK-R43 a refused deposit is not counted: only deposits that were written add up', async () => {
    const id = await api.openAccount('CAD');
    at(0);
    await deposit(id, '6000.00');
    assert.equal((await deposit(id, '4000.001')).status, 400);
    await deposit(id, '3000.00');
    assert.equal((await last()).decision, 'allowed');
  });
});

describe('the sanctions list', () => {
  const owner = async (name: string, currency = 'CAD') => api.openAccount(currency, name);

  for (const name of [
    'Viktor Ostrovsky',
    'VIKTOR OSTROVSKY',
    'Ostrovsky, Viktor',
    '  Viktor   Ostrovsky ',
    'Víktor Östrovsky',
    'Victor Ostrovskiy',
    'Mohammed Alrahimi',
    'Mohamed Al Rahimi',
    'AL-RAHIMI, Muhammad',
    'Yelena Voronina',
    'Youssef Karimoff',
  ]) {
    test(`BK-R44 a deposit to an account owned by "${name}" is blocked, and nothing is written`, async () => {
      const id = await owner(name);
      const before = transfersCount();
      held(await deposit(id, '10.00'));
      assert.equal(transfersCount(), before);
      assert.equal((await api.get(`/accounts/${id}`)).body.balance, '0.00');
      const row = await last();
      assert.equal(row.decision, 'blocked');
      assert.equal(row.rule, 'sanctions_match');
    });
  }

  for (const [name, why] of [
    ['Viktor Ostrowsky', 'one letter changed'],
    ['Viktor Ostrovski', 'one letter dropped'],
    ['Elena Voronin', 'one letter dropped'],
  ] as const) {
    test(`BK-R44 "${name}" (${why}) is held for review, not blocked`, async () => {
      const id = await owner(name);
      held(await deposit(id, '10.00'));
      const row = await last();
      assert.equal(row.decision, 'held');
      assert.equal(row.rule, 'sanctions_near_match');
    });
  }

  for (const name of ['Viktor Petrovsky', 'Victor Ostrov', 'Viktor Ostrovsky Junior', 'Muhammad Rahimi', 'Joseph Karimov', 'Ada Lovelace', 'Elena Smith']) {
    test(`BK-R44 "${name}" is not on the list and is allowed (not a match, not a near match)`, async () => {
      const id = await owner(name);
      assert.equal((await deposit(id, '10.00')).status, 201);
      assert.equal((await last()).decision, 'allowed');
    });
  }

  test('BK-R44 a listed party on either side stops a transfer, and on a withdrawal', async () => {
    const clean = await owner('Ada Lovelace');
    await deposit(clean, '100.00');
    // Funded under a clean name, then renamed past the API: a listed owner can't deposit.
    const listed = await owner('Ada Byron');
    await deposit(listed, '100.00');
    api.ledger.db.exec(`UPDATE accounts SET owner = 'Yusuf Karimov' WHERE id = ${listed}`);
    held(await transfer(clean, listed, '1.00'));
    held(await transfer(listed, clean, '1.00'));
    held(await withdraw(listed, '1.00'));
    const [a, b, c] = (await rows()).slice(-3);
    assert.deepEqual([a.kind, b.kind, c.kind], ['transfer', 'transfer', 'withdrawal']);
    assert.ok([a, b, c].every((r) => r.decision === 'blocked'));
  });

  test('BK-R44 when the sender is a near match and the receiver an exact one, the transfer is blocked, not held: the stronger match decides, in either order', async () => {
    // Both funded under a clean name, then renamed past the API: a listed owner can't deposit.
    const near = await owner('Ada Byron');
    const exact = await owner('Ada Byron');
    await deposit(near, '100.00');
    await deposit(exact, '100.00');
    api.ledger.db.exec(`UPDATE accounts SET owner = 'Viktor Ostrowsky' WHERE id = ${near}`);
    api.ledger.db.exec(`UPDATE accounts SET owner = 'Viktor Ostrovsky' WHERE id = ${exact}`);
    for (const [from, to] of [[near, exact], [exact, near]] as const) {
      held(await transfer(from, to, '1.00'));
      const row = await last();
      assert.equal(row.decision, 'blocked');
      assert.match(row.detail, new RegExp(`account ${exact}:`));
    }
  });

  test('BK-R44 a listed owner who also deposits 10,000.00 is blocked, not just reported: the list outweighs the report', async () => {
    held(await deposit(await owner('Elena Voronina'), '20000.00'));
    assert.equal((await last()).decision, 'blocked');
  });

  test('BK-R44 the answer to a block and to a hold is the same words, with no name and no list entry in it', async () => {
    const blocked = await deposit(await owner('Viktor Ostrovsky'), '1.00');
    const near = await deposit(await owner('Viktor Ostrowsky'), '1.00');
    assert.deepEqual(blocked.body, near.body);
    assert.doesNotMatch(JSON.stringify(blocked.body), /ostrov|viktor|S-00|list|sanction/i);
  });

  test('BK-R44 an owner with no Latin letters matches nothing (a limit, not a rule)', async () => {
    const id = await owner('Виктор Островский');
    assert.equal((await deposit(id, '10.00')).status, 201);
    assert.equal((await last()).decision, 'allowed');
  });
});

describe('the name matching on its own', () => {
  test('BK-R44 normalize drops accents, case, punctuation and order, joins "al", and makes known spellings one', () => {
    assert.equal(normalize('Víktor  ÖSTROVSKY'), 'ostrovsky viktor');
    assert.equal(normalize('Ostrovsky, Viktor'), 'ostrovsky viktor');
    assert.equal(normalize('Mohammed Al-Rahimi'), 'alrahimi muhammad');
    assert.equal(normalize('Mohamed el Rahimi'), 'elrahimi muhammad');
    assert.equal(normalize('Łukasz Østergård'), 'lukasz ostergard');
    assert.equal(normalize('Straße'), 'strasse');
    assert.equal(normalize('Виктор'), '');
    assert.equal(normalize(''), '');
  });

  test(`BK-R44 one wrong letter is a near match only from ${NEAR_MIN_LENGTH} letters on: shorter names must match exactly`, () => {
    const list = [{ id: 'X-1', names: ['Ana Li'] }];
    assert.deepEqual(matchName('Ana Li', list), { kind: 'exact', listed: 'X-1' });
    assert.equal(matchName('Ann Li', list), null);
    const long = [{ id: 'X-2', names: ['Anastasia Lindqvist'] }];
    assert.deepEqual(matchName('Anastasia Lindqvest', long), { kind: 'near', listed: 'X-2' });
    assert.equal(matchName('Anastasia Lindqvest Smith', long), null);
  });

  test('BK-R44 an exact match on a later entry beats a near match on an earlier one', () => {
    const list = [{ id: 'A', names: ['Viktor Ostrovskx'] }, { id: 'B', names: ['Viktor Ostrovsky'] }];
    assert.deepEqual(matchName('Viktor Ostrovsky', list), { kind: 'exact', listed: 'B' });
  });
});

describe('the audit record', () => {
  test('BK-R45 every movement that reaches the screening gets exactly one row, with the answer, the rule and the reason', async () => {
    const before = (await rows()).length;
    const fresh = await api.openAccount('CAD');
    const listed = await api.openAccount('CAD', 'Viktor Ostrovsky');
    at(0);
    await deposit(fresh, '5.00'); // allowed
    await deposit(fresh, '10000.00'); // reported
    await deposit(listed, '5.00'); // blocked
    const added = (await rows()).slice(before);
    assert.deepEqual(added.map((r) => r.decision), ['allowed', 'reported', 'blocked']);
    assert.deepEqual(added.map((r) => r.rule), [null, 'large_cash', 'sanctions_match']);
    const [first, second, third] = added;
    assert.equal(first.kind, 'deposit');
    assert.equal(first.from_account_id, null);
    assert.equal(first.to_account_id, fresh);
    assert.equal(first.amount, '5.00');
    assert.equal(first.currency, 'CAD');
    assert.equal(first.decided_at, clock);
    assert.match(first.detail, /no rule/);
    assert.match(second.detail, /10000\.00 CAD/);
    assert.match(third.detail, new RegExp(`account ${listed}.*S-001`));
    assert.doesNotMatch(third.detail, /viktor|ostrovsky/i, 'the audit reason names accounts and entries, never a person');
    assert.ok(added.every((r, i) => i === 0 || r.id > added[i - 1].id), 'oldest first');
  });

  test('BK-R45 a movement refused before the screening (not enough money, unknown account) leaves no row', async () => {
    const id = await api.openAccount('CAD');
    const before = (await rows()).length;
    assert.equal((await withdraw(id, '1.00')).body.code, 'insufficient_funds');
    assert.equal((await deposit(999999, '1.00')).status, 404);
    assert.equal((await deposit(id, 'abc')).status, 400);
    assert.equal((await rows()).length, before);
  });

  test('BK-R45 an Idempotency-Key replay answers from the first movement and adds no row; a key refused by the screening can be used again', async () => {
    const id = await api.openAccount('CAD');
    const key = { 'Idempotency-Key': `aml-${Date.now()}-a` };
    const send = () => api.request('POST', `/accounts/${id}/deposits`, { amount: '10.00', currency: 'CAD' }, key);
    const before = (await rows()).length;
    assert.equal((await send()).status, 201);
    const replay = await send();
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
    assert.equal((await rows()).length, before + 1);

    const listed = await api.openAccount('CAD', 'Elena Voronina');
    const heldKey = { 'Idempotency-Key': `aml-${Date.now()}-b` };
    const again = () => api.request('POST', `/accounts/${listed}/deposits`, { amount: '10.00', currency: 'CAD' }, heldKey);
    held(await again());
    held(await again()); // the key was given up, so this isn't a mismatch or an in-flight key
    assert.equal((await rows()).length, before + 3);
  });

  test('BK-R45 the table refuses a row with a rule on an allowed decision, or none on a stopped one', () => {
    const sql = (decision: string, rule: string | null) =>
      api.ledger.db.exec(`INSERT INTO screening_decisions (decided_at, kind, amount, currency, decision, rule, detail) VALUES ('t', 'deposit', 1, 'CAD', '${decision}', ${rule === null ? 'NULL' : `'${rule}'`}, 'x')`);
    assert.throws(() => sql('allowed', 'large_cash'), /CHECK/);
    assert.throws(() => sql('blocked', null), /CHECK/);
    assert.throws(() => sql('maybe', 'x'), /CHECK/);
    assert.doesNotThrow(() => sql('reported', 'large_cash'));
  });

  test('BK-R45 a ledger file from before the screening gets the table when it is opened, and keeps its rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'banking-aml-'));
    try {
      const file = join(dir, 'old.db');
      const first = new Ledger(file);
      const account = first.openAccount('Ada', 'CAD');
      first.deposit(account.id, 500n, 'CAD');
      first.db.exec('DROP TABLE screening_decisions');
      first.close();
      const reopened = new Ledger(file);
      assert.deepEqual(reopened.decisions(), []);
      assert.equal(reopened.getAccount(account.id)?.balance, 500n);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the real server has the rules on', () => {
  test('BK-R42 BK-R44 BK-R45 a server started with node src/server.ts reports a large deposit and holds a listed owner', async () => {
    const servers = await startServers(1);
    const base = servers.bases[0]!;
    const open = async (owner: string) => (await servers.post(base, '/accounts', { owner, currency: 'CAD' })).body.id as number;
    const clean = await open('Ada Lovelace');
    const listed = await open('Viktor Ostrovsky');
    assert.equal((await servers.post(base, `/accounts/${clean}/deposits`, { amount: '10000.00', currency: 'CAD' })).status, 201);
    held(await servers.post(base, `/accounts/${listed}/deposits`, { amount: '1.00', currency: 'CAD' }));
    const decisions = (await servers.get(base, '/screening-decisions')).body.decisions;
    assert.deepEqual(decisions.map((d: any) => d.decision), ['reported', 'blocked']);
  });

  test('BK-R44 a blocked movement takes as long as any other: with a 300 ms screening it is not answered early', async () => {
    const servers = await startServers(1, { SCREENING_DELAY_MS: '300' });
    const base = servers.bases[0]!;
    const listed = (await servers.post(base, '/accounts', { owner: 'Viktor Ostrovsky', currency: 'CAD' })).body.id as number;
    const clean = (await servers.post(base, '/accounts', { owner: 'Ada Lovelace', currency: 'CAD' })).body.id as number;
    const time = async (id: number) => {
      const started = performance.now();
      const reply = await servers.post(base, `/accounts/${id}/deposits`, { amount: '1.00', currency: 'CAD' });
      return { reply, ms: performance.now() - started };
    };
    const blocked = await time(listed);
    const allowed = await time(clean);
    held(blocked.reply);
    assert.equal(allowed.reply.status, 201);
    assert.ok(blocked.ms >= 250, `a block answered in ${blocked.ms} ms, before the screening's wait`);
    assert.ok(allowed.ms >= 250, `a payment answered in ${allowed.ms} ms, before the screening's wait`);
  });
});

describe('requests at the same time, with a slow screening', () => {
  const wait = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 40)); };

  test('BK-R43 two deposits of 6,000.00 sent at once: one is allowed and the other reported, because the total is read just before the write', async () => {
    const slow = await startApi({ aml: true, screen: wait });
    const id = await slow.openAccount('CAD');
    const replies = await Promise.all([deposit(id, '6000.00', 'CAD', slow), deposit(id, '6000.00', 'CAD', slow)]);
    assert.deepEqual(replies.map((r) => r.status), [201, 201]);
    const rules = (await slow.get('/screening-decisions')).body.decisions.map((d: any) => d.rule as string | null);
    assert.deepEqual(rules.sort((a: string | null, b: string | null) => String(a).localeCompare(String(b))), ['24_hour', null]);
  });

  test('BK-R45 the row is the decision, not the outcome: two withdrawals of 600.00 at once from 1,000.00 both get an allowed row, and the ledger refuses the second', async () => {
    const slow = await startApi({ aml: true, screen: wait });
    const id = await slow.openAccount('CAD');
    await deposit(id, '1000.00', 'CAD', slow);
    const replies = await Promise.all([1, 2].map(() => slow.post(`/accounts/${id}/withdrawals`, { amount: '600.00', currency: 'CAD' })));
    assert.deepEqual(replies.map((r) => r.status).sort(), [201, 422]);
    assert.equal(replies.find((r) => r.status === 422)!.body.code, 'insufficient_funds');
    const withdrawals = (await slow.get('/screening-decisions')).body.decisions.filter((d: any) => d.kind === 'withdrawal');
    assert.deepEqual(withdrawals.map((d: any) => d.decision), ['allowed', 'allowed']);
    assert.equal(Number((slow.ledger.db.prepare("SELECT COUNT(*) AS n FROM transfers WHERE kind = 'withdrawal'").get() as { n: number }).n), 1);
  });
});
