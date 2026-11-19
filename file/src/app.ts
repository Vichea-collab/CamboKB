import { randomUUID } from 'node:crypto';
import {
  createMetrics,
  requestContext,
  requireServiceSecret,
  currentRequestId,
} from '@cambo/service-kit';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import multer, { MulterError } from 'multer';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { AssetRegistry } from './assets';
import type { FileConfig } from './config';
import { FileError } from './errors';
import { deleteImage, IMAGE_PREFIXES, IMAGE_WIDTHS, processImage, shareImage } from './images';
import type { Logger } from './logger';
import { isSafeKey, type StorageAdapter } from './storage/types';

export type FileDeps = {
  config: FileConfig;
  storage: StorageAdapter;
  assets: AssetRegistry;
  logger: Logger;
};

const MAX_BYTES = 8 * 1024 * 1024;
const FILE_PREFIXES = ['misc', 'payments'] as const;
const GENERIC_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function createFileApp({ config, storage, assets, logger }: FileDeps) {
  const metrics = createMetrics('file');
  const processed = metrics.counter('file_uploads_total', 'Uploads handled', [
    'kind',
    'result',
  ] as const);
  metrics.gauge('file_assets', 'Stored assets by kind', ['kind'] as const, async (g) => {
    g.reset();
    for (const s of await assets.stats().catch(() => [])) g.set({ kind: s.kind }, s.count);
  });
  metrics.gauge('file_asset_bytes', 'Bytes stored by kind', ['kind'] as const, async (g) => {
    g.reset();
    for (const s of await assets.stats().catch(() => [])) g.set({ kind: s.kind }, s.bytes);
  });
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(requestContext());
  app.use(metrics.middleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: () => currentRequestId() ?? randomUUID(),
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/metrics' },
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1, fields: 5 },
  });
  const internal = express.Router();
  internal.use(
    requireServiceSecret(
      config.secret,
      () => new FileError(401, 'UNAUTHORIZED', 'Missing or invalid service credentials'),
    ),
  );

  internal.post('/images', upload.single('file'), async (req, res) => {
    const prefix = z.enum(IMAGE_PREFIXES).safeParse(req.body?.prefix);
    if (!prefix.success) throw new FileError(400, 'VALIDATION_ERROR', 'Invalid prefix');
    if (!req.file) throw new FileError(400, 'VALIDATION_ERROR', 'Missing file');
    let stored;
    try {
      stored = await processImage(storage, req.file.buffer, prefix.data);
    } catch (err) {
      processed.inc({ kind: 'image', result: 'rejected' });
      throw err;
    }
    try {
      await assets.record({
        storageKey: stored.storageKey,
        kind: 'image',
        contentType: 'image/webp',
        sizeBytes: stored.bytes,
        width: stored.width,
        height: stored.height,
      });
    } catch (err) {
      // The registry is this service's database: never keep a stored image it doesn't know about.
      await deleteImage(storage, stored.storageKey).catch(() => undefined);
      processed.inc({ kind: 'image', result: 'error' });
      logger.error({ err }, 'could not record image, upload undone');
      throw new FileError(
        503,
        'DATABASE_UNAVAILABLE',
        'Could not save the image, try again shortly',
      );
    }
    processed.inc({ kind: 'image', result: 'ok' });
    res
      .status(201)
      .json({ storageKey: stored.storageKey, width: stored.width, height: stored.height });
  });

  internal.delete('/images/:prefix/:id', async (req, res) => {
    const key = `${req.params.prefix}/${req.params.id}`;
    if (
      !z.enum(IMAGE_PREFIXES).safeParse(req.params.prefix).success ||
      !z.uuid().safeParse(req.params.id).success
    ) {
      throw new FileError(400, 'VALIDATION_ERROR', 'Invalid image key');
    }
    await deleteImage(storage, key);
    await assets
      .forget(key)
      .catch((err) => logger.warn({ err, key }, 'could not remove image record'));
    res.status(204).end();
  });

  internal.post('/files', upload.single('file'), async (req, res) => {
    const prefix = z.enum(FILE_PREFIXES).safeParse(req.body?.prefix);
    if (!prefix.success) throw new FileError(400, 'VALIDATION_ERROR', 'Invalid prefix');
    if (!req.file) throw new FileError(400, 'VALIDATION_ERROR', 'Missing file');
    const ext = GENERIC_TYPES[req.file.mimetype];
    if (!ext || !sniffMatches(req.file.buffer, ext))
      throw new FileError(400, 'UNSUPPORTED_FILE', 'File type not allowed');
    const storageKey = `${prefix.data}/${randomUUID()}.${ext}`;
    await storage.put(storageKey, req.file.buffer, req.file.mimetype);
    try {
      await assets.record({
        storageKey,
        kind: 'file',
        contentType: req.file.mimetype,
        sizeBytes: req.file.size,
      });
    } catch (err) {
      await storage.delete(storageKey).catch(() => undefined);
      processed.inc({ kind: 'file', result: 'error' });
      logger.error({ err }, 'could not record file, upload undone');
      throw new FileError(
        503,
        'DATABASE_UNAVAILABLE',
        'Could not save the file, try again shortly',
      );
    }
    processed.inc({ kind: 'file', result: 'ok' });
    res.status(201).json({ storageKey, contentType: req.file.mimetype, size: req.file.size });
  });

  internal.delete('/files/:prefix/:name', async (req, res) => {
    const key = `${req.params.prefix}/${req.params.name}`;
    if (!isSafeKey(key)) throw new FileError(400, 'VALIDATION_ERROR', 'Invalid key');
    await storage.delete(key);
    await assets
      .forget(key)
      .catch((err) => logger.warn({ err, key }, 'could not remove file record'));
    res.status(204).end();
  });

  internal.get('/assets/stats', async (_req, res) => {
    res.json({ assets: await assets.stats() });
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/readyz', async (_req, res) => {
    try {
      await assets.ping();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.get('/metrics', metrics.handler);
  app.use('/internal', internal);

  // 1200x630 JPEG for link previews (Telegram, Facebook, WhatsApp don't all read WebP).
  // Built on first request from the stored WebP and cached for a year (the key never changes).
  app.get('/files/og/:prefix/:file', cors({ origin: config.corsOrigin }), async (req, res) => {
    const prefix = z.enum(IMAGE_PREFIXES).safeParse(req.params.prefix);
    const id = /^([0-9a-f-]{36})\.jpg$/i.exec(req.params.file ?? '')?.[1];
    if (!prefix.success || !id || !z.uuid().safeParse(id).success)
      throw new FileError(404, 'NOT_FOUND', 'Not found');
    let source: Buffer | null = null;
    for (const w of [...IMAGE_WIDTHS].reverse()) {
      source = (await storage.get(`${prefix.data}/${id}-${w}.webp`))?.body ?? null;
      if (source) break;
    }
    if (!source) throw new FileError(404, 'NOT_FOUND', 'Not found');
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(await shareImage(source));
  });

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
