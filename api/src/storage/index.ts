import type { Config } from '../config';
import type { StorageAdapter } from './types';

export function createStorage(_config: Config): StorageAdapter {
  throw new Error('storage not implemented yet');
}
