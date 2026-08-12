import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
    atlassianRequest,
    getConfluenceConfig,
    htmlToMarkdown,
    markdownToConfluenceStorage,
} from '../atlassian.js';

const ENV_KEYS = [
    'ATLASSIAN_BEARER_TOKEN',
    'ATLASSIAN_CONFLUENCE_BASE_URL',
    'ATLASSIAN_DEPLOYMENT',
    'ATLASSIAN_EMAIL',
    'ATLASSIAN_API_TOKEN',
    'ATLASSIAN_OAUTH_TOKEN',
    'ATLASSIAN_PAT',
    'ATLASSIAN_PASSWORD',
    'ATLASSIAN_USERNAME',
    'CONFLUENCE_API_TOKEN',
    'CONFLUENCE_BASE_URL',
    'CONFLUENCE_EMAIL',
    'CONFLUENCE_PASSWORD',
    'CONFLUENCE_PAT',
    'CONFLUENCE_USERNAME',
];

function clearEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
});

describe('confluence atlassian helpers', () => {
    it('builds Confluence Cloud and Data Center authentication', () => {
        process.env.ATLASSIAN_CONFLUENCE_BASE_URL = 'https://team.atlassian.net';
        process.env.ATLASSIAN_EMAIL = 'bot@example.com';
        process.env.ATLASSIAN_API_TOKEN = 'secret';
        expect(getConfluenceConfig()).toMatchObject({
            baseUrl: 'https://team.atlassian.net/wiki',
            deployment: 'cloud',
            authHeaders: { Authorization: `Basic ${Buffer.from('bot@example.com:secret').toString('base64')}` },
        });

        clearEnv();
        process.env.ATLASSIAN_CONFLUENCE_BASE_URL = 'https://confluence.example.com/confluence';
        process.env.ATLASSIAN_DEPLOYMENT = 'datacenter';
        process.env.ATLASSIAN_PAT = 'pat-123';
        expect(getConfluenceConfig()).toMatchObject({
            baseUrl: 'https://confluence.example.com/confluence',
            deployment: 'datacenter',
            authHeaders: { Authorization: 'Bearer pat-123' },
        });
    });

    it('converts Confluence HTML and Markdown storage formats', () => {
        expect(htmlToMarkdown('<p><strong>Fixed</strong><br>Ready</p>')).toContain('**Fixed**');
        const storage = markdownToConfluenceStorage([
            '# RCA',
            '',
            '- Parent',
            '  - Child',
            '',
            '| Service | Status |',
            '| --- | --- |',
            '| payments | fixed |',
        ].join('\n'));
        expect(storage.replace(/\s*\n\s*/g, '')).toContain('<ul><li>Parent<ul><li>Child</li></ul></li></ul>');
        expect(storage).toContain('<h1>RCA</h1>');
        expect(storage).toContain('<td>fixed</td>');
    });

    it('sends JSON requests and preserves typed failures', async () => {
        const config = {
            product: 'confluence',
            baseUrl: 'https://confluence.example.com',
            deployment: 'datacenter',
            authHeaders: { Authorization: 'Bearer token' },
        };
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(atlassianRequest(config, '/rest/api/content', { label: 'confluence content' })).resolves.toEqual({ ok: true });
        expect(fetchMock.mock.calls[0][0]).toBe('https://confluence.example.com/rest/api/content');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');

        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'bad token' }), { status: 401 })));
        await expect(atlassianRequest(config, '/rest/api/content', { label: 'confluence content' }))
            .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'slow down' }), { status: 429 })));
        await expect(atlassianRequest(config, '/rest/api/content', { label: 'confluence content' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });

        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>login</html>', { status: 200 })));
        await expect(atlassianRequest(config, '/rest/api/content', { label: 'confluence content' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});
