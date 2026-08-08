import { describe, it, expect } from 'vitest';
import {
  analyzeSite,
  buildAdapterHints,
  detectAntiBot,
  classifyPattern,
  findNearestAdapter,
  scoreEndpointEvidence,
  scoreNetworkEvidence,
  type PageSignals,
} from './analyze.js';
import type { CliCommand } from '../registry.js';

function mkSignals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    cookieNames: [],
    networkEntries: [],
    initialState: {
      __INITIAL_STATE__: false,
      __NUXT__: false,
      __NEXT_DATA__: false,
      __APOLLO_STATE__: false,
    },
    title: 'Example',
    ...overrides,
  };
}

function mkCmd(site: string, name: string, domain?: string): CliCommand {
  return {
    site,
    name,
    access: 'read',
    description: '',
    domain,
    browser: false,
    args: [],
  };
}

describe('detectAntiBot', () => {
  it('flags Aliyun WAF from cookie', () => {
    const v = detectAntiBot(mkSignals({ cookieNames: ['JSESSIONID', 'acw_sc__v2'] }));
    expect(v.detected).toBe(true);
    expect(v.vendor).toBe('aliyun_waf');
    expect(v.evidence).toContain('cookie:acw_sc__v2');
    expect(v.implication).toMatch(/browser context/i);
  });

  it('flags Aliyun WAF from challenge HTML body', () => {
    const v = detectAntiBot(
      mkSignals({
        networkEntries: [
          {
            url: 'https://x.com/',
            status: 200,
            contentType: 'text/html',
            bodyPreview: "var arg1 = 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6';",
          },
        ],
      }),
    );
    expect(v.detected).toBe(true);
    expect(v.vendor).toBe('aliyun_waf');
  });

  it('flags Cloudflare from cf_clearance cookie', () => {
    const v = detectAntiBot(mkSignals({ cookieNames: ['cf_clearance'] }));
    expect(v.vendor).toBe('cloudflare');
    expect(v.implication).toMatch(/Cloudflare/i);
  });

  it('flags Akamai from _abck cookie', () => {
    const v = detectAntiBot(mkSignals({ cookieNames: ['_abck', 'bm_sz'] }));
    expect(v.vendor).toBe('akamai');
  });

  it('returns no-match verdict with actionable fallback advice', () => {
    const v = detectAntiBot(mkSignals());
    expect(v.detected).toBe(false);
    expect(v.vendor).toBeNull();
    expect(v.implication).toMatch(/Node-side COOKIE fetch first/);
  });
});

describe('classifyPattern', () => {
  it('returns A for JSON-heavy pages without SSR state', () => {
    const v = classifyPattern(
      mkSignals({
        networkEntries: [
          { url: 'https://x.com/api/a', status: 200, contentType: 'application/json', bodyPreview: '{"items":[{"title":"A","id":"1"}]}' },
          { url: 'https://x.com/api/b', status: 200, contentType: 'application/json;charset=utf-8', bodyPreview: '{"data":{"results":[{"name":"B","url":"/b"}]}}' },
        ],
      }),
    );
    expect(v.pattern).toBe('A');
    expect(v.json_responses).toBe(2);
    expect(v.real_data_candidates).toBe(2);
  });

  it('does not call analytics JSON a real API pattern', () => {
    const v = classifyPattern(
      mkSignals({
        networkEntries: [
          { url: 'https://x.com/analytics/collect', status: 200, contentType: 'application/json', bodyPreview: '{"event":"view","clientId":"abc","experiment":"A"}' },
          { url: 'https://x.com/personalization', status: 200, contentType: 'application/json', bodyPreview: '{"sessionId":"s1","metrics":{"latency":12}}' },
        ],
      }),
    );
    expect(v.pattern).toBe('C');
    expect(v.json_responses).toBe(2);
    expect(v.real_data_candidates).toBe(0);
    expect(v.reason).toMatch(/telemetry|side-channel/);
  });

  it('returns B when __INITIAL_STATE__ is present, beating JSON signals', () => {
    const v = classifyPattern(
      mkSignals({
        initialState: { __INITIAL_STATE__: true, __NUXT__: false, __NEXT_DATA__: false, __APOLLO_STATE__: false },
        networkEntries: [
          { url: 'https://x.com/api/a', status: 200, contentType: 'application/json', bodyPreview: '{}' },
        ],
      }),
    );
    expect(v.pattern).toBe('B');
  });

  it('returns D when auth failures dominate', () => {
    const v = classifyPattern(
      mkSignals({
        networkEntries: [
          { url: 'https://x.com/api/a', status: 401, contentType: 'application/json', bodyPreview: '' },
          { url: 'https://x.com/api/b', status: 403, contentType: 'application/json', bodyPreview: '' },
        ],
      }),
    );
    expect(v.pattern).toBe('D');
    expect(v.auth_failures).toBe(2);
  });

  it('returns C by default for static pages', () => {
    const v = classifyPattern(mkSignals());
    expect(v.pattern).toBe('C');
  });
});

