import type { EventEnvelope, EventTarget } from '@cambo/shared';
import { serviceFetch } from '@cambo/service-kit';

/** A delivery that did not work. `retryable` says whether trying again later can help. */
export class EventDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EventDeliveryError';
  }
}

export interface EventSender {
  send(target: EventTarget, envelope: EventEnvelope): Promise<void>;
}

/** Sends events to POST /internal/events of the target service, with its shared secret. */
export class HttpEventSender implements EventSender {
  constructor(private readonly targets: Record<EventTarget, { url: string; secret: string }>) {}

  async send(target: EventTarget, envelope: EventEnvelope) {
    const { url, secret } = this.targets[target];
    let res: Response;
    try {
      res = await serviceFetch(`${url}/internal/events`, {
        method: 'POST',
        secret,
        headers: {
          'content-type': 'application/json',
          ...(envelope.requestId ? { 'x-request-id': envelope.requestId } : {}),
        },
        body: JSON.stringify(envelope),
        timeoutMs: 10_000,
      });
    } catch (err) {
      throw new EventDeliveryError(`${target} unreachable: ${(err as Error).name}`, true);
    }
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    const detail =
      `${target} answered ${res.status} ${body.error?.code ?? ''} ${body.error?.message ?? ''}`.trim();
    // A rejected event (400/404/422) will never be accepted as it is. Bad credentials (401/403) and
    // overload (408/425/429/5xx) can be fixed or pass, so those are retried.
    const retryable = res.status >= 500 || [401, 403, 408, 425, 429].includes(res.status);
    throw new EventDeliveryError(detail, retryable, res.status);
  }
}
