import { canTransition, type OrderStatus } from '@cambo/shared';
import type { AppDeps } from '../../http/app';
import { AppError, notFound } from '../../http/errors';
import { publishAdminEvent } from '../../lib/events';
import { kickEvents } from '../events/outbox';
import { announceStatusChanged } from '../events/snapshot';
import { cancelOrder } from './orders';

/** Tell the open admin screens an order (or its payment) changed. Never throws. */
export async function publishOrderUpdate(
  deps: AppDeps,
  orderId: string,
  kind: 'order' | 'payment' = 'order',
): Promise<void> {
  try {
    const o = await deps.prisma.order.findUnique({
      where: { id: orderId },
      select: { number: true, status: true, payment: { select: { status: true } } },
    });
    if (!o) return;
    if (kind === 'payment')
      publishAdminEvent({
        type: 'payment.updated',
        orderId,
        number: o.number,
        status: o.payment?.status ?? 'UNPAID',
      });
    else publishAdminEvent({ type: 'order.updated', orderId, number: o.number, status: o.status });
  } catch (err) {
    deps.logger.warn({ err, orderId }, 'could not publish live order update');
  }
}

/**
 * Move an order to a new status: checks the move is allowed, gives stock back on a
 * cancellation, records who did it, then tells the customer (Telegram) and the open
 * admin screens. Used by the admin screen and by the Telegram order buttons.
 * Throws AppError 404 / 409.
 */
export async function changeOrderStatus(
  deps: AppDeps,
  id: string,
  status: OrderStatus,
  actorUserId: string | null,
  note?: string,
): Promise<{ number: string; from: OrderStatus }> {
  const { prisma } = deps;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw notFound('Order');
    if (!canTransition(order.status, status)) {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `Can't change an order from ${order.status} to ${status}`,
        { status: order.status, number: order.number },
      );
    }
    if (status === 'CANCELLED') await cancelOrder(tx, order, actorUserId, note);
    else {
      await tx.order.update({ where: { id }, data: { status } });
      await tx.orderStatusEvent.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: status,
          note: note ?? null,
          actorUserId,
        },
      });
    }
    await announceStatusChanged(tx, id);
    return { number: order.number, from: order.status };
  });
  kickEvents(deps);
  void publishOrderUpdate(deps, id);
  return result;
}
