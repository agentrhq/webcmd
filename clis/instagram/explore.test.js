import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './explore.js';

async function runExplore(payload, limit = 20) {
  const command = getRegistry().get('instagram/explore');
  const source = command.pipeline.find((step) => step.evaluate).evaluate
    .replace('${{ args.limit }}', String(limit));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  });
  try {
    return await eval(source);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('instagram explore', () => {
  it('collects distinct identified media from nested Explore layouts', async () => {
    const photo = {
      pk: 'photo-1',
      user: { username: 'photographer' },
      caption: { text: 'First\nphoto' },
      like_count: 12,
      comment_count: 3,
      media_type: 1,
    };
    const reel = {
      id: 'reel-2',
      user: { username: 'filmmaker' },
      caption: { text: 'Nested reel' },
      play_count: 99,
      comment_count: 4,
      media_type: 2,
    };
    const payload = {
      sectional_items: [
        { layout_content: { medias: [{ media: photo }] } },
        { layout_content: { one_by_two_item: { clips: { items: [{ media: reel }] } } } },
        { layout_content: { fill_items: [{ media: photo }] } },
        {
          layout_content: {
            fill_items: [{
              media: {
                user: { username: 'missing-identity' },
                like_count: 1,
                media_type: 1,
              },
            }],
          },
        },
      ],
    };

    await expect(runExplore(payload)).resolves.toEqual([
      {
        rank: 1,
        user: 'photographer',
        caption: 'First photo',
        likes: 12,
        comments: 3,
        type: 'photo',
      },
      {
        rank: 2,
        user: 'filmmaker',
        caption: 'Nested reel',
        likes: 99,
        comments: 4,
        type: 'video',
      },
    ]);
  });
});
