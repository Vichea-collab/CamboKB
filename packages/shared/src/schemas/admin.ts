import { z } from 'zod';
import { ORDER_STATUSES } from '../status';
import { PAYMENT_STATUSES, PROMO_TYPES } from '../types';
import { latLngSchema, uuidSchema } from './common';

const cents = z.number().int().min(0).max(100_000_00);

export const specRowSchema = z.object({ label: z.string().trim().min(1).max(60), value: z.string().trim().max(200) });

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(140).optional(),
  categoryId: uuidSchema,
  specsLine: z.string().trim().max(200).default(''),
  description: z.string().trim().max(5000).default(''),
  priceCents: cents,
  compareAtCents: cents.nullish(),
  stock: z.number().int().min(0).max(100000),
  isSoldOut: z.boolean().default(false),
  isActive: z.boolean().default(true),
  specs: z.array(specRowSchema).max(40).default([]),
});
export const productPatchSchema = productInputSchema.partial();

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60).optional(),
});

export const bannerPatchSchema = z.object({
  linkUrl: z.url().max(500).nullish(),
  isActive: z.boolean().optional(),
});

export const reorderSchema = z.object({ ids: z.array(uuidSchema).min(1).max(1000) });

export const promoInputSchema = z
  .object({
    code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((v) => v.toUpperCase()),
    type: z.enum(PROMO_TYPES),
    value: z.number().int().min(1),
    minSubtotalCents: cents.default(0),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    maxUses: z.number().int().min(1).nullish(),
    maxUsesPerUser: z.number().int().min(1).nullish(),
    isActive: z.boolean().default(true),
  })
  .refine((p) => p.type !== 'PERCENT' || p.value <= 100, { message: 'Percent must be 1–100', path: ['value'] });

export const deliverySettingsSchema = z.object({
  store: latLngSchema,
  provinceFeeCents: cents,
  phnomPenhStandardFeeCents: cents,
  grabTiers: z.array(z.object({ maxKm: z.number().positive().max(100), feeCents: cents })).max(10),
  grabBeyondFeeCents: cents,
});

export const settingsInputSchema = z.object({
  storeName: z.string().trim().min(1).max(60),
  delivery: deliverySettingsSchema,
  telegramNotify: z.boolean(),
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export const paymentStatusUpdateSchema = z.object({ status: z.enum(PAYMENT_STATUSES) });

export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductPatch = z.infer<typeof productPatchSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type PromoInput = z.infer<typeof promoInputSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type SpecRow = z.infer<typeof specRowSchema>;
