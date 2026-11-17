import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { queryClient } from './app/queryClient';
import { router } from './app/router';
import './styles.css';

// Inside the Telegram app, make the web view full height and match our colours.
const tg = (window as { Telegram?: { WebApp?: { ready(): void; expand(): void; setHeaderColor?(c: string): void } } }).Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.('#14171c');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
