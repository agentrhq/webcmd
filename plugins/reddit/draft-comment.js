import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const REDDIT_POST_ID_RE = /^[a-z0-9]+$/i;

function normalizeBareRedditPostId(value) {
    const postId = String(value || '').trim();
    if (!REDDIT_POST_ID_RE.test(postId)) {
        throw new ArgumentError(
            'Post ID must be a Reddit post id, t3_ fullname, or reddit.com post URL.',
            'Use a bare post id like 1abc123, a fullname like t3_1abc123, or a full Reddit post URL.',
        );
    }
    return postId.toLowerCase();
}

export function normalizeDraftPostId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new ArgumentError(
            'Post ID is required.',
            'Use a bare post id like 1abc123, a fullname like t3_1abc123, or a full Reddit post URL.',
        );
    }

    const fullname = raw.match(/^t3_([a-z0-9]+)$/i);
    if (fullname) return normalizeBareRedditPostId(fullname[1]);

    if (/^https?:\/\//i.test(raw)) {
        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            throw new ArgumentError(`Invalid Reddit post URL: ${raw}`);
        }
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== 'https:' || (host !== 'reddit.com' && !host.endsWith('.reddit.com'))) {
            throw new ArgumentError(
                'Post URL must be an https reddit.com URL.',
                'Use a URL like https://www.reddit.com/r/sub/comments/1abc123/title_slug/',
            );
        }
        const parts = parsed.pathname.split('/').filter(Boolean);
        const commentsIndex = parts.indexOf('comments');
        const postIndex = commentsIndex + 1;
        if (commentsIndex < 0 || parts.length <= postIndex) {
            throw new ArgumentError(
                'Post URL must include the target post id.',
                'Use a URL like https://www.reddit.com/r/sub/comments/1abc123/title_slug/',
            );
        }
        if (parts.length > postIndex + 3) {
            throw new ArgumentError(
                'Post URL must end at the post slug or comment permalink id.',
                'Remove extra path segments after the post slug or comment id.',
            );
        }
        if (parts.length === postIndex + 3) normalizeBareRedditPostId(parts[postIndex + 2]);
        return normalizeBareRedditPostId(parts[postIndex]);
    }

    if (raw.includes('/') || raw.startsWith('t1_')) {
        throw new ArgumentError(
            'Post ID must be a Reddit post id, t3_ fullname, or reddit.com post URL.',
            'Use a bare post id like 1abc123, a fullname like t3_1abc123, or a full Reddit post URL.',
        );
    }

    return normalizeBareRedditPostId(raw);
}

export function requireDraftText(value) {
    const text = String(value || '');
    if (!text.trim()) {
        throw new ArgumentError('Comment text is required.', 'Pass non-empty text to draft in the Reddit comment box.');
    }
    return text;
}

function mapUiResult(action, result) {
    if (result?.kind === 'auth') {
        throw new AuthRequiredError('reddit.com', result.detail);
    }
    if (result?.kind !== 'ok') {
        throw new CommandExecutionError(`${action} failed: ${result?.detail || JSON.stringify(result)}`);
    }
}

cli({
    site: 'reddit',
    name: 'draft-comment',
    access: 'write',
    description: 'Draft a comment on a Reddit post without submitting it',
    domain: 'reddit.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    freshPage: true,
    example: 'webcmd reddit draft-comment <post-id-or-url> <text> --window foreground',
    args: [
        { name: 'post-id', type: 'string', required: true, positional: true, help: 'Post ID (e.g. 1abc123), t3 fullname, or Reddit post URL' },
        { name: 'text', type: 'string', required: true, positional: true, help: 'Comment text to leave in the composer' },
    ],
    columns: ['status', 'message', 'url'],
    func: async (page, kwargs) => {
        const postId = normalizeDraftPostId(kwargs['post-id']);
        const text = requireDraftText(kwargs.text);
        const targetUrl = `https://www.reddit.com/comments/${postId}/`;

        await page.goto(targetUrl);
        const openResult = await page.evaluate(`(async () => {
          function visible(el) {
            var r = el && el.getBoundingClientRect && el.getBoundingClientRect();
            if (!r || r.width <= 20 || r.height <= 10) return false;
            var style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          }
          function findComposerTrigger() {
            var selectors = [
              'textarea[placeholder="Join the conversation"]',
              'faceplate-textarea-input[placeholder="Join the conversation"]',
              'shreddit-composer[placeholder="Join the conversation"]',
              'reddit-rte[placeholder="Join the conversation"]',
              '[role="textbox"][aria-label*="comment" i]'
            ];
            for (var si = 0; si < selectors.length; si++) {
              var els = Array.from(document.querySelectorAll(selectors[si]));
              for (var i = 0; i < els.length; i++) {
                if (visible(els[i])) return els[i];
              }
            }
            return null;
          }
          var el = findComposerTrigger();
          if (!el) {
            var bodyText = document.body ? document.body.innerText : '';
            if (/\\b(log in|sign in)\\b/i.test(bodyText)) {
              return { kind: 'auth', detail: 'Log in to reddit.com before drafting a comment.' };
            }
            return { kind: 'missing', detail: 'No visible "Join the conversation" composer found. The post may be locked, archived, or still loading.' };
          }
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          await new Promise((resolve) => setTimeout(resolve, 500));
          var r = el.getBoundingClientRect();
          return { kind: 'ok', x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        mapUiResult('Open Reddit composer', openResult);

        if (typeof page.nativeClick === 'function' && Number.isFinite(openResult.x) && Number.isFinite(openResult.y)) {
            await page.nativeClick(openResult.x, openResult.y);
            await page.sleep?.(0.5);
        }
        if (typeof page.insertText !== 'function') {
            throw new CommandExecutionError('Browser runtime does not support native text insertion.');
        }
        await page.insertText(text);

        const verifyResult = await page.evaluate(`(async () => {
          var expected = ${JSON.stringify(text)};
          await new Promise((resolve) => setTimeout(resolve, 500));
          var active = document.activeElement;
          var activeText = active ? (active.value || active.innerText || active.textContent || '') : '';
          var bodyText = document.body ? document.body.innerText : '';
          if (!activeText.includes(expected) && !bodyText.includes(expected)) {
            return { kind: 'missing', detail: 'Draft text was not found in the active Reddit composer.' };
          }
          return { kind: 'ok', currentUrl: location.href };
        })()`);
        mapUiResult('Verify drafted Reddit comment', verifyResult);

        return [{
            status: 'drafted',
            message: 'Draft comment inserted; review the visible Reddit tab and click Comment when ready.',
            url: verifyResult.currentUrl || targetUrl,
        }];
    },
});
