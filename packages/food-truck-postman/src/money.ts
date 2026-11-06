// Money is whole cents everywhere, so no floating point ever touches a price.
// HST is 13%, worked out once on the whole order (food plus delivery fee) and rounded
// half up. Rounding each item instead gives a different total, which is why the rule
// lives in one place.

export const TAX_PERCENT = 13;
export const DELIVERY_FEE_CENTS = 499;

export type Fulfilment = 'pickup' | 'delivery';

export interface PricedLine {
  quantity: number;
  unit_price_cents: number;
}

export interface Totals {
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  total_cents: number;
}

// Adding 50 before dividing by 100 rounds half up with integers only: 4550 becomes 46.
export const taxOn = (cents: number): number => Math.floor((cents * TAX_PERCENT + 50) / 100);

export function priceOrder(lines: readonly PricedLine[], fulfilment: Fulfilment): Totals {
  const subtotal_cents = lines.reduce((sum, line) => sum + line.quantity * line.unit_price_cents, 0);
  const delivery_fee_cents = fulfilment === 'delivery' ? DELIVERY_FEE_CENTS : 0;
  const tax_cents = taxOn(subtotal_cents + delivery_fee_cents);
  return { subtotal_cents, delivery_fee_cents, tax_cents, total_cents: subtotal_cents + delivery_fee_cents + tax_cents };
}
