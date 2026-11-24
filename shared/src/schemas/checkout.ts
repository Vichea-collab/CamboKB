import { z } from 'zod';
import { DELIVERY_SERVICES, PAYMENT_METHODS, REGIONS } from '../types';
import { latLngSchema, phoneSchema, uuidSchema } from './common';

export const cartItemSchema = z.object({ productId: uuidSchema, quantity: z.number().int().min(1).max(20) });

export const quoteSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(50),
  region: z.enum(REGIONS),
  deliveryService: z.enum(DELIVERY_SERVICES),
  pin: latLngSchema.nullish(),
  promoCode: z.string().trim().max(40).optional(),
});

export const createOrderSchema = quoteSchema.extend({
  contactName: z.string().trim().min(1).max(60),
  contactPhone: phoneSchema,
  addressLine: z.string().trim().min(1).max(500),
  note: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  defaultAddress: z
    .object({
      region: z.enum(REGIONS),
      addressLine: z.string().trim().max(500),
      lat: z.number().nullish(),
      lng: z.number().nullish(),
    })
    .nullish(),
});

export type QuoteInput = z.infer<typeof quoteSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
