import { describe, expect, it } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { createPageMock } from '../test-utils.js';
import './article.js';

describe('twitter article evaluated arguments', () => {
  it('serializes tweet-id before embedding it in page.evaluate', async () => {
    const command = getRegistry().get('twitter/article');
    const tweetId = '123"; window.__webcmdInjected = true; //';
    const rows = [{
      title: '(Note Tweet)',
      author: 'alice',
      content: 'hello',
      url: 'https://x.com/alice/status/123',
    }];
    const page = createPageMock([null, rows], {
      getCookies: async () => [{ name: 'ct0', value: 'csrf-token' }],
    });

    await expect(command.func(page, { 'tweet-id': tweetId })).resolves.toEqual(rows);

    expect(page.goto).toHaveBeenCalledWith(`https://x.com/i/status/${tweetId}`);
    const graphqlScript = page.evaluate.mock.calls[1][0];
    expect(graphqlScript).toContain(`const tweetId = ${JSON.stringify(tweetId)};`);
    expect(graphqlScript).not.toContain('const tweetId = "123"; window.__webcmdInjected = true; //";');
  });
});
