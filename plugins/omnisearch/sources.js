/**
 * OmniSearch — shared source fetchers for public platforms.
 *
 * Every search command aggregates across these. Each fetcher returns
 * normalized rows: { platform, title, author, score, commentCount, createdAt, url, text }
 */
import { CommandExecutionError } from '@agentrhq/webcmd/errors';

/** Fetch helper: isolates transport errors into webcmd's typed error. */
async function get(url, init, { source } = {}) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new CommandExecutionError(
      `OmniSearch: ${source} request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new CommandExecutionError(`OmniSearch: ${source} HTTP ${res.status}`);
  }
  return res;
}

// --- Hacker News (Algolia) ---
export async function hnSearch(query, limit) {
  const url = new URL('https://hn.algolia.com/api/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('tags', 'story');
  url.searchParams.set('hitsPerPage', String(limit));
  const res = await get(url, {}, { source: 'Hacker News' });
  const json = await res.json();
  return (json?.hits ?? []).slice(0, limit).map((h) => ({
    platform: 'hackernews',
    title: String(h.title ?? h.story_title ?? '').trim(),
    author: String(h.author ?? ''),
    score: h.points ?? 0,
    commentCount: h.num_comments ?? 0,
    createdAt: String(h.created_at ?? ''),
    url: String(h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`),
    text: '',
  }));
}

// --- Lobste.rs ---
export async function lobstersSearch(query, limit) {
  const res = await get('https://lobste.rs/newest.json', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniSearch/0.1)' },
  }, { source: 'Lobste.rs' });
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  const q = query.toLowerCase();
  return rows
    .filter((s) =>
      String(s.title ?? '').toLowerCase().includes(q) ||
      String(s.description_plain ?? '').toLowerCase().includes(q) ||
      (Array.isArray(s.tags) && s.tags.some((t) => t.toLowerCase().includes(q))),
    )
    .slice(0, limit)
    .map((s) => ({
      platform: 'lobsters',
      title: String(s.title ?? '').trim(),
      author: String(s.submitter_user ?? ''),
      score: s.score ?? 0,
      commentCount: s.comment_count ?? 0,
      createdAt: String(s.created_at ?? ''),
      url: String(s.comments_url ?? ''),
      text: String(s.description_plain ?? ''),
    }));
}

// --- Stack Overflow (public StackExchange API) ---
export async function stackoverflowSearch(query, limit) {
  const url = new URL('https://api.stackexchange.com/2.3/search/advanced');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('sort', 'relevance');
  url.searchParams.set('q', query);
  url.searchParams.set('site', 'stackoverflow');
  url.searchParams.set('pagesize', String(limit));
  const res = await get(url, {}, { source: 'Stack Overflow' });
  const json = await res.json();
  return (json?.items ?? []).slice(0, limit).map((q) => ({
    platform: 'stackoverflow',
    title: String(q.title ?? '').trim(),
    author: String(q.owner?.display_name ?? ''),
    score: q.score ?? 0,
    commentCount: q.answer_count ?? 0,
    createdAt: String(new Date((q.creation_date ?? Date.now()) * 1000).toISOString()),
    url: String(q.link ?? ''),
    text: '',
  }));
}

// --- Dev.to (tag-based public articles) ---
export async function devtoSearch(query, limit) {
  const url = new URL('https://dev.to/api/articles');
  url.searchParams.set('tag', query.replace(/[^a-zA-Z0-9-]/g, ''));
  url.searchParams.set('per_page', String(limit));
  const res = await get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniSearch/0.1)' },
  }, { source: 'Dev.to' });
  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json.slice(0, limit).map((a) => ({
    platform: 'devto',
    title: String(a.title ?? '').trim(),
    author: String(a.user?.username ?? a.user?.name ?? ''),
    score: a.positive_reactions_count ?? 0,
    commentCount: a.comments_count ?? 0,
    createdAt: String(a.published_at ?? ''),
    url: String(a.url ?? ''),
    text: String(a.description ?? ''),
  }));
}
// --- GitHub issues (people reporting problems) ---
export async function githubSearch(query, limit) {
  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set('q', `${query} in:title,body`);
  url.searchParams.set('per_page', String(limit));
  const res = await get(url, { headers: { 'User-Agent': 'OmniSearch/0.1' } }, { source: 'GitHub' });
  const json = await res.json();
  return (json?.items ?? []).slice(0, limit).map((i) => ({
    platform: 'github',
    title: `[${i.state ?? ''}] ${String(i.title ?? '').trim()}`.trim(),
    author: String(i.user?.login ?? ''),
    score: i.reactions?.total_count ?? 0,
    commentCount: i.comments ?? 0,
    createdAt: String(i.created_at ?? ''),
    url: String(i.html_url ?? ''),
    text: String(i.body ?? '').slice(0, 300),
  }));
}

