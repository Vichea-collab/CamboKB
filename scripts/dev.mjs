// Runs every service's dev script in parallel with prefixed output. Ctrl+C stops all.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const services = ['file', 'report', 'api', 'web'].filter((s) => existsSync(`${s}/package.json`));
const colors = { file: 35, report: 36, api: 33, web: 32 };
const children = services.map((s) => {
  const child = spawn('npm', ['run', 'dev', '--workspace', s], { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `\x1b[${colors[s]}m[${s}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) => out.write(d.toString().replace(/^(?=.)/gm, prefix)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
});
const stop = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
