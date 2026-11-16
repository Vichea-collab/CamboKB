import multer from 'multer';
import { AppError } from '../errors';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** In-memory uploads (forwarded to the file service), images only, ≤8 MB each. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 10, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new AppError(400, 'UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG or WebP image'));
  },
});
