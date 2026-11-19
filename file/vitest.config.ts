import os from 'node:os';
import { defineConfig } from 'vitest/config';

const testDb =
  process.env.FILE_DATABASE_URL_TEST ??
  `postgresql://${os.userInfo().username}@localhost:5432/cambo_file_test`;
process.env.FILE_DATABASE_URL_TEST = testDb;

export default defineConfig({
  test: {
    testTimeout: 20000,
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false,
    env: { FILE_DATABASE_URL_TEST: testDb },
  },
});
