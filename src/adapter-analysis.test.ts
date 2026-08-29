import { describe, expect, it, vi } from 'vitest';
import {
  auditAdapterConventions,
  validateAdapterCommands,
  type AdapterAnalysisCommand,
} from './adapter-analysis.js';

const command: AdapterAnalysisCommand = {
  site: 'demo',
  name: 'list',
  command: 'demo/list',
  description: 'List demos',
  access: 'read',
  browser: false,
  args: [{ name: 'limit' }],
  columns: ['item_id'],
  pipeline: [{ fetch: { url: 'https://example.com' } }],
  runnable: true,
  sourceFile: 'plugins/demo/clis/demo/list.js',
};

describe('public adapter analysis', () => {
  it('validates supplied commands and step names without registry discovery', () => {
    expect(validateAdapterCommands([command], { knownPipelineSteps: ['fetch'] })).toEqual({
      ok: true,
      results: [{ label: 'demo/list', errors: [], warnings: [] }],
      errors: 0,
      warnings: 0,
      commands: 1,
    });
  });

  it('passes only the logical package-relative path to the source reader', () => {
    const readSource = vi.fn(() => 'const row = { item_id: "a", hidden: true };');
    const report = auditAdapterConventions([command], { readSource });
    expect(readSource).toHaveBeenCalledWith('plugins/demo/clis/demo/list.js');
    expect(report.categories.find(category => category.rule === 'silent-column-drop')?.count).toBe(1);
    expect(report.categories.flatMap(category => category.violations)[0]?.file)
      .toBe('plugins/demo/clis/demo/list.js');
  });

  it('rejects unknown targets before reading source', () => {
    const readSource = vi.fn();
    expect(() => auditAdapterConventions([command], { target: 'missing', readSource }))
      .toThrow('No command matches "missing"');
    expect(readSource).not.toHaveBeenCalled();
  });
});
