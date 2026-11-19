import { z } from 'zod';
import { ORDER_STATUSES } from './status';
import { DELIVERY_SERVICES, PAYMENT_METHODS, PAYMENT_STATUSES, REGIONS } from './types';

/**
 * What the services say to each other. The api writes these into its outbox and delivers them to
 * `POST /internal/events` on the target service; the receivers parse them with the same schemas.
 * Changing a schema is a change to every service that uses it.
 */

/** The whole order at one moment. Safe to apply twice; newest `emittedAt` wins. */
export const orderSnapshotSchema = z.object({
  id: z.uuid(),
  number: z.string().min(1).max(30),
  status: z.enum(ORDER_STATUSES),
  createdAt: z.iso.datetime(),
  contactName: z.string(),
  contactPhone: z.string(),
  region: z.enum(REGIONS),
  deliveryService: z.enum(DELIVERY_SERVICES),
  addressLine: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  distanceKm: z.number().nullable(),
  note: z.string().nullable(),
  subtotalCents: z.number().int(),
  deliveryFeeCents: z.number().int(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  promoCode: z.string().nullable(),
  /** The carrier's tracking code once the shop has handed the parcel over. Older queued events lack it. */
  trackingNumber: z.string().nullable().default(null),
  payment: z
    .object({ method: z.enum(PAYMENT_METHODS), status: z.enum(PAYMENT_STATUSES) })
    .nullable(),
  items: z.array(
    z.object({
      productId: z.uuid(),
      name: z.string(),
      quantity: z.number().int().positive(),
      priceCents: z.number().int(),
      lineTotalCents: z.number().int(),
    }),
  ),
});
export type OrderSnapshot = z.infer<typeof orderSnapshotSchema>;

/** Telegram chat of the customer, or null when they have none or the account is disabled. */
const chat = z
  .string()
  .regex(/^-?\d+$/)
  .nullable();

export const eventDataSchemas = {
  // -> report
  'order.snapshot': orderSnapshotSchema,
  // -> notification
  'order.placed': z.object({
    order: orderSnapshotSchema,
    customerChatId: chat,
    adminAlerts: z.boolean(),
    holdMinutes: z.number().int().positive(),
  }),
  'order.status_changed': z.object({ order: orderSnapshotSchema, customerChatId: chat }),
  'order.tracking_set': z.object({ order: orderSnapshotSchema, customerChatId: chat }),
  'payment.confirmed': z.object({
    order: orderSnapshotSchema,
    customerChatId: chat,
    adminAlerts: z.boolean(),
  }),
  'payment.expired': z.object({
    order: orderSnapshotSchema,
    customerChatId: chat,
    holdMinutes: z.number().int().positive(),
  }),
  'product.low_stock': z.object({
    productId: z.uuid(),
    name: z.string().min(1).max(200),
    /** What is left: 0 means sold out. */
    stock: z.number().int().min(0),
    adminAlerts: z.boolean(),
  }),
  'customer.signed_up': z.object({
    name: z.string().min(1).max(100),
    phone: z.string(),
    telegramUsername: z.string().nullable(),
    adminAlerts: z.boolean(),
  }),
  'admin.alert': z.object({
    text: z.string().min(1).max(3500),
    adminAlerts: z.boolean().default(true),
  }),
} as const;

export type EventType = keyof typeof eventDataSchemas;
export type EventData<T extends EventType> = z.infer<(typeof eventDataSchemas)[T]>;

/** Which service each event goes to. */
export const EVENT_TARGETS = {
  'order.snapshot': 'report',
  'order.placed': 'notification',
  'order.status_changed': 'notification',
  'order.tracking_set': 'notification',
  'payment.confirmed': 'notification',
  'payment.expired': 'notification',
  'product.low_stock': 'notification',
  'customer.signed_up': 'notification',
  'admin.alert': 'notification',
} as const satisfies Record<EventType, 'report' | 'notification'>;
export type EventTarget = (typeof EVENT_TARGETS)[EventType];

export const eventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  emittedAt: z.iso.datetime(),
  requestId: z.string().max(100).optional(),
  /** Stops the same event being applied twice (e.g. `order:<id>:customer:CONFIRMED`). */
  dedupeKey: z.string().max(200).optional(),
  data: z.unknown(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** Parse an envelope and its data for a known type. Throws a ZodError when the contract is broken. */
export function parseEvent<T extends EventType>(
  type: T,
  raw: unknown,
): { envelope: EventEnvelope; data: EventData<T> } {
  const envelope = eventEnvelopeSchema.parse(raw);
  return { envelope, data: eventDataSchemas[type].parse(envelope.data) as EventData<T> };
}

export function isEventType(type: string): type is EventType {
  return type in eventDataSchemas;
}

// ---------------------------------------------------------------------------
// notification -> api

/** A Telegram update, trimmed to what the shop reads. */
export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      from: z
        .object({
          id: z.number(),
          is_bot: z.boolean().optional(),
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          username: z.string().optional(),
        })
        .optional(),
      chat: z.object({ id: z.number(), type: z.string() }),
      text: z.string().optional(),
      contact: z
        .object({
          phone_number: z.string(),
          first_name: z.string().optional(),
          user_id: z.number().optional(),
        })
        .optional(),
      /** A location the customer shared with the bot (the "Share my location" button). */
      location: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        })
        .optional(),
    })
    .optional(),
});
export type TelegramUpdateInput = z.infer<typeof telegramUpdateSchema>;

/** What the api asks the notification service to do in answer to a chat message. */
export const botActionSchema = z.object({
  type: z.literal('send'),
  chatId: z.number(),
  text: z.string(),
  parseMode: z.literal('HTML').optional(),
  replyMarkup: z.unknown().optional(),
});
export type BotAction = z.infer<typeof botActionSchema>;
export const botReplySchema = z.object({ actions: z.array(botActionSchema) });

/** Owner pressed an order button in Telegram. */
export const orderButtonRequestSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  telegramUserId: z.number(),
  /** True in a group chat: the person must also be a linked admin account. */
  requireLinkedAdmin: z.boolean(),
});
export type OrderButtonRequest = z.infer<typeof orderButtonRequestSchema>;

/** The "/" menu of the bot. The api writes the /help text from it; the notification service registers it with Telegram. */
export const BOT_COMMANDS = [
  { command: 'shop', description: 'Open the store' },
  { command: 'orders', description: 'See my latest orders' },
  { command: 'help', description: 'What this bot can do' },
] as const;
