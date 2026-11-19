import pg from 'pg';

/** The notification service's own database. */
export const createPool = (connectionString: string) =>
  new pg.Pool({ connectionString, max: 5, options: '-c statement_timeout=15000' });
