// DELIBERATE BREAK for the burn-in PR, removed in its next commit: passes in the
// regular CI job (no run number), fails on burn-in run 2 in each browser.
describe('burn-in proof', () => {
  it('fails only on its second run', () => {
    expect(String(Cypress.expose('BURN_IN_RUN'))).not.to.equal('2');
  });
});
