import { z } from 'zod';
import { normalizePhone } from '../phone';

export const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'qwertyuiop', '11111111', '00000000', 'iloveyou', 'abc12345', 'asdfghjk', 'letmein1',
  '87654321', 'admin123', 'welcome1', 'football', 'baseball', 'sunshine', 'princess',
]);

export const phoneSchema = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'Invalid phone number' });
    return z.NEVER;
  }
  return p;
});

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), 'This password is too common');

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const uuidSchema = z.uuid();
