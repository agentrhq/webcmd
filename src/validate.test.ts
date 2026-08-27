/**
 * Tests for src/validate.ts.
 *
 * Focus: regression guards for the "single source of truth" link between
 * pipeline step registry (src/pipeline/registry.ts) and validate.ts step
 * allowlist. A new step registered via `registerStep()` must automatically
 * be allowlisted by `webcmd validate` — no parallel hand-maintained list.
 */

import { describe, it, expect } from 'vitest';
import { getRegisteredStepNames, registerStep } from './pipeline/registry.js';
import { cli, getRegistry, Strategy } from './registry.js';
import { ArgumentError } from './errors.js';
import { validateClisWithTarget } from './validate.js';

function registerValidateFixture(site: string, name: string, aliases?: string[]): void {
  cli({
    site,
    name,
    ...(aliases ? { aliases } : {}),
    access: 'read',
    browser: false,
    strategy: Strategy.PUBLIC,
    args: [],
    func: async () => [],
  });
}

function withValidateFixtures<T>(keys: string[], run: () => T): T {
  const reg = getRegistry();
  const originals = keys.map(key => [key, reg.get(key)] as const);
  for (const key of keys) reg.delete(key);
  try {
    return run();
  } finally {
    for (const key of keys) reg.delete(key);
    for (const [key, original] of originals) {
      if (original) reg.set(key, original);
    }
  }
}

describe('validate.ts pipeline step allowlist', () => {
  it('uses every step name registered in pipeline/registry.ts', () => {
    const registered = getRegisteredStepNames();
    expect(registered).toContain('navigate');
    expect(registered).toContain('click');
    expect(registered).toContain('type');
    expect(registered).toContain('fill');
    expect(registered).toContain('fetch');
    expect(registered.length).toBeGreaterThanOrEqual(15);
  });

  it('does not warn for any step name currently registered in the pipeline registry', () => {
    // Snapshot the registry before mutating it for the test.
    const reg = getRegistry();
    const original = reg.get('validate-allowlist-test/all-steps');
    if (original) reg.delete('validate-allowlist-test/all-steps');

    const allRegisteredSteps = getRegisteredStepNames();
    cli({
      site: 'validate-allowlist-test',
      name: 'all-steps',
      access: 'read',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [],
      pipeline: allRegisteredSteps.map(stepName => ({ [stepName]: {} })),
      func: async () => [],
    });

    try {
      const report = validateClisWithTarget([], 'validate-allowlist-test/all-steps');
      const r = report.results[0];
      const unknownStepWarning = r.warnings.find(w => w.startsWith('Pipeline step '));
      expect(unknownStepWarning).toBeUndefined();
    } finally {
      reg.delete('validate-allowlist-test/all-steps');
      if (original) reg.set('validate-allowlist-test/all-steps', original);
    }
  });

  it('newly registered step automatically appears in validator allowlist', () => {
    const customStep = '__test_custom_step__';
    expect(getRegisteredStepNames()).not.toContain(customStep);

    registerStep(customStep, async (_p, _params, data) => data);

    try {
      expect(getRegisteredStepNames()).toContain(customStep);

      const reg = getRegistry();
      const original = reg.get('validate-dynamic-test/uses-custom');
      if (original) reg.delete('validate-dynamic-test/uses-custom');

      cli({
        site: 'validate-dynamic-test',
        name: 'uses-custom',
        access: 'read',
        browser: false,
        strategy: Strategy.PUBLIC,
        args: [],
        pipeline: [{ [customStep]: {} }],
        func: async () => [],
      });

      try {
        const report = validateClisWithTarget([], 'validate-dynamic-test/uses-custom');
        const r = report.results[0];
        const unknownStepWarning = r.warnings.find(w => w.includes(customStep));
        expect(unknownStepWarning).toBeUndefined();
      } finally {
        reg.delete('validate-dynamic-test/uses-custom');
        if (original) reg.set('validate-dynamic-test/uses-custom', original);
      }
    } finally {
      // Best-effort cleanup of the test step. There is no `unregisterStep` —
      // leaving it registered is harmless because the test step name is
      // namespaced and never used outside this file.
    }
  });
});

describe('validateClisWithTarget unknown target', () => {
  it('rejects an unknown site instead of passing zero commands', () => {
    const site = 'validate-unknown-site';
    const key = `${site}/search`;
    withValidateFixtures([key], () => {
      registerValidateFixture(site, 'search');

      let thrown: unknown;
      try {
        validateClisWithTarget([], 'nope');
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ArgumentError);
      const error = thrown as ArgumentError;
      expect(error.exitCode).toBe(2);
      expect(error.message).toContain('No command matches "nope"');
      expect(error.message).toContain(`Valid sites:`);
      expect(error.message).toContain(site);
      expect(error.hint).toContain('usage: webcmd validate <site|site/name>');
      expect(error.hint).toMatch(/example: webcmd validate /);
    });
  });

  it('enumerates commands when the site exists but the command does not', () => {
    const site = 'validate-unknown-cmd';
    const keys = [`${site}/search`, `${site}/synonyms`];
    withValidateFixtures(keys, () => {
      registerValidateFixture(site, 'search');
      registerValidateFixture(site, 'synonyms');

      expect(() => validateClisWithTarget([], `${site}/nope`)).toThrow(ArgumentError);
      try {
        validateClisWithTarget([], `${site}/nope`);
      } catch (err) {
        expect(err).toBeInstanceOf(ArgumentError);
        expect((err as ArgumentError).message).toBe(
          `No command matches "${site}/nope". Valid commands for ${site}: search, synonyms`,
        );
        expect((err as ArgumentError).hint).toBe(
          `usage: webcmd validate <site|site/name>\nexample: webcmd validate ${site}/search`,
        );
      }
    });
  });

  it('still validates an alias target after resolving it', () => {
    const site = 'validate-alias-target';
    const keys = [`${site}/search`, `${site}/find`];
    withValidateFixtures(keys, () => {
      registerValidateFixture(site, 'search', ['find']);
      const report = validateClisWithTarget([], `${site}/find`);
      expect(report.ok).toBe(true);
      expect(report.commands).toBe(1);
      expect(report.results[0]?.label).toBe(`${site}/search`);
    });
  });

  it('still validates a known site', () => {
    const site = 'validate-known-site';
    const key = `${site}/search`;
    withValidateFixtures([key], () => {
      registerValidateFixture(site, 'search');
      const report = validateClisWithTarget([], site);
      expect(report).toEqual({
        ok: true,
        results: [{ label: `${site}/search`, errors: [], warnings: ['Missing description'] }],
        errors: 0,
        warnings: 1,
        commands: 1,
      });
    });
  });
});
