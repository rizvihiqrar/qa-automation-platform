import type { Screen } from './app.ts';
import type { Ledger, Movement, Refusal } from './ledger.ts';
import { CASH_REPORT_THRESHOLD, CASH_WINDOW_MS, formatAmount } from './money.ts';
import { matchName, SANCTIONS_DEMO, type Listed, type Match } from './sanctions.ts';

// Anti-money-laundering rules on the screening step (BK-R42 to BK-R45), after the
// Canadian rules FINTRAC publishes: a report for cash of CAD 10,000 or more, the 24-hour
// rule, and a sanctions list. Each movement that reaches the screening gets exactly one
// decision, written to the audit table before the movement is written (or refused).
//
// Order of weight: blocked (a listed name), held (almost a listed name), reported
// (large cash), allowed. The strongest one decides; the others aren't looked for.

// The same words for a block and a hold, and no name from the list: the customer isn't
// told which, or why (no tipping off). The audit row has the difference.
const HOLD: Refusal = { ok: false, status: 422, code: 'screening_hold', error: 'this movement is held for review; contact the bank' };

export function amlScreen(ledger: Ledger, list: Listed[] = SANCTIONS_DEMO): Screen {
  return async (m: Movement) => {
    // Both parties are read, and the stronger match decides: an exact one beats a near one.
    let strongest: { accountId: number; match: Match } | null = null;
    for (const accountId of [m.from, m.to]) {
      if (accountId === null) continue;
      const account = ledger.getAccount(accountId);
      const match = account && matchName(account.owner, list);
      if (match && (!strongest || (match.kind === 'exact' && strongest.match.kind !== 'exact'))) strongest = { accountId, match };
    }
    if (strongest) {
      const blocked = strongest.match.kind === 'exact';
      ledger.recordDecision(m, blocked ? 'blocked' : 'held', blocked ? 'sanctions_match' : 'sanctions_near_match',
        `account ${strongest.accountId}: the owner ${blocked ? 'matches' : 'is one letter from'} list entry ${strongest.match.listed}`);
      return HOLD;
    }

    // Cash is a deposit into, or a withdrawal from, one customer account.
    const cashAccount = m.kind === 'deposit' ? m.to : m.kind === 'withdrawal' ? m.from : null;
    if (cashAccount !== null && (m.kind === 'deposit' || m.kind === 'withdrawal')) {
      const threshold = CASH_REPORT_THRESHOLD[m.currency];
      const shown = (minor: bigint) => `${formatAmount(minor, m.currency)} ${m.currency}`;
      if (m.amount >= threshold) {
        ledger.recordDecision(m, 'reported', 'large_cash', `account ${cashAccount}: ${m.kind} of ${shown(m.amount)} is at or over ${shown(threshold)}`);
        return;
      }
      const since = new Date(Date.parse(ledger.now()) - CASH_WINDOW_MS).toISOString();
      const total = ledger.cashTotal(cashAccount, m.kind, since) + m.amount;
      if (total >= threshold) {
        ledger.recordDecision(m, 'reported', '24_hour', `account ${cashAccount}: ${shown(total)} in ${m.kind}s in 24 hours, with this one, is at or over ${shown(threshold)}`);
        return;
      }
    }
    ledger.recordDecision(m, 'allowed', null, 'no rule applied');
  };
}
