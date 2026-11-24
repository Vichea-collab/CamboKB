import type { RequestHandler } from 'express';
import type { AppDeps } from '../../http/app';

/**
 * For the admin catalogue routes: after a write that succeeds, the cached public catalogue is cleared before the
 * response is sent, so the admin's next request already sees it. Reads and failed writes (status 400 and up) clear
 * nothing. The cache never throws, so a dead Redis only delays the response by its fail-fast timeout.
 */
export function invalidateCatalogOnWrite(deps: AppDeps): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const end = res.end.bind(res) as (...args: unknown[]) => typeof res;
    res.end = ((...args: unknown[]) => {
      if (res.statusCode >= 400 || res.writableEnded) return end(...args);
      void deps.cache.invalidate('catalog').finally(() => end(...args));
      return res;
    }) as typeof res.end;
    next();
  };
}
