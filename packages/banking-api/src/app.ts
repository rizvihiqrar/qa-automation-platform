import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MATRIX, can, words, type Action, type Matrix } from './entitlements.ts';
import { Ledger, type Account, type Entry, type Movement, type Refusal, type Result, type ScreeningDecision, type Store, type Transfer } from './ledger.ts';
import { CURRENCIES, REFERENCE_MAX, formatAmount, isCurrency, isReference, parseAmount, type Currency } from './money.ts';

// A plain node:http server: no framework, no runtime dependencies. Every response is
// JSON, and every refusal is { error, code } (BK-R16).

const MAX_BODY_BYTES = 16 * 1024;
const OWNER_MAX = 100;
const KEY_MAX = 255;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;
  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

type Body = Record<string, unknown>;
type Reply = [status: number, payload: unknown, headers?: Record<string, string>];
interface Context { ledger: Store; params: number[]; body: Body; req: IncomingMessage; screen: Screen; rules?: Rules }
type Handler = (ctx: Context) => Reply | Promise<Reply>;
// `actions` names what each method is for, which the roles are checked against (BK-R46).
interface Route { pattern: RegExp; methods: Record<string, Handler>; actions?: Record<string, Action> }

// An outside check awaited before each movement (fraud, limits). The server's stands
// in for a slow one (SCREENING_DELAY_MS); by default it returns at once. While it
// runs, other requests run too, which is why the ledger checks funds again when it
// writes (BK-R24).
// It may answer with a refusal, which stops the movement (BK-R44).
export type Screen = (movement: Movement) => Promise<Refusal | void>;
// Rules decided on what the ledger holds (the anti-money-laundering rules, BK-R42 to BK-R45),
// run after the screening and inside the store's exclusive section for the movement, on the
// store it hands them: what they read can't change before the money is written, and what they
// write is kept even when the movement is then refused.
export type Rules = (movement: Movement, store: Store) => Promise<Refusal | void>;
export interface Options { screen?: Screen; rules?: Rules; entitlements?: Matrix }

// Positive integer ids in paths; anything else isn't a route (404).
const ID = '([1-9][0-9]{0,14})';

const routes: Route[] = [
  { pattern: /^\/health$/, methods: { GET: () => [200, { status: 'ok' }] } },
  { pattern: /^\/accounts$/, methods: { GET: listAccounts, POST: openAccount }, actions: { GET: 'view', POST: 'open_account' } },
  { pattern: new RegExp(`^/accounts/${ID}$`), methods: { GET: getAccount }, actions: { GET: 'view' } },
  { pattern: new RegExp(`^/accounts/${ID}/entries$`), methods: { GET: getEntries }, actions: { GET: 'view' } },
  { pattern: new RegExp(`^/accounts/${ID}/deposits$`), methods: { POST: postDeposit }, actions: { POST: 'deposit' } },
  { pattern: new RegExp(`^/accounts/${ID}/withdrawals$`), methods: { POST: postWithdrawal }, actions: { POST: 'withdraw' } },
  { pattern: /^\/transfers$/, methods: { POST: postTransfer }, actions: { POST: 'transfer' } },
  { pattern: new RegExp(`^/transfers/${ID}$`), methods: { GET: getTransfer }, actions: { GET: 'view' } },
  { pattern: /^\/screening-decisions$/, methods: { GET: listDecisions }, actions: { GET: 'read_audit' } },
];

