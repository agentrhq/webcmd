import { describe, expect, it } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './popular.js';

describe('reddit popular adapter', () => {
  const command = getRegistry().get('reddit/popular');
  const evaluate = command?.pipeline?.find((step) => step.evaluate)?.evaluate;
  const map = command?.pipeline?.find((step) => step.map)?.map;

  it('exposes the full post-list shape including the 4 media columns', () => {
    expect(command?.columns).toEqual([
      'rank', 'id', 'title', 'subreddit', 'score', 'comments', 'author', 'url',
      'created_utc', 'selftext',
      'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls',
    ]);
  });

  it('surfaces media via extractRedditMedia in evaluate + map', () => {
    expect(evaluate).toContain('function extractRedditMedia');
    expect(evaluate).toContain('...extractRedditMedia(c.data)');
    expect(map).toMatchObject({
      post_hint: '${{ item.post_hint }}',
      url_overridden_by_dest: '${{ item.url_overridden_by_dest }}',
      preview_image_url: '${{ item.preview_image_url }}',
      gallery_urls: '${{ item.gallery_urls }}',
    });
  });

  it('navigates to Reddit and guards HTML responses before JSON parsing', () => {
    expect(command?.pipeline?.[0]).toEqual({ navigate: 'https://www.reddit.com' });
    expect(evaluate).toContain('await res.text()');
    expect(evaluate).toContain('Reddit popular expected JSON');
    expect(evaluate).not.toContain('await res.json()');
  });
});
