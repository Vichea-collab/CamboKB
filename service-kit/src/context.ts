import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * The id that follows one customer action through every service. It comes in as `x-request-id`
 * (or is made up here), goes out on every call to another service, and is stamped on every log line.
 */
const store = new AsyncLocalStorage<{ requestId: string }>();
const SAFE = /^[\w.:-]{1,100}$/;

export const currentRequestId = (): string | undefined => store.getStore()?.requestId;
export const runWithRequestId = <T>(requestId: string, fn: () => T): T =>
  store.run({ requestId }, fn);

export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const given = req.get('x-request-id');
    const requestId = given && SAFE.test(given) ? given : randomUUID();
    res.setHeader('x-request-id', requestId);
    store.run({ requestId }, next);
  };
}