export function createApp(ledger: Store = new Ledger(), { screen = async () => {}, rules, entitlements = MATRIX }: Options = {}): Server {
  return createServer((req, res) => {
    handle(ledger, screen, rules, entitlements, req, res).catch((err: unknown) => {
      try {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code }, err.headers);
        // Another process held the database past the busy timeout: a reason to retry,
        // not a server fault (BK-R25).
        if (isBusy(err)) return send(res, 503, { error: 'the database is busy; try again', code: 'busy' }, { 'Retry-After': '1' });
        console.error(err);
        send(res, 500, { error: 'internal error', code: 'internal' });
      } catch (failed) {
        // The error could not be sent as it was (a refusal with no valid status, say, from a
        // store call that was not awaited): a 500 still, never a request left without an answer.
        console.error(failed);
        try {
          if (!res.headersSent) return send(res, 500, { error: 'internal error', code: 'internal' });
        } catch (again) {
          console.error(again);
        }
        res.destroy();
      }
    });
  });
}

// SQLite: SQLITE_BUSY. Postgres: a lock not granted within lock_timeout (55P03), a deadlock the
// server broke by cancelling this side (40P01), or no free connection in the pool in time.
const PG_BUSY = new Set(['55P03', '40P01']);
const isBusy = (err: unknown): boolean => {
  const { code, errcode, message } = err as { code?: string; errcode?: number; message?: string };
  if (code === 'ERR_SQLITE_ERROR') return ((errcode ?? 0) & 0xff) === 5;
  return (code !== undefined && PG_BUSY.has(code)) || message === 'timeout exceeded when trying to connect';
};

// The banking UI (public/): plain files, no build, served from the same origin as the
// API so it needs no CORS. Nothing inline, so the policy allows only this origin (BK-R32).
const PUBLIC = new URL('../public/', import.meta.url);
const UI_FILES: Record<string, [file: string, type: string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
};
const UI_POLICY = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

async function handle(ledger: Store, screen: Screen, rules: Rules | undefined, matrix: Matrix, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const file = UI_FILES[pathname];
  if (file) {
    if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed', `${req.method} is not allowed here; use GET`, { Allow: 'GET' });
    res.writeHead(200, {
      'Content-Type': file[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': UI_POLICY,
    });
    res.end(await readFile(new URL(file[0], PUBLIC)));
    return;
  }
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const handler = route.methods[req.method ?? ''];
    if (!handler) {
      const allow = Object.keys(route.methods).join(', ');
      throw new HttpError(405, 'method_not_allowed', `${req.method} is not allowed here; use ${allow}`, { Allow: allow });
    }
    authorize(req, route.actions?.[req.method ?? ''], matrix);
    const body = req.method === 'POST' ? await readJson(req) : {};
    const [status, payload, headers] = await handler({ ledger, params: match.slice(1).map(Number), body, req, screen, rules });
    return send(res, status, payload, headers);
  }
  throw new HttpError(404, 'not_found', `no route for ${pathname}`);
}

// Who may do this (BK-R46 to BK-R49), asked before anything else about the request is read, so a
// role that may not do it learns nothing about the accounts, the body or the key. The role is the
// X-Role header, a claim and not a proof. No header means no restriction, except for the audit
// record, which only the auditor reads. Any role not in the matrix may do nothing.
function authorize(req: IncomingMessage, action: Action | undefined, matrix: Matrix): void {
  if (action === undefined) return;
  const raw = req.headers['x-role'];
  const role = Array.isArray(raw) ? raw.join(', ') : raw;
  if (role === undefined && action !== 'read_audit') return;
  if (role === undefined || !can(matrix, role, action)) {
    const who = role === undefined ? 'a request with no role' : Object.hasOwn(matrix, role) ? `the role ${role}` : 'an unknown role';
    throw new HttpError(403, 'forbidden', `${who} may not ${words(action)}`);
  }
}

