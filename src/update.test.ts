import { describe, it, expect } from 'vitest';
import { buildUpgradeCommand } from './update.js';
import { PACKAGE_NAME } from './brand.js';

describe('buildUpgradeCommand', () => {
  it('uses npm global install by default', () => {
    // Test runtime is Node, not Bun.
    expect(buildUpgradeCommand()).toEqual({
      cmd: 'npm',
      args: ['install', '-g', `${PACKAGE_NAME}@latest`],
    });
  });

  it('honours an explicit spec', () => {
    expect(buildUpgradeCommand(`${PACKAGE_NAME}@1.2.3`).args).toContain(`${PACKAGE_NAME}@1.2.3`);
  });
});
