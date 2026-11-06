import type { Fulfilment } from './money.ts';

// The life of an order. "paid" is reached only by a payment and "cancelled" only by
// the cancel route (which also deals with the money), so PATCH /orders/:id/status
// takes the kitchen and driver steps alone.

export const STATUSES = ['placed', 'paid', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

export const STAFF_STEPS: readonly Status[] = ['preparing', 'ready', 'out_for_delivery', 'delivered', 'picked_up'];

export const isStatus = (value: unknown): value is Status => STATUSES.includes(value as Status);

// The states an order may move to next. Delivered and picked up are the ends of the
// two paths: pickup skips the driver.
export function allowedNext(status: Status, fulfilment: Fulfilment): Status[] {
  switch (status) {
    case 'placed': return ['paid', 'cancelled'];
    case 'paid': return ['preparing', 'cancelled'];
    case 'preparing': return ['ready'];
    case 'ready': return fulfilment === 'delivery' ? ['out_for_delivery'] : ['picked_up'];
    case 'out_for_delivery': return ['delivered'];
    default: return [];
  }
}
