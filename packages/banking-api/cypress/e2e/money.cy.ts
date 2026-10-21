// Money typed as text: each currency's decimals, amounts a double can't hold, and the
// refusals the user sees. Setup goes through the API; the movement under test through
// the page.

const form = (name: string) => `[data-cy=${name}-form]`;

function submit(name: string, amount: string): void {
  const field = cy.get(`${form(name)} [data-cy=amount]`).clear();
  if (amount !== '') field.type(amount);
  cy.get(`${form(name)} [data-cy=submit]`).click();
  cy.get(`${form(name)} [data-cy=submit]`).should('not.be.disabled');
}

describe('amounts typed as text', () => {
  for (const [currency, typed, shown] of [
    ['CAD', '12.5', '12.50'],
    ['CAD', '7', '7.00'],
    ['USD', '0.01', '0.01'],
    ['JPY', '1250', '1250'],
    ['KWD', '0.125', '0.125'],
    ['KWD', '3', '3.000'],
  ] as const) {
    it(`BK-R02 BK-R07 BK-R33 a ${currency} deposit typed as "${typed}" is shown as ${shown}, in the status, balance and statement`, () => {
      cy.openAccount(currency).then((id) => {
        cy.visit(`/#/accounts/${id}`);
        submit('deposit', typed);
        cy.get(`${form('deposit')} [data-cy=status]`).should('have.text', `Deposited ${shown} ${currency}.`);
        cy.get('[data-cy=balance]').should('have.text', shown);
        cy.get('[data-cy=entry]').should('have.length', 1).first().within(() => {
          cy.contains('td', 'Deposit');
          cy.get('[data-cy=amount]').should('have.text', shown);
          cy.get('[data-cy=balance-after]').should('have.text', shown);
        });
        cy.get(`${form('deposit')} [data-cy=amount]`).should('have.value', '');
      });
    });
  }

  it('BK-R33 spaces around the amount are dropped before it is sent', () => {
    cy.intercept('POST', '/accounts/*/deposits').as('deposit');
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      submit('deposit', '  5  ');
      cy.wait('@deposit').its('request.body.amount').should('equal', '5');
      cy.get('[data-cy=balance]').should('have.text', '5.00');
    });
  });

  it('BK-R04 BK-R33 three deposits of 0.10 show exactly 0.30 (as doubles they sum to 0.30000000000000004)', () => {
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      for (let i = 0; i < 3; i++) submit('deposit', '0.10');
      cy.get('[data-cy=balance]').should('have.text', '0.30');
      cy.get('[data-cy=balance-after]').last().should('have.text', '0.30');
    });
  });

  it('BK-R04 BK-R33 an amount above 2^53 minor units stays exact on the page: 90071992547409.93 + 0.01', () => {
    cy.intercept('POST', '/accounts/*/deposits').as('deposit');
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      submit('deposit', '90071992547409.93');
      cy.wait('@deposit').its('request.body.amount').should('equal', '90071992547409.93');
      submit('deposit', '0.01');
      cy.get('[data-cy=balance]').should('have.text', '90071992547409.94');
      cy.get('[data-cy=entry] [data-cy=amount]').first().should('have.text', '90071992547409.93');
    });
  });

  it('BK-R01 BK-R33 the request carries the amount as a JSON string, never a number', () => {
    cy.intercept('POST', '/accounts/*/deposits').as('deposit');
    cy.openAccount('KWD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      submit('deposit', '1.005');
      cy.wait('@deposit').then(({ request }) => {
        const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        expect(raw).to.contain('"amount":"1.005"');
        expect(request.headers['content-type']).to.match(/^application\/json/);
      });
    });
  });

  it('BK-R33 each currency shows its own hint: decimals for CAD, none for JPY, three for KWD', () => {
    for (const [currency, hint, mode] of [
      ['CAD', 'Up to 2 decimals, for example 12.50', 'decimal'],
      ['JPY', 'Whole JPY, no decimals, for example 1250', 'numeric'],
      ['KWD', 'Up to 3 decimals, for example 12.500', 'decimal'],
    ] as const) {
      cy.openAccount(currency).then((id) => {
        cy.visit(`/#/accounts/${id}`);
        cy.get('#deposit-hint').should('have.text', hint);
        cy.get(`${form('deposit')} [data-cy=amount]`).should('have.attr', 'inputmode', mode).and('have.attr', 'type', 'text');
      });
    }
  });
});

