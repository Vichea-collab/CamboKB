import type { Metrics } from '@cambo/service-kit';
import type { AppDeps } from '../http/app';

/** Business metrics the api adds to its Prometheus registry. */
type AppMetrics = {
  ordersCreated: { inc(l: { payment_method: string }): void };
  khqrPayments: { inc(l: { result: string }): void };
};
const store = new WeakMap<Metrics, AppMetrics>();

export function registerAppMetrics(metrics: Metrics): void {
  store.set(metrics, {
    ordersCreated: metrics.counter('orders_created_total', 'Orders placed', [
      'payment_method',
    ] as const),
    khqrPayments: metrics.counter('khqr_payments_total', 'KHQR payment outcomes', [
      'result',
    ] as const),
  });
}

/** The counters, or no-ops when metrics were not registered (some tests). */
export const appMetrics = (deps: Pick<AppDeps, 'metrics'>): AppMetrics =>
  store.get(deps.metrics) ?? { ordersCreated: { inc() {} }, khqrPayments: { inc() {} } };
