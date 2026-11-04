// Feature flags, read once at start-up from FEATURE_FLAGS, a comma-separated list like
//   FEATURE_FLAGS=discount-codes:off
// A flag that is not listed keeps its default below. Changing a flag means a restart, so a
// running server never changes behaviour under the requests it is serving.
export const DEFAULTS = {
  // Orders may carry a discount code. Off: an order that names one is refused (400).
  'discount-codes': true,
} as const;

export type FlagName = keyof typeof DEFAULTS;
export type Flags = Record<FlagName, boolean>;

const isFlagName = (name: string): name is FlagName => Object.hasOwn(DEFAULTS, name);

// A flag name that is not known is ignored with a warning (a flag removed from the code can
// still be in a deployment's settings). A value other than on or off stops the start: a typo
// such as "of" must not leave a flag in the state nobody asked for.
export function parseFlags(raw: string | undefined, warn: (message: string) => void = console.warn): Flags {
  const flags: Flags = { ...DEFAULTS };
  const seen = new Set<string>();
  for (const entry of (raw ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const [name = '', value, ...rest] = entry.split(':').map((p) => p.trim());
    if (!name || value === undefined || rest.length) throw new Error(`FEATURE_FLAGS: "${entry}" is not name:on or name:off`);
    if (value !== 'on' && value !== 'off') throw new Error(`FEATURE_FLAGS: ${name} must be on or off, not "${value}"`);
    if (seen.has(name)) throw new Error(`FEATURE_FLAGS: ${name} is listed twice`);
    seen.add(name);
    if (isFlagName(name)) flags[name] = value === 'on';
    else warn(`FEATURE_FLAGS: unknown flag "${name}" ignored (known: ${Object.keys(DEFAULTS).join(', ')})`);
  }
  return flags;
}

export const flags: Flags = parseFlags(process.env.FEATURE_FLAGS);
