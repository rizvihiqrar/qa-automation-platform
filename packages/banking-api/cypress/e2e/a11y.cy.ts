// Accessibility: axe-core on every screen and state in both themes, a deposit done
// with the keyboard only, and refusals announced and tied to their field (BK-R37).

const form = (name: string) => `[data-cy=${name}-form]`;

function inBothThemes(check: () => void): void {
  for (const theme of ['light', 'dark']) {
    cy.document().then((doc) => {
      if (doc.documentElement.dataset.theme !== theme) cy.get('[data-cy=theme]').click();
    });
    cy.document().its('documentElement.dataset.theme').should('equal', theme);
    check();
  }
}

describe('axe-core finds no WCAG 2.2 A or AA violation', () => {
  it('BK-R37 on the accounts list and its open-account form, light and dark', () => {
    cy.openAccount('CAD', 'Axe Owner');
    cy.visit('/');
    cy.get('[data-cy=accounts]').should('be.visible');
    inBothThemes(() => cy.checkA11y());
  });

  it('BK-R37 on an account with a filled statement, light and dark', () => {
    cy.openAccount('USD', 'Axe Payer').then((id) => {
      cy.openAccount('USD', 'Axe Payee').then((to) => {
        cy.apiDeposit(id, '50.00', 'USD');
        cy.request({ method: 'POST', url: '/transfers', headers: { 'Content-Type': 'application/json' }, body: { from_account_id: id, to_account_id: to, amount: '12.34', currency: 'USD' } });
        cy.visit(`/#/accounts/${id}`);
        cy.get('[data-cy=entry]').should('have.length', 2);
        inBothThemes(() => cy.checkA11y());
      });
    });
  });

  it('BK-R37 with a refusal and a confirmation on screen, light and dark', () => {
    cy.openAccount('KWD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('withdraw')} [data-cy=amount]`).type('1');
      cy.get(`${form('withdraw')} [data-cy=submit]`).click();
      cy.get(`${form('withdraw')} [data-cy=error]`).should('not.be.empty');
      cy.get(`${form('deposit')} [data-cy=amount]`).type('1');
      cy.get(`${form('deposit')} [data-cy=submit]`).click();
      cy.get(`${form('deposit')} [data-cy=status]`).should('not.be.empty');
      inBothThemes(() => cy.checkA11y());
    });
  });

  it('BK-R37 on Account Not Found, light and dark', () => {
    cy.visit('/#/accounts/999999');
    cy.get('[data-cy=title]').should('have.text', 'Account Not Found');
    inBothThemes(() => cy.checkA11y());
  });

  it('BK-R37 at phone width (375 px) with no sideways scrolling', () => {
    cy.viewport(375, 740);
    cy.openAccount('JPY').then((id) => {
      cy.apiDeposit(id, '123456789', 'JPY');
      cy.visit(`/#/accounts/${id}`);
      cy.get('[data-cy=entry]').should('have.length', 1);
      cy.checkA11y();
      cy.document().then((doc) => {
        expect(doc.documentElement.scrollWidth, 'page width').to.be.at.most(375);
      });
    });
  });
});

describe('keyboard and screen readers', () => {
  it('BK-R37 a deposit done with the keyboard only: Tab to the amount, type, Tab to Deposit, Enter', () => {
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.focused().should('have.attr', 'data-cy', 'title'); // focus starts on the page's heading
      cy.press(Cypress.Keyboard.Keys.TAB);
      cy.focused().should('have.id', 'deposit-amount');
      cy.focused().type('3.21');
      cy.press(Cypress.Keyboard.Keys.TAB);
      cy.focused().should('have.text', 'Deposit');
      // Tab is a real key press (cy.press), so the browser itself moves focus; Enter
      // on the focused button goes through type(), as cy.press's Enter doesn't press it.
      cy.focused().type('{enter}');
      cy.get(`${form('deposit')} [data-cy=status]`).should('have.text', 'Deposited 3.21 CAD.');
      cy.get('[data-cy=balance]').should('have.text', '3.21');
    });
  });

  it('BK-R37 the skip link is the first stop and moves focus to the content', () => {
    cy.visit('/');
    cy.get('[data-cy=title]').should('have.text', 'Accounts');
    cy.get('a[href], button, input, select, [tabindex="0"]').first().should('have.attr', 'data-cy', 'skip');
    cy.get('[data-cy=skip]').focus().should('be.visible').and('have.text', 'Skip to Content');
    cy.press(Cypress.Keyboard.Keys.ENTER);
    cy.focused().should('have.id', 'main');
    cy.get('[data-cy=title]').should('have.text', 'Accounts'); // still on the same page
  });

  it('BK-R37 going to an account moves focus to its heading, so a screen reader starts there', () => {
    cy.openAccount('USD', 'Focus Owner').then((id) => {
      cy.visit('/');
      cy.contains('a', 'Focus Owner').click();
      cy.focused().should('have.attr', 'data-cy', 'title').and('have.text', 'Focus Owner\'s USD Account');
    });
  });

  it('BK-R34 BK-R37 a refusal is announced (role=alert) and tied to its field by aria-describedby', () => {
    cy.openAccount('CAD').then((id) => {
      cy.visit(`/#/accounts/${id}`);
      cy.get(`${form('deposit')} [data-cy=amount]`).type('1.234');
      cy.get(`${form('deposit')} [data-cy=submit]`).click();
      cy.get(`${form('deposit')} [data-cy=amount]`).should('have.attr', 'aria-invalid', 'true')
        .invoke('attr', 'aria-describedby').then((ids) => {
          const texts = String(ids).split(' ').map((one) => Cypress.$(`#${one}`).text());
          expect(texts).to.deep.equal(['Up to 2 decimals, for example 12.50', 'amount must be digits with at most 2 decimals for CAD, such as "12.50"']);
        });
      cy.get(`${form('deposit')} [data-cy=error]`).should('have.attr', 'role', 'alert');
    });
  });

  it('BK-R37 every field has a visible label naming it, and the amount label names the currency', () => {
    cy.openAccount('KWD', 'Label Owner').then((id) => {
      cy.openAccount('KWD', 'Other');
      cy.visit(`/#/accounts/${id}`);
      cy.get('main input, main select').each((field) => {
        cy.get(`label[for="${field.attr('id')}"]`).should('be.visible').invoke('text').should('not.be.empty');
      });
      cy.get('label[for="deposit-amount"]').should('have.text', 'Amount (KWD)');
    });
  });

  it('BK-R37 the theme switch is a labelled button that says what it will do, and the choice is remembered', () => {
    cy.visit('/', { onBeforeLoad: (win) => win.localStorage.setItem('theme', 'light') });
    cy.get('[data-cy=theme]').should('have.attr', 'aria-label', 'Switch to Dark Mode').click();
    cy.document().its('documentElement.dataset.theme').should('equal', 'dark');
    cy.get('[data-cy=theme]').should('have.attr', 'aria-label', 'Switch to Light Mode');
    cy.reload();
    cy.document().its('documentElement.dataset.theme').should('equal', 'dark');
  });
});
