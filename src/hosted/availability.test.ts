import { describe, expect, it } from 'vitest';
import {
  deriveBrowserAvailability,
  deriveHostedAvailability,
} from './availability.js';

describe('hosted availability', () => {
  it('keeps client-owned commands local before strategy and domain classification', () => {
    expect(deriveHostedAvailability({ clientOwned: true, strategy: 'public', domain: 'example.com' }))
      .toEqual({ mode: 'local-only', reason: 'client-owned' });
  });

  it('derives decisions only from normalized strategy and domain metadata', () => {
    expect(deriveHostedAvailability({ strategy: 'local', domain: 'localhost' }))
      .toEqual({ mode: 'local-only', reason: 'local-tool' });
    expect(deriveHostedAvailability({ strategy: 'ui', domain: 'localhost' }))
      .toEqual({ mode: 'local-only', reason: 'desktop-app' });
    expect(deriveHostedAvailability({ strategy: 'cookie', domain: 'example.com' }))
      .toEqual({ mode: 'hosted' });
    expect(deriveBrowserAvailability('bind')).toEqual({ mode: 'hosted' });
    expect(deriveBrowserAvailability('run')).toEqual({ mode: 'hosted' });
    expect(deriveBrowserAvailability('tabs')).toEqual({ mode: 'hosted' });
  });
});

describe('deriveHostedAvailability classification table', () => {
  it('treats a dotted domain as hosted', () => {
    expect(deriveHostedAvailability({ strategy: 'PUBLIC', domain: 'news.ycombinator.com' }))
      .toEqual({ mode: 'hosted' });
  });

  it('treats a dotless domain as a desktop app', () => {
    expect(deriveHostedAvailability({ strategy: 'UI', domain: 'chatgpt-app' }))
      .toEqual({ mode: 'local-only', reason: 'desktop-app' });
  });

  it('treats a local IP domain as a desktop app', () => {
    expect(deriveHostedAvailability({ strategy: 'UI', domain: '127.0.0.1:3000' }))
      .toEqual({ mode: 'local-only', reason: 'desktop-app' });
  });

  it('treats an absent domain as hosted', () => {
    expect(deriveHostedAvailability({ strategy: 'PUBLIC' })).toEqual({ mode: 'hosted' });
  });

  it('treats LOCAL strategy as a local tool regardless of domain', () => {
    expect(deriveHostedAvailability({ strategy: 'local', domain: 'example.com' }))
      .toEqual({ mode: 'local-only', reason: 'local-tool' });
  });
});
