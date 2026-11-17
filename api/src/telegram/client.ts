export type TgUser = { id: number; is_bot?: boolean; first_name?: string; username?: string };
export type TgContact = { phone_number: string; first_name?: string; user_id?: number };
export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  contact?: TgContact;
};
export type TgUpdate = { update_id: number; message?: TgMessage };

export type SendOptions = { replyMarkup?: unknown; parseMode?: 'HTML' };

export interface TelegramClient {
  sendMessage(chatId: number | string, text: string, opts?: SendOptions): Promise<void>;
  getUpdates(offset: number, timeoutSec: number): Promise<TgUpdate[]>;
  setWebhook(url: string, secret: string): Promise<void>;
  /** The "/" command menu shown in the chat. */
  setCommands(commands: { command: string; description: string }[]): Promise<void>;
  /** Replace the chat menu button with one that opens the store as a Telegram app (https only). */
  setMenuButton(url: string, text: string): Promise<void>;
}

/** Talks to the Telegram Bot API over HTTPS. The token never leaves the server. */
export class HttpTelegramClient implements TelegramClient {
  constructor(private readonly botToken: string) {}

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
    return json.result as T;
  }

  async sendMessage(chatId: number | string, text: string, opts: SendOptions = {}) {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode,
      reply_markup: opts.replyMarkup,
      disable_web_page_preview: true,
    });
  }

  getUpdates(offset: number, timeoutSec: number) {
    return this.call<TgUpdate[]>('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message'] }, (timeoutSec + 10) * 1000);
  }

  async setWebhook(url: string, secret: string) {
    await this.call('setWebhook', { url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false });
  }

  async setCommands(commands: { command: string; description: string }[]) {
    await this.call('setMyCommands', { commands });
  }

  async setMenuButton(url: string, text: string) {
    await this.call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } });
  }
}

/** Used when TELEGRAM_MODE=off: messages are logged instead of sent. */
export class NoopTelegramClient implements TelegramClient {
  constructor(private readonly log: (msg: string) => void = () => {}) {}
  async sendMessage(chatId: number | string, text: string) {
    this.log(`[telegram:off] to ${chatId}: ${text}`);
  }
  async getUpdates() {
    return [];
  }
  async setWebhook() {}
  async setCommands() {}
  async setMenuButton() {}
}
