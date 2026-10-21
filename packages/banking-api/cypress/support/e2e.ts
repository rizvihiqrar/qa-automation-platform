import type { AxeResults, Result } from 'axe-core';

// Helpers for the UI tests. Setting up money goes through the API (cy.request), the way
// a second client would; only the behaviour under test goes through the page.

type Currency = 'CAD' | 'USD' | 'JPY' | 'KWD';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Opens an account through the API and yields its id. */
      openAccount(currency: Currency, owner?: string): Chainable<number>;
      /** Moves money through the API, as another tab or client would. */
      apiDeposit(id: number, amount: string, currency: Currency): Chainable<Cypress.Response<any>>;
      apiWithdraw(id: number, amount: string, currency: Currency): Chainable<Cypress.Response<any>>;
      /** The account's statement as the API returns it. */
      statementOf(id: number): Chainable<{ balance: string; entries: { kind: string; amount: string; balance_after: string }[] }>;
      /** Runs axe-core on the page: no WCAG 2.2 A or AA violation (BK-R37). */
      checkA11y(): Chainable<void>;
    }
  }
}

const json = { 'Content-Type': 'application/json' };

Cypress.Commands.add('openAccount', (currency: Currency, owner = 'Test Owner') =>
  cy.request({ method: 'POST', url: '/accounts', headers: json, body: { owner, currency } }).then((res) => res.body.id as number));

Cypress.Commands.add('apiDeposit', (id: number, amount: string, currency: Currency) =>
  cy.request({ method: 'POST', url: `/accounts/${id}/deposits`, headers: json, body: { amount, currency } }));

Cypress.Commands.add('apiWithdraw', (id: number, amount: string, currency: Currency) =>
  cy.request({ method: 'POST', url: `/accounts/${id}/withdrawals`, headers: json, body: { amount, currency } }));

Cypress.Commands.add('statementOf', (id: number) =>
  cy.request(`/accounts/${id}/entries`).then((res) => res.body));

const describeViolation = (v: Result) =>
  `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n')}`;

Cypress.Commands.add('checkA11y', () => {
  cy.readFile('node_modules/axe-core/axe.min.js', { log: false }).then((source: string) => {
    cy.window({ log: false }).then((win) => {
      const w = win as unknown as { axe?: { run: (ctx: Document, opts: object) => Promise<AxeResults> }; eval: (code: string) => void };
      if (!w.axe) w.eval(source);
      return w.axe!.run(win.document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    }).then((results) => {
      const violations = (results as AxeResults).violations;
      expect(violations.map(describeViolation), 'axe violations').to.deep.equal([]);
    });
  });
});

// Every spec ends with the SQL ledger checks on the database the run has written so
// far: whatever the UI did, every transfer still balances (BK-R30).
after(() => {
  cy.task<{ code: number; output: string }>('ledgerChecks', undefined, { log: false }).then(({ code, output }) => {
    expect(code, `npm run check on ui.db:\n${output}`).to.equal(0);
  });
});
