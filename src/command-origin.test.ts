import { describe, expect, it } from 'vitest';
import { classifyCommandOrigin, formatCommandOrigin } from './command-origin.js';

const paths = { pluginsDir: '/h/.webcmd/plugins', userClisDir: '/h/.webcmd/clis' };

describe('classifyCommandOrigin', () => {
  it('classifies a plugin-registered command by plugin name', () => {
    expect(classifyCommandOrigin({ source: '/h/.webcmd/plugins/linkedin/search.js' }, paths))
      .toEqual({ kind: 'plugin', plugin: 'linkedin' });
  });

  it('classifies a user clis command with no provenance as local', () => {
    expect(classifyCommandOrigin({ source: '/h/.webcmd/clis/mysite/run.js' }, paths))
      .toEqual({ kind: 'local' });
  });

  it('classifies an unknown source as builtin', () => {
    expect(classifyCommandOrigin({ source: undefined }, paths)).toEqual({ kind: 'builtin' });
  });

  it('formats each origin', () => {
    expect(formatCommandOrigin({ kind: 'plugin', plugin: 'linkedin' })).toBe('plugin:linkedin');
    expect(formatCommandOrigin({ kind: 'override', plugin: 'linkedin' })).toBe('override:linkedin');
    expect(formatCommandOrigin({ kind: 'local' })).toBe('local');
  });
});
