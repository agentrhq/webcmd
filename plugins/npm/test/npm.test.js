import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, test } from 'vitest';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pluginRoot, '..', '..');
const peerScopeDir = path.join(pluginRoot, 'node_modules', '@agentrhq');
const peerLink = path.join(peerScopeDir, 'webcmd');

let createdPeerLink = false;
if (!fs.existsSync(peerLink)) {
    fs.mkdirSync(peerScopeDir, { recursive: true });
    // On Windows, directory junctions don't require elevated privileges.
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(repoRoot, peerLink, linkType);
    createdPeerLink = true;
}

afterAll(() => {
    if (!createdPeerLink) return;
    fs.rmSync(peerLink, { force: true, recursive: true });
    for (const dir of [peerScopeDir, path.dirname(peerScopeDir)]) {
        try { fs.rmdirSync(dir); } catch { /* leave unrelated local state alone */ }
    }
});

const { getRegistry } = await import('@agentrhq/webcmd/registry');
const [{ versionsNpm }] = await Promise.all([
    import('../versions.js'),
    import('../package.js'),
    import('../downloads.js'),
    import('../search.js'),
]);

// ---------------------------------------------------------------------------
// Shared fixture — a minimal registry payload for a fictional package "exlib"
// ---------------------------------------------------------------------------
const REGISTRY_PAYLOAD = {
    name: 'exlib',
    description: 'An example library',
    'dist-tags': { latest: '2.1.0' },
    versions: {
        '2.1.0': {
            description: 'An example library',
            license: 'MIT',
            homepage: 'https://exlib.dev',
            repository: { type: 'git', url: 'git+https://github.com/example/exlib.git' },
            bugs: { url: 'https://github.com/example/exlib/issues' },
            keywords: ['example', 'lib'],
        },
        '2.0.0': {
            description: 'An example library',
            license: 'MIT',
        },
    },
    maintainers: [{ name: 'alice', email: 'alice@example.com' }],
    time: {
        created:  '2024-01-01T00:00:00.000Z',
        modified: '2026-06-15T12:00:00.000Z',
        '2.0.0':  '2025-03-10T08:00:00.000Z',
        '2.1.0':  '2026-06-15T12:00:00.000Z',
    },
};

const DOWNLOADS_PAYLOAD = {
    package: 'exlib',
    downloads: [
        { day: '2026-06-09', downloads: 1200 },
        { day: '2026-06-10', downloads: 1350 },
        { day: '2026-06-11', downloads: 980 },
    ],
};