describe('scoreEndpointEvidence', () => {
  it('scores non-empty business JSON above telemetry side-channel JSON', () => {
    const data = scoreEndpointEvidence({
      url: 'https://x.com/api/search',
      status: 200,
      contentType: 'application/json',
      bodyPreview: '{"data":{"items":[{"title":"A","price":12,"url":"/a"}],"total":1}}',
    });
    const telemetry = scoreEndpointEvidence({
      url: 'https://x.com/analytics/collect',
      status: 200,
      contentType: 'application/json',
      bodyPreview: '{"event":"view","clientId":"abc"}',
    });

    expect(data.verdict).toBe('likely_data');
    expect(data.real_data_score).toBeGreaterThan(telemetry.real_data_score);
    expect(data.sample_paths).toContain('$.data.items:array(1)');
    expect(telemetry.verdict).toBe('noise');
  });

  it('marks auth-gated JSON as blocked rather than data', () => {
    const evidence = scoreEndpointEvidence({
      url: 'https://x.com/api/private',
      status: 403,
      contentType: 'application/json',
      bodyPreview: '{"error":"forbidden"}',
    });

    expect(evidence.verdict).toBe('blocked');
    expect(evidence.real_data_score).toBeLessThan(0.1);
  });
});

describe('findNearestAdapter', () => {
  it('matches by domain suffix', () => {
    const reg = new Map<string, CliCommand>([
      ['github search', mkCmd('github', 'search', 'github.com')],
      ['github auth', mkCmd('github', 'auth', 'github.com')],
      ['linkedin search', mkCmd('linkedin', 'search', 'linkedin.com')],
    ]);
    const v = findNearestAdapter('https://docs.github.com/', reg);
    expect(v?.site).toBe('github');
    expect(v?.example_commands).toContain('github search');
  });

  it('falls back to site-name containment when no domain is registered', () => {
    const reg = new Map<string, CliCommand>([
      ['github search', mkCmd('github', 'search')],
    ]);
    const v = findNearestAdapter('https://gist.github.com/', reg);
    expect(v?.site).toBe('github');
  });

  it('returns null when no adapter matches', () => {
    const reg = new Map<string, CliCommand>([
      ['github search', mkCmd('github', 'search', 'github.com')],
    ]);
    const v = findNearestAdapter('https://random-site.io/', reg);
    expect(v).toBeNull();
  });

  it('prefers the site with the most commands', () => {
    const reg = new Map<string, CliCommand>([
      ['a search', mkCmd('a', 'search', 'a.com')],
      ['b search', mkCmd('b', 'search', 'a.com')],
      ['b detail', mkCmd('b', 'detail', 'a.com')],
      ['b company', mkCmd('b', 'company', 'a.com')],
    ]);
    const v = findNearestAdapter('https://jobs.a.com/', reg);
    expect(v?.site).toBe('b');
  });
});

describe('analyzeSite', () => {
  it('recommends browser-context fetch when WAF is detected', () => {
    const report = analyzeSite(
      mkSignals({ cookieNames: ['acw_sc__v2'] }),
      new Map(),
    );
    expect(report.anti_bot.vendor).toBe('aliyun_waf');
    expect(report.recommended_next_step).toMatch(/browser context/i);
  });

  it('recommends reading SSR state when Pattern B fires', () => {
    const report = analyzeSite(
      mkSignals({
        initialState: { __INITIAL_STATE__: false, __NUXT__: true, __NEXT_DATA__: false, __APOLLO_STATE__: false },
      }),
      new Map(),
    );
    expect(report.pattern.pattern).toBe('B');
    expect(report.recommended_next_step).toMatch(/__NUXT__|__INITIAL_STATE__|__NEXT_DATA__/);
  });

  it('includes __APOLLO_STATE__ in Pattern B next-step guidance', () => {
    const report = analyzeSite(
      mkSignals({
        initialState: { __INITIAL_STATE__: false, __NUXT__: false, __NEXT_DATA__: false, __APOLLO_STATE__: true },
      }),
      new Map(),
    );
    expect(report.pattern.pattern).toBe('B');
    expect(report.recommended_next_step).toMatch(/__APOLLO_STATE__/);
  });

  it('includes nearest_adapter when the registry has a match', () => {
    const reg = new Map<string, CliCommand>([
      ['github search', mkCmd('github', 'search', 'github.com')],
    ]);
    const report = analyzeSite(
      mkSignals({ finalUrl: 'https://github.com/features/actions' }),
      reg,
    );
    expect(report.nearest_adapter?.site).toBe('github');
  });

  it('always includes adapter_hints with the Playwright boundary notice', () => {
    const report = analyzeSite(mkSignals(), new Map());
    expect(report.adapter_hints.do_not_copy_playwright_notice).toMatch(/not adapter source/i);
    expect(report.adapter_hints.network_evidence).toEqual(report.api_candidates);
  });
});

