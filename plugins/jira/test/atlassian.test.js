import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
    adfToMarkdown,
    atlassianRequest,
    getJiraConfig,
    htmlToMarkdown,
} from '../atlassian.js';

const ENV_KEYS = [
    'ATLASSIAN_BEARER_TOKEN',
    'ATLASSIAN_DEPLOYMENT',
    'ATLASSIAN_EMAIL',
    'ATLASSIAN_API_TOKEN',
    'ATLASSIAN_OAUTH_TOKEN',
    'ATLASSIAN_PAT',
    'ATLASSIAN_PASSWORD',
    'ATLASSIAN_USERNAME',
    'ATLASSIAN_JIRA_BASE_URL',
    'JIRA_API_TOKEN',
    'JIRA_BASE_URL',
    'JIRA_EMAIL',
    'JIRA_PASSWORD',
    'JIRA_PAT',
    'JIRA_USERNAME',
];

function clearEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
});

describe('jira atlassian helpers', () => {
    it('builds Jira Cloud and Data Center authentication', () => {
        process.env.ATLASSIAN_JIRA_BASE_URL = 'https://team.atlassian.net';
        process.env.ATLASSIAN_EMAIL = 'bot@example.com';
        process.env.ATLASSIAN_API_TOKEN = 'secret';
        expect(getJiraConfig()).toMatchObject({
            baseUrl: 'https://team.atlassian.net',
            deployment: 'cloud',
            authHeaders: { Authorization: `Basic ${Buffer.from('bot@example.com:secret').toString('base64')}` },
        });

        clearEnv();
        process.env.ATLASSIAN_JIRA_BASE_URL = 'https://jira.example.com';
        process.env.ATLASSIAN_DEPLOYMENT = 'datacenter';
        process.env.ATLASSIAN_PAT = 'pat-123';
        expect(getJiraConfig()).toMatchObject({
            baseUrl: 'https://jira.example.com',
            deployment: 'datacenter',
            authHeaders: { Authorization: 'Bearer pat-123' },
        });
    });

    it('converts Jira ADF and rendered HTML to Markdown', () => {
        const markdown = adfToMarkdown({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Broken ', marks: [{ type: 'strong' }] },
                        { type: 'text', text: 'checkout', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
                    ],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'retry payment' }] }] }],
                },
            ],
        });
        expect(markdown).toContain('**Broken **');
        expect(markdown).toContain('[checkout](https://example.com)');
        expect(markdown).toContain('- retry payment');
        expect(adfToMarkdown({
            type: 'doc',
            content: [{
                type: 'table',
                content: [
                    { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'text', text: 'Notes' }] }] },
                    { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'text', text: 'a | b' }] }] },
                ],
            }],
        })).toContain('a \\| b');
        expect(htmlToMarkdown('<p><strong>Fixed</strong><br>Ready</p>')).toContain('**Fixed**');
    });

    it('sends JSON requests and preserves typed failures', async () => {
        const config = {
            product: 'jira',
            baseUrl: 'https://jira.example.com',
            deployment: 'datacenter',
            authHeaders: { Authorization: 'Bearer token' },
        };
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(atlassianRequest(config, '/rest/api/2/myself', { label: 'jira myself' })).resolves.toEqual({ ok: true });
        expect(fetchMock.mock.calls[0][0]).toBe('https://jira.example.com/rest/api/2/myself');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');

        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'bad token' }), { status: 401 })));
        await expect(atlassianRequest(config, '/rest/api/2/myself', { label: 'jira myself' }))
            .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'slow down' }), { status: 429 })));
        await expect(atlassianRequest(config, '/rest/api/2/myself', { label: 'jira myself' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });

        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>login</html>', { status: 200 })));
        await expect(atlassianRequest(config, '/rest/api/2/myself', { label: 'jira myself' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});