const SEARCH_PAYLOAD = {
    objects: [
        {
            package: {
                name: 'exlib',
                version: '2.1.0',
                description: 'An example library',
                license: 'MIT',
                publisher: { username: 'alice' },
                links: { npm: 'https://www.npmjs.com/package/exlib' },
            },
            downloads: { weekly: 50000 },
            dependents: 120,
            updated: '2026-06-15T12:00:00.000Z',
        },
    ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fakeRequest(payload, { ok = true, status = 200 } = {}) {
    const req = async (url, _opts) => {
        req.calls.push(String(url));
        return { ok, status, json: async () => payload };
    };
    req.calls = [];
    return req;
}

function withFetch(payload, fn, { ok = true, status = 200 } = {}) {
    const original = globalThis.fetch;
    globalThis.fetch = fakeRequest(payload, { ok, status });
    return fn().finally(() => { globalThis.fetch = original; });
}

// ---------------------------------------------------------------------------
// npm package
// ---------------------------------------------------------------------------
test('npm package returns latest metadata', () =>
    withFetch(REGISTRY_PAYLOAD, async () => {
        const rows = await getRegistry().get('npm/package').func({ name: 'exlib' });
        assert.equal(rows.length, 1);
        const [row] = rows;
        assert.equal(row.name, 'exlib');
        assert.equal(row.latestVersion, '2.1.0');
        assert.equal(row.description, 'An example library');
        assert.equal(row.license, 'MIT');
        assert.equal(row.homepage, 'https://exlib.dev');
        assert.equal(row.repository, 'https://github.com/example/exlib');
        assert.equal(row.bugs, 'https://github.com/example/exlib/issues');
        assert.equal(row.maintainers, 'alice');
        assert.equal(row.keywords, 'example, lib');
        assert.equal(row.created, '2024-01-01');
        assert.equal(row.modified, '2026-06-15');
        assert.equal(row.url, 'https://www.npmjs.com/package/exlib');
    }),
);

test('npm package hits the correct registry URL', () => {
    const req = fakeRequest(REGISTRY_PAYLOAD);
    const original = globalThis.fetch;
    globalThis.fetch = req;
    return getRegistry().get('npm/package').func({ name: 'exlib' })
        .then(() => {
            assert.ok(req.calls[0].startsWith('https://registry.npmjs.org/'));
        })
        .finally(() => { globalThis.fetch = original; });
});

test('npm package rejects invalid package names', async () => {
    await assert.rejects(
        () => getRegistry().get('npm/package').func({ name: '' }),
        /required/,
    );
    await assert.rejects(
        () => getRegistry().get('npm/package').func({ name: '../etc/passwd' }),
        /valid/,
    );
});

test('npm package throws EmptyResultError on 404', () =>
    withFetch({}, async () => {
        await assert.rejects(
            () => getRegistry().get('npm/package').func({ name: 'no-such-pkg-xyz' }),
            (err) => err.code === 'EMPTY_RESULT',
        );
    }, { ok: false, status: 404 }),
);

// ---------------------------------------------------------------------------
// npm versions
// ---------------------------------------------------------------------------
test('npm versions returns rows newest first', () =>
    withFetch(REGISTRY_PAYLOAD, async () => {
        const rows = await versionsNpm({ name: 'exlib', limit: 10 });
        assert.equal(rows.length, 2);
        assert.equal(rows[0].version, '2.1.0');
        assert.equal(rows[0].publishedAt, '2026-06-15');
        assert.equal(rows[0].isLatest, true);
        assert.ok(rows[0].url.includes('2.1.0'));
        assert.equal(rows[1].version, '2.0.0');
        assert.equal(rows[1].isLatest, false);
    }),
);

test('npm versions strips created/modified bookkeeping keys', () =>
    withFetch(REGISTRY_PAYLOAD, async () => {
        const rows = await versionsNpm({ name: 'exlib', limit: 50 });
        assert.ok(rows.every((r) => r.version !== 'created' && r.version !== 'modified'));
    }),
);

test('npm versions respects --limit', () =>
    withFetch(REGISTRY_PAYLOAD, async () => {
        const rows = await versionsNpm({ name: 'exlib', limit: 1 });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].version, '2.1.0');
    }),
);

test('npm versions sorts correctly when two versions share the same date', () => {
    // Regression: sort must use the full ISO timestamp, not the truncated
    // date-only string, so same-day releases still come out newest-first.
    const sameDayPayload = {
        name: 'exlib',
        'dist-tags': { latest: '2.1.1' },
        versions: {
            '2.1.0': { description: 'v2.1.0' },
            '2.1.1': { description: 'v2.1.1' },
            // '0.0.1-ghost' intentionally absent — time-only entry below must be excluded
        },
        time: {
            created:       '2026-06-15T08:00:00.000Z',
            modified:      '2026-06-15T14:00:00.000Z',
            '2.1.0':       '2026-06-15T08:00:00.000Z',  // earlier on same day
            '2.1.1':       '2026-06-15T14:00:00.000Z',  // later on same day
            '0.0.1-ghost': '2026-06-15T06:00:00.000Z',  // time-only, no body.versions entry
        },
    };
    return withFetch(sameDayPayload, async () => {
        const rows = await versionsNpm({ name: 'exlib', limit: 10 });
        // ghost entry must be excluded
        assert.equal(rows.length, 2);
        // 2.1.1 published at 14:00 must come before 2.1.0 published at 08:00
        assert.equal(rows[0].version, '2.1.1');
        assert.equal(rows[1].version, '2.1.0');
        // Both format to the same date string
        assert.equal(rows[0].publishedAt, '2026-06-15');
        assert.equal(rows[1].publishedAt, '2026-06-15');
        // ghost must not appear at all
        assert.ok(rows.every((r) => r.version !== '0.0.1-ghost'));
    });
});

