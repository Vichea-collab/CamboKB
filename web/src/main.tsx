import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { LanguageBoundary } from './app/LanguageToggle';
import { queryClient } from './app/queryClient';
import { router } from './app/router';
import './styles.css';
import { blockPageZoom } from './shared/lib/noPageZoom';
import { configureTelegramApp, loadTelegramScript, telegramApp } from './shared/lib/telegram';

blockPageZoom();

// Inside the Telegram app, make the web view full height and match our colours.
// (Ordinary visitors never load Telegram's script, so the first paint doesn't wait for telegram.org.)
await loadTelegramScript();
configureTelegramApp(telegramApp(), getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#12151a');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageBoundary>
        <RouterProvider router={router} />
      </LanguageBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
