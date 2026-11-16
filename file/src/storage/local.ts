import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contentTypeFor, isSafeKey, type StorageAdapter } from './types';

export class LocalStorage implements StorageAdapter {
  private readonly root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  private resolve(key: string): string {
    if (!isSafeKey(key)) throw new Error(`unsafe key: ${key}`);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`unsafe key: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string) {
    try {
      return { body: await readFile(this.resolve(key)), contentType: contentTypeFor(key) };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}
