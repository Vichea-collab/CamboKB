import type { TelegramUpdateInput } from '@cambo/shared';

/** The bot's messages arrive from the notification service as the trimmed update the contract describes. */
export type TgUpdate = TelegramUpdateInput;
export type TgMessage = NonNullable<TgUpdate['message']>;
export type TgUser = NonNullable<TgMessage['from']>;
