import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@agentrhq/webcmd/errors';
import {
  assertLinkedInAuthenticated,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

const LINKEDIN_DOMAIN = 'www.linkedin.com';
const MAX_ROUNDS = 200;
const UNREACHED_COUNT_STABLE_ROUNDS = 10;
const COLUMNS = [
  'rank',
  'name',
  'headline',
  'profile_url',
  'comment_count',
  'sample_comment',
  'commented_at',
  'source_post',
];

function canonicalizePostUrl(value) {
  const raw = normalizeWhitespace(value);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ArgumentError('post-url must be an exact LinkedIn post URL');
  }
  const host = parsed.hostname.toLowerCase();
  const feedPath = /^\/feed\/update\/urn:li:activity:\d+\/?$/i.test(parsed.pathname);
  const postsPath = /^\/posts\/[^/?#]+\/?$/i.test(parsed.pathname);
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || (host !== 'linkedin.com' && host !== LINKEDIN_DOMAIN)
    || (!feedPath && !postsPath)
  ) {
    throw new ArgumentError('post-url must be an exact HTTPS LinkedIn /feed/update/ or /posts/ URL');
  }
  parsed.hostname = LINKEDIN_DOMAIN;
  parsed.search = '';
  parsed.hash = '';
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed.toString();
}

function parseOptionalLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ArgumentError('--limit must be a positive integer');
  }
  return limit;
}