// --- arXiv (research papers) ---
export async function arxivSearch(query, limit) {
  const url = new URL('https://export.arxiv.org/api/query');
  url.searchParams.set('search_query', `all:${query.split(' ').join('+')}`);
  url.searchParams.set('max_results', String(limit));
  const res = await get(url, {}, { source: 'arXiv' });
  const xml = await res.text();
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  const rows = [];
  let m;
  while ((m = entryRe.exec(xml)) !== null && rows.length < limit) {
    const e = m[1];
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]
      ?.replace(/\s+/g, ' ').trim() ?? '';
    const author = ((e.match(/<name>([\s\S]*?)<\/name>/) || [])[1] ?? '').trim();
    const id = (e.match(/<id>([\s\S]*?)<\/id>/) || [])[1] ?? '';
    const updated = ((e.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] ?? '').trim();
    const summary = ((e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] ?? '')
      .replace(/\s+/g, ' ').trim();
    rows.push({
      platform: 'arxiv',
      title,
      author,
      score: 0,
      commentCount: 0,
      createdAt: updated,
      url: id,
      text: summary.slice(0, 200),
    });
  }
  return rows;
}

// --- Bluesky (public author feed) ---
export async function blueskyPosts(handle, limit) {
  const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed');
  url.searchParams.set('actor', handle);
  url.searchParams.set('limit', String(limit));
  const res = await get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniSearch/0.1)' },
  }, { source: 'Bluesky' });
  const json = await res.json();
  const feed = Array.isArray(json?.feed) ? json.feed : [];
  return feed.slice(0, limit).map((entry) => {
    const post = entry?.post ?? {};
    const author = post.author ?? {};
    const record = post.record ?? {};
    const uri = String(post.uri ?? '');
    const rkey = uri.split('/').pop() ?? '';
    return {
      platform: 'bluesky',
      title: String(record.text ?? '').replace(/\s*\n+/g, ' ').trim().slice(0, 200),
      author: String(author.handle ?? handle),
      score: post.likeCount ?? 0,
      commentCount: post.replyCount ?? 0,
      createdAt: String(record.createdAt ?? post.indexedAt ?? ''),
      url: `https://bsky.app/profile/${author.handle ?? handle}/post/${rkey}`,
      text: String(record.text ?? '').replace(/\s*\n+/g, ' ').trim(),
    };
  });
}

// --- Reddit (public JSON search API, no auth) ---
export async function redditSearch(query, limit) {
  const url = new URL('https://www.reddit.com/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'relevance');
  url.searchParams.set('type', 'link');
  url.searchParams.set('limit', String(Math.min(limit, 100)));
  const res = await get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniSearch/0.1; +https://github.com/agentrhq/webcmd)' },
  }, { source: 'Reddit' });
  const json = await res.json();
  const children = Array.isArray(json?.data?.children) ? json.data.children : [];
  return children
    .filter((child) => child?.data && typeof child.data === 'object')
    .slice(0, limit)
    .map((child) => {
    const d = child?.data ?? {};
    const createdAt = new Date(d.created_utc ? Number(d.created_utc) * 1000 : NaN);
    return {
      platform: 'reddit',
      title: String(d.title ?? '').trim(),
      author: String(d.author ?? ''),
      score: d.score ?? 0,
      commentCount: d.num_comments ?? 0,
      createdAt: Number.isNaN(createdAt.getTime()) ? '' : createdAt.toISOString(),
      url: d.url ? String(d.url) : `https://www.reddit.com${d.permalink ?? ''}`,
      text: String(d.selftext ?? '').slice(0, 200),
    };
  });
}

