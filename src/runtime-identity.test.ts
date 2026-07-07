import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { getUserWebcmdDir, getUserClisDir, getPluginsDir } from './discovery.js';

describe('webcmd runtime identity', () => {
  it('uses webcmd runtime directories', async () => {
    expect(getUserWebcmdDir('/home/tester')).toBe(path.join('/home/tester', '.webcmd'));
    expect(getUserClisDir('/home/tester')).toBe(path.join('/home/tester', '.webcmd', 'clis'));
    expect(getPluginsDir('/home/tester')).toBe(path.join('/home/tester', '.webcmd', 'plugins'));
  });
});
