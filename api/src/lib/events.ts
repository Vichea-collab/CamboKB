import { EventEmitter } from 'node:events';

/** What the admin screens hear about as it happens. Small on purpose: the screens refetch the details. */
export type AdminEvent =
  | { type: 'order.created'; orderId: string; number: string; totalCents: number; customer: string }
  | { type: 'order.updated'; orderId: string; number: string; status: string }
  | { type: 'payment.updated'; orderId: string; number: string; status: string };

const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Tell every admin who is connected. Never throws: a live update must not break the action that caused it. */
export function publishAdminEvent(event: AdminEvent): void {
  try {
    bus.emit('admin', event);
  } catch {
    // a listener failed; nothing to do
  }
}

export function subscribeAdminEvents(listener: (event: AdminEvent) => void): () => void {
  bus.on('admin', listener);
  return () => bus.off('admin', listener);
}
