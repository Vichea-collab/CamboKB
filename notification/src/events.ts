import {
  eventDataSchemas,
  eventEnvelopeSchema,
  type EventData,
  type EventType,
  type OrderSnapshot,
} from '@cambo/shared';
import type pg from 'pg';
import { orderKeyboard } from './buttons';
import type { NotificationConfig } from './config';
import { NotificationError } from './errors';
import {
  customerKeyboard,
  customerMessage,
  lowStockAlert,
  newCustomerAlert,
  newOrderAlert,
  paymentReceivedAlert,
  type CustomerKind,
} from './render';
import type { Outbox, OutboxMessage } from './outbox';
import type { TopicKey } from './topics';

export type EventResult = 'applied' | 'duplicate';

const NOTIFICATION_EVENTS = [
  'order.placed',
  'order.status_changed',
  'order.tracking_set',
  'payment.confirmed',
  'payment.reminder',
  'payment.refunded',
  'product.low_stock',
  'customer.signed_up',
  'payment.expired',
  'admin.alert',
] as const;
type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
const handles = (type: string): type is NotificationEvent =>
  (NOTIFICATION_EVENTS as readonly string[]).includes(type);

type Messages = Omit<OutboxMessage, 'requestId' | 'sourceEventId'>[];

/** Turn one event into the messages to send. Pure: no database, no Telegram. */
export function messagesFor<T extends NotificationEvent>(
  type: T,
  data: EventData<T>,
  config: Pick<NotificationConfig, 'webOrigin'> & { adminChatId?: string },
): Messages {
  const out: Messages = [];
  const customer = (
    chatId: string | null,
    o: OrderSnapshot,
    kind: CustomerKind,
    holdMinutes?: number,
    minutesLeft?: number,
  ) => {
    if (chatId)
      out.push({
        chatId,
        text: customerMessage(kind, o, { webOrigin: config.webOrigin, holdMinutes, minutesLeft }),
        replyMarkup: customerKeyboard(kind, o, config.webOrigin),
        dedupeKey: `order:${o.id}:customer:${kind === 'status' ? o.status : kind === 'tracking' ? `tracking:${o.trackingNumber}` : kind}`,
      });
  };
  const admin = (msg: Omit<OutboxMessage, 'chatId'>, on: boolean, topic: TopicKey) => {
    if (config.adminChatId && on) out.push({ chatId: config.adminChatId, topic, ...msg });
  };
  const awaiting = (o: OrderSnapshot) =>
    o.status === 'PENDING' && o.payment?.method === 'KHQR' && o.payment.status === 'PENDING';

  switch (type) {
    case 'order.placed': {
      const d = data as EventData<'order.placed'>;
      customer(d.customerChatId, d.order, 'placed', d.holdMinutes);
      admin(
        {
          text: newOrderAlert(d.order, config.webOrigin),
          parseMode: 'HTML',
          replyMarkup: orderKeyboard({
            id: d.order.id,
            status: d.order.status,
            awaitingPayment: awaiting(d.order),
          }, false, config.webOrigin),
          dedupeKey: `order:${d.order.id}:admin:new`,
        },
        d.adminAlerts,
        'orders',
      );
      break;
    }
    case 'order.status_changed': {
      const d = data as EventData<'order.status_changed'>;
      customer(d.customerChatId, d.order, 'status');
      break;
    }
    case 'order.tracking_set': {
      const d = data as EventData<'order.tracking_set'>;
      customer(d.customerChatId, d.order, 'tracking');
      break;
    }
    case 'payment.confirmed': {
      const d = data as EventData<'payment.confirmed'>;
      customer(d.customerChatId, d.order, 'paid');
      admin(
        {
          text: paymentReceivedAlert(d.order),
          replyMarkup: orderKeyboard({ id: d.order.id, status: d.order.status }, false, config.webOrigin),
          dedupeKey: `order:${d.order.id}:admin:paid`,
        },
        d.adminAlerts,
        'payments',
      );
      break;
    }
    case 'payment.reminder': {
      const d = data as EventData<'payment.reminder'>;
      customer(d.customerChatId, d.order, 'reminder', undefined, d.minutesLeft);
      break;
    }
    case 'payment.refunded': {
      const d = data as EventData<'payment.refunded'>;
      customer(d.customerChatId, d.order, 'refunded');
      break;
    }
    case 'payment.expired': {
      const d = data as EventData<'payment.expired'>;
      customer(d.customerChatId, d.order, 'expired', d.holdMinutes);
      break;
    }
    case 'product.low_stock': {
      const d = data as EventData<'product.low_stock'>;
      admin({ text: lowStockAlert(d, config.webOrigin), parseMode: 'HTML' }, d.adminAlerts, 'stock');
      break;
    }
    case 'customer.signed_up': {
      const d = data as EventData<'customer.signed_up'>;
      admin({ text: newCustomerAlert(d), parseMode: 'HTML' }, d.adminAlerts, 'customers');
      break;
    }
    case 'admin.alert': {
      const d = data as EventData<'admin.alert'>;
      admin({ text: d.text }, d.adminAlerts, 'attention');
      break;
    }
  }
  return out;
}

/**
 * Handle one event from the api. The api delivers at least once, so a repeat is recognised and ignored.
 * Recording the event and queueing its messages happen in one transaction: either both or neither.
 */
export async function handleEvent(
  deps: { pool: pg.Pool; outbox: Outbox; config: NotificationConfig },
  raw: unknown,
): Promise<EventResult> {
  const envelope = eventEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new NotificationError(400, 'INVALID_EVENT', 'Not an event');
  const { id, type, requestId, dedupeKey, data } = envelope.data;
  if (!handles(type))
    throw new NotificationError(
      422,
      'UNKNOWN_EVENT',
      `This service does not handle ${type.slice(0, 40)}`,
    );
  const parsed = eventDataSchemas[type as EventType].safeParse(data);
  if (!parsed.success)
    throw new NotificationError(
      400,
      'INVALID_EVENT',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );

  const messages = messagesFor(type, parsed.data as never, {
    webOrigin: deps.config.webOrigin,
    adminChatId: deps.config.telegram.adminChatId,
  });
  const db = await deps.pool.connect();
  try {
    await db.query('BEGIN');
    const first = await db.query(
      'INSERT INTO received_events (event_id, type, request_id) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING',
      [id, type, requestId ?? null],
    );
    if (first.rowCount === 0) {
      await db.query('ROLLBACK');
      return 'duplicate';
    }
    for (const m of messages) {
      // Alerts carry the api's own dedupe key so a re-sent alert is not shown twice.
      const dedupe = m.dedupeKey ?? (dedupeKey ? `alert:${dedupeKey}` : undefined);
      await deps.outbox.save({ ...m, dedupeKey: dedupe, requestId, sourceEventId: id }, db);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }
  deps.outbox.kick();
  return 'applied';
}
