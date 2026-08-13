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
    fs.symlinkSync(repoRoot, peerLink, 'dir');
    createdPeerLink = true;
}

afterAll(() => {
    if (!createdPeerLink) return;
    fs.rmSync(peerLink, { force: true, recursive: true });
    for (const dir of [peerScopeDir, path.dirname(peerScopeDir)]) {
        try {
            fs.rmdirSync(dir);
        } catch {
            // Directory is not empty; leave unrelated local state alone.
        }
    }
});

const { getRegistry } = await import('@agentrhq/webcmd/registry');
const [{ releasesPyPI }] = await Promise.all([
    import('../releases.js'),
    import('../package.js'),
    import('../downloads.js'),
]);

const payload = {
    info: {
        name: 'pictovap',
        version: '0.7.14',
        summary: 'Visual finishing engine for publishers',
        author: 'Kemal Kaya',
        license: 'MIT',
        requires_python: '>=3.10',
        keywords: 'images,publishing',
        package_url: 'https://pypi.org/project/pictovap/',
        home_page: 'https://github.com/yoldaolmak/Pictovap',
        project_urls: {
            Homepage: 'https://github.com/yoldaolmak/Pictovap',
            Repository: 'https://github.com/yoldaolmak/Pictovap',
        },
    },
    releases: {
        '0.7.14': [
            {
                upload_time_iso_8601: '2026-07-26T06:12:00.000Z',
                upload_time: '2026-07-26T06:12:00',
                python_version: 'py3',
                yanked: false,
            },
            {
                upload_time_iso_8601: '2026-07-26T06:13:00.000Z',
                upload_time: '2026-07-26T06:13:00',
                python_version: 'source',
                yanked: false,
            },
        ],
        '0.7.13': [
            {
                upload_time_iso_8601: '2026-07-26T05:22:00.000Z',
                upload_time: '2026-07-26T05:22:00',
                python_version: 'py3',
                yanked: false,
            },
        ],
    },
};

function fakeRequest(responsePayload = payload, { ok = true, status = 200 } = {}) {
    const request = async (url, options) => {
        request.calls.push({ url: String(url), options });
        return {
            ok,
            status,
            json: async () => responsePayload,
        };
    };
    request.calls = [];
    return request;
}

test('package returns public PyPI project metadata', async () => {
    const request = fakeRequest();
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = request;
        const rows = await getRegistry().get('pypi/package').func({ name: 'pictovap' }, false);

        assert.deepEqual(rows, [{
            name: 'pictovap',
            latestVersion: '0.7.14',
            summary: 'Visual finishing engine for publishers',
            author: 'Kemal Kaya',
            license: 'MIT',
            homepage: 'https://github.com/yoldaolmak/Pictovap',
            repository: 'https://github.com/yoldaolmak/Pictovap',
            requiresPython: '>=3.10',
            keywords: 'images,publishing',
            releases: 2,
            firstReleased: '2026-07-26',
            lastReleased: '2026-07-26',
            url: 'https://pypi.org/project/pictovap/',
        }]);
        assert.equal(request.calls[0].url, 'https://pypi.org/pypi/pictovap/json');
        assert.match(request.calls[0].options.headers['user-agent'], /webcmd/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('releases returns recent release rows newest first', async () => {
    const rows = await releasesPyPI({ name: 'pictovap', limit: 2 }, fakeRequest());

    assert.deepEqual(rows, [
        {
            version: '0.7.14',
            uploadedAt: '2026-07-26T06:13:00.000Z',
            fileCount: 2,
            pythonVersions: 'py3, source',
            yanked: false,
            url: 'https://pypi.org/project/pictovap/0.7.14/',
        },
        {
            version: '0.7.13',
            uploadedAt: '2026-07-26T05:22:00.000Z',
            fileCount: 1,
            pythonVersions: 'py3',
            yanked: false,
            url: 'https://pypi.org/project/pictovap/0.7.13/',
        },
    ]);
});

test('rejects invalid package names and limits', async () => {
    await assert.rejects(
        () => getRegistry().get('pypi/package').func({ name: '../secret' }, false),
        /package name/,
    );
    await assert.rejects(
        () => releasesPyPI({ name: 'pictovap', limit: 51 }, fakeRequest()),
        /integer between 1 and 50/,
    );
});

test('reports missing packages as empty results', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = fakeRequest({}, { ok: false, status: 404 });
        await assert.rejects(
            () => getRegistry().get('pypi/package').func({ name: 'missing-package' }, false),
            error => error.code === 'EMPTY_RESULT' && /returned 404/.test(error.hint),
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('registered handlers do not require a browser', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async url => String(url).includes('pypistats.org')
            ? { ok: true, status: 200, json: async () => ({ package: 'pictovap', data: { last_day: 1, last_week: 7, last_month: 30 } }) }
            : { ok: true, status: 200, json: async () => payload };
        const registry = getRegistry();

        const packageCommand = registry.get('pypi/package');
        const downloadsCommand = registry.get('pypi/downloads');
        const releasesCommand = registry.get('pypi/releases');
        assert.ok(packageCommand?.func);
        assert.ok(downloadsCommand?.func);
        assert.ok(releasesCommand?.func);
        assert.equal(packageCommand.browser, false);
        assert.equal(downloadsCommand.browser, false);
        assert.equal(releasesCommand.browser, false);
        await packageCommand.func({ name: 'pictovap' }, false);
        assert.deepEqual(await downloadsCommand.func({ name: 'pictovap', period: 'recent' }, false), [
            { rank: 1, package: 'pictovap', period: 'last_day', date: '', downloads: 1 },
            { rank: 2, package: 'pictovap', period: 'last_week', date: '', downloads: 7 },
            { rank: 3, package: 'pictovap', period: 'last_month', date: '', downloads: 30 },
        ]);
        await releasesCommand.func({ name: 'pictovap', limit: 1 }, false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
