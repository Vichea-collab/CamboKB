import { createMetrics } from '@cambo/service-kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger';
import { Outbox, retryDelaySeconds } from '../src/outbox';
import { TelegramError } from '../src/telegram';
import { FakeTelegramClient, pool, resetDb } from './helpers';

const logger = createLogger('silent');
const newOutbox = (telegram = new FakeTelegramClient()) => ({
  telegram,
  outbox: new Outbox(pool, telegram, logger, createMetrics('notification')),
});
const rows = async () => (await pool.query('SELECT * FROM messages ORDER BY created_at, id')).rows;
/** Pretend the wait is over so the next drain tries again. */
const makeDue = () =>
  pool.query(
    "UPDATE messages SET next_attempt_at = now() - interval '1 second', locked_until = NULL WHERE status = 'PENDING'",
  );

describe('telegram outbox', () => {
  beforeEach(resetDb);

  it('sends a queued message right away and marks it sent', async () => {
    const { outbox, telegram } = newOutbox();
    await outbox.enqueue({ chatId: 42, text: 'hello' });
    await Outbox.idle();
    expect(telegram.sent).toEqual([
      { chatId: 42, text: 'hello', opts: { parseMode: undefined, replyMarkup: undefined } },
    ]);
    expect((await rows())[0]).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  it('keeps a message when Telegram is down and delivers it after a restart', async () => {
    const down = newOutbox();
    down.telegram.failSends = true;
    await down.outbox.enqueue({ chatId: 42, text: 'order CS-1' });
    await Outbox.idle();
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'telegram down' });
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    const after = newOutbox(); // a "restarted" service: new client, same database
    expect(await after.outbox.drain()).toBe(0); // not due yet
    await makeDue();
    expect(await after.outbox.drain()).toBe(1);
    expect(after.telegram.sent.map((m) => m.text)).toEqual(['order CS-1']);
  });

  it('waits as long as Telegram says when rate limited, without using up an attempt', async () => {
    const { outbox, telegram } = newOutbox();
    telegram.failWith = new TelegramError('Too Many Requests', 429, 30);
    await outbox.enqueue({ chatId: 1, text: 'a' });
    await Outbox.idle();
    await outbox.save({ chatId: 2, text: 'b' });
    await makeDue();
    await outbox.drain();
    const [a, b] = await rows();
    expect(a.attempts).toBe(0);
    expect(new Date(a.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 25_000);
    expect(b.attempts).toBe(0); // the batch stopped at the first 429
    telegram.failWith = null;
    await makeDue();
    expect(await outbox.drain()).toBe(2);
  });

  it("doesn't retry when the user blocked the bot", async () => {
    const { outbox, telegram } = newOutbox();
    telegram.failWith = new TelegramError('Forbidden: bot was blocked by the user', 403);
    await outbox.enqueue({ chatId: 7, text: 'x' });
    await Outbox.idle();
    expect((await rows())[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    telegram.failWith = null;
    await makeDue();
    expect(await outbox.drain()).toBe(0);
  });

  it('gives up after repeated failures', async () => {
    const { outbox, telegram } = newOutbox();
    telegram.failSends = true;
    await outbox.enqueue({ chatId: 7, text: 'x' });
    await Outbox.idle();
    for (let i = 0; i < 10; i++) {
      await makeDue();
      await outbox.drain();
    }
    expect((await rows())[0]).toMatchObject({ status: 'FAILED', attempts: 8 });
    expect(await outbox.health()).toMatchObject({
      pending: 0,
      failed: 1,
      lastError: 'telegram down',
    });
  });

  it('never queues the same notification twice', async () => {
    const { outbox, telegram } = newOutbox();
    await outbox.enqueue({ chatId: 1, text: 'confirmed', dedupeKey: 'order:1:customer:CONFIRMED' });
    await outbox.enqueue({ chatId: 1, text: 'confirmed', dedupeKey: 'order:1:customer:CONFIRMED' });
    await Outbox.idle();
    expect(telegram.sent).toHaveLength(1);
  });

  it('two workers never send the same message twice', async () => {
    const a = newOutbox();
    const b = newOutbox();
    for (let i = 0; i < 10; i++) await a.outbox.save({ chatId: 1, text: `m${i}` });
    await Promise.all([a.outbox.drain(), b.outbox.drain()]);
    const all = [...a.telegram.sent, ...b.telegram.sent].map((m) => m.text).sort();
    expect(all).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`).sort());
  });

  it('retries a message left locked by a crashed worker', async () => {
    const { outbox } = newOutbox();
    await pool.query(
      "INSERT INTO messages (chat_id, text, attempts, locked_until) VALUES (1, 'stuck', 1, now() - interval '1 second')",
    );
    expect(await outbox.drain()).toBe(1);
  });

  it('truncates a message over the Telegram limit', async () => {
    const { outbox, telegram } = newOutbox();
    await outbox.enqueue({ chatId: 1, text: 'x'.repeat(5000) });
    await Outbox.idle();
    expect(telegram.sent[0]!.text.length).toBeLessThanOrEqual(4000);
  });

  it('keeps who and why: the request and event that caused it', async () => {
    const { outbox } = newOutbox();
    await outbox.enqueue({
      chatId: 1,
      text: 'x',
      requestId: 'req-9',
      sourceEventId: '0d3b9a52-1c61-4c4e-9d7e-6a1f4b2c8e90',
    });
    await Outbox.idle();
    expect((await rows())[0]).toMatchObject({
      request_id: 'req-9',
      source_event_id: '0d3b9a52-1c61-4c4e-9d7e-6a1f4b2c8e90',
    });
  });

  it('backs off 5s, 15s, 45s... up to 15 minutes', () => {
    expect([1, 2, 3, 4, 9].map(retryDelaySeconds)).toEqual([5, 15, 45, 135, 900]);
  });

  it('cleans up old rows but keeps recent and pending ones', async () => {
    const { outbox } = newOutbox();
    await pool.query(`INSERT INTO messages (chat_id, text, status, created_at) VALUES
      (1, 'old sent', 'SENT', now() - interval '20 days'), (1, 'new sent', 'SENT', now()), (1, 'old pending', 'PENDING', now() - interval '20 days')`);
    await pool.query(
      "INSERT INTO received_events (event_id, type, received_at) VALUES ('0d3b9a52-1c61-4c4e-9d7e-6a1f4b2c8e91', 'x', now() - interval '20 days')",
    );
    expect(await outbox.purge()).toBe(2);
    expect((await rows()).map((r) => r.text).sort()).toEqual(['new sent', 'old pending']);
  });

  describe('forum topics in the owner group', () => {
    const GROUP = -1004305607479;
    const sent = (t: FakeTelegramClient) => t.sent.map((m) => ({ text: m.text, thread: m.opts?.threadId }));

    it('creates the topic the first time it is needed, then reuses it', async () => {
      const { outbox, telegram } = newOutbox();
      await outbox.enqueue({ chatId: GROUP, text: 'order 1', topic: 'orders' });
      await Outbox.idle();
      await outbox.enqueue({ chatId: GROUP, text: 'order 2', topic: 'orders' });
      await Outbox.idle();
      expect(telegram.topicsCreated).toEqual([{ chatId: String(GROUP), name: '🛒 New orders', threadId: 100 }]);
      expect(sent(telegram)).toEqual([
        { text: 'order 1', thread: 100 },
        { text: 'order 2', thread: 100 },
      ]);
    });

    it('keeps each kind of alert in its own topic and remembers them after a restart', async () => {
      const first = newOutbox();
      await first.outbox.enqueue({ chatId: GROUP, text: 'new order', topic: 'orders' });
      await first.outbox.enqueue({ chatId: GROUP, text: 'paid', topic: 'payments' });
      await Outbox.idle();
      expect(first.telegram.topicsCreated.map((t) => t.name)).toEqual(['🛒 New orders', '💳 Payments']);

      const restarted = newOutbox();
      await restarted.outbox.enqueue({ chatId: GROUP, text: 'another order', topic: 'orders' });
      await Outbox.idle();
      expect(restarted.telegram.topicsCreated).toHaveLength(0); // found in the database, not created again
      expect(sent(restarted.telegram)).toEqual([{ text: 'another order', thread: 100 }]);
    });

    it('sends messages with no topic (customers, the General test) without a thread', async () => {
      const { outbox, telegram } = newOutbox();
      await outbox.enqueue({ chatId: 42, text: 'to a customer' });
      await Outbox.idle();
      expect(sent(telegram)).toEqual([{ text: 'to a customer', thread: undefined }]);
      expect(telegram.topicsCreated).toHaveLength(0);
    });

    it('still delivers in a chat that has no Topics, and does not hammer Telegram trying to create them', async () => {
      const { outbox, telegram } = newOutbox();
      telegram.notForum = true;
      await outbox.enqueue({ chatId: 7, text: 'one', topic: 'orders' });
      await outbox.enqueue({ chatId: 7, text: 'two', topic: 'orders' });
      await Outbox.idle();
      expect(sent(telegram)).toEqual([
        { text: 'one', thread: undefined },
        { text: 'two', thread: undefined },
      ]);
      expect((await rows()).map((r) => r.status)).toEqual(['SENT', 'SENT']);
    });

    it('recreates a topic someone deleted, and still delivers the message', async () => {
      const { outbox, telegram } = newOutbox();
      await outbox.enqueue({ chatId: GROUP, text: 'order 1', topic: 'orders' });
      await Outbox.idle();
      telegram.deletedThreads.add(100); // an admin deleted the topic in Telegram
      await outbox.enqueue({ chatId: GROUP, text: 'order 2', topic: 'orders' });
      await Outbox.idle();
      expect(telegram.topicsCreated.map((t) => t.threadId)).toEqual([100, 101]);
      expect(sent(telegram).at(-1)).toEqual({ text: 'order 2', thread: 101 });
      expect((await rows()).map((r) => r.status)).toEqual(['SENT', 'SENT']);
    });
  });
});
