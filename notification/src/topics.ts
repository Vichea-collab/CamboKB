import type pg from 'pg';
import type { Logger } from './logger';
import { TelegramError, type TelegramClient } from './telegram';

/**
 * The owner's group can use Telegram "Topics": one topic per kind of alert, so orders, payments and
 * problems don't drown each other. Topics are created the first time they are needed.
 */
export const TOPICS = {
  orders: { name: '🛒 New orders', color: 16766590 },
  payments: { name: '💳 Payments', color: 9367192 },
  attention: { name: '⚠️ Needs attention', color: 16478047 },
} as const;
export type TopicKey = keyof typeof TOPICS;
export const TOPIC_KEYS = Object.keys(TOPICS) as TopicKey[];
export const isTopicKey = (v: unknown): v is TopicKey => typeof v === 'string' && v in TOPICS;

/** A chat that refused topics (not a forum, or the bot may not manage them) is left alone for this long. */
const UNSUPPORTED_MS = 10 * 60 * 1000;

export class Topics {
  private readonly loading = new Map<string, Promise<number | undefined>>();
  private readonly unsupportedUntil = new Map<string, number>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
  ) {}

  /**
   * The thread id to post in, creating the topic if it does not exist yet. Undefined when the chat can't
   * have topics: the message is then sent to the chat as a whole. A temporary Telegram failure throws, so
   * the message is retried later instead of landing in the wrong place.
   */
  resolve(chatId: number | string | bigint, key: TopicKey): Promise<number | undefined> {
    const chat = String(chatId);
    if ((this.unsupportedUntil.get(chat) ?? 0) > Date.now()) return Promise.resolve(undefined);
    const id = `${chat}:${key}`;
    let task = this.loading.get(id);
    if (!task) {
      task = this.load(chat, key).finally(() => this.loading.delete(id));
      this.loading.set(id, task);
    }
    return task;
  }

  /** The topic was deleted in Telegram: forget it so the next message creates a new one. */
  async forget(chatId: number | string | bigint, key: TopicKey): Promise<void> {
    await this.pool.query('DELETE FROM topics WHERE chat_id = $1 AND key = $2', [String(chatId), key]);
  }

  private async load(chat: string, key: TopicKey): Promise<number | undefined> {
    const known = await this.pool.query('SELECT thread_id FROM topics WHERE chat_id = $1 AND key = $2', [chat, key]);
    if (known.rows[0]) return known.rows[0].thread_id as number;
    let threadId: number;
    try {
      threadId = await this.telegram.createForumTopic(chat, TOPICS[key].name, TOPICS[key].color);
    } catch (err) {
      if (err instanceof TelegramError && err.permanent) {
        this.unsupportedUntil.set(chat, Date.now() + UNSUPPORTED_MS);
        this.logger.warn({ chatId: chat, err: err.message }, 'Telegram topics are not available in this chat; sending without them');
        return undefined;
      }
      throw err;
    }
    // Another instance may have created it a moment ago: keep whichever was stored first.
    await this.pool.query('INSERT INTO topics (chat_id, key, thread_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [chat, key, threadId]);
    const stored = await this.pool.query('SELECT thread_id FROM topics WHERE chat_id = $1 AND key = $2', [chat, key]);
    return (stored.rows[0]?.thread_id as number | undefined) ?? threadId;
  }
}
