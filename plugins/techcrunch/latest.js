import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const FEED_URL = 'https://techcrunch.com/feed/';
const MAX_LIMIT = 50;

function parseLimit(raw) {
    const value = raw === undefined || raw === null || raw === '' ? 20 : Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return value;
}

function decodeXml(value) {
    return String(value ?? '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#039;/g, "'");
}

function textFrom(block, tag) {
    const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? decodeXml(match[1]).trim() : '';
}

function plainText(value) {
    return decodeXml(value)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseFeed(xml, limit) {
    const rows = [];
    const itemPattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemPattern.exec(xml)) && rows.length < limit) {
        const block = match[1];
        const title = plainText(textFrom(block, 'title'));
        const url = textFrom(block, 'link') || textFrom(block, 'guid');
        if (!title || !url) continue;
        rows.push({
            rank: rows.length + 1,
            title,
            author: plainText(textFrom(block, 'dc:creator')) || null,
            publishedAt: textFrom(block, 'pubDate') || null,
            description: plainText(textFrom(block, 'description')).slice(0, 240) || null,
            url,
        });
    }
    return rows;
}

cli({
    site: 'techcrunch',
    name: 'latest',
    access: 'read',
    description: 'List the latest TechCrunch stories from the public RSS feed',
    domain: 'techcrunch.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: `Maximum stories to return (1-${MAX_LIMIT})` },
    ],
    columns: ['rank', 'title', 'author', 'publishedAt', 'description', 'url'],
    func: async (kwargs) => {
        const limit = parseLimit(kwargs.limit);
        let response;
        try {
            response = await fetch(FEED_URL, {
                headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' },
            });
        } catch (error) {
            throw new CommandExecutionError(`TechCrunch feed request failed: ${error.message}`);
        }
        if (!response.ok) {
            throw new CommandExecutionError(`TechCrunch feed request failed with HTTP ${response.status}`);
        }
        let xml;
        try {
            xml = await response.text();
        } catch (error) {
            throw new CommandExecutionError(`TechCrunch feed response could not be read: ${error.message}`);
        }
        const rows = parseFeed(xml, limit);
        if (!rows.length) {
            throw new EmptyResultError('techcrunch latest', 'The TechCrunch feed did not contain any readable stories.');
        }
        return rows;
    },
});
