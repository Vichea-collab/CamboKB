import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/lib/api';
import { useUi } from '../../../shared/lib/ui-store';

type Status = {
  /** False when the api cannot reach the notification service at all. */
  serviceReachable: boolean;
  /** Events the api is still holding for the notification service. */
  waitingForService: { pending: number; failed: number };
  mode: 'webhook' | 'polling' | 'off';
  botConfigured: boolean;
  adminChatSet: boolean;
  alertsOn: boolean;
  outbox: {
    pending: number;
    failed: number;
    oldestPendingAgeSec: number | null;
    lastError: string | null;
  };
};

/** Is the Telegram bot wired up, and is anything stuck? Plus a button to send yourself a test. */
export function TelegramStatus() {
  const qc = useQueryClient();
  const showToast = useUi((s) => s.showToast);
  const status = useQuery({
    queryKey: ['admin', 'telegram-status'],
    queryFn: () => api<Status>('/admin/telegram/status'),
    refetchInterval: 15_000,
  });
  const test = useMutation({
    mutationFn: () => api('/admin/telegram/test', { method: 'POST' }),
    onSuccess: () => {
      showToast('Test message sent. Check Telegram.');
      void qc.invalidateQueries({ queryKey: ['admin', 'telegram-status'] });
    },
  });
  const s = status.data;
  if (!s) return null;

  const problem = !s.serviceReachable
    ? "The notification service isn't answering. Orders still work; messages are kept and sent when it is back."
    : !s.botConfigured
      ? "The Telegram bot isn't connected yet. Ask whoever runs your server to switch it on."
      : !s.adminChatSet
        ? "Alerts don't have a chat to go to yet. Ask whoever runs your server to set your alert chat."
        : null;
  const waiting = s.waitingForService.pending + s.outbox.pending;
  const failed = s.waitingForService.failed + s.outbox.failed;
  const stuck = failed > 0 || (s.outbox.oldestPendingAgeSec ?? 0) > 120;

  return (
    <div className="rounded-xl bg-raised p-3.5 text-sm ring-1 ring-line">
      <p className="flex items-center gap-2 font-semibold">
        <span
          className={`size-2 rounded-full ${problem ? 'bg-danger' : stuck ? 'bg-yellow' : 'bg-green'}`}
          aria-hidden
        />
        {problem ??
          (stuck ? 'Some Telegram messages are not getting through' : 'Telegram is connected')}
      </p>
      {(!problem || !s.serviceReachable) && (
        <p className="mt-1 text-xs text-muted">
          Waiting to send: {waiting} · Failed this week: {failed}
          {s.outbox.lastError && stuck ? ` · Last error: ${s.outbox.lastError}` : ''}
        </p>
      )}
      <button
        type="button"
        className="btn-ghost btn-sm mt-3"
        disabled={Boolean(problem) || test.isPending}
        onClick={() => test.mutate()}
      >
        {test.isPending ? 'Sending…' : 'Send test message'}
      </button>
      {test.error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {(test.error as Error).message}
        </p>
      )}
    </div>
  );
}
