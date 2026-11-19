import { currentRequestId } from './context';

/** fetch() for calls to another service: bearer secret, request id forwarded, a timeout. */
export function serviceFetch(
  url: string,
  init: Omit<RequestInit, 'signal'> & { secret: string; timeoutMs?: number },
): Promise<Response> {
  const { secret, timeoutMs = 15_000, headers, ...rest } = init;
  const out = new Headers(headers);
  out.set('authorization', `Bearer ${secret}`);
  const requestId = currentRequestId();
  if (requestId && !out.has('x-request-id')) out.set('x-request-id', requestId);
  return fetch(url, { ...rest, headers: out, signal: AbortSignal.timeout(timeoutMs) });
}