test('npm versions filters out prereleases by default and includes them with flag', () => {
    const prereleasePayload = {
        name: 'exlib',
        'dist-tags': { latest: '2.1.0' },
        versions: {
            '2.0.0': { description: 'v2.0.0' },
            '2.1.0': { description: 'v2.1.0' },
            '2.2.0-beta.0': { description: 'v2.2.0-beta.0' },
        },
        time: {
            created:        '2025-01-01T00:00:00.000Z',
            modified:       '2026-07-01T00:00:00.000Z',
            '2.0.0':        '2025-03-10T08:00:00.000Z',
            '2.1.0':        '2026-06-15T12:00:00.000Z',
            '2.2.0-beta.0': '2026-07-01T00:00:00.000Z',
        },
    };
    return withFetch(prereleasePayload, async () => {
        // By default, prerelease (2.2.0-beta.0) is filtered out
        const defaultRows = await versionsNpm({ name: 'exlib', limit: 10 });
        assert.equal(defaultRows.length, 2);
        assert.equal(defaultRows[0].version, '2.1.0');
        assert.equal(defaultRows[1].version, '2.0.0');

        // With prereleases: true flag, prereleases are returned
        const allRows = await versionsNpm({ name: 'exlib', limit: 10, prereleases: true });
        assert.equal(allRows.length, 3);
        assert.equal(allRows[0].version, '2.2.0-beta.0');
        assert.equal(allRows[1].version, '2.1.0');
        assert.equal(allRows[2].version, '2.0.0');
    });
});

test('npm versions rejects out-of-range limit', () =>
    withFetch(REGISTRY_PAYLOAD, async () => {
        await assert.rejects(
            () => versionsNpm({ name: 'exlib', limit: 51 }),
            /50/,
        );
    }),
);

// ---------------------------------------------------------------------------
// npm downloads
// ---------------------------------------------------------------------------
test('npm downloads returns one row per day', () =>
    withFetch(DOWNLOADS_PAYLOAD, async () => {
        const rows = await getRegistry().get('npm/downloads').func({ name: 'exlib', period: 'last-week' });
        assert.equal(rows.length, 3);
        assert.equal(rows[0].rank, 1);
        assert.equal(rows[0].package, 'exlib');
        assert.equal(rows[0].day, '2026-06-09');
        assert.equal(rows[0].downloads, 1200);
    }),
);

test('npm downloads rejects invalid period', async () => {
    await assert.rejects(
        () => getRegistry().get('npm/downloads').func({ name: 'exlib', period: 'bad-period' }),
        /invalid/,
    );
});

test('npm downloads rejects date range where start is after end', async () => {
    await assert.rejects(
        () => getRegistry().get('npm/downloads').func({ name: 'exlib', period: '2026-06-15:2026-01-01' }),
        /after end/,
    );
});

// ---------------------------------------------------------------------------
// npm search
// ---------------------------------------------------------------------------
test('npm search returns ranked results', () =>
    withFetch(SEARCH_PAYLOAD, async () => {
        const rows = await getRegistry().get('npm/search').func({ query: 'exlib', limit: 20 });
        assert.equal(rows.length, 1);
        const [row] = rows;
        assert.equal(row.rank, 1);
        assert.equal(row.name, 'exlib');
        assert.equal(row.version, '2.1.0');
        assert.equal(row.weeklyDownloads, 50000);
        assert.equal(row.dependents, 120);
        assert.equal(row.url, 'https://www.npmjs.com/package/exlib');
    }),
);

test('npm search rejects empty query', async () => {
    await assert.rejects(
        () => getRegistry().get('npm/search').func({ query: '', limit: 20 }),
        /empty/,
    );
});

// ---------------------------------------------------------------------------
// All registered commands are browser: false
// ---------------------------------------------------------------------------
test('all npm commands are browser-free', () => {
    const registry = getRegistry();
    for (const name of ['npm/package', 'npm/downloads', 'npm/search', 'npm/versions']) {
        const cmd = registry.get(name);
        assert.ok(cmd, `command ${name} not registered`);
        assert.equal(cmd.browser, false, `${name} should not require a browser`);
    }
});
