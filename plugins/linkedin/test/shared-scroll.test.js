import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSectionScrollScript, scrollToSections } from '../shared.js';

/**
 * Runs the generated script against a JSDOM document. JSDOM reports every
 * layout metric as 0, so the fixture defines scrollHeight/clientHeight
 * explicitly and a settable scrollTop, which is exactly the state the script
 * reads to decide which element scrolls.
 */
function runScript(html, { headings, scrollHeight = 4000, clientHeight = 800, overflowY = 'auto' } = {}) {
  const dom = new JSDOM(html, { url: 'https://www.linkedin.com/in/alice/', runScripts: 'outside-only' });
  const { window } = dom;
  const workspace = window.document.querySelector('#workspace');
  if (workspace) {
    Object.defineProperty(workspace, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(workspace, 'clientHeight', { value: clientHeight, configurable: true });
    let top = 0;
    Object.defineProperty(workspace, 'scrollTop', {
      get: () => top,
      set: (value) => { top = value; },
      configurable: true,
    });
    workspace.style.overflowY = overflowY;
  }
  Object.defineProperty(window.document.documentElement, 'scrollHeight', { value: scrollHeight, configurable: true });
  window.innerHeight = clientHeight;
  const scrolled = [];
  window.scrollTo = (x, y) => { scrolled.push(y); window.scrollY = y; };
  const result = window.eval(buildSectionScrollScript(headings ?? ['experience', 'education']));
  return { result, window, workspace, scrolled };
}

describe('linkedin section scrolling', () => {
  it('scrolls main#workspace when the window scroller cannot move', () => {
    const { result, workspace, scrolled } = runScript(`
      <main id="workspace" style="overflow-y: auto">
        <section><h2>About</h2></section>
      </main>
    `);

    expect(result.container).toBe('#workspace');
    expect(workspace.scrollTop).toBe(800);
    expect(result.atEnd).toBe(false);
    expect(result.found).toEqual([]);
    expect(scrolled).toEqual([]);
  });

  it('reports the requested headings once they are in the DOM', () => {
    const { result } = runScript(`
      <main id="workspace" style="overflow-y: auto">
        <section><h2>Experience</h2></section>
        <section><h2>Education</h2></section>
      </main>
    `);

    expect(result.found).toEqual(['experience', 'education']);
  });

  it('falls back to the window scroller on layouts without an inner container', () => {
    const { result, scrolled } = runScript(`
      <main>
        <section><h2>Experience</h2></section>
      </main>
    `);

    expect(result.container).toBe('window');
    expect(scrolled).toEqual([800]);
    expect(result.found).toEqual(['experience']);
  });

  it('reports the end of the container so callers stop scrolling', () => {
    const { result } = runScript(`
      <main id="workspace" style="overflow-y: auto"><section><h2>About</h2></section></main>
    `, { scrollHeight: 1000, clientHeight: 900 });

    expect(result.container).toBe('#workspace');
    expect(result.atEnd).toBe(true);
  });
});

describe('scrollToSections', () => {
  const page = (payloads) => ({
    evaluate: vi.fn().mockImplementation(async () => payloads.shift() ?? { found: [], atEnd: true }),
    wait: vi.fn().mockResolvedValue(undefined),
  });

  it('keeps scrolling until every requested section has loaded', async () => {
    const target = page([
      { found: [], atEnd: false, container: '#workspace' },
      { found: ['experience'], atEnd: false, container: '#workspace' },
      { found: ['experience', 'education'], atEnd: false, container: '#workspace' },
    ]);

    await expect(scrollToSections(target, ['experience', 'education']))
      .resolves.toMatchObject({ found: ['experience', 'education'] });
    expect(target.evaluate).toHaveBeenCalledTimes(3);
  });

  it('stops once the container is stably at its end and no section appeared', async () => {
    const target = page([
      { found: [], atEnd: false, container: '#workspace' },
      { found: [], atEnd: true, container: '#workspace' },
      { found: [], atEnd: true, container: '#workspace' },
    ]);

    await expect(scrollToSections(target, ['experience'])).resolves.toMatchObject({ atEnd: true });
    expect(target.evaluate).toHaveBeenCalledTimes(3);
  });

  it('keeps scrolling past an atEnd round that lazy-loaded a new section', async () => {
    const target = page([
      { found: [], atEnd: true, container: '#workspace' },
      { found: ['experience'], atEnd: true, container: '#workspace' },
      { found: ['experience', 'education'], atEnd: true, container: '#workspace' },
    ]);

    await expect(scrollToSections(target, ['experience', 'education']))
      .resolves.toMatchObject({ found: ['experience', 'education'] });
    expect(target.evaluate).toHaveBeenCalledTimes(3);
  });

  it('gives up after the round budget instead of scrolling forever', async () => {
    const target = page([]);
    target.evaluate.mockResolvedValue({ found: [], atEnd: false, container: '#workspace' });

    await scrollToSections(target, ['experience'], { rounds: 3 });

    expect(target.evaluate).toHaveBeenCalledTimes(3);
  });

  it('never fails the command when the page cannot be evaluated', async () => {
    const target = { evaluate: vi.fn().mockRejectedValue(new Error('page closed')), wait: vi.fn() };

    await expect(scrollToSections(target, ['experience'])).resolves.toMatchObject({ found: [] });
  });
});
