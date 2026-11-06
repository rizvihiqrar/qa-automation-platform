// A pretend card company, inside the API: no sandbox account and no secrets. The card
// number picks what happens, the way a real provider's test cards do. It keeps its own
// list of charges, which is what the real company's books would show: the node tests
// read that list, because Postman can only see what the API says about it.

export const CARDS = {
  approved: '4242424242424242',
  declined: '4000000000000002',
  timeout: '4000000000000119',
  chargedTwice: '4000000000000259',
} as const;

export interface Charge {
  id: string;
  reference: string;
  amount_cents: number;
  card_last4: string;
  refunded_cents: number;
  voided: boolean;
}

export type Outcome = { outcome: 'approved'; charges: Charge[] } | { outcome: 'declined' };

export class ProviderTimeout extends Error {}

export class MockProvider {
  readonly charges: Charge[] = [];
  calls = 0;
  // Tests set this to hold a charge open, so that two requests overlap for certain.
  gate: Promise<void> | null = null;

  // `reference` is the order. The same card finds the charge already made for it, not a
  // new one: that is what makes a retry safe after a timeout, when the money may have
  // moved even though the reply never came. A different card means the first attempt
  // was given up, so its charge is voided and this card decides.
  async charge(reference: string, card: string, amount_cents: number): Promise<Outcome> {
    this.calls += 1;
    await (this.gate ?? new Promise((resolve) => setImmediate(resolve)));
    const made = this.active(reference);
    if (made.some((charge) => charge.card_last4 === card.slice(-4))) return { outcome: 'approved', charges: made };
    for (const charge of made) this.void(charge);
    switch (card) {
      case CARDS.approved:
        return { outcome: 'approved', charges: [this.record(reference, card, amount_cents)] };
      case CARDS.timeout:
        this.record(reference, card, amount_cents);
        throw new ProviderTimeout('the provider did not answer in time');
      case CARDS.chargedTwice:
        return { outcome: 'approved', charges: [this.record(reference, card, amount_cents), this.record(reference, card, amount_cents)] };
      default:
        return { outcome: 'declined' };
    }
  }

  active(reference: string): Charge[] {
    return this.charges.filter((charge) => charge.reference === reference && !charge.voided);
  }

  void(charge: Charge): void {
    charge.voided = true;
  }

  refund(reference: string, cents: number): void {
    const [charge] = this.active(reference);
    if (charge) charge.refunded_cents += cents;
  }

  // What the card company's books say it holds for this reference.
  heldCents(reference: string): number {
    return this.active(reference).reduce((sum, charge) => sum + charge.amount_cents - charge.refunded_cents, 0);
  }

  private record(reference: string, card: string, amount_cents: number): Charge {
    const charge = { id: `ch_${this.charges.length + 1}`, reference, amount_cents, card_last4: card.slice(-4), refunded_cents: 0, voided: false };
    this.charges.push(charge);
    return charge;
  }
}
