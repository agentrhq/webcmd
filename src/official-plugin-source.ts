const LEGACY_GITHUB = /^github:agentrhq\/webcmd(?:\/([\w.-]+))?$/;
const LEGACY_HTTPS = /^https:\/\/github\.com\/agentrhq\/webcmd(?:\.git)?$/;
const CANONICAL_GITHUB = 'github:agentrhq/webcmd-plugins';
const CANONICAL_CLONE = 'https://github.com/agentrhq/webcmd-plugins.git';

export function normalizeOfficialPluginSource(source: string): string {
  const github = LEGACY_GITHUB.exec(source);
  if (github) {
    return github[1] ? `${CANONICAL_GITHUB}/${github[1]}` : CANONICAL_GITHUB;
  }
  if (LEGACY_HTTPS.test(source)) return CANONICAL_CLONE;
  return source;
}

export function normalizeOfficialCatalogSource<T extends { id: string; source: string; manifestUrl: string }>(entry: T): T {
  const source = normalizeOfficialPluginSource(entry.source);
  if (source === entry.source) return entry;
  const parsed = /^github:([\w.-]+)\/([\w.-]+)$/.exec(source);
  if (!parsed) return { ...entry, source };
  const [, owner, repo] = parsed;
  return {
    ...entry,
    id: `${owner}/${repo}`,
    source,
    manifestUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/webcmd-plugin.json`,
  };
}
