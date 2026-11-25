import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';

const doc = () => new DOMParser().parseFromString(html, 'text/html');

describe('the page before the app has started', () => {
  it('shows the shop and grey blocks, hidden from screen readers, with one word for them', () => {
    const root = doc().getElementById('root')!;
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Loading…');
    const blocks = root.querySelectorAll('.boot-bone');
    expect(blocks.length).toBeGreaterThan(5);
    blocks.forEach((b) => expect(b.closest('[aria-hidden="true"]')).not.toBeNull());
    expect(root.textContent).toContain('Cambo Keyboard Supply');
    expect(root.querySelectorAll('a, button, input')).toHaveLength(0);
  });

  it('carries its own look: it needs no stylesheet, and no inline script (the security policy forbids those)', () => {
    const d = doc();
    expect(d.querySelector('head style')?.textContent).toContain('.boot-bone');
    expect(d.querySelectorAll('script:not([src])')).toHaveLength(0);
  });

  it('stops pulsing for people who asked for less motion, and is not shown without JavaScript', () => {
    expect(doc().querySelector('head style')?.textContent).toContain('prefers-reduced-motion');
    expect(html).toMatch(/<noscript>[^]*\.boot\s*\{\s*display:\s*none/);
  });

  it('is gone once the app draws itself', async () => {
    const root = document.importNode(doc().getElementById('root')!, true);
    document.body.append(root);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    await act(async () => createRoot(root).render('app'));
    expect(root.querySelector('.boot')).toBeNull();
    expect(root).toHaveTextContent(/^app$/);
    root.remove();
  });
});
