import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArgumentError } from './errors.js';
import { listWebcmdSkills, readWebcmdSkill } from './skills.js';

function makePackageRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcmd-skills-'));
  fs.mkdirSync(path.join(root, 'skill-data', 'webcmd-browser', 'references'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skill-data', 'webcmd-autofix'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skill-data', 'smart-search'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@agentrhq/webcmd"}\n');
  fs.writeFileSync(path.join(root, 'skill-data', 'webcmd-browser', 'SKILL.md'), [
    '---',
    'name: webcmd-browser',
    'description: Browser control skill',
    'version: 1.2.3',
    '---',
    '',
    '# Browser',
    '',
    'Body.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'skill-data', 'webcmd-browser', 'references', 'targets.md'), '# Targets\n');
  fs.writeFileSync(path.join(root, 'skill-data', 'webcmd-autofix', 'SKILL.md'), [
    '---',
    'name: webcmd-autofix',
    'description: Fix adapters: keep scope narrow',
    '---',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'skill-data', 'smart-search', 'SKILL.md'), [
    '---',
    'name: smart-search',
    'description: Search skill',
    '---',
    '',
  ].join('\n'));
  return root;
}

describe('webcmd skills content', () => {
  it('lists bundled skills', () => {
    const root = makePackageRoot();

    expect(listWebcmdSkills(root).map((skill) => skill.name)).toEqual([
      'smart-search',
      'webcmd-autofix',
      'webcmd-browser',
    ]);
    expect(listWebcmdSkills(root).find((skill) => skill.name === 'webcmd-autofix')?.description)
      .toBe('Fix adapters: keep scope narrow');
  });

  it('reads a skill SKILL.md and reference file', () => {
    const root = makePackageRoot();

    expect(readWebcmdSkill('webcmd-browser', '', root)).toMatchObject({
      skill: 'webcmd-browser',
      path: 'SKILL.md',
    });
    expect(readWebcmdSkill('webcmd-browser/references/targets.md', '', root)).toMatchObject({
      skill: 'webcmd-browser',
      path: 'references/targets.md',
      content: '# Targets\n',
    });
    expect(readWebcmdSkill('webcmd-browser', 'references/targets.md', root).content).toBe('# Targets\n');
  });

  it('rejects unknown skills and path traversal', () => {
    const root = makePackageRoot();

    expect(readWebcmdSkill('smart-search', '', root)).toMatchObject({
      skill: 'smart-search',
      path: 'SKILL.md',
    });
    expect(() => readWebcmdSkill('not-real', '', root)).toThrow(ArgumentError);
    expect(() => readWebcmdSkill('webcmd-browser/../smart-search/SKILL.md', '', root)).toThrow(ArgumentError);
    expect(() => readWebcmdSkill('webcmd-browser', '../../package.json', root)).toThrow(ArgumentError);
  });
});
