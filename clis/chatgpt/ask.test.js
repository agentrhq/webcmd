import { describe, expect, it } from 'vitest';
import { askCommand } from './ask.js';

describe('chatgpt ask polling', () => {
  it('uses pure sleep while waiting for an active generation to finish', () => {
    const source = askCommand.func.toString();

    expect(source).toContain('await page.sleep(3)');
    expect(source).not.toContain('await page.wait(3)');
  });
});
