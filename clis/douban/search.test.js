import { describe, expect, it } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './search.js';

describe('douban search command', () => {
    it('skips default pre-navigation because the adapter handles navigation itself', () => {
        const command = getRegistry().get('douban/search');
        expect(command).toBeDefined();
        expect(command?.navigateBefore).toBe(false);
    });
});
