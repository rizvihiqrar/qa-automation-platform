// A realistic walk through qa-practice-api: sign up, browse, buy, update.
// Two steps send invalid product data on purpose; the contract says 400. The
// admin stocks the shop and moves the order on; the customer's attempts at either
// are refused (403).

// The server is seeded with this admin (src/live.js starts it with these values).
export const ADMIN = { email: 'admin@drift-check.test', password: 'Drift-admin-1!' };

export function steps() {
  const email = `drift-${Date.now()}@example.com`;
  const password = 'Str0ng-pass!';
  const code = `DRIFT-${Date.now().toString(36).toUpperCase()}`;
  return [
    { name: 'health check', method: 'GET', path: '/health', expect: 200 },
    { name: 'register', method: 'POST', path: '/auth/register', body: { name: 'Drift Check', email, password }, expect: 201,
      save: (b) => ({ token: b.token, userId: b.user.id }) },
    { name: 'register the same email again', method: 'POST', path: '/auth/register', body: { name: 'Again', email, password }, expect: 409 },
    { name: 'log in with a wrong password', method: 'POST', path: '/auth/login', body: { email, password: 'wrong' }, expect: 401 },
    { name: 'log in', method: 'POST', path: '/auth/login', body: { email, password }, expect: 200, save: (b) => ({ token: b.token }) },
    { name: 'log in as the admin', method: 'POST', path: '/auth/login', body: ADMIN, expect: 200, save: (b) => ({ adminToken: b.token }) },
    { name: 'current user', method: 'GET', path: '/auth/me', auth: true, expect: 200 },
    { name: 'current user without a token', method: 'GET', path: '/auth/me', expect: 401 },
    { name: 'create a product as a customer', method: 'POST', path: '/products', auth: true,
      body: { name: 'Backpack', category: 'bags', price: 29.99, stock: 10 }, expect: 403 },
    { name: 'create a product', method: 'POST', path: '/products', auth: 'adminToken',
      body: { name: 'Backpack', category: 'bags', price: 29.99, stock: 10 }, expect: 201, save: (b) => ({ productId: b.id }) },
    { name: 'list products', method: 'GET', path: '/products', expect: 200 },
    { name: 'get the product', method: 'GET', path: '/products/{productId}', expect: 200 },
    { name: 'get a missing product', method: 'GET', path: '/products/999999', expect: 404 },
    { name: 'create a product with a non-numeric price', method: 'POST', path: '/products', auth: 'adminToken',
      body: { name: 'Bad price', category: 'bags', price: 'abc', stock: 1 }, expect: 400 },
    { name: 'create a product with negative stock', method: 'POST', path: '/products', auth: 'adminToken',
      body: { name: 'Bad stock', category: 'bags', price: 5, stock: -3 }, expect: 400 },
    { name: 'order two of the product', method: 'POST', path: '/orders', auth: true,
      body: (v) => ({ items: [{ product_id: v.productId, quantity: 2 }] }), expect: 201, save: (b) => ({ orderId: b.id }) },
    { name: 'list my orders', method: 'GET', path: '/orders', auth: true, expect: 200 },
    { name: 'get the order', method: 'GET', path: '/orders/{orderId}', auth: true, expect: 200 },
    { name: 'mark my own order shipped', method: 'PATCH', path: '/orders/{orderId}/status', auth: true, body: { status: 'shipped' }, expect: 403 },
    { name: 'start processing the order', method: 'PATCH', path: '/orders/{orderId}/status', auth: 'adminToken', body: { status: 'processing' }, expect: 200 },
    { name: 'mark the order shipped', method: 'PATCH', path: '/orders/{orderId}/status', auth: 'adminToken', body: { status: 'shipped' }, expect: 200 },
    { name: 'move a shipped order back to pending', method: 'PATCH', path: '/orders/{orderId}/status', auth: 'adminToken', body: { status: 'pending' }, expect: 409 },
    { name: 'set an unknown status', method: 'PATCH', path: '/orders/{orderId}/status', auth: true, body: { status: 'lost' }, expect: 400 },
    { name: 'list users as a customer', method: 'GET', path: '/users', auth: true, expect: 403 },
    { name: 'list users', method: 'GET', path: '/users', auth: 'adminToken', expect: 200 },
    { name: 'get my user', method: 'GET', path: '/users/{userId}', auth: true, expect: 200 },
    { name: 'get the first user as a customer', method: 'GET', path: '/users/1', auth: true, expect: 403 },
    // Discount codes (written by an AI, docs/ai-written-code): admin-only, and an
    // order can carry one.
    { name: 'create a discount code as a customer', method: 'POST', path: '/discounts', auth: true, body: { code, type: 'percent', value: 10 }, expect: 403 },
    { name: 'list discount codes without a token', method: 'GET', path: '/discounts', expect: 401 },
    { name: 'create a discount code', method: 'POST', path: '/discounts', auth: 'adminToken',
      body: { code: code.toLowerCase(), type: 'percent', value: 10, max_uses: 5, min_subtotal: 10 }, expect: 201, save: (b) => ({ code: b.code }) },
    { name: 'create the same code in another case', method: 'POST', path: '/discounts', auth: 'adminToken', body: { code, type: 'fixed', value: 5 }, expect: 409 },
    { name: 'create a code with a percent of 0', method: 'POST', path: '/discounts', auth: 'adminToken', body: { code: `${code}-0`, type: 'percent', value: 0 }, expect: 400 },
    { name: 'list discount codes', method: 'GET', path: '/discounts', auth: 'adminToken', expect: 200 },
    { name: 'get the code', method: 'GET', path: '/discounts/{code}', auth: 'adminToken', expect: 200 },
    { name: 'get a missing code', method: 'GET', path: '/discounts/NO-SUCH-CODE', auth: 'adminToken', expect: 404 },
    { name: 'change the code\'s limit and expiry', method: 'PATCH', path: '/discounts/{code}', auth: 'adminToken', body: { max_uses: 3, expires_at: '2099-12-31T23:59:59Z' }, expect: 200 },
    { name: 'change the code\'s value', method: 'PATCH', path: '/discounts/{code}', auth: 'adminToken', body: { value: 50 }, expect: 400 },
    { name: 'order with the code', method: 'POST', path: '/orders', auth: true,
      body: (v) => ({ items: [{ product_id: v.productId, quantity: 1 }], discount_code: v.code }), expect: 201 },
    { name: 'order with the code a second time', method: 'POST', path: '/orders', auth: true,
      body: (v) => ({ items: [{ product_id: v.productId, quantity: 1 }], discount_code: v.code }), expect: 422 },
  ];
}
