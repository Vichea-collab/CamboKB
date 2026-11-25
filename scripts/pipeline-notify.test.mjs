import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { esc, renderEvent, renderRun, send, toTelegram } from './pipeline-notify.mjs';

const repository = { full_name: 'acme/shop', html_url: 'https://github.com/acme/shop' };

describe('push', () => {
  const base = {
    ref: 'refs/heads/feat/cart',
    before: 'a'.repeat(40),
    after: 'b'.repeat(40),
    compare: 'https://github.com/acme/shop/compare/aaa...bbb',
    repository,
    sender: { login: 'vichea' },
    commits: [
      {
        id: '1234567890abcdef',
        message: 'feat: cart\n\nlong body',
        url: 'https://x/c1',
        author: { username: 'vichea' },
      },
      {
        id: 'fedcba0987654321',
        message: 'fix: <b>typo</b>',
        url: 'https://x/c2',
        author: { name: 'Sok' },
      },
    ],
  };

  it('lists the commits and links to the comparison', () => {
    const m = renderEvent('push', base);
    assert.match(m.text, /<b>Push<\/b> to <code>feat\/cart<\/code>/);
    assert.match(m.text, /2 commits/);
    assert.match(m.text, /<a href="https:\/\/x\/c1">1234567<\/a> feat: cart — vichea/);
    assert.equal(m.url, base.compare);
  });

  it('escapes commit text so it cannot inject markup', () => {
    const m = renderEvent('push', base);
    assert.ok(m.text.includes('fix: &lt;b&gt;typo&lt;/b&gt;'));
    assert.ok(!m.text.includes('<b>typo'));
  });

  it('shows at most five commits', () => {
    const commits = Array.from({ length: 8 }, (_, i) => ({
      id: String(i).repeat(8),
      message: `c${i}`,
      url: 'https://x',
    }));
    const m = renderEvent('push', { ...base, commits });
    assert.equal((m.text.match(/^•/gm) ?? []).length, 5);
    assert.match(m.text, /and 3 more/);
  });

  it('announces deleted branches and pushed tags', () => {
    assert.match(renderEvent('push', { ...base, deleted: true }).text, /Branch deleted/);
    const tag = renderEvent('push', { ...base, ref: 'refs/tags/v1.0.0', commits: [] });
    assert.match(tag.text, /Tag pushed<\/b> <code>v1\.0\.0/);
    assert.equal(tag.url, 'https://github.com/acme/shop/releases/tag/v1.0.0');
  });

  it('says so when a branch is created with no new commits', () => {
    const m = renderEvent('push', { ...base, created: true, commits: [], before: '0'.repeat(40) });
    assert.match(m.text, /New branch/);
  });
});

