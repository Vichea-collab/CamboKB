export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const FLOW: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'];
const CANCELLABLE: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PACKED'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (to === 'CANCELLED') return CANCELLABLE.includes(from);
  const i = FLOW.indexOf(from);
  const j = FLOW.indexOf(to);
  return i !== -1 && j !== -1 && j > i;
}
