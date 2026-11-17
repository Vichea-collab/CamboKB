import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors';

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    req.valid ??= {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', result.error.issues.map((i) => ({
          path: [part, ...i.path].join('.'),
          message: i.message,
        })));
      }
      req.valid[part] = result.data;
    }
    next();
  };
}