async function readJson(req: IncomingMessage): Promise<Body> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) throw new HttpError(415, 'unsupported_media_type', 'send the body as application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large', `body must be at most ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'invalid_body', 'body must be a JSON object');
  return body as Body;
}

function send(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

// ---- Reading request fields --------------------------------------------------

function currencyOf(body: Body): Currency {
  if (!isCurrency(body.currency)) {
    throw new HttpError(400, 'invalid_currency', `currency must be one of ${Object.keys(CURRENCIES).join(', ')}`);
  }
  return body.currency;
}

function amountOf(body: Body, currency: Currency): bigint {
  const parsed = parseAmount(body.amount, currency);
  if (!parsed.ok) throw new HttpError(400, 'invalid_amount', parsed.error);
  return parsed.minor;
}

function accountIdOf(body: Body, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new HttpError(400, 'invalid_account_id', `${field} must be a positive whole number`);
  }
  return value;
}

// Optional; 1 to 35 characters of the restricted set, read before the key (BK-R38).
function referenceOf(body: Body): string | null {
  const value = body.reference;
  if (value === undefined || value === null) return null;
  if (!isReference(value)) {
    throw new HttpError(400, 'invalid_reference', `reference must be 1 to ${REFERENCE_MAX} characters: letters, digits, space and / - ? : ( ) . , ' + (no space at either end)`);
  }
  return value;
}

// Optional; 1 to 255 visible ASCII characters (BK-R19).
function idempotencyKeyOf(req: IncomingMessage): string | null {
  const value = req.headers['idempotency-key'];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > KEY_MAX || !/^[\x21-\x7e]+$/.test(value)) {
    throw new HttpError(400, 'invalid_idempotency_key', `Idempotency-Key must be 1 to ${KEY_MAX} visible ASCII characters`);
  }
  return value;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new HttpError(result.status, result.code, result.error);
  return result.value;
}

// ---- Handlers ------------------------------------------------------------------

async function openAccount({ ledger, body }: Context): Promise<Reply> {
  const owner = typeof body.owner === 'string' ? body.owner.trim() : '';
  if (owner.length < 1 || owner.length > OWNER_MAX) {
    throw new HttpError(400, 'invalid_owner', `owner must be a name of 1 to ${OWNER_MAX} characters`);
  }
  return [201, account(await ledger.openAccount(owner, currencyOf(body)))];
}

async function listAccounts({ ledger }: Context): Promise<Reply> {
  return [200, { accounts: (await ledger.listAccounts()).map(account) }];
}

async function getAccount({ ledger, params: [accountId] }: Context): Promise<Reply> {
  const found = await ledger.getAccount(accountId!);
  if (!found) throw new HttpError(404, 'not_found', `account ${accountId} not found`);
  return [200, account(found)];
}

async function getEntries({ ledger, params: [accountId] }: Context): Promise<Reply> {
  const found = await ledger.getAccount(accountId!);
  if (!found) throw new HttpError(404, 'not_found', `account ${accountId} not found`);
  const entries = (await ledger.statement(found.id)).map((e) => entry(e, found.currency));
  return [200, { ...account(found), entries }];
}

// Currency first: it decides how many decimals the amount may have.
function postDeposit(ctx: Context): Promise<Reply> {
  const currency = currencyOf(ctx.body);
  return move(ctx, { kind: 'deposit', from: null, to: ctx.params[0]!, amount: amountOf(ctx.body, currency), currency, reference: referenceOf(ctx.body) });
}

function postWithdrawal(ctx: Context): Promise<Reply> {
  const currency = currencyOf(ctx.body);
  return move(ctx, { kind: 'withdrawal', from: ctx.params[0]!, to: null, amount: amountOf(ctx.body, currency), currency, reference: referenceOf(ctx.body) });
}

function postTransfer(ctx: Context): Promise<Reply> {
  const currency = currencyOf(ctx.body);
  const amount = amountOf(ctx.body, currency);
  const from = accountIdOf(ctx.body, 'from_account_id');
  const to = accountIdOf(ctx.body, 'to_account_id');
  return move(ctx, { kind: 'transfer', from, to, amount, currency, reference: referenceOf(ctx.body) });
}

