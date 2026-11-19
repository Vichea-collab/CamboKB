import type { FileConfig } from '../config';
import { LocalStorage } from './local';
import { S3Storage } from './s3';
import type { StorageAdapter } from './types';

export function createStorage(config: FileConfig): StorageAdapter {
  return config.storage.driver === 's3' ? new S3Storage(config.storage) : new LocalStorage(config.storage.dir);
}
