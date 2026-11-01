import * as store from './store.ts';
import { hashPassword } from '../security/password.ts';

// Creates the admin account from ADMIN_EMAIL and ADMIN_PASSWORD when both are set.
// Sign-up always makes a customer and no route changes a role, so this is the only
// way to get an admin; the tests and the CI security scan start the server with it.
// Neither has a default: a server started without them has no admin at all.
export async function seedAdmin(env: NodeJS.ProcessEnv = process.env): Promise<store.User | null> {
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = env;
  if (!email || !password) return null;
  // On Postgres the account outlives a restart, so an existing one is kept as it is
  // (a changed ADMIN_PASSWORD does not replace its password).
  const existing = await store.users.findOne({ email });
  if (existing) return existing;
  try {
    return await store.users.insert({ name: 'Admin', email, password: await hashPassword(password), role: 'admin' });
  } catch (err) {
    // Another server on the same database created it while this one was hashing.
    if (err instanceof store.UniqueViolation) return store.users.findOne({ email });
    throw err;
  }
}
