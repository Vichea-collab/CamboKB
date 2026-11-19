import { createRequire } from 'node:module';

type KhqrResult = { status: { code: number; message?: string | null }; data?: { qr: string; md5: string } | null };
type Sdk = {
  BakongKHQR: new () => { generateIndividual(info: unknown): KhqrResult };
  IndividualInfo: new (accountId: string, merchantName: string, merchantCity: string, optional: Record<string, unknown>) => unknown;
  khqrData: { currency: { usd: number } };
};

// NBC's official SDK is CommonJS without types.
const sdk = createRequire(import.meta.url)('bakong-khqr') as Sdk;

/**
 * A dynamic individual KHQR for an exact USD amount, payable to `accountId` until
 * `expiresAt`. The md5 of the QR string is what Bakong uses to find the payment.
 */
export function createKhqr(input: {
  accountId: string;
  merchantName: string;
  merchantCity: string;
  amountCents: number;
  billNumber: string;
  expiresAt: Date;
}): { qr: string; md5: string } {
  const info = new sdk.IndividualInfo(input.accountId, input.merchantName.slice(0, 25), input.merchantCity.slice(0, 15), {
    currency: sdk.khqrData.currency.usd,
    amount: Number((input.amountCents / 100).toFixed(2)),
    billNumber: input.billNumber.slice(0, 25),
    expirationTimestamp: input.expiresAt.getTime(),
  });
  let result: KhqrResult;
  try {
    result = new sdk.BakongKHQR().generateIndividual(info);
  } catch (err) {
    // The SDK throws plain response objects for invalid input.
    const message = (err as KhqrResult)?.status?.message ?? (err as Error)?.message ?? 'unknown error';
    throw new Error(`KHQR generation failed: ${message}`);
  }
  if (result.status.code !== 0 || !result.data) throw new Error(`KHQR generation failed: ${result.status.message ?? 'unknown error'}`);
  return result.data;
}
