import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Same-origin in development and preview: the session cookie and Origin check just work.
const proxy = {
  '/api': { target: 'http://localhost:4000' },
  '/files': { target: 'http://localhost:4100' },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { sourcemap: true, chunkSizeWarningLimit: 600 },
});
