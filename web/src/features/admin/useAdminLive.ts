import { useQueryClient } from '@tanstack/react-query';
import { formatUsd } from '@cambo/shared';
import { useEffect, useState } from 'react';
import { apiUrl } from '../../shared/lib/api';
import { useUi } from '../../shared/lib/ui-store';

type Created = { orderId: string; number: string; totalCents: number; customer: string };
type Changed = { orderId: string; number: string; status: string };

/** A short two-note chime so a new order is noticed from another tab. Browsers may block it until the page has been clicked once. */
function chime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.22);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // no sound: the toast and the badge still show
  }
}

/**
 * Keeps the admin screens live: listens to the server's event stream and refreshes
 * whatever is on screen when an order is placed or changes. Returns whether the
 * stream is connected. If it drops, the browser reconnects by itself and everything
 * is refreshed once to catch up; the slow polling elsewhere is the safety net.
 */
export function useAdminLive(): boolean {
  const qc = useQueryClient();
  const showToast = useUi((s) => s.showToast);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(apiUrl('/admin/events'), { withCredentials: true });
    let wasDown = false;
    const refresh = (orderId?: string) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      if (orderId) void qc.invalidateQueries({ queryKey: ['admin', 'order', orderId] });
    };
    const parse = <T>(e: Event) => JSON.parse((e as MessageEvent<string>).data) as T;

    source.onopen = () => {
      setLive(true);
      if (wasDown) void qc.invalidateQueries({ queryKey: ['admin'] }); // catch up on what we missed
      wasDown = false;
    };
    source.onerror = () => {
      setLive(false);
      wasDown = true;
    };
    source.addEventListener('order.created', (e) => {
      const o = parse<Created>(e);
      refresh(o.orderId);
      showToast(`New order ${o.number} · ${formatUsd(o.totalCents)} · ${o.customer}`);
      chime();
    });
    source.addEventListener('order.updated', (e) => refresh(parse<Changed>(e).orderId));
    source.addEventListener('payment.updated', (e) => {
      const p = parse<Changed>(e);
      refresh(p.orderId);
      if (p.status === 'PAID') showToast(`Payment received for ${p.number}`);
    });
    return () => source.close();
  }, [qc, showToast]);

  return live;
}
