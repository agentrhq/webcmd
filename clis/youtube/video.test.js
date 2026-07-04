import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';

const { mockPrepare } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  prepareYoutubeApiPage: mockPrepare,
}));

import { getRegistry } from '@agentrhq/webcmd/registry';
import './video.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videoSource = readFileSync(resolve(__dirname, 'video.js'), 'utf8');

describe('youtube video source contract', () => {
  it('extracts playability gate signals inside the watch bootstrap evaluate', () => {
    // members-only video metadata localized text——playabilityStatus is the decision source;
    // reason localized text,membersOnly must use locale locale-independent badge enum detection.
    expect(videoSource).toContain('player.playabilityStatus');
    expect(videoSource).toContain('BADGE_STYLE_TYPE_MEMBERS_ONLY');
  });
});

describe('youtube video row mapping', () => {
  const command = getRegistry().get('youtube/video');
  const page = { evaluate: vi.fn() };

  beforeEach(() => {
    mockPrepare.mockReset().mockResolvedValue(undefined);
    page.evaluate.mockReset();
  });

  it('surfaces playabilityStatus / playabilityReason / membersOnly as rows', async () => {
    page.evaluate.mockResolvedValueOnce({
      title: 'KojiKoji Yang:How experts useAI?',
      channel: 'Class Notes',
      videoId: 'jgeqHyFzfIM',
      playabilityStatus: 'UNPLAYABLE',
      playabilityReason: "This video is available to this channel's members",
      membersOnly: true,
    });

    const rows = await command.func(page, { url: 'https://www.youtube.com/watch?v=jgeqHyFzfIM' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));

    expect(byField.playabilityStatus).toBe('UNPLAYABLE');
    expect(byField.membersOnly).toBe('true');
    expect(byField.playabilityReason).toContain('members');
    // metadata metadata rows still return(member video metadata remains visible)
    expect(byField.title).toBe('KojiKoji Yang:How experts useAI?');
  });

  it('reports OK playability for a normal video', async () => {
    page.evaluate.mockResolvedValueOnce({
      title: 'normal',
      playabilityStatus: 'OK',
      playabilityReason: '',
      membersOnly: false,
    });

    const rows = await command.func(page, { url: 'dQw4w9WgXcQ' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));

    expect(byField.playabilityStatus).toBe('OK');
    expect(byField.membersOnly).toBe('false');
  });

  it('unwraps Browser Bridge envelopes before row mapping', async () => {
    page.evaluate.mockResolvedValueOnce({
      session: 'browser:default',
      data: {
        title: 'normal',
        playabilityStatus: 'OK',
        playabilityReason: '',
        membersOnly: false,
      },
    });

    const rows = await command.func(page, { url: 'dQw4w9WgXcQ' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));

    expect(byField.title).toBe('normal');
    expect(byField.playabilityStatus).toBe('OK');
  });

  it('typed-fails when playability marker fields are missing', async () => {
    page.evaluate.mockResolvedValueOnce({
      title: 'unknown',
    });

    await expect(command.func(page, { url: 'dQw4w9WgXcQ' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('typed-fails malformed membersOnly instead of defaulting to false', async () => {
    page.evaluate.mockResolvedValueOnce({
      title: 'unknown',
      playabilityStatus: 'OK',
      playabilityReason: '',
      membersOnly: 'false',
    });

    await expect(command.func(page, { url: 'dQw4w9WgXcQ' })).rejects.toBeInstanceOf(CommandExecutionError);
  });
});
