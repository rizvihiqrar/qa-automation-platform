import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Ledger, type Account, type Entry, type Movement, type Result, type Transfer } from './ledger.ts';
import { CURRENCIES, formatAmount, isCurrency, parseAmount, type Currency } from './money.ts';

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
interface Context { ledger: Ledger; params: number[]; body: Body; req: IncomingMessage; screen: Screen }
type Handler = (ctx: Context) => Reply | Promise<Reply>;
interface Route { pattern: RegExp; methods: Record<string, Handler> }

// An outside check awaited before each movement (fraud, limits). The server's stands
// in for a slow one (SCREENING_DELAY_MS); by default it returns at once. While it
// runs, other requests run too, which is why the ledger checks funds again when it
// writes (BK-R24).
export type Screen = (movement: Movement) => Promise<void>;
export interface Options { screen?: Screen }

// Positive integer ids in paths; anything else isn't a route (404).
const ID = '([1-9][0-9]{0,14})';

const routes: Route[] = [
  { pattern: /^\/health$/, methods: { GET: () => [200, { status: 'ok' }] } },
  { pattern: /^\/accounts$/, methods: { POST: openAccount } },
  { pattern: new RegExp(`^/accounts/${ID}$`), methods: { GET: getAccount } },
  { pattern: new RegExp(`^/accounts/${ID}/entries$`), methods: { GET: getEntries } },
  { pattern: new RegExp(`^/accounts/${ID}/deposits$`), methods: { POST: postDeposit } },
  { pattern: new RegExp(`^/accounts/${ID}/withdrawals$`), methods: { POST: postWithdrawal } },
  { pattern: /^\/transfers$/, methods: { POST: postTransfer } },
  { pattern: new RegExp(`^/transfers/${ID}$`), methods: { GET: getTransfer } },
];

export function createApp(ledger: Ledger = new Ledger(), { screen = async () => {} }: Options = {}): Server {
  return createServer((req, res) => {
    handle(ledger, screen, req, res).catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code }, err.headers);
      // Another process held the database past the busy timeout: a reason to retry,
      // not a server fault (BK-R25).
      if (isBusy(err)) return send(res, 503, { error: 'the database is busy; try again', code: 'busy' }, { 'Retry-After': '1' });
      console.error(err);
      send(res, 500, { error: 'internal error', code: 'internal' });
    });
  });
}

const isBusy = (err: unknown): boolean =>
  (err as { code?: string }).code === 'ERR_SQLITE_ERROR' && (((err as { errcode?: number }).errcode ?? 0) & 0xff) === 5;

async function handle(ledger: Ledger, screen: Screen, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const handler = route.methods[req.method ?? ''];
    if (!handler) {
      const allow = Object.keys(route.methods).join(', ');
      throw new HttpError(405, 'method_not_allowed', `${req.method} is not allowed here; use ${allow}`, { Allow: allow });
    }
    const body = req.method === 'POST' ? await readJson(req) : {};
    const [status, payload, headers] = await handler({ ledger, params: match.slice(1).map(Number), body, req, screen });
    return send(res, status, payload, headers);
  }
  throw new HttpError(404, 'not_found', `no route for ${pathname}`);
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

function openAccount({ ledger, body }: Context): Reply {
  const owner = typeof body.owner === 'string' ? body.owner.trim() : '';
  if (owner.length < 1 || owner.length > OWNER_MAX) {
    throw new HttpError(400, 'invalid_owner', `owner must be a name of 1 to ${OWNER_MAX} characters`);
  }
  return [201, account(ledger.openAccount(owner, currencyOf(body)))];
}

function getAccount({ ledger, params: [accountId] }: Context): Reply {
  const found = ledger.getAccount(accountId!);
  if (!found) throw new HttpError(404, 'not_found', `account ${accountId} not found`);
  return [200, account(found)];
}

function getEntries({ ledger, params: [accountId] }: Context): Reply {
  const found = ledger.getAccount(accountId!);
  if (!found) throw new HttpError(404, 'not_found', `account ${accountId} not found`);
  const entries = ledger.statement(found.id).map((e) => entry(e, found.currency));
  return [200, { ...account(found), entries }];
}

