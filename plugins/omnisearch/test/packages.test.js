import assert from 'node:assert/strict';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import '../packages.js';

afterEach(() => vi.unstubAllGlobals());

// Mock payloads
const NPM_PAYLOAD = {
  objects: [
    {
      package: {
        name: 'lodash',
        version: '4.17.21',
        description: 'Lodash utilities',
        links: { npm: 'https://www.npmjs.com/package/lodash' },
      },
    },
  ],
};

const CRATES_PAYLOAD = {
  crates: [
    {
      name: 'serde',
      max_version: '1.0.152',
      description: 'A generic serialization/deserialization framework',
    },
  ],
};

const NUGET_PAYLOAD = {
  data: [
    {
      id: 'Newtonsoft.Json',
      version: '13.0.1',
      description: 'Json.NET is a popular high-performance JSON framework',
    },
  ],
};

const RUBYGEMS_PAYLOAD = [
  {
    name: 'rails',
    version: '7.0.4',
    info: 'Ruby on Rails is a full-stack web framework',
  },
];

const PACKAGIST_PAYLOAD = {
  results: [
    {
      name: 'monolog/monolog',
      description: 'Sends your logs to files, sockets, inboxes, databases',
      url: 'https://packagist.org/packages/monolog/monolog',
    },
  ],
};

const MAVEN_PAYLOAD = {
  response: {
    docs: [
      {
        g: 'com.google.guava',
        a: 'guava',
        latestVersion: '31.1-jre',
        p: 'jar',
      },
    ],
  },
};

function stubRegistryFetch(handler) {
  vi.stubGlobal('fetch', async (url) => {
    const resBody = handler(String(url));
    if (!resBody) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(JSON.stringify(resBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('omnisearch packages integration', () => {
  it('queries all registries and returns a unified schema by default', async () => {
    stubRegistryFetch((url) => {
      if (url.includes('registry.npmjs.org')) return NPM_PAYLOAD;
      if (url.includes('crates.io')) return CRATES_PAYLOAD;
      if (url.includes('nuget.org')) return NUGET_PAYLOAD;
      if (url.includes('rubygems.org')) return RUBYGEMS_PAYLOAD;
      if (url.includes('packagist.org')) return PACKAGIST_PAYLOAD;
      if (url.includes('search.maven.org')) return MAVEN_PAYLOAD;
      return null;
    });

    const command = getRegistry().get('omnisearch/packages');
    const rows = await command.func({ query: 'test', limit: 6 });

    expect(rows).toHaveLength(6);

    // npm
    const npmRow = rows.find((r) => r.registry === 'npm');
    expect(npmRow).toBeDefined();
    expect(npmRow.name).toBe('lodash');
    expect(npmRow.version).toBe('4.17.21');
    expect(npmRow.description).toBe('Lodash utilities');
    expect(npmRow.url).toBe('https://www.npmjs.com/package/lodash');

    // crates
    const cratesRow = rows.find((r) => r.registry === 'crates');
    expect(cratesRow).toBeDefined();
    expect(cratesRow.name).toBe('serde');
    expect(cratesRow.version).toBe('1.0.152');
    expect(cratesRow.description).toContain('serialization');
    expect(cratesRow.url).toBe('https://crates.io/crates/serde');

    // nuget
    const nugetRow = rows.find((r) => r.registry === 'nuget');
    expect(nugetRow).toBeDefined();
    expect(nugetRow.name).toBe('Newtonsoft.Json');
    expect(nugetRow.version).toBe('13.0.1');
    expect(nugetRow.url).toBe('https://www.nuget.org/packages/Newtonsoft.Json');

    // rubygems
    const rubygemsRow = rows.find((r) => r.registry === 'rubygems');
    expect(rubygemsRow).toBeDefined();
    expect(rubygemsRow.name).toBe('rails');
    expect(rubygemsRow.version).toBe('7.0.4');

    // packagist
    const packagistRow = rows.find((r) => r.registry === 'packagist');
    expect(packagistRow).toBeDefined();
    expect(packagistRow.name).toBe('monolog/monolog');
    expect(packagistRow.url).toBe('https://packagist.org/packages/monolog/monolog');

    // maven
    const mavenRow = rows.find((r) => r.registry === 'maven');
    expect(mavenRow).toBeDefined();
    expect(mavenRow.name).toBe('com.google.guava:guava');
    expect(mavenRow.version).toBe('31.1-jre');
  });

  it('respects the registries filter', async () => {
    stubRegistryFetch((url) => {
      if (url.includes('registry.npmjs.org')) return NPM_PAYLOAD;
      if (url.includes('crates.io')) return CRATES_PAYLOAD;
      return null;
    });

    const command = getRegistry().get('omnisearch/packages');
    const rows = await command.func({ query: 'json', limit: 10, registries: 'npm,crates' });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.registry).sort()).toEqual(['crates', 'npm']);
  });

  it('respects total limit', async () => {
    stubRegistryFetch((url) => {
      if (url.includes('registry.npmjs.org')) return NPM_PAYLOAD;
      if (url.includes('crates.io')) return CRATES_PAYLOAD;
      return null;
    });

    const command = getRegistry().get('omnisearch/packages');
    const rows = await command.func({ query: 'json', limit: 1, registries: 'npm,crates' });

    expect(rows).toHaveLength(1);
  });

  it('tolerates failure of one or more registries (failure isolation)', async () => {
    vi.stubGlobal('fetch', async (url) => {
      if (url.includes('registry.npmjs.org')) {
        return new Response('Rate Limited', { status: 429 });
      }
      if (url.includes('crates.io')) {
        return new Response(JSON.stringify(CRATES_PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    const command = getRegistry().get('omnisearch/packages');
    // Even though npm failed (429), crates.io succeeded, so we still get results
    const rows = await command.func({ query: 'json', limit: 5, registries: 'npm,crates' });
    expect(rows).toHaveLength(1);
    expect(rows[0].registry).toBe('crates');
    expect(rows[0].name).toBe('serde');
  });

  it('is registered as browser: false', () => {
    const command = getRegistry().get('omnisearch/packages');
    expect(command).toBeDefined();
    expect(command.browser).toBe(false);
  });

  it('passes a 10-second timeout AbortSignal to fetch', async () => {
    let passedSignal = null;
    vi.stubGlobal('fetch', async (url, init) => {
      passedSignal = init?.signal;
      return new Response(JSON.stringify(NPM_PAYLOAD), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const command = getRegistry().get('omnisearch/packages');
    await command.func({ query: 'lodash', limit: 1, registries: 'npm' });

    expect(passedSignal).toBeInstanceOf(AbortSignal);
  });
});
