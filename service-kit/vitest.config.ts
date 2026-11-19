import os from 'node:os';
import { defineConfig } from 'vitest/config';

const testDb =
  process.env.DATABASE_URL_TEST_KIT ??
  `postgresql://${os.userInfo().username}@localhost:5432/cambo_kit_test`;
process.env.DATABASE_URL_TEST_KIT = testDb;

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false,
    env: { DATABASE_URL_TEST_KIT: testDb },
  },
});
