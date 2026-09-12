/**
 * Webcmd Browser Actions Subsystem
 * Clean internal abstraction for executing browser operations on elements.
 * Resolves @eN refs, CSS selectors, text, and semantic locators.
 * Uses native CDP input dispatch for real keyboard/mouse events.
 */

class ActionExecutor {
  constructor(cdpClient, snapshotEngine) {
    this.cdp = cdpClient;
    this.snapshot = snapshotEngine;
  }

  _buildLocatorScript(target) {
    if (!target) throw new Error('Target is required for element action');
    target = target.trim();

    // If it's a ref like @e1
    if (target.startsWith('@e')) {
      return `document.querySelector('[data-webcmd-ref="${target}"]')`;
    }

    // If it's a text locator: text="Submit" or text=Submit
    if (target.startsWith('text=')) {
      const query = target.slice(5).replace(/^["']|["']$/g, '').toLowerCase();
      return `(() => {
        const els = Array.from(document.querySelectorAll('*'));
        return els.find(e => (e.innerText || e.textContent || '').trim().toLowerCase() === '${query}' || (e.innerText || '').toLowerCase().includes('${query}'));
      })()`;
    }

    // If it's an XPath
    if (target.startsWith('//') || target.startsWith('xpath=')) {
      const xpath = target.startsWith('xpath=') ? target.slice(6) : target;
      return `document.evaluate('${xpath}', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
    }

    // Default to CSS selector
    return `document.querySelector('${target.replace(/'/g, "\\'")}')`;
  }

  async navigate(url) {
    await this.cdp.navigate(url);
    await this.snapshot.capture();
    return { success: true, url };
  }

  async click(target) {
    const loc = this._buildLocatorScript(target);
    const script = `(() => {
      const el = ${loc};
      if (!el) return { error: 'Element not found: ' + '${target}' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return { success: true, tag: el.tagName.toLowerCase(), id: el.id, class: el.className };
    })()`;

    const res = await this.cdp.evaluate(script);
    if (res && res.error) {
      throw new Error(res.error);
    }
    // Allow mutation or DOM transition
    await new Promise(r => setTimeout(r, 200));
    return res || { success: true };
  }

  async fill(target, value) {
    const loc = this._buildLocatorScript(target);
    const safeVal = JSON.stringify(value);
    const script = `(() => {
      const el = ${loc};
      if (!el) return { error: 'Element not found: ' + '${target}' };
      el.scrollIntoView({ block: 'center' });
      el.focus();
      el.value = ${safeVal};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, actualValue: el.value };
    })()`;

    const res = await this.cdp.evaluate(script);
    if (res && res.error) {
      throw new Error(res.error);
    }
    return res || { success: true };
  }

  async press(key) {
    if (key === 'Enter') {
      try {
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          windowsVirtualKeyCode: 13,
          unmodifiedText: '\r',
          text: '\r',
          key: 'Enter',
          code: 'Enter'
        });
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          windowsVirtualKeyCode: 13,
          key: 'Enter',
          code: 'Enter'
        });
      } catch (_) {}

      // Form submission fallback
      await this.cdp.evaluate(`(() => {
        const active = document.activeElement;
        if (active) {
          if (active.form) {
            if (typeof active.form.requestSubmit === 'function') {
              active.form.requestSubmit();
            } else {
              active.form.submit();
            }
          } else {
            const form = active.closest('form') || document.querySelector('form');
            if (form) {
              if (typeof form.requestSubmit === 'function') form.requestSubmit();
              else form.submit();
            }
          }
        }
      })()`).catch(() => {});

      await new Promise(r => setTimeout(r, 500));
      return { success: true };
    }

    // Generic key press via CDP
    try {
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: key.length === 1 ? key : '',
        key: key
      });
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: key
      });
    } catch (_) {
      const script = `(() => {
        const active = document.activeElement || document.body;
        const event = new KeyboardEvent('keydown', { key: '${key}', code: '${key}', bubbles: true });
        active.dispatchEvent(event);
      })()`;
      await this.cdp.evaluate(script);
    }
    return { success: true };
  }

  async select(target, value) {
    const loc = this._buildLocatorScript(target);
    const safeVal = JSON.stringify(value);
    const script = `(() => {
      const el = ${loc};
      if (!el) return { error: 'Element not found: ' + '${target}' };
      el.value = ${safeVal};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, value: el.value };
    })()`;

    const res = await this.cdp.evaluate(script);
    if (res && res.error) throw new Error(res.error);
    return res || { success: true };
  }

  async scroll(direction = 'down', amount = 300) {
    const sign = direction === 'up' ? -1 : 1;
    const script = `window.scrollBy({ top: ${sign * amount}, behavior: 'smooth' })`;
    await this.cdp.evaluate(script);
    await new Promise(r => setTimeout(r, 100));
    return { success: true };
  }

  async wait(condition, timeoutMs = 10000) {
    const startTime = Date.now();
    const interval = 100;

    while (Date.now() - startTime < timeoutMs) {
      if (typeof condition === 'number') {
        await new Promise(r => setTimeout(r, condition));
        return { success: true };
      }

      if (condition.type === 'url') {
        const currUrl = await this.cdp.evaluate('window.location.href');
        if (currUrl.includes(condition.expected)) return { success: true, url: currUrl };
      } else if (condition.type === 'selector_visible' || condition.type === 'selector') {
        const loc = this._buildLocatorScript(condition.target || condition.expected);
        const isVisible = await this.cdp.evaluate(`(() => {
          const el = ${loc};
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })()`);
        if (isVisible) return { success: true };
      } else if (condition.type === 'text_contains') {
        const script = condition.target 
          ? `(${this._buildLocatorScript(condition.target)}?.innerText || '').includes('${condition.expected}')`
          : `document.body.innerText.includes('${condition.expected}')`;
        const matched = await this.cdp.evaluate(script);
        if (matched) return { success: true };
      }

      await new Promise(r => setTimeout(r, interval));
    }

    throw new Error(`Wait condition timed out after ${timeoutMs}ms: ${JSON.stringify(condition)}`);
  }

  async extract(target, prop = 'text') {
    const loc = this._buildLocatorScript(target);
    const script = `(() => {
      const el = ${loc};
      if (!el) return null;
      if ('${prop}' === 'text') return (el.innerText || el.textContent || '').trim();
      if ('${prop}' === 'value') return el.value;
      if ('${prop}' === 'html') return el.innerHTML;
      return el.getAttribute('${prop}');
    })()`;
    return await this.cdp.evaluate(script);
  }
}

module.exports = { ActionExecutor };
