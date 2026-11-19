export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

/** Keys look like `products/<uuid>-400.webp`: lowercase segments, no traversal. */
export const KEY_PATTERN = /^[a-z0-9]+(?:\/[a-z0-9][a-z0-9._-]*)+$/;
export const isSafeKey = (key: string) => KEY_PATTERN.test(key) && !key.includes('..');

export const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};
export const contentTypeFor = (key: string) => CONTENT_TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream';