describe('refused amounts', () => {
  const decimals = (n: number, currency: string, example: string) => `amount must be digits with ${n === 0 ? 'no decimals' : `at most ${n} decimals`} for ${currency}, such as "${example}"`;
  for (const [currency, typed, message] of [
    ['CAD', '1.230', decimals(2, 'CAD', '12.50')],
    ['CAD', '1,000.00', decimals(2, 'CAD', '12.50')],
    ['CAD', '1e3', decimals(2, 'CAD', '12.50')],
    ['CAD', '-5', decimals(2, 'CAD', '12.50')],
    ['CAD', '007', decimals(2, 'CAD', '12.50')],
    ['CAD', '5.', decimals(2, 'CAD', '12.50')],
    ['CAD', '１２', decimals(2, 'CAD', '12.50')],
    ['CAD', '0', 'amount must be greater than zero'],
    ['CAD', '0.00', 'amount must be greater than zero'],
    ['CAD', '', decimals(2, 'CAD', '12.50')],
    ['JPY', '12.5', decimals(0, 'JPY', '1250')],
    ['JPY', '12.0', decimals(0, 'JPY', '1250')],
    ['KWD', '1.2345', decimals(3, 'KWD', '12.500')],
    ['USD', '1000000000000000.00', 'amount must be at most 999999999999999.99'],
  ] as const) {
    it(`BK-R02 BK-R03 BK-R05 BK-R34 a ${currency} amount of ${JSON.stringify(typed)} is refused: the message is shown, the field marked, nothing written`, () => {
      cy.openAccount(currency).then((id) => {
        cy.visit(`/#/accounts/${id}`);
        submit('deposit', typed);
        cy.get(`${form('deposit')} [data-cy=error]`).should('have.text', message);
        cy.get(`${form('deposit')} [data-cy=amount]`).should('have.attr', 'aria-invalid', 'true').and('have.value', typed);
        cy.get(`${form('deposit')} [data-cy=status]`).should('be.empty');
        cy.get('[data-cy=no-entries]').should('be.visible');
        cy.statementOf(id).its('entries').should('have.length', 0);
      });
    });
  }

  it('BK-R34 a corrected amount clears the refusal and the invalid mark', () => {
    cy.openAccount('JPY').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      submit('deposit', '12.5');
      cy.get(`${form('deposit')} [data-cy=error]`).should('not.be.empty');
      submit('deposit', '125');
      cy.get(`${form('deposit')} [data-cy=error]`).should('be.empty');
      cy.get(`${form('deposit')} [data-cy=amount]`).should('not.have.attr', 'aria-invalid');
      cy.get('[data-cy=balance]').should('have.text', '125');
    });
  });
});

describe('refusals from the bank', () => {
  it('BK-R12 BK-R34 withdrawing the whole balance is allowed; one cent more is refused with the balance named', () => {
    cy.openAccount('CAD').then((id) => {
      cy.apiDeposit(id, '10.00', 'CAD');
      cy.visit(`/#/accounts/${id}`);
      submit('withdraw', '10.01');
      cy.get(`${form('withdraw')} [data-cy=error]`).should('have.text', 'insufficient funds: balance is 10.00, amount is 10.01');
      cy.get(`${form('withdraw')} [data-cy=amount]`).should('have.attr', 'aria-invalid', 'true');
      cy.get('[data-cy=balance]').should('have.text', '10.00');
      submit('withdraw', '10');
      cy.get(`${form('withdraw')} [data-cy=status]`).should('have.text', 'Withdrew 10.00 CAD.');
      cy.get('[data-cy=balance]').should('have.text', '0.00');
      cy.get('[data-cy=entry]').last().find('[data-cy=amount]').should('have.text', '-10.00');
    });
  });

  it('BK-R10 BK-R13 a transfer shows on both statements: a debit on one, a credit on the other', () => {
    cy.openAccount('USD', 'Payer').then((from) => {
      cy.openAccount('USD', 'Payee').then((to) => {
        cy.apiDeposit(from, '20.00', 'USD');
        cy.visit(`/#/accounts/${from}`);
        cy.get(`${form('transfer')} [data-cy=to]`).select(`#${to} Payee (USD)`);
        submit('transfer', '7.25');
        cy.get(`${form('transfer')} [data-cy=status]`).should('have.text', 'Transferred 7.25 USD.');
        cy.get('[data-cy=balance]').should('have.text', '12.75');
        cy.get('[data-cy=entry]').last().should('contain', `Transfer to #${to}`).find('[data-cy=amount]').should('have.text', '-7.25');
        cy.visit(`/#/accounts/${to}`);
        cy.get('[data-cy=balance]').should('have.text', '7.25');
        cy.get('[data-cy=entry]').should('have.length', 1).and('contain', `Transfer from #${from}`);
      });
    });
  });

  it('BK-R10 BK-R34 a transfer to an account in another currency is refused and the To field is marked', () => {
    cy.openAccount('CAD', 'Loonie').then((from) => {
      cy.openAccount('USD', 'Greenback').then((to) => {
        cy.apiDeposit(from, '5.00', 'CAD');
        cy.visit(`/#/accounts/${from}`);
        cy.get(`${form('transfer')} [data-cy=to]`).select(`#${to} Greenback (USD)`);
        submit('transfer', '1.00');
        cy.get(`${form('transfer')} [data-cy=error]`).should('have.text', `account ${to} holds USD, not CAD`);
        cy.get(`${form('transfer')} [data-cy=to]`).should('have.attr', 'aria-invalid', 'true');
        cy.get(`${form('transfer')} [data-cy=amount]`).should('not.have.attr', 'aria-invalid');
        cy.get('[data-cy=balance]').should('have.text', '5.00');
      });
    });
  });

  it('BK-R11 the To list never offers the account itself, so a transfer to itself cannot be chosen', () => {
    cy.openAccount('CAD', 'Self').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('transfer')} [data-cy=to] option`).each((option) => {
        expect(option.val()).not.to.equal(String(id));
      });
    });
  });

  it('BK-R06 BK-R34 a limit_exceeded refusal is shown on the amount (stubbed reply: filling a currency to its limit would block the rest of the run)', () => {
    cy.intercept('POST', '/accounts/*/deposits', {
      statusCode: 422,
      body: { error: 'deposit would take the CAD held by all accounts past 999999999999999.99', code: 'limit_exceeded' },
    });
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      submit('deposit', '1.00');
      cy.get(`${form('deposit')} [data-cy=error]`).should('have.text', 'deposit would take the CAD held by all accounts past 999999999999999.99');
      cy.get(`${form('deposit')} [data-cy=amount]`).should('have.attr', 'aria-invalid', 'true');
    });
  });
});