describe('buildAdapterHints', () => {
  it('recommends PUBLIC_API for Pattern A with no anti-bot signal', () => {
    const signals = mkSignals({
      networkEntries: [
        { url: 'https://x.com/api/a', status: 200, contentType: 'application/json', bodyPreview: '{"items":[{"title":"A","id":"1"}]}' },
      ],
    });
    const pattern = classifyPattern(signals);
    const antiBot = detectAntiBot(signals);
    const hints = buildAdapterHints(signals, pattern, antiBot, scoreNetworkEvidence(signals));
    expect(hints.recommended_strategy).toBe('PUBLIC_API');
    expect(hints.adapter_compatible_path).toMatch(/Strategy\.PUBLIC.*browser:false/);
    expect(hints.state_hazards).toEqual([]);
  });

  it('recommends COOKIE_API and flags the hazard for Pattern A behind a WAF', () => {
    const signals = mkSignals({
      cookieNames: ['acw_sc__v2'],
      networkEntries: [
        { url: 'https://x.com/api/a', status: 200, contentType: 'application/json', bodyPreview: '{"items":[{"title":"A","id":"1"}]}' },
      ],
    });
    const pattern = classifyPattern(signals);
    const antiBot = detectAntiBot(signals);
    const hints = buildAdapterHints(signals, pattern, antiBot, scoreNetworkEvidence(signals));
    expect(hints.recommended_strategy).toBe('COOKIE_API');
    expect(hints.state_hazards.some((h) => /aliyun_waf/i.test(h))).toBe(true);
  });

  it('recommends DOM_STATE for Pattern B', () => {
    const signals = mkSignals({
      initialState: { __INITIAL_STATE__: true, __NUXT__: false, __NEXT_DATA__: false, __APOLLO_STATE__: false },
    });
    const pattern = classifyPattern(signals);
    const antiBot = detectAntiBot(signals);
    const hints = buildAdapterHints(signals, pattern, antiBot, scoreNetworkEvidence(signals));
    expect(hints.recommended_strategy).toBe('DOM_STATE');
    expect(hints.adapter_compatible_path).toMatch(/page\.evaluate/);
  });

  it('recommends COOKIE_API and flags the auth hazard for Pattern D', () => {
    const signals = mkSignals({
      networkEntries: [
        { url: 'https://x.com/api/a', status: 401, contentType: 'application/json', bodyPreview: '' },
        { url: 'https://x.com/api/b', status: 403, contentType: 'application/json', bodyPreview: '' },
      ],
    });
    const pattern = classifyPattern(signals);
    const antiBot = detectAntiBot(signals);
    const hints = buildAdapterHints(signals, pattern, antiBot, scoreNetworkEvidence(signals));
    expect(hints.recommended_strategy).toBe('COOKIE_API');
    expect(hints.state_hazards.some((h) => /401\/403/.test(h))).toBe(true);
  });

  it('recommends UI_SELECTOR and points at the snapshot tool for Pattern C', () => {
    const signals = mkSignals();
    const pattern = classifyPattern(signals);
    const antiBot = detectAntiBot(signals);
    const hints = buildAdapterHints(signals, pattern, antiBot, scoreNetworkEvidence(signals));
    expect(pattern.pattern).toBe('C');
    expect(hints.recommended_strategy).toBe('UI_SELECTOR');
    expect(hints.selector_evidence).toMatch(/browser <session> snapshot/);
  });

  it('recommends INTERCEPT and flags the WS hazard for Pattern E', () => {
    const signals = mkSignals();
    const pattern = { pattern: 'E' as const, reason: 'WS traffic observed', json_responses: 0, real_data_candidates: 0, auth_failures: 0 };
    const antiBot = detectAntiBot(signals);
    const hints = buildAdapterHints(signals, pattern, antiBot, scoreNetworkEvidence(signals));
    expect(hints.recommended_strategy).toBe('INTERCEPT');
    expect(hints.state_hazards.some((h) => /WebSocket/.test(h))).toBe(true);
  });

  it('always carries the fixed do-not-copy-Playwright notice regardless of strategy', () => {
    const signals = mkSignals();
    const pattern = classifyPattern(signals);
    const antiBot = detectAntiBot(signals);
    const hints = buildAdapterHints(signals, pattern, antiBot, scoreNetworkEvidence(signals));
    expect(hints.do_not_copy_playwright_notice).toMatch(/never paste Playwright locators/i);
  });
});
