#!/usr/bin/env node
/**
 * Pipeline notices for the Telegram group's "Pipeline" topic: pushes, pull requests (opened, merged,
 * closed) and the result of every CI / Deploy run.
 *
 * Runs inside GitHub Actions (see .github/workflows/notify.yml, ci.yml, deploy.yml) and needs nothing
 * installed. It talks to Telegram directly on purpose: a build alert must still arrive when the shop
 * itself is down, so it must not depend on the shop's notification service.
 *
 *   node scripts/pipeline-notify.mjs event   push / pull_request, read from $GITHUB_EVENT_PATH
 *   node scripts/pipeline-notify.mjs run     the result of a workflow run (needs RUN_TITLE, RUN_RESULTS)
 *
 * Settings (repository secrets / variables):
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID           where to send
 *   TELEGRAM_PIPELINE_THREAD_ID                    the topic (message_thread_id); empty = the group's main chat
 *
 * Everything in a GitHub payload (commit messages, PR titles, branch names) is written by other people,
 * so it is escaped before it goes into a Telegram HTML message, and never passed through a shell.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_COMMITS = 5;
const MAX_TEXT = 3900; // Telegram's limit is 4096

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const firstLine = (text, max = 80) => {
  const line = String(text ?? '')
    .split('\n')[0]
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const shortSha = (sha) => String(sha ?? '').slice(0, 7);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const link = (url, label) => (url ? `<a href="${esc(url)}">${esc(label)}</a>` : esc(label));
const ZERO = /^0+$/;

function pushMessage(p) {
  const repo = p.repository?.full_name ?? '';
  const who = p.sender?.login ?? p.pusher?.name ?? 'someone';
  const ref = String(p.ref ?? '');
  const isTag = ref.startsWith('refs/tags/');
  const name = ref.replace(/^refs\/(heads|tags)\//, '');

  if (p.deleted) {
    return {
      text: `🗑 <b>${isTag ? 'Tag' : 'Branch'} deleted</b>\n<code>${esc(name)}</code> in ${esc(repo)}\nby ${esc(who)}`,
    };
  }
  if (isTag) {
    return {
      text: `🏷 <b>Tag pushed</b> <code>${esc(name)}</code>\n${esc(repo)} · by ${esc(who)}`,
      url: p.repository?.html_url
        ? `${p.repository.html_url}/releases/tag/${encodeURIComponent(name)}`
        : undefined,
      button: 'Open tag',
    };
  }

  const commits = Array.isArray(p.commits) ? p.commits : [];
  const head = [
    `⬆️ <b>${p.forced ? 'Force push' : 'Push'}</b> to <code>${esc(name)}</code>`,
    `${esc(repo)} · by ${esc(who)}${commits.length ? ` · ${plural(commits.length, 'commit')}` : ''}`,
  ];
  if (p.created && !commits.length) head.push('New branch');
  const lines = commits.slice(0, MAX_COMMITS).map((c) => {
    const author = c.author?.username ?? c.author?.name;
    return `• ${link(c.url, shortSha(c.id))} ${esc(firstLine(c.message))}${author ? ` — ${esc(author)}` : ''}`;
  });
  if (commits.length > MAX_COMMITS) lines.push(`… and ${commits.length - MAX_COMMITS} more`);
  return {
    text: [...head, ...(lines.length ? ['', ...lines] : [])].join('\n'),
    url:
      p.compare && !ZERO.test(String(p.before ?? ''))
        ? p.compare
        : (p.head_commit?.url ?? undefined),
    button: 'Open changes',
  };
}

function pullRequestMessage(p) {
  const pr = p.pull_request;
  if (!pr) return null;
  const repo = p.repository?.full_name ?? '';
  const title = `#${pr.number} ${esc(firstLine(pr.title, 100))}`;
  const route = `<code>${esc(pr.head?.ref)}</code> → <code>${esc(pr.base?.ref)}</code>`;
  const size =
    pr.changed_files != null
      ? `\n+${pr.additions ?? 0} −${pr.deletions ?? 0} in ${plural(pr.changed_files, 'file')}`
      : '';
  const author = esc(pr.user?.login ?? p.sender?.login ?? 'someone');

  let headline;
  let who = author;
  switch (p.action) {
    case 'opened':
      headline = pr.draft
        ? '🔀 <b>Pull request opened</b> (draft)'
        : '🔀 <b>Pull request opened</b>';
      break;
    case 'reopened':
      headline = '🔁 <b>Pull request reopened</b>';
      break;
    case 'ready_for_review':
      headline = '👀 <b>Ready for review</b>';
      break;
    case 'closed':
      if (pr.merged) {
        headline = '🟣 <b>Merged</b>';
        who = esc(pr.merged_by?.login ?? p.sender?.login ?? author);
        return {
          text: `${headline} ${title}\n${esc(repo)} · ${route}\nmerged by ${who}${size}`,
          url: pr.html_url,
          button: 'Open pull request',
        };
      }
      headline = '🚫 <b>Closed without merging</b>';
      who = esc(p.sender?.login ?? author);
      break;
    default:
      return null;
  }
  return {
    text: `${headline} ${title}\n${esc(repo)} · ${route}\nby ${who}${size}`,
    url: pr.html_url,
    button: 'Open pull request',
  };
}

export function renderEvent(eventName, payload) {
  if (!payload) return null;
  if (eventName === 'push') return pushMessage(payload);
  if (eventName === 'pull_request') return pullRequestMessage(payload);
  return null;
}

const ICON = { success: '✅', failure: '❌' };

/**
 * One notice for a finished workflow. `results` is `toJSON(needs)` from the closing job:
 * { jobId: { result: 'success' | 'failure' | 'cancelled' | 'skipped' } }.
 * A run that was only cancelled (a newer push replaced it) says nothing.
 */