function canonicalizeProfileUrl(value) {
  try {
    const parsed = new URL(normalizeWhitespace(value), `https://${LINKEDIN_DOMAIN}`);
    const host = parsed.hostname.toLowerCase();
    const match = parsed.pathname.match(/^\/in\/([^/?#]+)(?:\/[a-z]{2})?\/?$/i);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.port
      || (host !== 'linkedin.com' && host !== LINKEDIN_DOMAIN)
      || !match
    ) return '';
    return `https://${LINKEDIN_DOMAIN}/in/${match[1]}/`;
  } catch {
    return '';
  }
}

function isCompanyProfileUrl(value) {
  try {
    const parsed = new URL(normalizeWhitespace(value), `https://${LINKEDIN_DOMAIN}`);
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && (parsed.hostname === 'linkedin.com' || parsed.hostname === LINKEDIN_DOMAIN)
      && /^\/company\/[^/?#]+\/(?:posts\/)?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function buildCommentRoundScript() {
  return String.raw`(() => {
    const clean = (value) => String(value || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const commentSelector = '[id^="replaceableComment_"]';
    const owns = (node, element) => element && element.closest(commentSelector) === node;
    const authRequired = /linkedin\.com\/(?:login|checkpoint|authwall|uas)/i.test(location.href)
      || /\b(sign in|log in|join linkedin|captcha|verification required)\b/i.test(document.body?.innerText || '');
    const nodes = Array.from(document.querySelectorAll(commentSelector));
    const expectedCommentCount = Math.max(0, ...Array.from(document.querySelectorAll('p, span, button'))
      .map((element) => clean(element.textContent || element.getAttribute('aria-label')))
      .map((text) => text.match(/^(\d[\d,.]*)([km]?)\s+comments?$/i))
      .filter(Boolean)
      .map((match) => Math.round(Number(match[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[match[2].toLowerCase()] || 1))));
    const rows = nodes.map((node) => {
      const links = Array.from(node.querySelectorAll('a[href]'))
        .filter((link) => owns(node, link) && /linkedin\.com\/(?:in|company)\//i.test(link.href));
      const rawProfileUrl = links[0]?.href || '';
      const identity = links.find((link) => link.href === rawProfileUrl && clean(link.textContent)) || links[0];
      const labels = Array.from(node.querySelectorAll('[aria-label]'))
        .filter((element) => owns(node, element))
        .map((element) => clean(element.getAttribute('aria-label')));
      const rawName = labels
        .map((label) => label.match(/^View (.+?)[’']s profile$/i)?.[1] || '')
        .find(Boolean)
        || Array.from(identity?.querySelectorAll('p') || [])
          .map((paragraph) => clean(paragraph.textContent))
          .find((text) => text && !/^(author|verified profile|[•·]?\s*(?:1st|2nd|3rd))/i.test(text))
        || '';
      const paragraphs = Array.from(identity?.querySelectorAll('p') || [])
        .map((paragraph) => clean(paragraph.textContent))
        .filter(Boolean);
      const rawHeadline = paragraphs
        .filter((text) => !(rawName && text.toLowerCase().includes(rawName.toLowerCase()))
          && !/^(author|verified profile|[•·]?\s*(?:1st|2nd|3rd))/i.test(text))
        .sort((left, right) => right.length - left.length)[0]
        || '';
      const textBox = Array.from(node.querySelectorAll('[data-testid="expandable-text-box"]'))
        .find((element) => owns(node, element));
      const ownText = Array.from(node.querySelectorAll('p, span'))
        .filter((element) => owns(node, element))
        .map((element) => clean(element.textContent));
      const rawCommentedAt = ownText
        .find((text) => /^\d+\s*(?:s|m|h|d|w|mo|yr)(?:\s*•.*)?$/i.test(text))
        || '';
      return {
        rawId: node.id,
        rawName,
        rawHeadline,
        rawProfileUrl,
        rawComment: clean(textBox?.textContent),
        rawCommentedAt,
      };
    });
    const controls = Array.from(document.querySelectorAll('button, [role="button"]')).filter((element) => {
      const text = clean(element.textContent || element.getAttribute('aria-label'));
      return /^(?:see previous replies|(?:load|show|see) more comments?)$/i.test(text);
    });
    for (const control of controls) {
      try { control.click(); } catch {}
    }
    const workspace = document.querySelector('#workspace');
    let atEnd = true;
    if (workspace && workspace.scrollHeight > workspace.clientHeight) {
      const bottom = workspace.scrollHeight - workspace.clientHeight;
      workspace.scrollTop = Math.max(0, bottom - 300);
      workspace.scrollTop = bottom;
      atEnd = workspace.scrollTop >= bottom - 2;
    } else {
      window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight - 300));
      window.scrollTo(0, document.documentElement.scrollHeight);
      atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    }
    return {
      rows,
      authRequired,
      commentNodeCount: nodes.length,
      expectedCommentCount,
      replyControlsClicked: controls.length,
      atEnd,
      url: location.href,
    };
  })()`;
}

function normalizeCommentRows(rows, sourcePost) {
  if (!Array.isArray(rows)) {
    throw new CommandExecutionError('LinkedIn post-comments returned malformed rows');
  }
  const people = new Map();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object') {
      throw new CommandExecutionError(`LinkedIn post-comments returned malformed row at index ${index}`);
    }
    const rawId = normalizeWhitespace(row.rawId);
    const name = normalizeWhitespace(row.rawName);
    const profileUrl = canonicalizeProfileUrl(row.rawProfileUrl);
    if (rawId && name && !profileUrl && isCompanyProfileUrl(row.rawProfileUrl)) continue;
    if (!rawId || !name || !profileUrl) {
      throw new CommandExecutionError(`LinkedIn post-comments returned row without stable profile identity at index ${index}`);
    }
    const existing = people.get(profileUrl);
    if (existing) {
      existing.comment_count += 1;
      continue;
    }
    people.set(profileUrl, {
      rank: people.size + 1,
      name,
      headline: normalizeWhitespace(row.rawHeadline),
      profile_url: profileUrl,
      comment_count: 1,
      sample_comment: normalizeWhitespace(row.rawComment),
      commented_at: normalizeWhitespace(row.rawCommentedAt),
      source_post: sourcePost,
    });
  }
  return Array.from(people.values());
}

async function collectPostComments(page, args) {
  if (!page) throw new CommandExecutionError('Browser session required for linkedin post-comments');
  const sourcePost = canonicalizePostUrl(args?.['post-url']);
  const limit = parseOptionalLimit(args?.limit);
  try {
    await page.goto(sourcePost);
    await page.wait(3);
  } catch (error) {
    throw new CommandExecutionError(`LinkedIn post-comments navigation failed: ${error?.message || error}`);
  }
  try {
    await assertLinkedInAuthenticated(page, 'LinkedIn post-comments');
  } catch (error) {
    if (error instanceof AuthRequiredError) throw error;
    throw new CommandExecutionError(`LinkedIn post-comments authentication check failed: ${error?.message || error}`);
  }

  const commentsById = new Map();
  let expectedCommentCount = 0;
  let stableRounds = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let payload;
    try {
      payload = unwrapEvaluateResult(await page.evaluate(buildCommentRoundScript()));
    } catch (error) {
      throw new CommandExecutionError(`LinkedIn post-comments extraction failed: ${error?.message || error}`);
    }
    if (payload?.authRequired) {
      throw new AuthRequiredError(
        LINKEDIN_DOMAIN,
        'LinkedIn post-comments requires an active signed-in browser session.',
      );
    }
    if (
      !payload
      || !Array.isArray(payload.rows)
      || !Number.isInteger(payload.commentNodeCount)
      || payload.commentNodeCount < 0
      || !Number.isInteger(payload.expectedCommentCount)
      || payload.expectedCommentCount < 0
      || !Number.isInteger(payload.replyControlsClicked)
      || payload.replyControlsClicked < 0
      || typeof payload.atEnd !== 'boolean'
    ) {
      throw new CommandExecutionError('LinkedIn post-comments returned malformed extraction payload');
    }
    let actualPost;
    try {
      actualPost = canonicalizePostUrl(payload.url);
    } catch {
      throw new CommandExecutionError('LinkedIn post-comments extraction ended outside an exact LinkedIn post URL');
    }
    if (actualPost !== sourcePost) {
      throw new CommandExecutionError(`LinkedIn post-comments post URL mismatch: expected ${sourcePost}; actual ${actualPost}`);
    }

    let newComments = 0;
    for (const row of payload.rows) {
      const id = normalizeWhitespace(row?.rawId);
      if (!id) {
        throw new CommandExecutionError('LinkedIn post-comments returned a comment without a stable id');
      }
      if (!commentsById.has(id)) {
        commentsById.set(id, row);
        newComments += 1;
      }
    }
    expectedCommentCount = Math.max(expectedCommentCount, payload.expectedCommentCount);
    const normalized = normalizeCommentRows(Array.from(commentsById.values()), sourcePost);
    if (limit && normalized.length >= limit) return normalized.slice(0, limit);

    const exhausted = newComments === 0
      && payload.replyControlsClicked === 0
      && payload.atEnd;
    stableRounds = exhausted ? stableRounds + 1 : 0;
    const stableRoundLimit = expectedCommentCount === 0 || commentsById.size >= expectedCommentCount
      ? 2
      : UNREACHED_COUNT_STABLE_ROUNDS;
    if (stableRounds >= stableRoundLimit) {
      if (normalized.length === 0) {
        throw new EmptyResultError(
          'linkedin post-comments',
          'No visible comments were found on the LinkedIn post.',
        );
      }
      return normalized;
    }
    await page.wait(1);
  }
  throw new CommandExecutionError(`LinkedIn post-comments did not reach a stable end after ${MAX_ROUNDS} rounds`);
}

cli({
  site: 'linkedin',
  name: 'post-comments',
  access: 'read',
  description: 'List unique commenters and reply authors from one exact LinkedIn post URL',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    {
      name: 'post-url',
      type: 'string',
      positional: true,
      required: true,
      help: 'Exact LinkedIn post URL',
    },
    {
      name: 'limit',
      type: 'int',
      required: false,
      help: 'Maximum unique commenters to return; omit to fetch all',
    },
  ],
  columns: COLUMNS,
  func: collectPostComments,
});

export const __test__ = {
  canonicalizePostUrl,
  parseOptionalLimit,
  canonicalizeProfileUrl,
  buildCommentRoundScript,
  normalizeCommentRows,
};
