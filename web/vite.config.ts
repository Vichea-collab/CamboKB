import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Same-origin in development and preview: the session cookie and Origin check just work.
const proxy = {
  '/api': { target: 'http://localhost:4000' },
  '/files': { target: 'http://localhost:4100' },
  '/robots.txt': { target: 'http://localhost:4000' },
  '/sitemap.xml': { target: 'http://localhost:4000' },
  '/seo': { target: 'http://localhost:4000' },
};

/**
 * Link previews need absolute URLs, but the public address is only known at deploy time.
 * Set VITE_SITE_URL (e.g. https://shop.example.com) when building.
 */
function siteUrl(url: string): Plugin {
  const base = url.replace(/\/$/, '');
  return { name: 'site-url', transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', base) };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), siteUrl(process.env.VITE_SITE_URL ?? env.VITE_SITE_URL ?? '')],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    build: { sourcemap: true, chunkSizeWarningLimit: 600 },
  };
});
