import { serviceFetch } from '@cambo/service-kit';
import {
  botReplySchema,
  type BotAction,
  type OrderButtonRequest,
  type OrderStatus,
  type TelegramUpdateInput,
} from '@cambo/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { status?: OrderStatus; number?: string },
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** What this service asks of the api (everything shop-related stays there). */
export interface ApiClient {
  /** A chat message: the api decides what to answer. */
  forwardUpdate(update: TelegramUpdateInput): Promise<BotAction[]>;
  /** The owner pressed an order button. Throws ApiError (403 not allowed, 404, 409 with the order's real status). */
  changeOrderStatus(
    orderId: string,
    body: OrderButtonRequest,
  ): Promise<{ number: string; status: OrderStatus }>;
}

export class HttpApiClient implements ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await serviceFetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        secret: this.secret,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 10_000,
      });
    } catch (err) {
      throw new ApiError(0, 'API_UNREACHABLE', `The api is unreachable: ${(err as Error).name}`);
    }
    const json = (await res.json().catch(() => ({}))) as {
      error?: {
        code?: string;
        message?: string;
        details?: { status?: OrderStatus; number?: string };
      };
    };
    if (!res.ok)
      throw new ApiError(
        res.status,
        json.error?.code ?? 'API_ERROR',
        json.error?.message ?? `The api answered ${res.status}`,
        json.error?.details,
      );
    return json as T;
  }

  async forwardUpdate(update: TelegramUpdateInput) {
    return botReplySchema.parse(await this.post('/internal/telegram/updates', { update })).actions;
  }

  changeOrderStatus(orderId: string, body: OrderButtonRequest) {
    return this.post<{ number: string; status: OrderStatus }>(
      `/internal/orders/${orderId}/status`,
      body,
    );
  }
}
