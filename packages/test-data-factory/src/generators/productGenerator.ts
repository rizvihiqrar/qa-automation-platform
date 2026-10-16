import { faker } from '@faker-js/faker';
import type { Product } from '../types.ts';

export function generateProduct(overrides: Partial<Product> = {}): Product {
  return {
    id:          faker.string.uuid(),
    sku:         faker.string.alphanumeric(8).toUpperCase(),
    name:        faker.commerce.productName(),
    description: faker.commerce.productDescription(),
    category:    faker.commerce.department(),
    price:       parseFloat(faker.commerce.price({ min: 1, max: 1000 })),
    stock:       faker.number.int({ min: 0, max: 500 }),
    available:   faker.datatype.boolean({ probability: 0.85 }),
    createdAt:   faker.date.past({ years: 3 }).toISOString(),
    ...overrides,
  };
}

export function generateProducts(count = 10, overrides: Partial<Product> = {}): Product[] {
  return Array.from({ length: count }, () => generateProduct(overrides));
}
