import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'scripts/seed.ts', 'scripts/promote-admin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (it ships TypeScript source); keep real deps external.
  noExternal: ['@cambo/shared'],
});