export function renderRun({ title, results, env, payload, note }) {
  const jobs = Object.entries(results ?? {}).map(([id, v]) => ({
    id,
    result: v?.result ?? 'unknown',
  }));
  const failed = jobs.filter((j) => j.result === 'failure');
  const cancelled = jobs.filter((j) => j.result === 'cancelled');
  const overall = failed.length ? 'failure' : cancelled.length ? 'cancelled' : 'success';
  if (overall === 'cancelled') return null;

  const pr = payload?.pull_request;
  const branch = pr ? pr.head?.ref : env.GITHUB_REF_NAME;
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const repo = env.GITHUB_REPOSITORY ?? '';
  const runUrl = env.GITHUB_RUN_ID
    ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`
    : undefined;
  const sha = pr?.head?.sha ?? env.GITHUB_SHA;
  const message = pr ? pr.title : (payload?.head_commit?.message ?? '');

  const lines = [
    `${ICON[overall]} <b>${esc(title)} ${overall === 'success' ? 'passed' : 'failed'}</b>`,
    `${esc(repo)} · <code>${esc(branch)}</code>${sha ? ` · ${esc(shortSha(sha))}` : ''}`,
  ];
  if (message) lines.push(esc(firstLine(message, 100)));
  if (pr) lines.push(`pull request #${pr.number}`);
  if (failed.length) lines.push('', `Failed: ${failed.map((j) => esc(j.id)).join(', ')}`);
  if (note) lines.push('', esc(note));
  if (env.GITHUB_ACTOR) lines.push(`by ${esc(env.GITHUB_ACTOR)}`);
  return { text: lines.join('\n'), url: runUrl, button: 'Open run' };
}

/** Finish the message: size limit, buttons, Telegram fields. */
export function toTelegram(msg, { chatId, threadId }) {
  let text = msg.text;
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT - 1)}…`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    disable_notification: false,
  };
  if (threadId) body.message_thread_id = Number(threadId);
  if (msg.url)
    body.reply_markup = { inline_keyboard: [[{ text: msg.button ?? 'Open', url: msg.url }]] };
  return body;
}

export async function send(
  body,
  token,
  { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {},
) {
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) return { ok: true };
      lastError = `${res.status} ${data.description ?? ''}`.trim();
      // Telegram says how long to wait when it is rate limiting; other 4xx will not get better.
      if (res.status === 429) {
        await sleep(Math.min((data.parameters?.retry_after ?? 2) * 1000, 30_000));
        continue;
      }
      if (res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(attempt * 1000);
  }
  return { ok: false, error: lastError };
}

async function main() {
  const mode = process.argv[2];
  const env = process.env;
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  const threadId = env.TELEGRAM_PIPELINE_THREAD_ID;

  let payload;
  if (env.GITHUB_EVENT_PATH) {
    try {
      payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    } catch {
      payload = undefined;
    }
  }

  let msg = null;
  if (mode === 'event') msg = renderEvent(env.GITHUB_EVENT_NAME, payload);
  else if (mode === 'run') {
    let results = {};
    try {
      results = JSON.parse(env.RUN_RESULTS || '{}');
    } catch {
      // an unreadable result list is reported as "passed" with no jobs; the run page has the truth
    }
    msg = renderRun({
      title: env.RUN_TITLE || 'Workflow',
      results,
      env,
      payload,
      note: env.RUN_NOTE,
    });
  } else {
    console.error('usage: pipeline-notify.mjs event|run');
    process.exit(2);
  }

  if (!msg) {
    console.log('Nothing to announce for this event.');
    return;
  }
  if (!token || !chatId) {
    console.log(
      '::notice::Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID), so nothing was sent.',
    );
    return;
  }
  const result = await send(toTelegram(msg, { chatId, threadId }), token);
  // A missed notice must never turn a green pipeline red.
  if (!result.ok)
    console.log(`::warning::Telegram notice not sent: ${result.error.replaceAll(token, '***')}`);
  else console.log('Telegram notice sent.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
