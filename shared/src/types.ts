export const REGIONS = ['PHNOM_PENH', 'PROVINCE'] as const;
export type Region = (typeof REGIONS)[number];

export const DELIVERY_SERVICES = ['GRAB', 'VET', 'JNT'] as const;
export type DeliveryService = (typeof DELIVERY_SERVICES)[number];

export const PAYMENT_METHODS = ['COD', 'KHQR'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['UNPAID', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PROMO_TYPES = ['FIXED', 'PERCENT'] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

export const ROLES = ['CUSTOMER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export type PublicUser = {
  id: string;
  name: string;
  phone: string;
  role: Role;
  telegramUsername: string | null;
};

/** A product with this many left (or fewer) counts as low stock: the dashboard lists it and the owner is warned. */
export const LOW_STOCK_THRESHOLD = 3;
