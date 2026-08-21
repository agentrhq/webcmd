import { CLI_COMMAND } from './brand.js';

export const PLUGIN_SEARCH_KIND = 'plugin-catalog' as const;
export const PLUGIN_SEARCH_SCOPE = 'installable marketplace plugins matched against name and description';

export interface PluginSearchPresentation<TPlugin, TError> {
  kind: typeof PLUGIN_SEARCH_KIND;
  query: string | null;
  total: number;
  scope: string;
  plugins: TPlugin[];
  errors: TError[];
  hint?: string;
}

export function presentPluginSearch<TPlugin, TError>(
  result: { plugins: TPlugin[]; errors: TError[] },
  query?: string,
): PluginSearchPresentation<TPlugin, TError> {
  const normalizedQuery = query?.trim() || null;
  const presented: PluginSearchPresentation<TPlugin, TError> = {
    kind: PLUGIN_SEARCH_KIND,
    query: normalizedQuery,
    total: result.plugins.length,
    scope: PLUGIN_SEARCH_SCOPE,
    plugins: result.plugins,
    errors: result.errors,
  };
  if (presented.total === 0) presented.hint = pluginSearchWebResearchHint(normalizedQuery);
  return presented;
}

export function formatPluginSearchEmptyCopy(query: string | null): string {
  const matched = query ? `"${query}"` : 'the catalog';
  return [
    `No marketplace plugins matched ${matched}. This command searches the plugin catalog, not the web.`,
    pluginSearchWebResearchHint(query),
  ].join('\n');
}

export function pluginSearchWebResearchHint(query: string | null): string {
  const encoded = query ? encodeURIComponent(query) : '<query>';
  return `${CLI_COMMAND} plugin search finds plugins to install, not web pages. For web research: ${CLI_COMMAND} web fetch --url "https://html.duckduckgo.com/html/?q=${encoded}"`;
}
