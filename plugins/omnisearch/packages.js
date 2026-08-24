/**
 * omnisearch packages — aggregate library searches across package registries.
 *
 * Parallel-queries npm, crates.io, NuGet, RubyGems, Packagist, and Maven Central.
 * Returns normalized rows. Useful for agents checking library support/availability.
 */
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const UA = 'webcmd-omnisearch-packages (+https://github.com/agentrhq/webcmd)';

async function get(url, init, { source } = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'user-agent': UA,
        accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new CommandExecutionError(
      `OmniSearch: ${source} request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new CommandExecutionError(`OmniSearch: ${source} HTTP ${res.status}`);
  }
  return res;
}

// Fetchers
async function npmSearch(query, limit) {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`;
  const res = await get(url, {}, { source: 'npm' });
  const body = await res.json();
  const list = Array.isArray(body?.objects) ? body.objects : [];
  return list.slice(0, limit).map((item) => {
    const pkg = item?.package ?? {};
    return {
      registry: 'npm',
      name: String(pkg.name ?? ''),
      version: String(pkg.version ?? ''),
      description: String(pkg.description ?? '').trim(),
      url: pkg.links?.npm ? String(pkg.links.npm) : (pkg.name ? `https://www.npmjs.com/package/${pkg.name}` : ''),
    };
  });
}

async function cratesSearch(query, limit) {
  const url = `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=${limit}`;
  const res = await get(url, {}, { source: 'crates' });
  const body = await res.json();
  const list = Array.isArray(body?.crates) ? body.crates : [];
  return list.slice(0, limit).map((c) => ({
    registry: 'crates',
    name: String(c.name ?? c.id ?? ''),
    version: String(c.newest_version ?? c.max_stable_version ?? c.max_version ?? ''),
    description: String(c.description ?? '').trim(),
    url: c.name ? `https://crates.io/crates/${c.name}` : '',
  }));
}

async function nugetSearch(query, limit) {
  const url = `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(query)}&take=${limit}&prerelease=false`;
  const res = await get(url, {}, { source: 'nuget' });
  const body = await res.json();
  const list = Array.isArray(body?.data) ? body.data : [];
  return list.slice(0, limit).map((pkg) => ({
    registry: 'nuget',
    name: String(pkg.id ?? ''),
    version: String(pkg.version ?? ''),
    description: String(pkg.description ?? '').trim(),
    url: pkg.id ? `https://www.nuget.org/packages/${pkg.id}` : '',
  }));
}

async function rubygemsSearch(query, limit) {
  const url = `https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(query)}&page=1`;
  const res = await get(url, {}, { source: 'rubygems' });
  const body = await res.json();
  const list = Array.isArray(body) ? body : [];
  return list.slice(0, limit).map((g) => {
    const name = String(g.name ?? '').trim();
    return {
      registry: 'rubygems',
      name,
      version: String(g.version ?? '').trim(),
      description: String(g.info ?? '').trim(),
      url: name ? `https://rubygems.org/gems/${name}` : '',
    };
  });
}

async function packagistSearch(query, limit) {
  const url = `https://packagist.org/search.json?q=${encodeURIComponent(query)}&per_page=${limit}`;
  const res = await get(url, {}, { source: 'packagist' });
  const body = await res.json();
  const list = Array.isArray(body?.results) ? body.results : [];
  return list.slice(0, limit).map((row) => ({
    registry: 'packagist',
    name: String(row.name ?? '').trim(),
    version: '',
    description: String(row.description ?? '').trim(),
    url: String(row.url ?? '').trim(),
  }));
}

async function mavenSearch(query, limit) {
  const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&rows=${limit}&wt=json`;
  const res = await get(url, {}, { source: 'maven' });
  const body = await res.json();
  const list = Array.isArray(body?.response?.docs) ? body.response.docs : [];
  return list.slice(0, limit).map((d) => {
    const groupId = String(d.g ?? '').trim();
    const artifactId = String(d.a ?? '').trim();
    const coord = groupId && artifactId ? `${groupId}:${artifactId}` : '';
    return {
      registry: 'maven',
      name: coord,
      version: String(d.latestVersion ?? '').trim(),
      description: `${d.p ?? ''} package`,
      url: coord ? `https://central.sonatype.com/artifact/${groupId}/${artifactId}` : '',
    };
  });
}

function requireQuery(value) {
  const s = String(value ?? '').trim();
  if (!s) throw new ArgumentError('a search query is required');
  return s;
}

cli({
  site: 'omnisearch',
  name: 'packages',
  tags: ['search'],
  access: 'read',
  description: 'Search across 6 major package registries simultaneously (npm, Crates.io, NuGet, RubyGems, Packagist, Maven Central)',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Library name or search keyword' },
    { name: 'limit', type: 'int', default: 10, help: 'Maximum total results to return' },
    {
      name: 'registries',
      default: 'npm,crates,nuget,rubygems,packagist,maven',
      help: 'Comma-separated registries to query (default: all)',
    },
  ],
  columns: ['registry', 'name', 'version', 'description', 'url'],
  func: async (kwargs) => {
    const query = requireQuery(kwargs.query);
    const raw = Number(kwargs.limit ?? 10);
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    const limit = Math.min(raw, 50);

    const wanted = String(kwargs.registries ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const fetchers = {
      npm: () => npmSearch(query, perRegistry),
      crates: () => cratesSearch(query, perRegistry),
      nuget: () => nugetSearch(query, perRegistry),
      rubygems: () => rubygemsSearch(query, perRegistry),
      packagist: () => packagistSearch(query, perRegistry),
      maven: () => mavenSearch(query, perRegistry),
    };

    const selected = wanted.length ? wanted.filter((s) => fetchers[s]) : Object.keys(fetchers);
    const perRegistry = Math.ceil(limit / Math.max(selected.length, 1));

    let rows = [];
    try {
      // Failure isolation: one rate-limited or erroring registry must not wipe out the others.
      const outcomes = await Promise.allSettled(selected.map((key) => fetchers[key]()));
      rows = outcomes
        .filter((o) => o.status === 'fulfilled')
        .flatMap((o) => o.value);
    } catch (err) {
      throw new CommandExecutionError(`packages aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!rows.length) {
      throw new EmptyResultError('omnisearch/packages', `no packages found across registries for "${query}"`);
    }

    return rows.slice(0, limit);
  },
});
