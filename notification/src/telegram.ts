export type TgUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};
export type TgContact = { phone_number: string; first_name?: string; user_id?: number };
export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  contact?: TgContact;
  location?: { latitude: number; longitude: number };
};
export type TgCallbackQuery = {
  id: string;
  from: TgUser;
  /** The message the pressed button is attached to. */
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    /** The text as Telegram shows it (no markup), with bold and link spans as entities. */
    text?: string;
    entities?: { type: string; offset: number; length: number; [k: string]: unknown }[];
  };
  data?: string;
};
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

/** A failed Bot API call, with what Telegram said so callers can decide whether to retry. */
export class TelegramError extends Error {
  constructor(
    message: string,
    /** HTTP-style error_code from Telegram (429, 403, ...); 0 when we never got an answer. */
    readonly code: number,
    /** Seconds Telegram asks us to wait (rate limit). */
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
  /** Retrying can't help: bad request, bot blocked by the user, chat not found. */
  get permanent() {
    return this.code === 400 || this.code === 403 || this.code === 404;
  }
}

export type SendOptions = {
  replyMarkup?: unknown;
  parseMode?: 'HTML';
  /** Post in this forum topic (message_thread_id) of a group that has Topics on. */
  threadId?: number;
};

export interface TelegramClient {
  sendMessage(chatId: number | string, text: string, opts?: SendOptions): Promise<void>;
  /** Create a topic in a group that has Topics on. Returns its thread id. */
  createForumTopic(chatId: number | string, name: string, iconColor?: number): Promise<number>;
  /** Tap feedback on an inline button (a small toast, or an alert when `alert` is set). */
  answerCallbackQuery(callbackQueryId: string, text?: string, alert?: boolean): Promise<void>;
  /** Swap the buttons under a message we sent earlier. */
  editReplyMarkup(chatId: number | string, messageId: number, replyMarkup: unknown): Promise<void>;
  /** Replace the text (keeping its bold and links through `entities`) and the buttons of a message we sent earlier. */
  editText(
    chatId: number | string,
    messageId: number,
    text: string,
    entities: unknown[] | undefined,
    replyMarkup: unknown,
  ): Promise<void>;
  getUpdates(offset: number, timeoutSec: number): Promise<TgUpdate[]>;
  setWebhook(url: string, secret: string): Promise<void>;
  /** The "/" command menu shown in the chat. */
  setCommands(commands: { command: string; description: string }[]): Promise<void>;
  /** Replace the chat menu button with one that opens the store as a Telegram app (https only). */
  setMenuButton(url: string, text: string): Promise<void>;
}

const ALLOWED_UPDATES = ['message', 'callback_query'];

/** Talks to the Telegram Bot API over HTTPS. The token never leaves the server. */
export class HttpTelegramClient implements TelegramClient {
  constructor(private readonly botToken: string) {}

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    timeoutMs = 15000,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Never put the URL (it holds the token) in the message.
      throw new TelegramError(`Telegram ${method} unreachable: ${(err as Error).name}`, 0);
    }
    const json = (await res.json().catch(() => null)) as {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    } | null;
    if (!json?.ok) {
      throw new TelegramError(
        `Telegram ${method} failed: ${json?.description ?? res.status}`,
        json?.error_code ?? res.status,
        json?.parameters?.retry_after,
      );
    }
    return json.result as T;
  }

  async sendMessage(chatId: number | string, text: string, opts: SendOptions = {}) {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode,
      reply_markup: opts.replyMarkup,
      message_thread_id: opts.threadId,
      disable_web_page_preview: true,
    });
  }

  async createForumTopic(chatId: number | string, name: string, iconColor?: number) {
    const topic = await this.call<{ message_thread_id: number }>('createForumTopic', { chat_id: chatId, name, icon_color: iconColor });
    return topic.message_thread_id;
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, alert?: boolean) {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: alert,
    });
  }

  async editReplyMarkup(chatId: number | string, messageId: number, replyMarkup: unknown) {
    await this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }

  async editText(
    chatId: number | string,
    messageId: number,
    text: string,
    entities: unknown[] | undefined,
    replyMarkup: unknown,
  ) {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(entities?.length ? { entities } : {}),
      link_preview_options: { is_disabled: true },
      reply_markup: replyMarkup,
    });
  }

  getUpdates(offset: number, timeoutSec: number) {
    return this.call<TgUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSec, allowed_updates: ALLOWED_UPDATES },
      (timeoutSec + 10) * 1000,
    );
  }

  async setWebhook(url: string, secret: string) {
    await this.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
    });
  }

  async setCommands(commands: { command: string; description: string }[]) {
    await this.call('setMyCommands', { commands });
  }

  async setMenuButton(url: string, text: string) {
    await this.call('setChatMenuButton', {
      menu_button: { type: 'web_app', text, web_app: { url } },
    });
  }
}

/** Used when TELEGRAM_MODE=off: messages are logged instead of sent. */
export class NoopTelegramClient implements TelegramClient {
  constructor(private readonly log: (msg: string) => void = () => {}) {}
  async sendMessage(chatId: number | string, text: string) {
    this.log(`[telegram:off] to ${chatId}: ${text}`);
  }
  async createForumTopic() {
    return 0;
  }
  async answerCallbackQuery() {}
  async editReplyMarkup() {}
  async editText() {}
  async getUpdates() {
    return [];
  }
  async setWebhook() {}
  async setCommands() {}
  async setMenuButton() {}
}
