// The admin account the test server is seeded with (src/db/seed.ts reads these
// from the environment; playwright.config.ts passes them). Test-only credentials:
// a server started without ADMIN_EMAIL and ADMIN_PASSWORD has no admin.
// The fallbacks are throwaway test accounts on the local test server, not real
// credentials; set QA_PRACTICE_ADMIN_PASSWORD / QA_PRACTICE_PASSWORD to override.
export const ADMIN = { email: 'admin@qa-practice.test', password: process.env.QA_PRACTICE_ADMIN_PASSWORD || 'Admin-only-in-tests-1!' };

// Password for the customer accounts the tests register.
export const PASSWORD = process.env.QA_PRACTICE_PASSWORD || 'Pass123!';

// tests/global-setup.ts signs the admin in once and leaves the token here, so the
// tests don't each sign in (parallel sign-ins as one account would trip the limit).
export function adminToken(): string {
  const token = process.env.QA_ADMIN_TOKEN;
  if (!token) throw new Error('No admin token: run the tests through playwright.config.ts (global setup signs in)');
  return token;
}

export const adminAuth = (): { Authorization: string } => ({ Authorization: `Bearer ${adminToken()}` });

export const adminId = (): number => Number(process.env.QA_ADMIN_ID);
