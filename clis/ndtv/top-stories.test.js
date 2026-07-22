import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';

const { ndtvFetchTopStoriesRssMock } = vi.hoisted(() => ({ ndtvFetchTopStoriesRssMock: vi.fn() }));
vi.mock('./utils.js', async () => {
  const actual = await vi.importActual('./utils.js');
  return { ...actual, ndtvFetchTopStoriesRss: ndtvFetchTopStoriesRssMock };
});

import './top-stories.js';

const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item>
    <title><![CDATA[First &amp; Biggest Story]]></title>
    <description><![CDATA[Lead story summary with <b>markup</b>.]]></description>
    <link>https://www.ndtv.com/india-news/first-story-123#publisher=newsstand</link>
    <guid isPermaLink="false">first-story-123</guid>
    <pubDate>Wed, 22 Jul 2026 09:24:37 GMT</pubDate>
  </item>
  <item>
    <title>Second Story</title>
    <description>Second summary</description>
    <link>https://www.ndtv.com/world-news/second-story-456</link>
    <guid>https://www.ndtv.com/world-news/second-story-456</guid>
    <pubDate>Wed, 22 Jul 2026 08:15:00 GMT</pubDate>
  </item>
</channel></rss>`;

describe('ndtv top-stories', () => {
  beforeEach(() => {
    ndtvFetchTopStoriesRssMock.mockReset();
  });

  it('registers as an anonymous read-only public command with default limit 5', async () => {
    const command = getRegistry().get('ndtv/top-stories');
    expect(command).toBeDefined();
    expect(command.access).toBe('read');
    expect(command.browser).toBe(false);
    ndtvFetchTopStoriesRssMock.mockResolvedValueOnce(sampleRss);

    const rows = await command.func({});

    expect(rows).toEqual([
      {
        rank: 1,
        title: 'First & Biggest Story',
        description: 'Lead story summary with markup.',
        pubDate: '2026-07-22T09:24:37.000Z',
        id: 'first-story-123',
        url: 'https://www.ndtv.com/india-news/first-story-123',
      },
      {
        rank: 2,
        title: 'Second Story',
        description: 'Second summary',
        pubDate: '2026-07-22T08:15:00.000Z',
        id: 'second-story-456',
        url: 'https://www.ndtv.com/world-news/second-story-456',
      },
    ]);
  });

  it('rejects invalid limits with typed argument errors', async () => {
    const command = getRegistry().get('ndtv/top-stories');
    await expect(command.func({ limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func({ limit: 51 })).rejects.toBeInstanceOf(ArgumentError);
  });

  it('maps an empty feed to EmptyResultError', async () => {
    const command = getRegistry().get('ndtv/top-stories');
    ndtvFetchTopStoriesRssMock.mockResolvedValueOnce('<rss><channel></channel></rss>');
    await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('maps malformed RSS to a typed execution error', async () => {
    const command = getRegistry().get('ndtv/top-stories');
    ndtvFetchTopStoriesRssMock.mockResolvedValueOnce('<rss><channel><item><title>Missing URL</title></item></channel></rss>');
    await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
  });
});
