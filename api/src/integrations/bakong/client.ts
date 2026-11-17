/**
 * Bakong Open API (National Bank of Cambodia): looks up a KHQR payment by the md5
 * of the QR string we generated. The token is registered at
 * https://api-bakong.nbc.gov.kh and expires every 90 days.
 */
export type BakongCheck =
  | {
      found: true;
      hash: string;
      amount: number;
      currency: string;
      fromAccountId: string;
      toAccountId: string;
      paidAt: Date;
      raw: Record<string, unknown>;
    }
  | { found: false };

export class BakongError extends Error {
  constructor(
    public readonly kind: 'UNAUTHORIZED' | 'UNAVAILABLE' | 'BAD_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'BakongError';
  }
}

export interface BakongClient {
  checkByMd5(md5: string): Promise<BakongCheck>;
}

type BakongResponse = {
  responseCode: number;
  responseMessage?: string;
  errorCode?: number | null;
  data?: {
    hash?: string;
    fromAccountId?: string;
    toAccountId?: string;
    currency?: string;
    amount?: number;
    createdDateMs?: number;
    acknowledgedDateMs?: number;
  } | null;
};

export class HttpBakongClient implements BakongClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  async checkByMd5(md5: string): Promise<BakongCheck> {
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}/v1/check_transaction_by_md5`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ md5 }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new BakongError('UNAVAILABLE', `Bakong unreachable: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new BakongError('UNAUTHORIZED', `Bakong rejected the token (${res.status})`);
    if (!res.ok) throw new BakongError('UNAVAILABLE', `Bakong error ${res.status}`);
    const body = (await res.json().catch(() => null)) as BakongResponse | null;
    if (!body || typeof body.responseCode !== 'number') throw new BakongError('BAD_RESPONSE', 'Unexpected Bakong response');
    if (body.responseCode !== 0 || !body.data?.hash) return { found: false };
    const d = body.data;
    return {
      found: true,
      hash: d.hash!,
      amount: Number(d.amount),
      currency: String(d.currency ?? ''),
      fromAccountId: String(d.fromAccountId ?? ''),
      toAccountId: String(d.toAccountId ?? ''),
      paidAt: new Date(d.acknowledgedDateMs ?? d.createdDateMs ?? Date.now()),
      raw: d as Record<string, unknown>,
    };
  }
}
