import { defineConfig } from 'tsup';

export default defineConfig({
  // Named so the output is dist/server.js, dist/seed.js, dist/promote-admin.js (what the Docker image runs).
  entry: { server: 'src/server.ts', seed: 'scripts/seed.ts', 'promote-admin': 'scripts/promote-admin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (it ships TypeScript source); keep real deps external.
  noExternal: ['@cambo/shared'],
});
