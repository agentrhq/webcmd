/**
 * opinions bluesky-posts — read what a public Bluesky account is saying.
 *
 * No login. Uses the public Bluesky API (public.api.bsky.app) author feed
 * endpoint, which returns a user's recent posts without authentication.
 * This is the closest no-login analog to reading someone's public X/Twitter
 * timeline.
 */
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  CommandExecutionError,
  EmptyResultError,
} from '@agentrhq/webcmd/errors';

const API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed';
const HANDLE = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;

function requireHandle(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s || !HANDLE.test(s)) {
    throw new ArgumentError('bluesky handle is required, e.g. "bsky.app" or "user.bsky.social"');
  }
  return s;
}

cli({
  site: 'opinions',
  name: 'bluesky-posts',
  access: 'read',
  description: "Recent posts from a public Bluesky account (no login)",
  domain: 'public.api.bsky.app',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'handle', required: true, positional: true, help: 'Bluesky handle (e.g. bsky.app)' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
  ],
  columns: ['rank', 'uri', 'createdAt', 'text', 'likeCount', 'replyCount', 'repostCount', 'url'],
  func: async (kwargs) => {
    const handle = requireHandle(kwargs.handle);
    const raw = Number(kwargs.limit ?? 20);
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    const limit = Math.min(raw, 100);

    const url = new URL(API);
    url.searchParams.set('actor', handle);
    url.searchParams.set('limit', String(limit));

    let json;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; webcmd-opinions/0.1)' },
      });
      if (!res.ok) {
        throw new CommandExecutionError(`Bluesky API request failed: HTTP ${res.status}`);
      }
      json = await res.json();
    } catch (err) {
      if (err instanceof CommandExecutionError) throw err;
      throw new CommandExecutionError(`Bluesky API request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const feed = Array.isArray(json?.feed) ? json.feed : [];
    if (!feed.length) {
      throw new EmptyResultError('opinions/bluesky-posts', `no posts found for "${handle}"`);
    }

    return feed.slice(0, limit).map((entry, index) => {
      const post = entry?.post ?? {};
      const author = post.author ?? {};
      const record = post.record ?? {};
      const uri = String(post.uri ?? '');
      const rkey = uri.split('/').pop() ?? '';
      return {
        rank: index + 1,
        uri,
        createdAt: String(record.createdAt ?? post.indexedAt ?? ''),
        text: String(record.text ?? '').replace(/\s*\n+/g, ' ').trim(),
        likeCount: post.likeCount ?? 0,
        replyCount: post.replyCount ?? 0,
        repostCount: post.repostCount ?? 0,
        url: `https://bsky.app/profile/${author.handle ?? handle}/post/${rkey}`,
      };
    });
  },
});