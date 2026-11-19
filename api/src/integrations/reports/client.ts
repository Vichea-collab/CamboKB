import { AppError } from '../../http/errors';

export interface ReportClient {
  invoicePdf(orderId: string): Promise<Buffer>;
  invoiceHtml(orderId: string): Promise<string>;
  get(path: string, query: Record<string, string>): Promise<{ body: Buffer; contentType: string }>;
}

/** Calls the report service's /internal API with the shared secret. */
export class HttpReportClient implements ReportClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  async get(path: string, query: Record<string, string>) {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}?${new URLSearchParams(query)}`, {
        headers: { authorization: `Bearer ${this.secret}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new AppError(503, 'REPORT_SERVICE_UNAVAILABLE', 'Reports are unavailable, try again shortly');
    }
    if (res.status >= 400 && res.status < 500) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new AppError(res.status, body.error?.code ?? 'REPORT_ERROR', body.error?.message ?? 'Report request failed');
    }
    if (!res.ok) throw new AppError(503, 'REPORT_SERVICE_UNAVAILABLE', 'Report service error');
    return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async invoicePdf(orderId: string) {
    return (await this.get(`/internal/invoices/${orderId}.pdf`, {})).body;
  }

  async invoiceHtml(orderId: string) {
    return (await this.get(`/internal/invoices/${orderId}.html`, {})).body.toString('utf8');
  }
}
