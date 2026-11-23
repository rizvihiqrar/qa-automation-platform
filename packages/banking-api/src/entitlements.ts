import { readFileSync } from 'node:fs';

// Who may do what (BK-R46 to BK-R49): a matrix of roles and actions kept in one committed file,
// `src/entitlements.json`, so a change to it is a change a person reviews. The roles are a
// claim in an `X-Role` header, not a sign-in: nothing here proves who is asking.

// What a request is for. Each route names one (`app.ts`), and /health is for nobody in particular.
export const ACTIONS = ['view', 'open_account', 'deposit', 'withdraw', 'transfer', 'read_audit'] as const;
export type Action = (typeof ACTIONS)[number];

export type Matrix = Record<string, readonly Action[]>;

// An action as words, for a message: read_audit is "read audit".
export const words = (action: Action): string => action.replaceAll('_', ' ');

// The file's shape: { "roles": { "<role>": ["<action>", ...] } }. A mistake in it stops the
// server from starting, with a message saying which one, so a typo can't quietly grant or
// remove a permission.
export function parseMatrix(value: unknown): Matrix {
  const roles = (value as { roles?: unknown } | null)?.roles;
  if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) throw new Error('entitlements: expected { "roles": { ... } }');
  const matrix: Matrix = Object.create(null);
  const names = Object.keys(roles);
  if (names.length === 0) throw new Error('entitlements: there must be at least one role');
  for (const name of names) {
    const actions = (roles as Record<string, unknown>)[name];
    if (!/^[a-z][a-z_]*$/.test(name)) throw new Error(`entitlements: the role "${name}" must be lowercase letters and underscores`);
    if (!Array.isArray(actions)) throw new Error(`entitlements: the role "${name}" must list its actions in an array`);
    for (const action of actions) {
      if (!(ACTIONS as readonly unknown[]).includes(action)) throw new Error(`entitlements: the role "${name}" has an unknown action ${JSON.stringify(action)}`);
    }
    if (new Set(actions).size !== actions.length) throw new Error(`entitlements: the role "${name}" lists an action twice`);
    matrix[name] = actions as Action[];
  }
  return matrix;
}

// The file's text, not just its value: JSON.parse keeps the last of two keys with the same name, so a
// role pasted in twice would quietly replace the first, and only the text shows it.
export function parseMatrixText(text: string): Matrix {
  const names = [...text.matchAll(/"([^"\\]+)"\s*:\s*\[/g)].map((m) => m[1]!);
  const twice = names.find((name, i) => names.indexOf(name) !== i);
  if (twice !== undefined) throw new Error(`entitlements: the role "${twice}" appears twice`);
  return parseMatrix(JSON.parse(text));
}

export const MATRIX: Matrix = parseMatrixText(readFileSync(new URL('./entitlements.json', import.meta.url), 'utf8'));

// Whether the role may do the action. A role that isn't in the matrix may do nothing, and
// names such as "constructor" are not roles.
export const can = (matrix: Matrix, role: string, action: Action): boolean =>
  Object.hasOwn(matrix, role) && matrix[role]!.includes(action);

// The matrix as a Markdown table, the one in the guide (a test keeps the two the same).
export function renderTable(matrix: Matrix): string {
  const lines = [`| Role | ${ACTIONS.map((a) => `\`${a}\``).join(' | ')} |`, `|---|${ACTIONS.map(() => ':---:').join('|')}|`];
  for (const role of Object.keys(matrix)) lines.push(`| ${role} | ${ACTIONS.map((a) => (can(matrix, role, a) ? 'yes' : 'no')).join(' | ')} |`);
  return lines.join('\n');
}
