import { serviceFetch } from '@cambo/service-kit';
import { AppError } from '../../http/errors';

export type NotificationStatus = {
  mode: 'webhook' | 'polling' | 'off';
  botConfigured: boolean;
  adminChatSet: boolean;
  outbox: {
    pending: number;
    failed: number;
    oldestPendingAgeSec: number | null;
    lastError: string | null;
  };
};

/** What the api asks of the notification service directly (everything else is an event). */
export interface NotificationClient {
  status(): Promise<NotificationStatus>;
  /** Queue a test message to the owner's chat. */
  sendTest(): Promise<void>;
}

export class HttpNotificationClient implements NotificationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await serviceFetch(`${this.baseUrl}${path}`, {
        ...init,
        secret: this.secret,
        timeoutMs: 8_000,
      });
    } catch {
      throw new AppError(
        503,
        'NOTIFICATION_SERVICE_UNAVAILABLE',
        'The notification service is unavailable',
      );
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      throw new AppError(
        res.status >= 500 ? 503 : res.status === 401 ? 502 : 409,
        body.error?.code ?? 'NOTIFICATION_ERROR',
        body.error?.message ?? 'Notification request failed',
      );
    }
    return res;
  }

  async status() {
    return (await (await this.call('/internal/status')).json()) as NotificationStatus;
  }

  async sendTest() {
    await this.call('/internal/test', { method: 'POST' });
  }
}
