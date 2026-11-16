import os from 'node:os';
import { defineConfig } from 'vitest/config';

const testDb =
  process.env.DATABASE_URL_TEST ?? `postgresql://${os.userInfo().username}@localhost:5432/cambo_supply_test`;
process.env.DATABASE_URL_TEST = testDb;

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
    env: { DATABASE_URL_TEST: testDb, NODE_ENV: 'test' },
  },
});
