// A realistic walk through qa-practice-api: sign up, browse, buy, update.
// Two steps send invalid product data on purpose; the contract says 400.

export function steps() {
  const email = `drift-${Date.now()}@example.com`;
  const password = 'Str0ng-pass!';
  return [
    { name: 'health check', method: 'GET', path: '/health', expect: 200 },
    { name: 'register', method: 'POST', path: '/auth/register', body: { name: 'Drift Check', email, password }, expect: 201,
      save: (b) => ({ token: b.token, userId: b.user.id }) },
    { name: 'register the same email again', method: 'POST', path: '/auth/register', body: { name: 'Again', email, password }, expect: 409 },
    { name: 'log in with a wrong password', method: 'POST', path: '/auth/login', body: { email, password: 'wrong' }, expect: 401 },
    { name: 'log in', method: 'POST', path: '/auth/login', body: { email, password }, expect: 200, save: (b) => ({ token: b.token }) },
    { name: 'current user', method: 'GET', path: '/auth/me', auth: true, expect: 200 },
    { name: 'current user without a token', method: 'GET', path: '/auth/me', expect: 401 },
    { name: 'create a product', method: 'POST', path: '/products', auth: true,
      body: { name: 'Backpack', category: 'bags', price: 29.99, stock: 10 }, expect: 201, save: (b) => ({ productId: b.id }) },
    { name: 'list products', method: 'GET', path: '/products', expect: 200 },
    { name: 'get the product', method: 'GET', path: '/products/{productId}', expect: 200 },
    { name: 'get a missing product', method: 'GET', path: '/products/999999', expect: 404 },
    { name: 'create a product with a non-numeric price', method: 'POST', path: '/products', auth: true,
      body: { name: 'Bad price', category: 'bags', price: 'abc', stock: 1 }, expect: 400 },
    { name: 'create a product with negative stock', method: 'POST', path: '/products', auth: true,
      body: { name: 'Bad stock', category: 'bags', price: 5, stock: -3 }, expect: 400 },
    { name: 'order two of the product', method: 'POST', path: '/orders', auth: true,
      body: (v) => ({ items: [{ product_id: v.productId, quantity: 2 }] }), expect: 201, save: (b) => ({ orderId: b.id }) },
    { name: 'list my orders', method: 'GET', path: '/orders', auth: true, expect: 200 },
    { name: 'get the order', method: 'GET', path: '/orders/{orderId}', auth: true, expect: 200 },
    { name: 'mark the order shipped', method: 'PATCH', path: '/orders/{orderId}/status', auth: true, body: { status: 'shipped' }, expect: 200 },
    { name: 'set an unknown status', method: 'PATCH', path: '/orders/{orderId}/status', auth: true, body: { status: 'lost' }, expect: 400 },
    { name: 'list users', method: 'GET', path: '/users', auth: true, expect: 200 },
    { name: 'get my user', method: 'GET', path: '/users/{userId}', auth: true, expect: 200 },
  ];
}
