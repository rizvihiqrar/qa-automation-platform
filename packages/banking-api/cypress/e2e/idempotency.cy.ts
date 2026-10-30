// A double click, a second Enter, or a retry after a reply that never arrived moves
// the money once: the page keeps one Idempotency-Key per filled form (BK-R35), and the
// API replays a key it has already used (BK-R20).

const form = (name: string) => `[data-cy=${name}-form]`;
const busy = { error: 'the database is busy; try again', code: 'busy' };

describe('one movement per filled form', () => {
  it('BK-R35 a double click on Deposit sends one request and writes one entry', () => {
    cy.intercept('POST', '/accounts/*/deposits').as('deposit');
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('deposit')} [data-cy=amount]`).type('5');
      cy.get(`${form('deposit')} [data-cy=submit]`).dblclick();
      cy.get(`${form('deposit')} [data-cy=status]`).should('have.text', 'Deposited 5.00 CAD.');
      cy.get('@deposit.all').should('have.length', 1);
      cy.statementOf(id).then((s) => {
        expect(s.entries).to.have.length(1);
        expect(s.balance).to.equal('5.00');
      });
    });
  });

  it('BK-R35 pressing Enter twice in the amount field moves the money once', () => {
    cy.openAccount('JPY').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('deposit')} [data-cy=amount]`).type('500{enter}{enter}');
      cy.get(`${form('deposit')} [data-cy=status]`).should('have.text', 'Deposited 500 JPY.');
      cy.statementOf(id).its('entries').should('have.length', 1);
    });
  });

  it('BK-R35 a double click on Transfer moves the money once, on both accounts', () => {
    cy.openAccount('KWD', 'From').then((from) => {
      cy.openAccount('KWD', 'To').then((to) => {
        cy.apiDeposit(from, '2.000', 'KWD');
        cy.visit(`/#/accounts/${from}`);
        cy.get(`${form('transfer')} [data-cy=to]`).select(`#${to} To (KWD)`);
        cy.get(`${form('transfer')} [data-cy=amount]`).type('0.750');
        cy.get(`${form('transfer')} [data-cy=submit]`).dblclick();
        cy.get(`${form('transfer')} [data-cy=status]`).should('have.text', 'Transferred 0.750 KWD.');
        cy.get('[data-cy=balance]').should('have.text', '1.250');
        cy.statementOf(to).then((s) => {
          expect(s.entries).to.have.length(1);
          expect(s.balance).to.equal('0.750');
        });
      });
    });
  });

  it('BK-R35 BK-R20 a reply lost after the money moved is retried with the same key and replayed, not moved again', () => {
    let calls = 0;
    // The first reply is replaced on its way back: the server wrote the deposit, the
    // page sees 503. The page retries with the same key, and the server replays it.
    cy.intercept('POST', '/accounts/*/deposits', (req) => {
      calls += 1;
      if (calls === 1) req.continue((res) => res.send(503, busy));
    }).as('deposit');
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('deposit')} [data-cy=amount]`).type('5.00');
      cy.get(`${form('deposit')} [data-cy=submit]`).click();
      cy.get(`${form('deposit')} [data-cy=status]`).should('have.text', 'Deposited 5.00 CAD.');
      cy.get(`${form('deposit')} [data-cy=error]`).should('be.empty');
      // A call is listed as soon as it is sent and its reply is added later, so the reply is
      // asserted inside should(), which retries, not read after it.
      type Sent = { request: { headers: Record<string, string> }; response?: { headers: Record<string, string> } };
      cy.get('@deposit.all').should((all) => {
        const sent = all as unknown as Sent[];
        expect(sent).to.have.length(2);
        expect(sent[1]!.response?.headers['idempotent-replayed'], 'the retry is a replay').to.equal('true');
        expect(sent[0]!.request.headers['idempotency-key'], 'a key is sent').to.match(/^[0-9a-f-]{36}$/);
        expect(sent[1]!.request.headers['idempotency-key'], 'the retry reuses it').to.equal(sent[0]!.request.headers['idempotency-key']);
      });
      cy.get('[data-cy=entry]').should('have.length', 1);
      cy.statementOf(id).its('balance').should('equal', '5.00');
    });
  });

  for (const status of [409, 502, 503, 504]) {
    it(`BK-R35 a ${status} that never reached the bank is retried with the same key, and the money moves once`, () => {
      let calls = 0;
      cy.intercept('POST', '/accounts/*/withdrawals', (req) => {
        calls += 1;
        if (calls === 1) req.reply({ statusCode: status, body: busy });
      }).as('withdraw');
      cy.openAccount('USD').then((id) => {
        cy.apiDeposit(id, '3.00', 'USD');
        cy.visit(`/#/accounts/${id}`);
        cy.get(`${form('withdraw')} [data-cy=amount]`).type('1');
        cy.get(`${form('withdraw')} [data-cy=submit]`).click();
        cy.get(`${form('withdraw')} [data-cy=status]`).should('have.text', 'Withdrew 1.00 USD.');
        cy.get('@withdraw.all').should('have.length', 2).then((calls) => {
          const keys = (calls as unknown as { request: { headers: Record<string, string> } }[]).map((c) => c.request.headers['idempotency-key']);
          expect(keys[1]).to.equal(keys[0]);
        });
        cy.get('[data-cy=balance]').should('have.text', '2.00');
      });
    });
  }

  it('BK-R35 a network failure before the bank is reached is retried, and the money moves once', () => {
    let calls = 0;
    cy.intercept('POST', '/accounts/*/deposits', (req) => {
      calls += 1;
      if (calls === 1) req.reply({ forceNetworkError: true });
    }).as('deposit');
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('deposit')} [data-cy=amount]`).type('2.50');
      cy.get(`${form('deposit')} [data-cy=submit]`).click();
      cy.get(`${form('deposit')} [data-cy=status]`).should('have.text', 'Deposited 2.50 CAD.');
      cy.get('[data-cy=entry]').should('have.length', 1);
    });
  });

  it('BK-R35 when no reply is ever confirmed the page says so, and sending again replays instead of paying twice', () => {
    // Every reply of the first click is lost (4 tries), though the first one moved the
    // money. The page keeps the key; the user's second click is answered with a replay.
    let calls = 0;
    cy.intercept('POST', '/accounts/*/deposits', (req) => {
      calls += 1;
      if (calls <= 4) req.continue((res) => res.send(503, busy));
    }).as('deposit');
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('deposit')} [data-cy=amount]`).type('9.99');
      cy.get(`${form('deposit')} [data-cy=submit]`).click();
      cy.get(`${form('deposit')} [data-cy=error]`, { timeout: 10000 })
        .should('have.text', 'The bank did not confirm this. Send it again: it will not move the money twice.');
      cy.get(`${form('deposit')} [data-cy=amount]`).should('have.value', '9.99');
      cy.get('[data-cy=balance]').should('have.text', '9.99'); // read again from the API: it did move
      cy.get(`${form('deposit')} [data-cy=submit]`).click();
      cy.get(`${form('deposit')} [data-cy=status]`).should('have.text', 'Deposited 9.99 CAD.');
      cy.get('@deposit.all').should('have.length', 5).then((calls) => {
        const keys = new Set((calls as unknown as { request: { headers: Record<string, string> } }[]).map((c) => c.request.headers['idempotency-key']));
        expect(keys.size, 'one key for all five requests').to.equal(1);
      });
      cy.statementOf(id).then((s) => {
        expect(s.entries).to.have.length(1);
        expect(s.balance).to.equal('9.99');
      });
    });
  });

  it('BK-R35 the same amount deposited twice on purpose is two deposits: a confirmed form starts a new key', () => {
    cy.intercept('POST', '/accounts/*/deposits').as('deposit');
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      for (let i = 1; i <= 2; i++) {
        cy.get(`${form('deposit')} [data-cy=amount]`).type('4.00');
        cy.get(`${form('deposit')} [data-cy=submit]`).click();
        cy.get('[data-cy=entry]').should('have.length', i);
      }
      cy.get('[data-cy=balance]').should('have.text', '8.00');
      cy.get('@deposit.all').then((calls) => {
        const keys = (calls as unknown as { request: { headers: Record<string, string> } }[]).map((c) => c.request.headers['idempotency-key']);
        expect(keys).to.have.length(2);
        expect(keys[1]).not.to.equal(keys[0]);
      });
    });
  });

  it('BK-R35 a refused movement gives up its key: the same form sent again after a deposit is a new request', () => {
    cy.intercept('POST', '/accounts/*/withdrawals').as('withdraw');
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('withdraw')} [data-cy=amount]`).type('1.00');
      cy.get(`${form('withdraw')} [data-cy=submit]`).click();
      cy.get(`${form('withdraw')} [data-cy=error]`).should('contain', 'insufficient funds');
      cy.apiDeposit(id, '1.00', 'CAD');
      cy.get(`${form('withdraw')} [data-cy=submit]`).click();
      cy.get(`${form('withdraw')} [data-cy=status]`).should('have.text', 'Withdrew 1.00 CAD.');
      cy.get('@withdraw.all').then((calls) => {
        const keys = (calls as unknown as { request: { headers: Record<string, string> } }[]).map((c) => c.request.headers['idempotency-key']);
        expect(keys[1]).not.to.equal(keys[0]);
      });
      cy.get('[data-cy=balance]').should('have.text', '0.00');
    });
  });
});
