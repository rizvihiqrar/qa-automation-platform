import { faker } from '@faker-js/faker';
import type { User } from '../types.ts';

export function generateUser(overrides: Partial<User> = {}): User {
  const firstName = faker.person.firstName();
  const lastName  = faker.person.lastName();
  return {
    id:        faker.string.uuid(),
    firstName,
    lastName,
    email:     faker.internet.email({ firstName, lastName }).toLowerCase(),
    phone:     faker.phone.number({ style: 'national' }),
    username:  faker.internet.username({ firstName, lastName }).toLowerCase(),
    address: {
      street:  faker.location.streetAddress(),
      city:    faker.location.city(),
      state:   faker.location.state({ abbreviated: true }),
      zip:     faker.location.zipCode(),
      country: 'US',
    },
    createdAt: faker.date.past({ years: 2 }).toISOString(),
    ...overrides,
  };
}

export function generateUsers(count = 10, overrides: Partial<User> = {}): User[] {
  return Array.from({ length: count }, () => generateUser(overrides));
}
