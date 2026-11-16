import type { AppDeps } from '../app';

/** New-order alert to the admin chat. Implemented in the admin-ops task; never throws. */
export async function notifyNewOrder(_deps: AppDeps, _orderId: string): Promise<void> {}
