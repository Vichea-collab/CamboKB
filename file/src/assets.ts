import type pg from 'pg';

export type AssetInput = {
  storageKey: string;
  kind: 'image' | 'file';
  contentType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
};

/** What the file service knows about what it stores. Serving files never depends on it. */
export class AssetRegistry {
  constructor(private readonly pool: pg.Pool) {}

  async record(a: AssetInput) {
    await this.pool.query(
      `INSERT INTO assets (storage_key, kind, content_type, size_bytes, width, height) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (storage_key) DO UPDATE SET content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes, width = EXCLUDED.width, height = EXCLUDED.height`,
      [a.storageKey, a.kind, a.contentType, a.sizeBytes, a.width ?? null, a.height ?? null],
    );
  }

  async forget(storageKey: string) {
    await this.pool.query('DELETE FROM assets WHERE storage_key = $1', [storageKey]);
  }

  async stats(): Promise<{ kind: string; count: number; bytes: number }[]> {
    const { rows } = await this.pool.query<{ kind: string; count: number; bytes: string }>(
      `SELECT kind, count(*)::int AS count, coalesce(sum(size_bytes), 0)::bigint AS bytes FROM assets GROUP BY kind ORDER BY kind`,
    );
    return rows.map((r) => ({ kind: r.kind, count: r.count, bytes: Number(r.bytes) }));
  }

  async ping() {
    await this.pool.query('SELECT 1');
  }
}
