import pg from 'pg';

/** The report service's own database. */
export const createPool = (connectionString: string) =>
  new pg.Pool({ connectionString, max: 5, options: '-c statement_timeout=15000' });
