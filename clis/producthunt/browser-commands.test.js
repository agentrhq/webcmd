import { describe, expect, it } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './hot.js';
import './browse.js';

function pageMock({ evaluations, captureError } = {}) {
    const queue = [...(evaluations ?? [])];
    return {
        goto: async () => undefined,
        wait: async () => undefined,
        installInterceptor: async () => undefined,
        waitForCapture: async () => {
            if (captureError) throw captureError;
        },
        evaluate: async () => queue.shift(),
    };
}

const challenge = {
    title: 'Just a moment...',
    body: 'Performing security verification before proceeding',
    cloudflare: true,
};
const accessible = {
    title: 'Product Hunt',
    body: 'Discover your next favorite thing',
    cloudflare: false,
};

describe('Product Hunt browser commands', () => {
    it.each([
        ['producthunt/hot', {}],
        ['producthunt/browse', { category: 'developer-tools' }],
    ])('%s reports verification pages as SITE_BLOCKED', async (name, args) => {
        const command = getRegistry().get(name);

        await expect(command.func(pageMock({ evaluations: [challenge] }), args)).rejects.toMatchObject({
            code: 'SITE_BLOCKED',
            exitCode: 69,
        });
    });

    it('reports a challenge when category capture fails on the verification page', async () => {
        const command = getRegistry().get('producthunt/browse');
        const captureError = new Error('No network capture within 5s');

        await expect(command.func(pageMock({ evaluations: [challenge], captureError }), {
            category: 'developer-tools',
        })).rejects.toMatchObject({
            code: 'SITE_BLOCKED',
            exitCode: 69,
        });
    });

    it.each([
        ['producthunt/hot', {}, 'Could not retrieve Product Hunt top posts'],
        ['producthunt/browse', { category: 'developer-tools' }, 'No products found for category'],
    ])('%s preserves NO_DATA for an accessible empty page', async (name, args, message) => {
        const command = getRegistry().get(name);

        await expect(command.func(pageMock({ evaluations: [accessible, []] }), args)).rejects.toMatchObject({
            code: 'NO_DATA',
            message: expect.stringContaining(message),
        });
    });
});
