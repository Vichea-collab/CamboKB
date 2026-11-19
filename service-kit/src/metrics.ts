import type { Request, RequestHandler, Response } from 'express';
import client from 'prom-client';

/**
 * Prometheus metrics every service exposes on GET /metrics (never routed through nginx):
 *  - process CPU, memory, event loop lag, GC (prom-client defaults);
 *  - http_requests_total and http_request_duration_seconds by method, route and status;
 *  - whatever the service adds with counter() / gauge() / histogram().
 */
export type Metrics = ReturnType<typeof createMetrics>;

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** The route pattern (`/api/v1/orders/:number`), never the raw URL, so labels stay few. */
export function routeLabel(req: Request, res: Response): string {
  if (req.route)
    return (
      `${req.baseUrl}${typeof req.route.path === 'string' ? req.route.path : String(req.route.path)}` ||
      '/'
    );
  return res.statusCode === 404 ? 'not_found' : 'unmatched';
}

export function createMetrics(service: string) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry });

  const labelNames = ['method', 'route', 'status'] as const;
  const requests = new client.Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled',
    labelNames,
    registers: [registry],
  });
  const duration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames,
    buckets: BUCKETS,
    registers: [registry],
  });

  const middleware: RequestHandler = (req, res, next) => {
    if (req.path === '/metrics' || req.path === '/healthz' || req.path === '/readyz') return next();
    const stop = duration.startTimer();
    res.on('finish', () => {
      const labels = {
        method: req.method,
        route: routeLabel(req, res),
        status: String(res.statusCode),
      };
      requests.inc(labels);
      stop(labels);
    });
    next();
  };

  const handler: RequestHandler = async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  };

  return {
    registry,
    middleware,
    handler,
    counter: <L extends string>(name: string, help: string, labelNames: readonly L[] = []) =>
      new client.Counter<L>({ name, help, labelNames, registers: [registry] }),
    /** `collect` runs on every scrape, so the value is always current (e.g. rows waiting in a table). */
    gauge: <L extends string>(
      name: string,
      help: string,
      labelNames: readonly L[] = [],
      collect?: (g: client.Gauge<L>) => void | Promise<void>,
    ) =>
      new client.Gauge<L>({
        name,
        help,
        labelNames,
        registers: [registry],
        ...(collect
          ? {
              collect() {
                return collect(this);
              },
            }
          : {}),
      }),
    histogram: <L extends string>(
      name: string,
      help: string,
      labelNames: readonly L[] = [],
      buckets: number[] = BUCKETS,
    ) => new client.Histogram<L>({ name, help, labelNames, buckets, registers: [registry] }),
  };
}
