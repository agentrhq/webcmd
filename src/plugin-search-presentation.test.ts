import { describe, expect, it } from 'vitest';
import {
  formatPluginSearchEmptyCopy,
  PLUGIN_SEARCH_KIND,
  PLUGIN_SEARCH_SCOPE,
  presentPluginSearch,
} from './plugin-search-presentation.js';

describe('plugin search presentation', () => {
  it('labels every result as plugin-catalog and keeps hits additive', () => {
    const presented = presentPluginSearch({
      plugins: [{ name: 'pypi', installSource: 'github:agentrhq/webcmd/pypi' }],
      errors: [],
    }, 'pypi');

    expect(presented).toEqual({
      kind: PLUGIN_SEARCH_KIND,
      query: 'pypi',
      total: 1,
      scope: PLUGIN_SEARCH_SCOPE,
      plugins: [{ name: 'pypi', installSource: 'github:agentrhq/webcmd/pypi' }],
      errors: [],
    });
    expect(presented.hint).toBeUndefined();
  });

  it('treats an empty research query as a catalog miss with a web-fetch next command', () => {
    const presented = presentPluginSearch({ plugins: [], errors: [] }, 'tls fingerprint');

    expect(presented).toMatchObject({
      kind: PLUGIN_SEARCH_KIND,
      query: 'tls fingerprint',
      total: 0,
      plugins: [],
      errors: [],
    });
    expect(presented.hint).toContain('not web pages');
    expect(presented.hint).toContain('webcmd web fetch --url "https://html.duckduckgo.com/html/?q=tls%20fingerprint"');
  });

  it('prints table copy that cannot be read as a failed web search', () => {
    expect(formatPluginSearchEmptyCopy('ja3 tls fingerprint')).toBe([
      'No marketplace plugins matched "ja3 tls fingerprint". This command searches the plugin catalog, not the web.',
      'webcmd plugin search finds plugins to install, not web pages. For web research: webcmd web fetch --url "https://html.duckduckgo.com/html/?q=ja3%20tls%20fingerprint"',
    ].join('\n'));
  });
});
