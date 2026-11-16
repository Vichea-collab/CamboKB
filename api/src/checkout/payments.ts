import type { Order, Prisma } from '@prisma/client';
import type { PaymentMethod, Region } from '@cambo/shared';
import { AppError } from '../errors';

/**
 * One implementation per payment method. KHQR / Bakong plugs in here later:
 * createPayment generates the QR (qrString, providerRef = md5, expiresAt) and a
 * status check / webhook marks the Payment PAID.
 */
export interface PaymentProvider {
  method: PaymentMethod;
  isAvailable(input: { region: Region }): boolean;
  createPayment(tx: Prisma.TransactionClient, order: Order): Promise<void>;
}

export const CodProvider: PaymentProvider = {
  method: 'COD',
  isAvailable: ({ region }) => region === 'PHNOM_PENH',
  async createPayment(tx, order) {
    await tx.payment.create({ data: { orderId: order.id, method: 'COD', status: 'UNPAID', amountCents: order.totalCents } });
  },
};

export const KhqrProvider: PaymentProvider = {
  method: 'KHQR',
  isAvailable: () => false,
  async createPayment() {
    throw new AppError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'KHQR payment is coming soon');
  },
};

const PROVIDERS: Record<PaymentMethod, PaymentProvider> = { COD: CodProvider, KHQR: KhqrProvider };

export function getPaymentProvider(method: PaymentMethod): PaymentProvider {
  return PROVIDERS[method];
}
