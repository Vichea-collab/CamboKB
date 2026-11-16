import pg from 'pg';

/**
 * Every connection is forced read-only at the session level, on top of the
 * read-only database role used in production — reporting can never change data.
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 5,
    options: '-c default_transaction_read_only=on -c statement_timeout=15000',
  });
}
