import { cli, Strategy } from '@agentrhq/webcmd/registry';

import { fetchPackageJson, parseLimit, summarizeReleases } from './utils.js';

export async function releasesPyPI(args, request = fetch) {
    const payload = await fetchPackageJson(args.name, request);
    return summarizeReleases(payload, parseLimit(args.limit));
}

cli({
    site: 'pypi',
    name: 'releases',
    access: 'read',
    description: 'List recent public PyPI package releases',
    domain: 'pypi.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, type: 'string', help: 'Python package name, for example django' },
        { name: 'limit', type: 'int', default: 10, help: 'Maximum releases to return (1-50)' },
    ],
    columns: ['version', 'uploadedAt', 'fileCount', 'pythonVersions', 'yanked', 'url'],
    func: args => releasesPyPI(args),
});
