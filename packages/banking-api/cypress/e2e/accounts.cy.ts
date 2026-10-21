// The accounts list, opening an account through the form, and pages that don't exist.

describe('accounts', () => {
  it('BK-R31 lists accounts opened elsewhere, with balances as the API returns them', () => {
    cy.openAccount('KWD', 'Listed Owner').then((id) => {
      cy.apiDeposit(id, '1.5', 'KWD');
      cy.visit('/');
      cy.get('[data-cy=title]').should('have.text', 'Accounts');
      cy.get(`[data-cy=account-${id}]`).within(() => {
        cy.contains('a', 'Listed Owner').should('have.attr', 'href', `#/accounts/${id}`);
        cy.contains('td', 'KWD');
        cy.get('[data-cy=balance]').should('have.text', '1.500');
      });
    });
  });

  for (const [currency, zero] of [['CAD', '0.00'], ['USD', '0.00'], ['JPY', '0'], ['KWD', '0.000']] as const) {
    it(`BK-R07 BK-R08 opening a ${currency} account through the form lands on it with a balance of ${zero}`, () => {
      cy.visit('/');
      cy.get('[data-cy=owner]').type('Form Owner');
      cy.get('[data-cy=currency]').select(currency);
      cy.get('[data-cy=open-form] [data-cy=submit]').click();
      cy.get('[data-cy=title]').should('have.text', `Form Owner's ${currency} Account`);
      cy.get('[data-cy=balance]').should('have.text', zero);
      cy.get('[data-cy=no-entries]').should('be.visible');
      cy.location('hash').should('match', /^#\/accounts\/\d+$/);
    });
  }

  it('BK-R34 an owner of only spaces is refused, the message shown and the field marked', () => {
    cy.visit('/');
    cy.get('[data-cy=owner]').type('   ');
    cy.get('[data-cy=open-form] [data-cy=submit]').click();
    cy.get('[data-cy=open-form] [data-cy=error]').should('have.attr', 'role', 'alert')
      .and('have.text', 'owner must be a name of 1 to 100 characters');
    cy.get('[data-cy=owner]').should('have.attr', 'aria-invalid', 'true');
    cy.get('[data-cy=title]').should('have.text', 'Accounts');
  });

  it('BK-R32 an owner name that looks like HTML is shown as text, never run', () => {
    const owner = '<img src=x onerror="window.hacked=1">';
    cy.openAccount('CAD', owner).then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get('[data-cy=title]').should('have.text', `${owner}'s CAD Account`);
      cy.get('main img').should('not.exist');
      cy.window().its('hacked').should('be.undefined');
    });
  });

  for (const path of ['/#/accounts/999999', '/#/accounts/0', '/#/accounts/abc', '/#/nowhere']) {
    it(`BK-R34 ${path} shows Account Not Found with a way back`, () => {
      cy.visit(path);
      cy.get('[data-cy=title]').should('have.text', 'Account Not Found');
      cy.contains('a', 'Back to Accounts').click();
      cy.get('[data-cy=title]').should('have.text', 'Accounts');
    });
  }
});
