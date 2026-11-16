import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import multer, { MulterError } from 'multer';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { requireSecret } from './auth';
import type { FileConfig } from './config';
import { FileError } from './errors';
import { deleteImage, IMAGE_PREFIXES, processImage } from './images';
import type { Logger } from './logger';
import { isSafeKey, type StorageAdapter } from './storage/types';

export type FileDeps = { config: FileConfig; storage: StorageAdapter; logger: Logger };

const MAX_BYTES = 8 * 1024 * 1024;
const FILE_PREFIXES = ['misc', 'payments'] as const;
const GENERIC_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function createFileApp({ config, storage, logger }: FileDeps) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(pinoHttp({ logger, genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(), autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 5 } });
  const internal = express.Router();
  internal.use(requireSecret(config.secret));

  internal.post('/images', upload.single('file'), async (req, res) => {
    const prefix = z.enum(IMAGE_PREFIXES).safeParse(req.body?.prefix);
    if (!prefix.success) throw new FileError(400, 'VALIDATION_ERROR', 'Invalid prefix');
    if (!req.file) throw new FileError(400, 'VALIDATION_ERROR', 'Missing file');
    res.status(201).json(await processImage(storage, req.file.buffer, prefix.data));
  });

  internal.delete('/images/:prefix/:id', async (req, res) => {
    const key = `${req.params.prefix}/${req.params.id}`;
    if (!z.enum(IMAGE_PREFIXES).safeParse(req.params.prefix).success || !z.uuid().safeParse(req.params.id).success) {
      throw new FileError(400, 'VALIDATION_ERROR', 'Invalid image key');
    }
    await deleteImage(storage, key);
    res.status(204).end();
  });

  internal.post('/files', upload.single('file'), async (req, res) => {
    const prefix = z.enum(FILE_PREFIXES).safeParse(req.body?.prefix);
    if (!prefix.success) throw new FileError(400, 'VALIDATION_ERROR', 'Invalid prefix');
    if (!req.file) throw new FileError(400, 'VALIDATION_ERROR', 'Missing file');
    const ext = GENERIC_TYPES[req.file.mimetype];
    if (!ext || !sniffMatches(req.file.buffer, ext)) throw new FileError(400, 'UNSUPPORTED_FILE', 'File type not allowed');
    const storageKey = `${prefix.data}/${randomUUID()}.${ext}`;
    await storage.put(storageKey, req.file.buffer, req.file.mimetype);
    res.status(201).json({ storageKey, contentType: req.file.mimetype, size: req.file.size });
  });

  internal.delete('/files/:prefix/:name', async (req, res) => {
    const key = `${req.params.prefix}/${req.params.name}`;
    if (!isSafeKey(key)) throw new FileError(400, 'VALIDATION_ERROR', 'Invalid key');
    await storage.delete(key);
    res.status(204).end();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/internal', internal);

  app.get('/files/*key', cors({ origin: config.corsOrigin }), async (req, res) => {
    const segments = (req.params as { key: string[] }).key;
    const key = Array.isArray(segments) ? segments.join('/') : String(segments);
    if (!isSafeKey(key)) throw new FileError(404, 'NOT_FOUND', 'Not found');
    const file = await storage.get(key);
    if (!file) throw new FileError(404, 'NOT_FOUND', 'Not found');
    res.set({
      'Content-Type': file.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.send(file.body);
  });

  app.use((_req, _res, next) => next(new FileError(404, 'NOT_FOUND', 'Not found')));
  app.use(errorHandler);
  return app;
}

/** Check magic bytes so a renamed file can't pass as an image or PDF. */
function sniffMatches(buf: Buffer, ext: string): boolean {
  const hex = buf.subarray(0, 12).toString('hex');
  switch (ext) {
    case 'pdf':
      return buf.subarray(0, 5).toString() === '%PDF-';
    case 'png':
      return hex.startsWith('89504e47');
    case 'jpg':
      return hex.startsWith('ffd8ff');
    case 'webp':
      return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
    default:
      return false;
  }
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL';
  let message = 'Something went wrong';
  if (err instanceof FileError) ({ status, code, message } = err);
  else if (err instanceof MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 8 MB' : err.message;
  }
  if (status >= 500) req.log?.error({ err }, 'unhandled error');
  res.status(status).json({ error: { code, message } });
};
