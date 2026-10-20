import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Ledger, type Account, type Entry, type Result, type Transfer } from './ledger.ts';
import { CURRENCIES, formatAmount, isCurrency, parseAmount, type Currency } from './money.ts';

// A plain node:http server: no framework, no runtime dependencies. Every response is
// JSON, and every refusal is { error, code } (BK-R16).

const MAX_BODY_BYTES = 16 * 1024;
const OWNER_MAX = 100;

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
type Handler = (ledger: Ledger, params: number[], body: Body) => [number, unknown];
interface Route { pattern: RegExp; methods: Record<string, Handler> }

// Positive integer ids in paths; anything else isn't a route (404).
const ID = '([1-9][0-9]{0,14})';

const routes: Route[] = [
  { pattern: /^\/health$/, methods: { GET: () => [200, { status: 'ok' }] } },
  { pattern: /^\/accounts$/, methods: { POST: openAccount } },
  { pattern: new RegExp(`^/accounts/${ID}$`), methods: { GET: getAccount } },
  { pattern: new RegExp(`^/accounts/${ID}/entries$`), methods: { GET: getEntries } },
  { pattern: new RegExp(`^/accounts/${ID}/deposits$`), methods: { POST: (l, [a], b) => moveFor(b, (amount, c) => l.deposit(a!, amount, c)) } },
  { pattern: new RegExp(`^/accounts/${ID}/withdrawals$`), methods: { POST: (l, [a], b) => moveFor(b, (amount, c) => l.withdraw(a!, amount, c)) } },
  { pattern: /^\/transfers$/, methods: { POST: postTransfer } },
  { pattern: new RegExp(`^/transfers/${ID}$`), methods: { GET: getTransfer } },
];

export function createApp(ledger: Ledger = new Ledger()): Server {
  return createServer((req, res) => {
    handle(ledger, req, res).catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code }, err.headers);
      console.error(err);
      send(res, 500, { error: 'internal error', code: 'internal' });
    });
  });
}

async function handle(ledger: Ledger, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const [status, payload] = handler(ledger, match.slice(1).map(Number), body);
    return send(res, status, payload);
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

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new HttpError(result.status, result.code, result.error);
  return result.value;
}

// ---- Handlers ------------------------------------------------------------------

function openAccount(ledger: Ledger, _params: number[], body: Body): [number, unknown] {
  const owner = typeof body.owner === 'string' ? body.owner.trim() : '';
  if (owner.length < 1 || owner.length > OWNER_MAX) {
    throw new HttpError(400, 'invalid_owner', `owner must be a name of 1 to ${OWNER_MAX} characters`);
  }
  return [201, account(ledger.openAccount(owner, currencyOf(body)))];
}

function getAccount(ledger: Ledger, [accountId]: number[]): [number, unknown] {
  const found = ledger.getAccount(accountId!);
  if (!found) throw new HttpError(404, 'not_found', `account ${accountId} not found`);
  return [200, account(found)];
}

function getEntries(ledger: Ledger, [accountId]: number[]): [number, unknown] {
  const found = ledger.getAccount(accountId!);
  if (!found) throw new HttpError(404, 'not_found', `account ${accountId} not found`);
  const entries = ledger.statement(found.id).map((e) => entry(e, found.currency));
  return [200, { ...account(found), entries }];
}

// Currency first: it decides how many decimals the amount may have.
function moveFor(body: Body, move: (amount: bigint, currency: Currency) => Result<Transfer>): [number, unknown] {
  const currency = currencyOf(body);
  const amount = amountOf(body, currency);
  return [201, transfer(unwrap(move(amount, currency)))];
}

function postTransfer(ledger: Ledger, _params: number[], body: Body): [number, unknown] {
  const currency = currencyOf(body);
  const amount = amountOf(body, currency);
  const from = accountIdOf(body, 'from_account_id');
  const to = accountIdOf(body, 'to_account_id');
  return [201, transfer(unwrap(ledger.transfer(from, to, amount, currency)))];
}

function getTransfer(ledger: Ledger, [transferId]: number[]): [number, unknown] {
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
