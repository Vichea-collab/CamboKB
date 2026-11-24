import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterEach, describe, expect, it } from 'vitest';
import { createPdfPrinter, type PdfPrinter } from '../src/pdf';

const text = async (pdf: Buffer) => (await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true })).text;
const page = (body: string) => `<!doctype html><meta charset="utf-8"><body>${body}</body>`;
const A4 = { format: 'A4' as const, printBackground: true };
const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
};

let printer: PdfPrinter;
afterEach(() => printer?.close());

describe('PDF printer', () => {
  it('opens no browser until the first PDF, and closes it when nothing has been printed for a while', async () => {
    printer = createPdfPrinter({ idleMs: 150 });
    expect(printer.browserPid()).toBeNull();
    expect((await printer.print(page('hello'), A4)).subarray(0, 4).toString()).toBe('%PDF');
    expect(printer.browserPid()).toEqual(expect.any(Number));
    await until(() => printer.browserPid() === null);
    expect(printer.browserPid()).toBeNull();
    expect(await text(await printer.print(page('again'), A4))).toContain('again'); // and opens again when needed
  });

  it('keeps one browser for PDFs that come close together', async () => {
    printer = createPdfPrinter({ idleMs: 5000 });
    await printer.print(page('one'), A4);
    const pid = printer.browserPid();
    await printer.print(page('two'), A4);
    expect(printer.browserPid()).toBe(pid);
  });

  it('prints in turn, never more at once than allowed, and each caller gets their own document', async () => {
    printer = createPdfPrinter({ concurrency: 1, idleMs: 5000 });
    const texts = await Promise.all(['alpha', 'beta', 'gamma', 'delta'].map(async (w) => text(await printer.print(page(w), A4))));
    expect(texts.map((t) => t.trim())).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(printer.mostAtOnce()).toBe(1);
  });

  it('starts a new browser after the old one is killed (a small server may run out of memory)', async () => {
    printer = createPdfPrinter({ idleMs: 5000 });
    await printer.print(page('before'), A4);
    const pid = printer.browserPid()!;
    process.kill(pid, 'SIGKILL');
    await until(() => printer.browserPid() === null);
    expect(await text(await printer.print(page('after'), A4))).toContain('after');
    expect(printer.browserPid()).not.toBe(pid);
  });

  it('runs no script and loads nothing from the network: documents hold text customers wrote', async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end('x');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    printer = createPdfPrinter({ idleMs: 5000 });
    const out = await text(
      await printer.print(
        page(`<p id="p">original</p><img src="${url}/a.png"><link rel="stylesheet" href="${url}/b.css"><script>document.getElementById('p').textContent='changed'</script>`),
        A4,
      ),
    );
    server.close();
    expect(out).toContain('original');
    expect(out).not.toContain('changed');
    expect(hits).toBe(0);
  });

  it('refuses new work once closed', async () => {
    printer = createPdfPrinter({ idleMs: 5000 });
    await printer.close();
    await expect(printer.print(page('late'), A4)).rejects.toThrow(/closed/);
  });
});
