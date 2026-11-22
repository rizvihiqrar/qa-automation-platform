// ITIL change types on the release gate (standard, normal, emergency).
// A change type decides who must approve, how long a release waits, and what is owed afterwards.
// It never relaxes the checks: an emergency change skips the wait, not the tests.

export const DEFAULT_CHANGE_TYPES = {
  standard: { needsApproval: false, waitHours: 0, needsReason: false, reviewWithinDays: 0 },
  normal: { needsApproval: true, waitHours: 24, needsReason: false, reviewWithinDays: 0 },
  emergency: { needsApproval: true, waitHours: 0, needsReason: true, reviewWithinDays: 5 },
};

export const CHANGE_WORDS = {
  standard: 'A standard change is a low-risk, pre-approved kind of change. It needs no approval and no wait.',
  normal: 'A normal change needs an approver and a waiting period before it goes out.',
  emergency: 'An emergency change skips the waiting period, but every check must still pass, and a review is owed afterwards.',
};

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const isText = (v) => typeof v === 'string' && v.trim() !== '';

// Only a full date-time with a zone is accepted, so "Nov 3" or a date with no time cannot slip through.
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-](\d{2}):(\d{2}))$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Date.parse rolls 2026-02-31 over to March, so the day is checked by writing it back out.
export function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

function time(value, field) {
  const m = isText(value) ? DATE_TIME.exec(value) : null;
  const inRange = m && isRealDate(m[1]) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4] ?? 0) < 60 && Number(m[5] ?? 0) <= 23 && Number(m[6] ?? 0) < 60;
  if (!inRange) throw new Error(`release file: change.${field} must be a date and time such as 2026-11-20T09:00Z`);
  return Date.parse(value);
}

// A policy override is checked too, so a typo such as "24h" cannot switch a rule off without a sound.
const OVERRIDES = { needsApproval: 'boolean', needsReason: 'boolean', waitHours: 'number', reviewWithinDays: 'number' };
function ruleFor(policy, type) {
  const override = policy.changeTypes?.[type] ?? {};
  for (const [key, value] of Object.entries(override)) {
    const kind = OVERRIDES[key];
    if (!kind) throw new Error(`policy: changeTypes.${type}.${key} is not a setting (use ${Object.keys(OVERRIDES).join(', ')})`);
    const ok = kind === 'boolean' ? typeof value === 'boolean' : typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (!ok) throw new Error(`policy: changeTypes.${type}.${key} must be ${kind === 'boolean' ? 'true or false' : 'a number of zero or more'}`);
  }
  return { ...DEFAULT_CHANGE_TYPES[type], ...override };
}

/**
 * Checks the change block of a release file and returns it. Throws a message that names the field.
 * @param {unknown} input
 */
export function validateChange(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('release file: "change" must be an object with type, requestedAt and plannedFor');
  const c = /** @type {Record<string, any>} */ (input);
  if (!Object.hasOwn(DEFAULT_CHANGE_TYPES, c.type)) throw new Error(`release file: change.type must be one of ${Object.keys(DEFAULT_CHANGE_TYPES).join(', ')}`);
  time(c.requestedAt, 'requestedAt');
  time(c.plannedFor, 'plannedFor');
  if (c.approvedBy !== undefined && !isText(c.approvedBy)) throw new Error('release file: change.approvedBy must be text');
  if (c.reason !== undefined && !isText(c.reason)) throw new Error('release file: change.reason must be text');
  if (c.reviewDoneOn !== undefined && !isRealDate(c.reviewDoneOn)) {
    throw new Error('release file: change.reviewDoneOn must be a date such as 2026-11-25');
  }
  return c;
}

/**
 * Applies the rules of the change type. Returns the problems that block the release and what is owed afterwards.
 * @param {{ changeTypes?: Record<string, object> }} policy
 * @param {unknown} changeInput
 */
export function evaluateChange(policy, changeInput) {
  const change = validateChange(changeInput);
  const rules = ruleFor(policy, change.type);
  const problems = [];

  if (rules.needsApproval && !isText(change.approvedBy)) problems.push(`a ${change.type} change needs an approver and none is named`);
  if (rules.needsReason && !isText(change.reason)) problems.push(`a ${change.type} change needs the reason it cannot wait`);

  const requested = Date.parse(change.requestedAt);
  const planned = Date.parse(change.plannedFor);
  const waited = (planned - requested) / HOUR;
  if (planned < requested) problems.push('the release is planned for before the change was requested');
  else if (rules.waitHours > 0 && waited < rules.waitHours) {
    problems.push(`a ${change.type} change waits ${rules.waitHours} hours and this one waits ${Math.floor(waited * 10) / 10}`);
  }

  const obligations = [];
  let reviewDueBy = null;
  if (rules.reviewWithinDays > 0) {
    reviewDueBy = new Date(planned + rules.reviewWithinDays * DAY).toISOString().slice(0, 10);
    // A review dated before the release it reviews is not a review of it.
    if (change.reviewDoneOn && change.reviewDoneOn < change.plannedFor.slice(0, 10)) problems.push(`the review is dated ${change.reviewDoneOn}, before the release on ${change.plannedFor.slice(0, 10)}`);
    obligations.push(change.reviewDoneOn
      ? `The review was done on ${change.reviewDoneOn}.`
      : `A review of this change is owed by ${reviewDueBy}.`);
  }
  return { type: change.type, change, rules, problems, obligations, reviewDueBy };
}

/**
 * Is the review that an emergency change owes done, still due, or late?
 * @param {{ reviewDueBy: string | null, change: { reviewDoneOn?: string } }} evaluation
 * @param {string} today a date such as 2026-11-22 (passed in, so a test never depends on the clock)
 */
export function reviewStatus(evaluation, today) {
  if (!evaluation.reviewDueBy) return 'none';
  if (evaluation.change.reviewDoneOn) return 'done';
  return today > evaluation.reviewDueBy ? 'overdue' : 'due';
}

/**
 * Adds the change rules to the gate's outcome: a problem blocks the release like any other failed check.
 * The checks themselves are not touched, so a change type can never turn a failed check into a pass.
 * A change block that cannot be read is a failed change-control check too, so the gate table says why.
 * With no change block at all the outcome is returned as it is, unless the policy sets "requireChange".
 * @template {{ decision: string, reasons: string[], checks: Array<{ name: string, status: string, detail: string }> }} T
 * @param {T} outcome
 * @param {{ changeTypes?: Record<string, object>, requireChange?: boolean }} policy
 * @param {unknown} changeInput
 */
export function applyChange(outcome, policy, changeInput) {
  const blocked = (problem) => ({
    ...outcome,
    decision: 'no-go',
    reasons: [...outcome.reasons, `change-control: ${problem}`],
    checks: [...outcome.checks, { name: 'change-control', status: 'fail', detail: problem }],
  });
  if (changeInput === undefined) return policy.requireChange ? blocked('this policy needs a change type and the release file has none') : outcome;
  let change;
  try { change = evaluateChange(policy, changeInput); } catch (err) { return blocked(err.message); }
  const ok = change.problems.length === 0;
  const detail = ok
    ? `${change.type} change, ${change.change.approvedBy ? `approved by ${change.change.approvedBy}` : 'no approval needed'}`
    : change.problems.join('; ');
  return {
    ...outcome,
    decision: outcome.decision === 'go' && ok ? 'go' : 'no-go',
    reasons: [...outcome.reasons, ...change.problems.map((p) => `change-control: ${p}`)],
    checks: [...outcome.checks, { name: 'change-control', status: ok ? 'pass' : 'fail', detail }],
    change,
  };
}
