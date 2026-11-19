import { BOT_COMMANDS } from '@cambo/shared';
import type { NotificationConfig } from './config';
import type { Logger } from './logger';
import type { TelegramClient } from './telegram';

/**
 * One-time bot setup on start: the "/" command menu, and (on https sites only) a menu button that
 * opens the store as a Telegram app. Failures are logged, never fatal.
 */
export async function setupBot({
  telegram,
  config,
  logger,
}: {
  telegram: TelegramClient;
  config: NotificationConfig;
  logger: Logger;
}): Promise<void> {
  try {
    await telegram.setCommands(BOT_COMMANDS.map((c) => ({ ...c })));
    if (config.webOrigin.startsWith('https://'))
      await telegram.setMenuButton(config.webOrigin, 'Shop');
  } catch (err) {
    logger.warn({ err }, 'Telegram bot setup failed');
  }
}
