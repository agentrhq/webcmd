import { describe, expect, it } from 'vitest';
import {
  CLI_COMMAND,
  CONFIG_DIR_NAME,
  DAEMON_HEADER_NAME,
  ENV_PREFIX,
  EXTENSION_ARTIFACT_PREFIX,
  EXTENSION_PACKAGE_NAME,
  PACKAGE_NAME,
  PRODUCT_DISPLAY_NAME,
  PRODUCT_NAME,
} from './brand.js';

describe('webcmd brand constants', () => {
  it('defines AgentR webcmd identity', () => {
    expect(PRODUCT_NAME).toBe('webcmd');
    expect(PRODUCT_DISPLAY_NAME).toBe('Webcmd');
    expect(CLI_COMMAND).toBe('webcmd');
    expect(PACKAGE_NAME).toBe('@agentrhq/webcmd');
    expect(CONFIG_DIR_NAME).toBe('.webcmd');
    expect(ENV_PREFIX).toBe('WEBCMD');
    expect(DAEMON_HEADER_NAME).toBe('X-Webcmd');
    expect(EXTENSION_PACKAGE_NAME).toBe('webcmd-extension');
    expect(EXTENSION_ARTIFACT_PREFIX).toBe('webcmd-extension');
  });
});
