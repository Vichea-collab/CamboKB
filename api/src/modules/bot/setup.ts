import type { AppDeps } from '../../http/app';
import { COMMANDS } from './updates';

/**
 * One-time bot setup on server start: the "/" command menu, and (on https sites only)
 * a menu button that opens the store as a Telegram app. Failures are logged, never fatal.
 */
export async function setupBot({ telegram, config, logger }: AppDeps): Promise<void> {
  try {
    await telegram.setCommands(COMMANDS.map((c) => ({ ...c })));
    const url = config.webOrigin[0];
    if (url?.startsWith('https://')) await telegram.setMenuButton(url, 'Shop');
  } catch (err) {
    logger.warn({ err }, 'Telegram bot setup failed');
  }
}
