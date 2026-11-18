import { Router } from 'express';
import { subscribeAdminEvents } from '../lib/events';
import { AppError } from '../http/errors';

const HEARTBEAT_MS = 20_000;
const MAX_STREAMS_PER_ADMIN = 8;
const open = new Map<string, number>();

/**
 * GET /admin/events: a Server-Sent Events stream. The admin screens listen to it so new
 * orders and status changes show up without a refresh. Behind nginx it needs
 * proxy_buffering off (see docker/nginx/default.conf.template).
 */
export function adminEventsRouter(): Router {
  const r = Router();
  r.get('/events', (req, res) => {
    const userId = req.user!.id;
    if ((open.get(userId) ?? 0) >= MAX_STREAMS_PER_ADMIN) throw new AppError(429, 'TOO_MANY_STREAMS', 'Too many open admin tabs');
    open.set(userId, (open.get(userId) ?? 0) + 1);

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    // Tell the browser how long to wait before reconnecting, and open the stream right away.
    res.write('retry: 3000\n\n: connected\n\n');

    const unsubscribe = subscribeAdminEvents((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    // A comment line every so often keeps proxies and phones from closing an idle connection.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      const left = (open.get(userId) ?? 1) - 1;
      if (left <= 0) open.delete(userId);
      else open.set(userId, left);
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
  });
  return r;
}
