import type { Order, Prisma } from '@prisma/client';
import type { PaymentMethod, Region } from '@cambo/shared';
import type { AppDeps } from '../../http/app';
import { issueKhqr } from './khqr';

/** One implementation per payment method. */
export interface PaymentProvider {
  method: PaymentMethod;
  isAvailable(deps: AppDeps, input: { region: Region }): boolean;
  /** Runs inside the order transaction. */
  createPayment(deps: AppDeps, tx: Prisma.TransactionClient, order: Order): Promise<void>;
}

export const CodProvider: PaymentProvider = {
  method: 'COD',
  isAvailable: (_deps, { region }) => region === 'PHNOM_PENH',
  async createPayment(_deps, tx, order) {
    await tx.payment.create({ data: { orderId: order.id, method: 'COD', status: 'UNPAID', amountCents: order.totalCents } });
  },
};

/** KHQR through Bakong: anywhere in Cambodia, once the store's Bakong account and token are configured. */
export const KhqrProvider: PaymentProvider = {
  method: 'KHQR',
  isAvailable: ({ config }) => config.bakong.enabled,
  async createPayment(deps, tx, order) {
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        method: 'KHQR',
        status: 'PENDING',
        amountCents: order.totalCents,
        currency: 'USD',
        provider: 'bakong',
        expiresAt: new Date(Date.now() + deps.config.bakong.holdMinutes * 60_000),
      },
    });
    await issueKhqr(deps, tx, { ...payment, order });
  },
};

const PROVIDERS: Record<PaymentMethod, PaymentProvider> = { COD: CodProvider, KHQR: KhqrProvider };

export function getPaymentProvider(method: PaymentMethod): PaymentProvider {
  return PROVIDERS[method];
}
