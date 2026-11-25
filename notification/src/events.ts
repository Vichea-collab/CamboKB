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
  cancelledAlert,
  customerKeyboard,
  customerMessage,
  dailySummary,
  lowStockAlert,
  newCustomerAlert,
  newOrderAlert,
  paymentReceivedAlert,
  paymentReceivedUpdate,
  refundedAlert,
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
  'shop.daily_summary',
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
  emittedAt = new Date().toISOString(),
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
  const buttons = (o: OrderSnapshot) =>
    orderKeyboard({ id: o.id, status: o.status, awaitingPayment: awaiting(o) }, false, config.webOrigin);
  /** An unpaid KHQR order is not an order yet: the group hears about it when the money arrives, or never. */
  const unpaidKhqr = (o: OrderSnapshot) =>
    o.payment?.method === 'KHQR' && o.payment.status !== 'PAID' && o.payment.status !== 'REFUNDED';
  /** The order with every detail, in New orders. Once per order, whichever event comes first. */
  const announce = (o: OrderSnapshot, on: boolean) =>
    admin(
      {
        text: newOrderAlert(o, config.webOrigin),
        parseMode: 'HTML',
        replyMarkup: buttons(o),
        dedupeKey: `order:${o.id}:admin:new`,
      },
      on,
      'orders',
    );
  /** Bring what the group already shows about this order up to date. Adds no message, so it ignores the alert switch. */
  const correct = (o: OrderSnapshot) => {
    if (!config.adminChatId) return;
    const edit = (key: 'new' | 'paid', text: string, parseMode?: 'HTML') =>
      out.push({
        chatId: config.adminChatId!,
        text,
        parseMode,
        replyMarkup: buttons(o),
        edits: `order:${o.id}:admin:${key}`,
        editAt: emittedAt,
        dedupeKey: `order:${o.id}:admin:${key}:now:${type}:${o.status}`,
      });
    edit('new', newOrderAlert(o, config.webOrigin), 'HTML');
    if (type !== 'payment.confirmed') edit('paid', paymentReceivedUpdate(o));
  };

  switch (type) {
    case 'order.placed': {
      const d = data as EventData<'order.placed'>;
      customer(d.customerChatId, d.order, 'placed', d.holdMinutes);
      if (!awaiting(d.order)) announce(d.order, d.adminAlerts);
      break;
    }
    case 'order.status_changed': {
      const d = data as EventData<'order.status_changed'>;
      customer(d.customerChatId, d.order, 'status');
      // A KHQR order the shop confirmed by hand was not announced when it was placed.
      if (d.order.status === 'CONFIRMED' && d.order.payment?.method === 'KHQR') announce(d.order, d.adminAlerts);
      correct(d.order);
      if (d.order.status === 'CANCELLED' && !unpaidKhqr(d.order))
        admin(
          { text: cancelledAlert(d.order), dedupeKey: `order:${d.order.id}:admin:cancelled` },
          d.adminAlerts,
          d.order.payment?.status === 'PAID' ? 'attention' : 'orders',
        );
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
      announce(d.order, d.adminAlerts);
      admin(
        {
          text: paymentReceivedAlert(d.order),
          replyMarkup: buttons(d.order),
          dedupeKey: `order:${d.order.id}:admin:paid`,
        },
        d.adminAlerts,
        'payments',
      );
      correct(d.order);
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
      admin(
        { text: refundedAlert(d.order), dedupeKey: `order:${d.order.id}:admin:refunded` },
        d.adminAlerts,
        'payments',
      );
      break;
    }
    case 'payment.expired': {
      const d = data as EventData<'payment.expired'>;
      customer(d.customerChatId, d.order, 'expired', d.holdMinutes);
      correct(d.order);
      break;
    }
    case 'shop.daily_summary': {
      const d = data as EventData<'shop.daily_summary'>;
      admin({ text: dailySummary(d), dedupeKey: `summary:${d.date}` }, d.adminAlerts, 'summary');
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
  const { id, type, emittedAt, requestId, dedupeKey, data } = envelope.data;
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
  }, emittedAt);
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
    // A message queued by this very event is up to date already: only older ones need correcting.
    const fresh = new Set<string>();
    for (const m of messages) {
      if (m.edits && fresh.has(m.edits)) continue;
      // Alerts carry the api's own dedupe key so a re-sent alert is not shown twice.
      const dedupe = m.dedupeKey ?? (dedupeKey ? `alert:${dedupeKey}` : undefined);
      const saved = await deps.outbox.save({ ...m, dedupeKey: dedupe, requestId, sourceEventId: id }, db);
      if (saved && dedupe) fresh.add(dedupe);
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
