export interface Credentials {
  username: string;
  password: string;
}

// Public saucedemo test account (published on the site's login page); override with SAUCEDEMO_PASSWORD.
const PASSWORD = process.env.SAUCEDEMO_PASSWORD || 'secret_sauce';

export const USERS = {
  standard: { username: 'standard_user',            password: PASSWORD },
  glitch:   { username: 'performance_glitch_user',  password: PASSWORD },
} satisfies Record<string, Credentials>;
