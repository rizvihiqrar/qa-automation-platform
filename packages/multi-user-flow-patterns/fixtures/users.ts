export interface Credentials {
  username: string;
  password: string;
}

export const USERS = {
  standard: { username: 'standard_user',            password: 'secret_sauce' },
  glitch:   { username: 'performance_glitch_user',  password: 'secret_sauce' },
} satisfies Record<string, Credentials>;
