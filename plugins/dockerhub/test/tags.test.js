import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, test, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pluginRoot, '..', '..');
const peerScopeDir = path.join(pluginRoot, 'node_modules', '@agentrhq');
const peerLink = path.join(peerScopeDir, 'webcmd');

let createdPeerLink = false;
if (!fs.existsSync(peerLink)) {
    fs.mkdirSync(peerScopeDir, { recursive: true });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(repoRoot, peerLink, linkType);
    createdPeerLink = true;
}

afterAll(() => {
    if (!createdPeerLink) return;
    fs.rmSync(peerLink, { force: true, recursive: true });
    for (const dir of [peerScopeDir, path.dirname(peerScopeDir)]) {
        try {
            fs.rmdirSync(dir);
        } catch {
            // Directory is not empty; leave local state alone.
        }
    }
});

afterEach(() => vi.unstubAllGlobals());

const { getRegistry } = await import('@agentrhq/webcmd/registry');
await Promise.all([
    import('../tags.js'),
    import('../image.js'),
    import('../search.js'),
]);

const TAGS_PAYLOAD = {
    results: [
        {
            name: 'latest',
            last_updated: '2026-08-25T10:52:43.606795Z',
            full_size: 75487477,
            images: [
                { architecture: 'amd64', os: 'linux', size: 75273372 },
                { architecture: 'arm64', os: 'linux', size: 73518870 },
            ],
        },
        {
            name: '1.25',
            last_updated: '2026-08-20T08:00:00Z',
            full_size: 75000000,
            images: [
                { architecture: 'amd64', os: 'linux', size: 75000000 },
            ],
        }
    ]
};

function stubFetch(payload, { ok = true, status = 200 } = {}) {
    vi.stubGlobal('fetch', async () => {
        return new Response(JSON.stringify(payload), {
            status,
            headers: { 'content-type': 'application/json' },
        });
    });
}

test('dockerhub tags lists public tags with size, architectures and urls', async () => {
    stubFetch(TAGS_PAYLOAD);
    const command = getRegistry().get('dockerhub/tags');
    const rows = await command.func({ image: 'nginx', limit: 2 });

    assert.equal(rows.length, 2);
    
    // Tag 1
    assert.equal(rows[0].tag, 'latest');
    assert.equal(rows[0].lastUpdated, '2026-08-25T10:52:43Z');
    assert.equal(rows[0].size, '71.99 MB');
    assert.equal(rows[0].architectures, 'amd64, arm64');
    assert.equal(rows[0].url, 'https://hub.docker.com/r/library/nginx/tags?name=latest');

    // Tag 2
    assert.equal(rows[1].tag, '1.25');
    assert.equal(rows[1].size, '71.53 MB');
    assert.equal(rows[1].architectures, 'amd64');
});

test('dockerhub tags respects limit', async () => {
    stubFetch(TAGS_PAYLOAD);
    const command = getRegistry().get('dockerhub/tags');
    const rows = await command.func({ image: 'library/nginx', limit: 1 });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].tag, 'latest');
});

test('dockerhub tags rejects invalid image names', async () => {
    const command = getRegistry().get('dockerhub/tags');
    await assert.rejects(
        () => command.func({ image: 'invalid/image/name/extra' }),
        /slug/,
    );
});

test('dockerhub tags handles empty result error', async () => {
    stubFetch({ results: [] });
    const command = getRegistry().get('dockerhub/tags');
    await assert.rejects(
        () => command.func({ image: 'nginx' }),
        /returned no data/,
    );
});
