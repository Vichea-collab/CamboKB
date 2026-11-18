import { z } from 'zod';
import { passwordSchema, phoneSchema, uuidSchema } from './common';

export const loginSchema = z.object({ phone: phoneSchema, password: z.string().min(1).max(128) });
export const signupCompleteSchema = z.object({
  requestId: uuidSchema,
  /** Optional: when left out, the name from the customer's Telegram profile is used. */
  name: z.string().trim().min(1).max(60).optional(),
  password: passwordSchema,
});
export const resetCompleteSchema = z.object({ requestId: uuidSchema, password: passwordSchema });
export const changePhoneCompleteSchema = z.object({ requestId: uuidSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export const TELEGRAM_AUTH_PURPOSES = ['SIGNUP', 'RESET', 'CHANGE_PHONE'] as const;
export type TelegramAuthPurpose = (typeof TELEGRAM_AUTH_PURPOSES)[number];
export const telegramStartSchema = z.object({
  purpose: z.enum(TELEGRAM_AUTH_PURPOSES),
  phone: phoneSchema.optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupCompleteInput = z.infer<typeof signupCompleteSchema>;
export type ResetCompleteInput = z.infer<typeof resetCompleteSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type TelegramStartInput = z.infer<typeof telegramStartSchema>;
