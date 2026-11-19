import pg from 'pg';

export const createPool = (connectionString: string) =>
  new pg.Pool({ connectionString, max: 5, options: '-c statement_timeout=15000' });
