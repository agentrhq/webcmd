// npm versions — list published versions for a package, newest first.
//
// Hits `https://registry.npmjs.org/<pkg>` and projects `time` entries so
// agents can answer "when was X released?" or "what's the latest stable?".
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { NPM_REGISTRY, npmFetch, requireBoundedInt, requirePackageName } from './utils.js';

export async function versionsNpm(args) {
    const name = requirePackageName(args.name);
    const limit = requireBoundedInt(args.limit ?? 10, 10, 50);
    const url = `${NPM_REGISTRY}/${name.split('/').map(encodeURIComponent).join('/')}`;
    const body = await npmFetch(url, `npm versions ${name}`);

    const timeMap = body?.time && typeof body.time === 'object' ? body.time : {};
    const versionsMap = body?.versions && typeof body.versions === 'object' ? body.versions : {};
    const latest = body?.['dist-tags']?.latest ?? '';

    const rows = Object.entries(timeMap)
        // skip internal bookkeeping keys that npm puts in time
        .filter(([version]) => version !== 'created' && version !== 'modified')
        // only keep versions that actually exist in body.versions — time-only
        // keys (e.g. unpublished entries) have no real release and must be omitted
        .filter(([version, publishedAt]) => version in versionsMap && typeof publishedAt === 'string')
        .filter(([version]) => !version.includes('-'))
        // sort on the raw full ISO timestamp BEFORE formatting so that two
        // versions published on the same calendar date still sort correctly
        .sort(([, left], [, right]) => String(right ?? '').localeCompare(String(left ?? '')))
        .slice(0, limit)
        .map(([version, publishedAt]) => ({
            version,
            publishedAt: String(publishedAt ?? '').slice(0, 10),
            isLatest: version === latest,
            url: `https://www.npmjs.com/package/${name}/v/${version}`,
        }));

    if (!rows.length) {
        throw new EmptyResultError('npm versions', `npm registry has no version history for "${name}".`);
    }
    return rows;
}

cli({
    site: 'npm',
    name: 'versions',
    access: 'read',
    description: 'List published versions of an npm package, newest first',
    domain: 'registry.npmjs.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'npm package name (e.g. "react", "@vercel/og")' },
        { name: 'limit', type: 'int', default: 10, help: 'Maximum versions to return (1-50)' },
    ],
    columns: ['version', 'publishedAt', 'isLatest', 'url'],
    func: (args) => versionsNpm(args),
});
