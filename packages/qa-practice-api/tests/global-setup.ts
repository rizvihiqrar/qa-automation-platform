// Runs once, after the web server is up: signs in as the seeded admin and passes
// the token to every worker through the environment.
import { request, type FullConfig } from '@playwright/test';
import { ADMIN } from './admin.ts';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  const api = await request.newContext({ baseURL });
  const res = await api.post('/auth/login', { data: ADMIN });
  if (res.status() !== 200) {
    throw new Error(`admin sign-in failed (${res.status()}): is the server seeded with ADMIN_EMAIL and ADMIN_PASSWORD? ${await res.text()}`);
  }
  const { token, user } = await res.json();
  process.env.QA_ADMIN_TOKEN = token;
  process.env.QA_ADMIN_ID = String(user.id);
  await api.dispose();
}
