import puppeteer, { type Browser, type PDFOptions } from 'puppeteer';

export type PdfPrinter = {
  /** A page of HTML in, a PDF out. Jobs wait their turn. */
  print(html: string, options: PDFOptions): Promise<Buffer>;
  close(): Promise<void>;
  /** The browser's process id, or null while none is open. */
  browserPid(): number | null;
  /** The most PDFs that were ever being made at the same time. */
  mostAtOnce(): number;
};

/**
 * Prints HTML with headless Chromium. Chromium is by far the largest thing in this service, so it is opened for the
 * first PDF, shared by the ones that follow, and closed after `idleMs` without work: a shop that prints a few
 * invoices a day does not keep a browser in memory.
 *
 * Documents hold text customers wrote. They are escaped, and as a second wall the page runs no script and has no
 * network.
 */
export function createPdfPrinter(
  opts: { chromePath?: string; concurrency?: number; idleMs?: number; timeoutMs?: number } = {},
): PdfPrinter {
  const concurrency = opts.concurrency ?? 1;
  const idleMs = opts.idleMs ?? 60_000;
  const timeout = opts.timeoutMs ?? 25_000;
  let browser: Promise<Browser> | null = null;
  let pid: number | null = null;
  let idle: NodeJS.Timeout | undefined;
  let closed = false;
  let running = 0;
  let most = 0;
  const waiting: (() => void)[] = [];

  const open = () => {
    if (browser) return browser;
    const opening: Promise<Browser> = puppeteer
      .launch({
        executablePath: opts.chromePath || undefined,
        headless: 'shell',
        timeout,
        protocolTimeout: timeout,
        // Container-friendly flags; Chrome's sandbox needs privileges Docker doesn't grant by default. The last three
        // keep it to the fewest processes.
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--renderer-process-limit=1', '--disable-extensions'],
      })
      .then((b) => {
        pid = b.process()?.pid ?? null;
        b.once('disconnected', () => {
          if (browser === opening) {
            browser = null;
            pid = null;
          }
        });
        return b;
      });
    // A browser that failed to start must not be handed to the next job.
    opening.catch(() => {
      if (browser === opening) browser = null;
    });
    browser = opening;
    return opening;
  };

  const shut = async () => {
    clearTimeout(idle);
    const b = browser;
    browser = null;
    pid = null;
    if (b) await b.then((x) => x.close()).catch(() => {});
  };

  const enter = async () => {
    if (running >= concurrency) await new Promise<void>((go) => waiting.push(go));
    else running++;
    clearTimeout(idle);
    most = Math.max(most, running);
  };
  const leave = () => {
    const next = waiting.shift();
    if (next) return next(); // hands its place over, so `running` does not change
    running--;
    if (running === 0 && !closed) {
      idle = setTimeout(() => void shut(), idleMs);
      idle.unref();
    }
  };

  return {
    async print(html, options) {
      if (closed) throw new Error('PDF printer is closed');
      await enter();
      try {
        if (closed) throw new Error('PDF printer is closed');
        const page = await (await open()).newPage();
        try {
          await page.setJavaScriptEnabled(false);
          await page.setOfflineMode(true);
          await page.setContent(html, { waitUntil: 'load', timeout });
          return Buffer.from(await page.pdf({ ...options, timeout }));
        } finally {
          await page.close().catch(() => {});
        }
      } finally {
        leave();
      }
    },
    async close() {
      closed = true;
      await shut();
    },
    browserPid: () => pid,
    mostAtOnce: () => most,
  };
}