// Currency first: it decides how many decimals the amount may have.
function postDeposit(ctx: Context): Promise<Reply> {
  const currency = currencyOf(ctx.body);
  return move(ctx, { kind: 'deposit', from: null, to: ctx.params[0]!, amount: amountOf(ctx.body, currency), currency });
}

function postWithdrawal(ctx: Context): Promise<Reply> {
  const currency = currencyOf(ctx.body);
  return move(ctx, { kind: 'withdrawal', from: ctx.params[0]!, to: null, amount: amountOf(ctx.body, currency), currency });
}

function postTransfer(ctx: Context): Promise<Reply> {
  const currency = currencyOf(ctx.body);
  const amount = amountOf(ctx.body, currency);
  const from = accountIdOf(ctx.body, 'from_account_id');
  const to = accountIdOf(ctx.body, 'to_account_id');
  return move(ctx, { kind: 'transfer', from, to, amount, currency });
}

// What a key promises to repeat: the route, the accounts, the amount in minor units
// and the currency, so "5" and "5.00" CAD are the same request (BK-R20).
const fingerprint = (m: Movement): string =>
  createHash('sha256').update(JSON.stringify([m.kind, m.from, m.to, m.amount.toString(), m.currency])).digest('hex');

// Refusal order (BK-R16): the request (already read), then the key, then the
// accounts and the bank's rules. A claimed key is given up unless the movement is
// written, so a refused request can be retried with the same key (BK-R22).
async function move(ctx: Context, m: Movement): Promise<Reply> {
  const key = idempotencyKeyOf(ctx.req);
  if (key === null) return run(ctx, m);
  const claim = ctx.ledger.claimKey(key, fingerprint(m));
  if (claim.state === 'mismatch') throw new HttpError(422, 'idempotency_key_mismatch', 'this Idempotency-Key was used for a different request');
  if (claim.state === 'in_flight') throw new HttpError(409, 'idempotency_key_in_use', 'a request with this Idempotency-Key is still running; retry later');
  if (claim.state === 'replay') return [201, transfer(claim.transfer), { 'Idempotent-Replayed': 'true' }];
  let written = false;
  try {
    const reply = await run(ctx, m, key);
    written = true;
    return reply;
  } finally {
    if (!written) ctx.ledger.releaseKey(key);
  }
}

// A movement that would be refused now is refused before the screening, which isn't
// asked about it. One that passes is checked again when written (BK-R24).
async function run({ ledger, screen }: Context, m: Movement, key?: string): Promise<Reply> {
  const refusal = ledger.check(m);
  if (refusal) unwrap(refusal);
  await screen(m);
  return [201, transfer(unwrap(ledger.apply(m, key)))];
}

function getTransfer({ ledger, params: [transferId] }: Context): Reply {
  const found = ledger.getTransfer(transferId!);
  if (!found) throw new HttpError(404, 'not_found', `transfer ${transferId} not found`);
  return [200, {
    ...transfer(found),
    entries: found.entries.map((e) => ({ account_id: e.account_id, amount: formatAmount(e.amount, found.currency) })),
  }];
}

// ---- Responses: every amount as a string with the currency's decimals (BK-R07) ---

const account = (a: Account) => ({ id: a.id, owner: a.owner, currency: a.currency, balance: formatAmount(a.balance, a.currency), created_at: a.created_at });

const transfer = (t: Transfer) => ({
  id: t.id, kind: t.kind, from_account_id: t.from_account_id, to_account_id: t.to_account_id,
  amount: formatAmount(t.amount, t.currency), currency: t.currency, created_at: t.created_at,
});

const entry = (e: Entry, currency: Currency) => ({
  id: e.id, transfer_id: e.transfer_id, kind: e.kind, counterparty_account_id: e.counterparty_account_id,
  amount: formatAmount(e.amount, currency), balance_after: formatAmount(e.balance_after, currency), created_at: e.created_at,
});
