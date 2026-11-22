import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockPageZoom } from './noPageZoom';

describe('the page never zooms', () => {
  let undo = () => {};
  afterEach(() => undo());

  it("cancels an iPhone's pinch gestures (iOS ignores the viewport tag)", () => {
    undo = blockPageZoom();
    for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
      const e = new Event(name, { cancelable: true, bubbles: true });
      document.body.dispatchEvent(e);
      expect(e.defaultPrevented, name).toBe(true);
    }
  });

  it('stops cancelling once undone', () => {
    blockPageZoom()();
    const e = new Event('gesturestart', { cancelable: true, bubbles: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('is also switched off in the viewport tag and in CSS, for Android', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<meta name="viewport"[^>]*maximum-scale=1\.0[^>]*user-scalable=no/);
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css).toMatch(/html\s*{[^}]*touch-action:\s*pan-x pan-y/);
  });
});
