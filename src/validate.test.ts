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
import { validateClisWithTarget } from './validate.js';

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

  it('untargeted validate does not flag the checked-out repo (currently in sync)', () => {
    // This repo's plugins/*/webcmd-plugin.json are all registered in the
    // root webcmd-plugin.json today — regression guard for #222: an
    // untargeted `webcmd validate` should stay clean, and only add a
    // "(webcmd-plugin.json)" row if drift is introduced.
    const report = validateClisWithTarget([]);
    const pluginRow = report.results.find(r => r.label === '(webcmd-plugin.json)');
    expect(pluginRow).toBeUndefined();
  });

  it('targeted validate does not run the repo-wide plugin-registration check', () => {
    const report = validateClisWithTarget([], 'validate-allowlist-test/all-steps');
    const pluginRow = report.results.find(r => r.label === '(webcmd-plugin.json)');
    expect(pluginRow).toBeUndefined();
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
