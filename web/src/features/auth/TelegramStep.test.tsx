import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramStep } from './TelegramStep';
import type { useTelegramVerification } from './useTelegramVerification';

type Tg = ReturnType<typeof useTelegramVerification>;
const waiting = { status: 'waiting', deepLink: 'https://t.me/Cambo_KB_Bot?start=abc', start: vi.fn(), reset: vi.fn() } as unknown as Tg;

describe('TelegramStep while waiting', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays quiet at first, then offers help if nothing has happened for a while', async () => {
    render(<TelegramStep tg={waiting} startLabel="Sign up with Telegram" />);
    expect(screen.queryByText('Nothing happening?')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(25_000));
    expect(screen.getByText('Nothing happening?')).toBeInTheDocument();
    expect(screen.getByText(/press Start/i)).toBeInTheDocument();
    expect(screen.getByText(/blocked the bot/i)).toBeInTheDocument();
  });

  it('keeps the link that reopens Telegram', () => {
    render(<TelegramStep tg={waiting} startLabel="Sign up with Telegram" />);
    expect(screen.getByRole('link', { name: 'Open Telegram' })).toHaveAttribute('href', waiting.deepLink);
  });
});
