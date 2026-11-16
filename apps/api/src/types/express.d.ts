import type { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Parsed values written by the `validate` middleware. Cast to the schema's inferred type at use. */
      valid: { body?: unknown; query?: unknown; params?: unknown };
      user?: User;
      sessionId?: string;
    }
  }
}

export {};
