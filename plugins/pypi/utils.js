import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const PYPI_BASE = 'https://pypi.org';
export const PYPISTATS_BASE = 'https://pypistats.org';
const PACKAGE_URL_BASE = `${PYPI_BASE}/project`;
const MAX_RELEASE_LIMIT = 50;
const USER_AGENT = 'webcmd-pypi-adapter (+https://github.com/agentrhq/webcmd)';
const PACKAGE_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function requirePackageName(value) {
    const name = String(value ?? '').trim();
    if (!name) throw new ArgumentError('pypi package name is required (e.g. "requests", "pandas")');
    if (name.length > 214 || !PACKAGE_NAME.test(name)) {
        throw new ArgumentError(
            `pypi package name "${value}" is not a valid distribution name`,
            'PyPI accepts ASCII letters / digits / "._-" with no leading or trailing separator.',
        );
    }
    return name;
}

export async function pypiFetch(url, label, request = fetch) {
    let response;
    try {
        response = await request(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    } catch (error) {
        throw new CommandExecutionError(
            `${label} request failed: ${error?.message ?? error}`,
            'Check that pypi.org / pypistats.org are reachable from this network.',
        );
    }
    if (response.status === 404) {
        throw new EmptyResultError(label, `PyPI returned 404 for ${url}.`);
    }
    if (response.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'PyPI throttles unauthenticated bursts; wait a few seconds and retry.',
        );
    }
    if (!response.ok) throw new CommandExecutionError(`${label} returned HTTP ${response.status}`);
    try {
        return await response.json();
    } catch (error) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${error?.message ?? error}`);
    }
}

export function parseLimit(raw, fallback = 10) {
    const value = raw === undefined || raw === null || raw === '' ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > MAX_RELEASE_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_RELEASE_LIMIT}`);
    }
    return value;
}

function latestUploadTime(files) {
    return files
        .map(file => file?.upload_time_iso_8601 || file?.upload_time || null)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
}

export function summarizeReleases(payload, limit) {
    const name = String(payload.info?.name || '').trim();
    const releases = payload.releases && typeof payload.releases === 'object' ? payload.releases : {};
    const rows = Object.entries(releases)
        .map(([version, files]) => {
            const versionFiles = Array.isArray(files) ? files : [];
            return {
                version,
                uploadedAt: latestUploadTime(versionFiles),
                fileCount: versionFiles.length,
                pythonVersions: [...new Set(versionFiles.map(file => file?.python_version).filter(Boolean))].join(', ') || null,
                yanked: versionFiles.length > 0 && versionFiles.every(file => file?.yanked === true),
                url: `${PACKAGE_URL_BASE}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/`,
            };
        })
        .filter(row => row.uploadedAt)
        .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
        .slice(0, limit);

    if (!rows.length) {
        throw new EmptyResultError('pypi releases', `PyPI returned no release files for "${name}".`);
    }
    return rows;
}

export async function fetchPackageJson(name, request = fetch) {
    const packageName = requirePackageName(name);
    const payload = await pypiFetch(`${PYPI_BASE}/pypi/${encodeURIComponent(packageName)}/json`, `pypi package ${packageName}`, request);
    if (!payload || typeof payload !== 'object' || !payload.info) {
        throw new CommandExecutionError('PyPI returned an unexpected response.');
    }
    return payload;
}