describe('pull request', () => {
  const pr = {
    number: 12,
    title: 'Add telegram pipeline',
    html_url: 'https://github.com/acme/shop/pull/12',
    user: { login: 'vichea' },
    head: { ref: 'feat/pipeline' },
    base: { ref: 'main' },
    additions: 40,
    deletions: 3,
    changed_files: 1,
  };
  const ev = (action, extra = {}) => ({
    action,
    repository,
    sender: { login: 'reviewer' },
    pull_request: { ...pr, ...extra },
  });

  it('opened', () => {
    const m = renderEvent('pull_request', ev('opened'));
    assert.match(m.text, /Pull request opened/);
    assert.match(m.text, /#12 Add telegram pipeline/);
    assert.match(m.text, /<code>feat\/pipeline<\/code> → <code>main<\/code>/);
    assert.match(m.text, /\+40 −3 in 1 file/);
    assert.equal(m.url, pr.html_url);
  });

  it('merged names who merged it', () => {
    const m = renderEvent(
      'pull_request',
      ev('closed', { merged: true, merged_by: { login: 'lead' } }),
    );
    assert.match(m.text, /Merged<\/b> #12/);
    assert.match(m.text, /merged by lead/);
  });

  it('closed without merging is not reported as merged', () => {
    const m = renderEvent('pull_request', ev('closed', { merged: false }));
    assert.match(m.text, /Closed without merging/);
    assert.doesNotMatch(m.text, /Merged/);
  });

  it('ignores actions nobody needs to hear about', () => {
    assert.equal(renderEvent('pull_request', ev('labeled')), null);
    assert.equal(renderEvent('pull_request', ev('synchronize')), null);
  });

  it('ignores other events', () => {
    assert.equal(renderEvent('issues', {}), null);
  });
});

describe('workflow run', () => {
  const env = {
    GITHUB_REPOSITORY: 'acme/shop',
    GITHUB_REF_NAME: 'main',
    GITHUB_SHA: 'abcdef1234567890',
    GITHUB_ACTOR: 'vichea',
    GITHUB_RUN_ID: '777',
    GITHUB_SERVER_URL: 'https://github.com',
  };
  const payload = { head_commit: { message: 'feat: ship it\n\nbody' } };

  it('passed', () => {
    const m = renderRun({
      title: 'CI',
      results: { test: { result: 'success' }, images: { result: 'success' } },
      env,
      payload,
    });
    assert.match(m.text, /✅ <b>CI passed<\/b>/);
    assert.match(m.text, /abcdef1/);
    assert.match(m.text, /feat: ship it/);
    assert.equal(m.url, 'https://github.com/acme/shop/actions/runs/777');
  });

  it('failed lists the failing jobs', () => {
    const m = renderRun({
      title: 'CI',
      results: { test: { result: 'failure' }, images: { result: 'skipped' } },
      env,
      payload,
    });
    assert.match(m.text, /❌ <b>CI failed<\/b>/);
    assert.match(m.text, /Failed: test/);
  });

  it('stays quiet when a run was only cancelled by a newer push', () => {
    assert.equal(
      renderRun({ title: 'CI', results: { test: { result: 'cancelled' } }, env, payload }),
      null,
    );
  });

  it('a real failure wins over a cancelled job', () => {
    const m = renderRun({
      title: 'CI',
      results: { a: { result: 'failure' }, b: { result: 'cancelled' } },
      env,
      payload,
    });
    assert.match(m.text, /CI failed/);
  });

  it('uses the pull request for its branch and title', () => {
    const p = {
      pull_request: { number: 9, title: 'Fix <it>', head: { ref: 'fix/it', sha: '1111111222222' } },
    };
    const m = renderRun({
      title: 'CI',
      results: { test: { result: 'success' } },
      env: { ...env, GITHUB_REF_NAME: '9/merge' },
      payload: p,
    });
    assert.match(m.text, /<code>fix\/it<\/code> · 1111111/);
    assert.match(m.text, /Fix &lt;it&gt;/);
    assert.match(m.text, /pull request #9/);
  });

  it('adds a note (used by Deploy)', () => {
    const m = renderRun({
      title: 'Deploy',
      results: { deploy: { result: 'success' } },
      env,
      note: 'Image tag latest',
    });
    assert.match(m.text, /Deploy passed/);
    assert.match(m.text, /Image tag latest/);
  });
});

describe('time', () => {
  // 22:20:30 on 25 November 2026 in Phnom Penh.
  const now = new Date('2026-11-25T15:20:30Z');
  const ago = (s) => new Date(now.getTime() - s * 1000);
  const WHEN = '🕒 25 Nov 2026, 22:20 (Phnom Penh)';
  const run = (over = {}) =>
    renderRun({ title: 'CI', results: { test: { result: 'success' } }, env: { GITHUB_REPOSITORY: 'acme/shop' }, now, ...over }).text;
  const last = (text) => text.split('\n').at(-1);

  it('says when a push and a pull request happened', () => {
    const push = renderEvent('push', { ref: 'refs/heads/main', repository, commits: [], sender: { login: 'v' } }, now);
    assert.equal(last(push.text), WHEN);
    const pr = { number: 1, title: 'x', head: { ref: 'a' }, base: { ref: 'main' }, user: { login: 'v' } };
    for (const p of [{ action: 'opened' }, { action: 'closed', merged: true }])
      assert.equal(last(renderEvent('pull_request', { action: p.action, repository, pull_request: { ...pr, merged: p.merged } }, now).text), WHEN);
    assert.equal(last(renderEvent('push', { ref: 'refs/heads/x', deleted: true, repository }, now).text), WHEN);
    assert.equal(last(renderEvent('push', { ref: 'refs/tags/v1', repository, commits: [] }, now).text), WHEN);
  });

  it('says how long CI took, from the push', () => {
    const pushed_at = ago(392).getTime() / 1000; // GitHub gives seconds here
    assert.equal(last(run({ payload: { repository: { pushed_at } } })), `${WHEN} · took 6 min 32 s`);
  });

  it('says how long a deploy took, and how long after the push the shop was live', () => {
    const payload = { workflow_run: { run_started_at: ago(508).toISOString(), updated_at: ago(74).toISOString() } };
    const text = run({ title: 'Deploy', payload });
    assert.ok(text.includes(`${WHEN} · took 1 min 14 s`));
    assert.equal(last(text), '🚀 Live 8 min 28 s after the push');
  });

  it('a failed deploy is not called live', () => {
    const payload = { workflow_run: { run_started_at: ago(508).toISOString(), updated_at: ago(16).toISOString() } };
    const text = run({ title: 'Deploy', payload, results: { deploy: { result: 'failure' } } });
    assert.equal(last(text), `${WHEN} · took 16 s`);
    assert.ok(!text.includes('Live'));
  });

  it('gives only the time when the start is not known, makes no sense, or the run was repeated by hand', () => {
    const pushed_at = ago(60).getTime() / 1000;
    assert.equal(last(run()), WHEN);
    assert.equal(last(run({ payload: { repository: { pushed_at: '2026-11-25T15:00:00Z' } }, env: { GITHUB_RUN_ATTEMPT: '1' } })), `${WHEN} · took 20 min 30 s`);
    assert.equal(last(run({ payload: { repository: { pushed_at: 'soon' } } })), WHEN);
    assert.equal(last(run({ payload: { repository: { pushed_at: now.getTime() / 1000 + 500 } } })), WHEN);
    assert.equal(last(run({ payload: { repository: { pushed_at } }, env: { GITHUB_RUN_ATTEMPT: '2' } })), WHEN);
    assert.equal(last(run({ payload: { repository: { pushed_at: ago(3 * 86400).getTime() / 1000 } } })), WHEN);
  });

  it('a pull request run counts from when the pull request was updated', () => {
    const payload = { pull_request: { number: 7, title: 'x', head: { ref: 'a', sha: 'abc' }, updated_at: ago(200).toISOString() }, repository: { pushed_at: ago(9000).toISOString() } };
    assert.equal(last(run({ payload })), `${WHEN} · took 3 min 20 s`);
  });
});

describe('telegram message', () => {
  it('goes to the topic and carries a link button', () => {
    const body = toTelegram(
      { text: 'hi', url: 'https://x', button: 'Open' },
      { chatId: '-100', threadId: '14' },
    );
    assert.equal(body.chat_id, '-100');
    assert.equal(body.message_thread_id, 14);
    assert.equal(body.parse_mode, 'HTML');
    assert.deepEqual(body.reply_markup.inline_keyboard, [[{ text: 'Open', url: 'https://x' }]]);
  });

  it('without a topic id it goes to the main chat', () => {
    const body = toTelegram({ text: 'hi' }, { chatId: '-100', threadId: '' });
    assert.equal('message_thread_id' in body, false);
    assert.equal('reply_markup' in body, false);
  });

  it('keeps long messages under the limit', () => {
    assert.ok(toTelegram({ text: 'x'.repeat(10000) }, { chatId: '1' }).text.length <= 4096);
  });

  it('esc handles markup characters', () => {
    assert.equal(esc('<a href="x">&</a>'), '&lt;a href="x"&gt;&amp;&lt;/a&gt;');
  });
});

describe('sending', () => {
  const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });
  const noSleep = async () => {};

  it('succeeds on the first try', async () => {
    const r = await send({ chat_id: 1 }, 'T', {
      fetchImpl: async () => reply(200, { ok: true }),
      sleep: noSleep,
    });
    assert.equal(r.ok, true);
  });

  it('waits and retries when Telegram rate limits', async () => {
    const waits = [];
    let n = 0;
    const r = await send({}, 'T', {
      fetchImpl: async () =>
        ++n === 1
          ? reply(429, { ok: false, parameters: { retry_after: 3 } })
          : reply(200, { ok: true }),
      sleep: async (ms) => waits.push(ms),
    });
    assert.equal(r.ok, true);
    assert.deepEqual(waits, [3000]);
  });

  it('does not retry a request Telegram rejects (e.g. topic not found)', async () => {
    let n = 0;
    const r = await send({}, 'T', {
      fetchImpl: async () => (
        n++,
        reply(400, { ok: false, description: 'Bad Request: message thread not found' })
      ),
      sleep: noSleep,
    });
    assert.equal(n, 1);
    assert.equal(r.ok, false);
    assert.match(r.error, /thread not found/);
  });

  it('gives up after three tries on server errors and network failures', async () => {
    let n = 0;
    const r = await send({}, 'T', {
      fetchImpl: async () => {
        n++;
        if (n === 2) throw new Error('socket hang up');
        return reply(502, { ok: false });
      },
      sleep: noSleep,
    });
    assert.equal(n, 3);
    assert.equal(r.ok, false);
  });
});
