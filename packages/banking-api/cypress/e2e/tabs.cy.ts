// Two tabs at once. Cypress drives one tab, so the second is another client of the
// same API (cy.request, or fetch from inside an intercept), which is what a second
// tab is to the server. The page must never act on, or show, a balance it read
// before the other tab moved money (BK-R36).

const form = (name: string) => `[data-cy=${name}-form]`;

describe('another tab moves money while the page is open', () => {
  it('BK-R36 BK-R12 the other tab spent the money: the page shows the refusal and the fresh balance, not its stale one', () => {
    cy.openAccount('CAD').then((id) => {
      cy.apiDeposit(id, '10.00', 'CAD');
      cy.visit(`/#/accounts/${id}`);
      cy.get('[data-cy=balance]').should('have.text', '10.00');
      cy.apiWithdraw(id, '10.00', 'CAD'); // the other tab
      cy.get('[data-cy=balance]').should('have.text', '10.00'); // not yet known here
      cy.get(`${form('withdraw')} [data-cy=amount]`).type('10.00');
      cy.get(`${form('withdraw')} [data-cy=submit]`).click();
      cy.get(`${form('withdraw')} [data-cy=error]`).should('have.text', 'insufficient funds: balance is 0.00, amount is 10.00');
      cy.get('[data-cy=balance]').should('have.text', '0.00');
      cy.get('[data-cy=entry]').should('have.length', 2);
    });
  });

  it('BK-R36 the other tab added money: after the page\'s own deposit the balance is the API\'s, not the old one plus the deposit', () => {
    cy.openAccount('JPY').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get('[data-cy=balance]').should('have.text', '0');
      cy.apiDeposit(id, '5000', 'JPY'); // the other tab
      cy.get(`${form('deposit')} [data-cy=amount]`).type('100');
      cy.get(`${form('deposit')} [data-cy=submit]`).click();
      cy.get(`${form('deposit')} [data-cy=status]`).should('have.text', 'Deposited 100 JPY.');
      cy.get('[data-cy=balance]').should('have.text', '5100');
      cy.get('[data-cy=balance-after]').then((cells) => {
        expect([...cells].map((c) => c.textContent)).to.deep.equal(['5000', '5100']);
      });
    });
  });

  it('BK-R36 BK-R24 the other tab withdraws while the page\'s withdrawal is on its way: one goes through, the balance never goes below zero', () => {
    cy.openAccount('USD').then((id) => {
      cy.apiDeposit(id, '10.00', 'USD');
      // The page's request is held until the other tab's withdrawal of the same money
      // has been answered, then sent on: the two meet at the server, the other first.
      // The other tab's request passes the same proxy, so it is marked and let through.
      cy.intercept('POST', `/accounts/${id}/withdrawals`, async (req) => {
        if (req.headers['x-other-tab']) return;
        const other = await fetch(`/accounts/${id}/withdrawals`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Other-Tab': '1' }, body: JSON.stringify({ amount: '10.00', currency: 'USD' }),
        });
        expect(other.status, 'the other tab').to.equal(201);
        req.continue();
      }).as('withdraw');
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('withdraw')} [data-cy=amount]`).type('10.00');
      cy.get(`${form('withdraw')} [data-cy=submit]`).click();
      cy.wait('@withdraw').its('response.statusCode').should('equal', 201); // the other tab's
      cy.wait('@withdraw').its('response.statusCode').should('equal', 422); // the page's
      cy.get(`${form('withdraw')} [data-cy=error]`).should('contain', 'insufficient funds');
      cy.get('[data-cy=balance]').should('have.text', '0.00');
      cy.statementOf(id).then((s) => {
        expect(s.entries.map((e) => e.balance_after)).to.deep.equal(['10.00', '0.00']);
      });
    });
  });

  it('BK-R36 a page left open shows the fresh balance after any answer, even a refusal of its own', () => {
    cy.openAccount('KWD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.apiDeposit(id, '2.500', 'KWD'); // the other tab
      cy.get(`${form('deposit')} [data-cy=amount]`).type('1.2345');
      cy.get(`${form('deposit')} [data-cy=submit]`).click();
      cy.get(`${form('deposit')} [data-cy=error]`).should('not.be.empty');
      cy.get('[data-cy=balance]').should('have.text', '2.500');
    });
  });
});
