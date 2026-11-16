import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { AppError } from '../errors';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Not found'));
};

export function errorHandler(isProduction: boolean): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let status = 500;
    let code = 'INTERNAL';
    let message = 'Something went wrong';
    let details: unknown;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = 'Already exists';
      details = { fields: err.meta?.target };
    } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Not found';
    } else if (err instanceof MulterError) {
      status = 400;
      code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
      message = err.message;
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body too large';
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Malformed JSON';
    } else if (!isProduction && err instanceof Error) {
      message = err.message;
    }

    if (status >= 500) req.log?.error({ err }, 'unhandled error');
    res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
  };
}
