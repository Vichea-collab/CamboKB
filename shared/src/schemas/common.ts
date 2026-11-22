import { z } from 'zod';
import { normalizePhone } from '../phone';

export const phoneSchema = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'Invalid phone number' });
    return z.NEVER;
  }
  return p;
});

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const uuidSchema = z.uuid();
