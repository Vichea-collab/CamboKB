export type ImageUrls = { sm: string; md: string; lg: string };
export type Category = { id: string; name: string; slug: string; sortOrder: number };
export type Banner = { id: string; linkUrl: string | null; width: number; height: number; image: ImageUrls };

export type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  specsLine: string;
  priceCents: number;
  compareAtCents: number | null;
  isSoldOut: boolean;
  category: { slug: string; name: string };
  image: ImageUrls | null;
  imageCount: number;
};

export type ProductDetailData = ProductCardData & {
  description: string;
  stock: number;
  specs: { label: string; value: string }[];
  images: (ImageUrls & { id: string; width: number; height: number })[];
};

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

export type QuoteLine = { productId: string; name: string; priceCents: number; quantity: number; lineTotalCents: number; image: string | null };
export type Quote = {
  items: QuoteLine[];
  subtotalCents: number;
  deliveryFeeCents: number;
  distanceKm: number | null;
  discountCents: number;
  totalCents: number;
  promo: { code: string } | null;
};

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PACKED' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED';
export type Order = {
  id: string;
  number: string;
  status: OrderStatus;
  createdAt: string;
  contactName: string;
  contactPhone: string;
  region: 'PHNOM_PENH' | 'PROVINCE';
  deliveryService: 'GRAB' | 'VET' | 'JNT';
  addressLine: string;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  note: string | null;
  /** The carrier's tracking code, once the shop has shipped the parcel. */
  trackingNumber: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  promoCode: string | null;
  items: { productId: string; name: string; priceCents: number; quantity: number; lineTotalCents: number; image: string | null }[];
  events: { fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; at: string }[];
  payment: { method: 'COD' | 'KHQR'; status: string; amountCents: number; paidAt: string | null; payBefore: string | null } | null;
};

export type PaymentView = {
  method: 'COD' | 'KHQR';
  status: 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED';
  amountCents: number;
  currency: string;
  payBefore: string | null;
  paidAt: string | null;
  canRenew: boolean;
  khqr: { qr: string; expiresAt: string } | null;
};
