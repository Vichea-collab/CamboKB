import { z } from 'zod';
import { uuidSchema } from './common';

export const changePhoneCompleteSchema = z.object({ requestId: uuidSchema });
export const TELEGRAM_AUTH_PURPOSES = ['CHANGE_PHONE', 'SHARE_LOCATION', 'LOGIN'] as const;
export type TelegramAuthPurpose = (typeof TELEGRAM_AUTH_PURPOSES)[number];
export const telegramStartSchema = z.object({
  purpose: z.enum(TELEGRAM_AUTH_PURPOSES),
});

export const loginCompleteSchema = z.object({ requestId: uuidSchema });
export const telegramWebAppSchema = z.object({ initData: z.string().min(1).max(4096) });

export type LoginCompleteInput = z.infer<typeof loginCompleteSchema>;
export type TelegramWebAppInput = z.infer<typeof telegramWebAppSchema>;
export type TelegramStartInput = z.infer<typeof telegramStartSchema>;
