import type { PublicUser } from '@cambo/shared';
import type { Order, ProductDetailData } from '../lib/types';

export type AdminOrder = Order & { customer: PublicUser };
export type AdminProduct = ProductDetailData & {
  isActive: boolean;
  sortOrder: number;
  categoryId: string;
  images: (ProductDetailData['images'][number] & { storageKey: string })[];
};
export type AdminBanner = { id: string; storageKey: string; linkUrl: string | null; isActive: boolean; sortOrder: number; image: { sm: string; md: string; lg: string } };
export type Promo = {
  id: string;
  code: string;
  type: 'FIXED' | 'PERCENT';
  value: number;
  minSubtotalCents: number;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  usedCount: number;
  isActive: boolean;
};
export type Customer = PublicUser & { disabled: boolean; createdAt: string; orderCount: number; totalSpentCents: number };
