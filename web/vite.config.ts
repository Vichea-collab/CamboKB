import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in development: the session cookie and Origin check just work.
    proxy: {
      '/api': { target: 'http://localhost:4000' },
      '/files': { target: 'http://localhost:4100' },
    },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 600 },
});
