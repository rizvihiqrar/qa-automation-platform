import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HttpError, Shop, type Order, type User } from './shop.ts';
import { STAFF_STEPS, isStatus } from './status.ts';

// A plain node:http server: no framework, no runtime dependencies. Every response is
// JSON with an X-Request-Id header, and every refusal is { error, code }.

const MAX_BODY_BYTES = 16 * 1024;
const KEY_MAX = 255;

type Body = Record<string, unknown>;
type Reply = [status: number, payload: unknown, headers?: Record<string, string>];
interface Context { shop: Shop; params: string[]; req: IncomingMessage }
type Handler = (ctx: Context) => Reply | Promise<Reply>;
interface Route { pattern: RegExp; methods: Record<string, Handler> }

const ID = '([1-9][0-9]{0,14})';
const SLUG = '([a-z-]{1,40})';

const routes: Route[] = [
  { pattern: /^\/health$/, methods: { GET: () => [200, { status: 'ok' }] } },
  { pattern: /^\/menu$/, methods: { GET: ({ shop }) => [200, { items: shop.listMenu() }] } },
  { pattern: new RegExp(`^/menu/${SLUG}$`), methods: { PATCH: patchMenuItem } },
  { pattern: /^\/auth\/login$/, methods: { POST: postLogin } },
  { pattern: /^\/orders$/, methods: { POST: postOrder } },
  { pattern: new RegExp(`^/orders/${ID}$`), methods: { GET: getOrder } },
  { pattern: new RegExp(`^/orders/${ID}/status$`), methods: { PATCH: patchStatus } },
  { pattern: new RegExp(`^/orders/${ID}/pay$`), methods: { POST: postPay } },
  { pattern: new RegExp(`^/orders/${ID}/cancel$`), methods: { POST: postCancel } },
  { pattern: new RegExp(`^/orders/${ID}/refund$`), methods: { POST: postRefund } },
  { pattern: new RegExp(`^/orders/${ID}/tracking$`), methods: { GET: getTracking } },
];

export function createApp(shop: Shop = new Shop()): Server {
  return createServer((req, res) => {
    const id = randomUUID();
    handle(shop, req, res, id).catch((err: unknown) => {
      // A 413 stops reading partway, so the rest of the body would land on the next request.
      if (err instanceof HttpError) return send(res, id, err.status, { error: err.message, code: err.code, ...err.extra }, err.status === 413 ? { Connection: 'close' } : {});
      console.error(err);
      send(res, id, 500, { error: 'internal error', code: 'internal' });
    });
  });
}

async function handle(shop: Shop, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const [pathname = '/'] = (req.url ?? '/').split('?');
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const handler = route.methods[req.method ?? ''];
    if (!handler) {
      const allow = Object.keys(route.methods).join(', ');
      throw new HttpError(405, 'method_not_allowed', `${req.method} is not allowed here; use ${allow}`);
    }
    const [status, payload, headers] = await handler({ shop, params: match.slice(1), req });
    return send(res, id, status, payload, headers);
  }
  throw new HttpError(404, 'not_found', `no route for ${pathname}`);
}

// Read by the handlers after they check who is asking, so a stranger's body is never
// parsed. No body at all is an empty object: cancel and a full refund need none.
async function readJson(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large', `body must be at most ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) throw new HttpError(415, 'unsupported_media_type', 'send the body as application/json');
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'the body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'invalid_json', 'the body must be a JSON object');
  return body as Body;
}

function send(res: ServerResponse, id: string, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': id, 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}

function signedIn({ shop, req }: Context): User {
  const [, token] = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '') ?? [];
  const user = token ? shop.userFor(token) : undefined;
  if (!user) throw new HttpError(401, 'unauthorized', 'sign in first: send Authorization: Bearer <token>');
  return user;
}

function staff(ctx: Context): User {
  const user = signedIn(ctx);
  if (user.role !== 'staff') throw new HttpError(403, 'forbidden', 'only staff can do this');
  return user;
}

const orderIn = (ctx: Context, user: User): Order => ctx.shop.orderFor(user, Number(ctx.params[0]));

// What a reader of the API sees: driver_steps is the tracking route's own business.
function view({ driver_steps: _steps, ...order }: Order): Omit<Order, 'driver_steps'> {
  return order;
}

async function postLogin({ shop, req }: Context): Promise<Reply> {
  const { email, password } = await readJson(req);
  return [200, shop.login(email, password)];
}

async function patchMenuItem(ctx: Context): Promise<Reply> {
  staff(ctx);
  const { sold_out: soldOut } = await readJson(ctx.req);
  return [200, ctx.shop.setSoldOut(ctx.params[0]!, soldOut)];
}

async function postOrder(ctx: Context): Promise<Reply> {
  const user = signedIn(ctx);
  const { items, fulfilment, address } = await readJson(ctx.req);
  return [201, view(ctx.shop.placeOrder(user, { items, fulfilment, address }))];
}

function getOrder(ctx: Context): Reply {
  return [200, view(orderIn(ctx, signedIn(ctx)))];
}

async function patchStatus(ctx: Context): Promise<Reply> {
  const user = staff(ctx);
  const order = orderIn(ctx, user);
  const { status } = await readJson(ctx.req);
  if (!isStatus(status) || !STAFF_STEPS.includes(status)) throw new HttpError(400, 'invalid_status', `status must be one of ${STAFF_STEPS.join(', ')}; paying and cancelling have their own routes`);
  return [200, view(ctx.shop.moveTo(order, status))];
}

async function postPay(ctx: Context): Promise<Reply> {
  const user = signedIn(ctx);
  const order = orderIn(ctx, user);
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key === '' || key.length > KEY_MAX) throw new HttpError(400, 'idempotency_key_required', `send an Idempotency-Key header of 1 to ${KEY_MAX} characters`);
  const { card_number: card } = await readJson(ctx.req);
  if (typeof card !== 'string' || !/^[0-9]{16}$/.test(card)) throw new HttpError(400, 'invalid_card', 'card_number must be 16 digits');
  const { reply: [status, payload], replayed } = await ctx.shop.pay(user, order, key, card);
  return [status, payload, replayed ? { 'Idempotent-Replayed': 'true' } : {}];
}

function postCancel(ctx: Context): Reply {
  return [200, view(ctx.shop.cancel(orderIn(ctx, signedIn(ctx))))];
}

async function postRefund(ctx: Context): Promise<Reply> {
  const user = staff(ctx);
  const order = orderIn(ctx, user);
  const { amount_cents: amount } = await readJson(ctx.req);
  return [200, ctx.shop.refund(order, amount)];
}

function getTracking(ctx: Context): Reply {
  return [200, ctx.shop.track(orderIn(ctx, signedIn(ctx)))];
}