// What a key promises to repeat: the route, the accounts, the amount in minor units
// and the currency, so "5" and "5.00" CAD are the same request (BK-R20).
const fingerprint = (m: Movement): string =>
  createHash('sha256').update(JSON.stringify([m.kind, m.from, m.to, m.amount.toString(), m.currency, m.reference ?? null])).digest('hex');

// Refusal order (BK-R16): the request (already read), then the key, then the
// accounts and the bank's rules. A claimed key is given up unless the movement is
// written, so a refused request can be retried with the same key (BK-R22).
async function move(ctx: Context, m: Movement): Promise<Reply> {
  const key = idempotencyKeyOf(ctx.req);
  if (key === null) return run(ctx, m);
  const claim = await ctx.ledger.claimKey(key, fingerprint(m));
  if (claim.state === 'mismatch') throw new HttpError(422, 'idempotency_key_mismatch', 'this Idempotency-Key was used for a different request');
  if (claim.state === 'in_flight') throw new HttpError(409, 'idempotency_key_in_use', 'a request with this Idempotency-Key is still running; retry later');
  if (claim.state === 'replay') return [201, transfer(claim.transfer), { 'Idempotent-Replayed': 'true' }];
  let written = false;
  try {
    const reply = await run(ctx, m, key);
    written = true;
    return reply;
  } finally {
    if (!written) await ctx.ledger.releaseKey(key);
  }
}

// A movement that would be refused now is refused before the screening, which isn't
// asked about it. One that passes is checked again when written (BK-R24).
// The rules and the write run in one exclusive section of the store, so two movements on the
// same account are decided and written one after the other (BK-R43, BK-R24). A refusal comes
// back out of the section as a value, not a throw, so what the rules recorded is kept.
async function run({ ledger, screen, rules }: Context, m: Movement, key?: string): Promise<Reply> {
  const refusal = await ledger.check(m);
  if (refusal) unwrap(refusal);
  const held = await screen(m);
  if (held) unwrap(held);
  const written = await ledger.exclusive(m, async (store): Promise<Result<Transfer>> => {
    const stopped = rules ? await rules(m, store) : undefined;
    if (stopped) return stopped;
    return store.apply(m, key);
  });
  return [201, transfer(unwrap(written))];
}

async function getTransfer({ ledger, params: [transferId] }: Context): Promise<Reply> {
  const found = await ledger.getTransfer(transferId!);
  if (!found) throw new HttpError(404, 'not_found', `transfer ${transferId} not found`);
  return [200, {
    ...transfer(found),
    entries: found.entries.map((e) => ({ account_id: e.account_id, amount: formatAmount(e.amount, found.currency) })),
  }];
}

// The audit record of the screening (BK-R45), oldest first.
async function listDecisions({ ledger }: Context): Promise<Reply> {
  return [200, { decisions: (await ledger.decisions()).map(decision) }];
}

// ---- Responses: every amount as a string with the currency's decimals (BK-R07) ---

const account = (a: Account) => ({ id: a.id, owner: a.owner, currency: a.currency, balance: formatAmount(a.balance, a.currency), created_at: a.created_at });

const decision = (d: ScreeningDecision) => ({
  id: d.id, decided_at: d.decided_at, kind: d.kind, from_account_id: d.from_account_id, to_account_id: d.to_account_id,
  amount: formatAmount(d.amount, d.currency), currency: d.currency, decision: d.decision, rule: d.rule, detail: d.detail,
});

const transfer = (t: Transfer) => ({
  id: t.id, kind: t.kind, from_account_id: t.from_account_id, to_account_id: t.to_account_id,
  amount: formatAmount(t.amount, t.currency), currency: t.currency, reference: t.reference, created_at: t.created_at,
});

const entry = (e: Entry, currency: Currency) => ({
  id: e.id, transfer_id: e.transfer_id, kind: e.kind, counterparty_account_id: e.counterparty_account_id,
  amount: formatAmount(e.amount, currency), balance_after: formatAmount(e.balance_after, currency), created_at: e.created_at,
});
