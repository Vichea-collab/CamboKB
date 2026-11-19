import { runWithRequestId } from '@cambo/service-kit';
import { randomUUID } from 'node:crypto';
import { handleUpdate, type BotDeps } from './bot';

/** Long-poll Telegram for updates (development). Returns a stop function. */
export function startPolling(deps: BotDeps): () => void {
  let stopped = false;
  let offset = 0;
  const loop = async () => {
    while (!stopped) {
      try {
        const updates = await deps.telegram.getUpdates(offset, 25);
        for (const u of updates) {
          offset = u.update_id + 1;
          await runWithRequestId(randomUUID(), () => handleUpdate(deps, u)).catch((err) =>
            deps.logger.error({ err }, 'telegram update failed'),
          );
        }
      } catch (err) {
        if (!stopped) {
          deps.logger.warn({ err }, 'telegram polling failed, retrying in 5s');
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
