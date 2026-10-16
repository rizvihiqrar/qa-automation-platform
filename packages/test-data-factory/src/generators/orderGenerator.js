import { faker } from '@faker-js/faker';

export const STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const SHIPPED_STATUSES = new Set(['shipped', 'delivered']);

export function generateOrder(overrides = {}) {
  const qty       = faker.number.int({ min: 1, max: 5 });
  const price     = parseFloat(faker.commerce.price({ min: 5, max: 500 }));
  const status    = overrides.status ?? faker.helpers.arrayElement(STATUSES);
  const orderedAt = faker.date.past({ years: 1 });
  // Only shipped or delivered orders have a ship date, and it can't be before the order.
  const shippedAt = SHIPPED_STATUSES.has(status)
    ? faker.date.between({ from: orderedAt, to: faker.defaultRefDate() }).toISOString()
    : null;
  return {
    orderId:     faker.string.uuid(),
    userId:      faker.string.uuid(),
    product:     faker.commerce.productName(),
    category:    faker.commerce.department(),
    quantity:    qty,
    unitPrice:   price,
    total:       parseFloat((qty * price).toFixed(2)),
    status,
    orderedAt:   orderedAt.toISOString(),
    shippedAt,
    ...overrides,
  };
}

export function generateOrders(count = 10, overrides = {}) {
  return Array.from({ length: count }, () => generateOrder(overrides));
}
