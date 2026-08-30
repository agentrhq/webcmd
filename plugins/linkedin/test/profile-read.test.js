import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import '../profile-read.js';

const { normalizeProfileReadUrl, normalizeProfile } = await import('../profile-read.js').then((m) => m.__test__);

describe('linkedin profile-read adapter', () => {
  const command = getRegistry().get('linkedin/profile-read');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toEqual([
      'profile_url',
      'name',
      'headline',
      'location',
      'about',
      'about_character_count',
      'about_skills',
      'experience',
      'education',
      'services',
      'featured',
    ]);
  });

  it('normalizes profile url default and explicit /in URL', () => {
    expect(normalizeProfileReadUrl(undefined)).toBe('https://www.linkedin.com/in/me/');
    expect(normalizeProfileReadUrl('https://www.linkedin.com/in/gauravsaxena1997?x=1')).toBe('https://www.linkedin.com/in/gauravsaxena1997?x=1');
  });

  it('rejects non-profile URLs', () => {
    expect(() => normalizeProfileReadUrl('https://www.linkedin.com/jobs/')).toThrow(CommandExecutionError);
  });

  it('normalizes duplicated profile text and requires a name', () => {
    expect(() => normalizeProfile({ name: '' })).toThrow(CommandExecutionError);
    expect(normalizeProfile({
      name: 'AliceAlice',
      headline: 'EngineerEngineer',
      about: '  Builds AI  ',
      about_character_count: '1,100/2,600',
      about_skills: ['AI', 'TypeScript'],
    })).toMatchObject({
      name: 'Alice',
      headline: 'Engineer',
      about: 'Builds AI',
      about_character_count: '1,100/2,600',
      about_skills: 'AI; TypeScript',
    });
  });

  const workspacePage = (row, scrollRounds) => {
    const rounds = [...scrollRounds];
    const evaluated = [];
    return {
      evaluated,
      goto: vi.fn(async () => {}),
      wait: vi.fn(async () => {}),
      autoScroll: vi.fn(async () => {}),
      evaluate: vi.fn(async (script) => {
        evaluated.push(script);
        if (script.includes('authwall')) return false;
        if (script.includes('scrollTop')) return rounds.shift() ?? { found: [], atEnd: true };
        return row;
      }),
    };
  };

  it('does not require edit access when reading an explicit profile URL', async () => {
    const page = workspacePage({
      profile_url: 'https://www.linkedin.com/in/alice/',
      name: 'Alice',
      headline: 'Engineer',
      about: 'Builds products',
    }, [{ found: ['about', 'experience', 'education', 'featured'], atEnd: false }]);

    await expect(command.func(page, { 'profile-url': 'https://www.linkedin.com/in/alice/' }))
      .resolves.toMatchObject([{ name: 'Alice', about: 'Builds products' }]);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/in/alice/');
    expect(page.goto.mock.calls.some(([url]) => String(url).includes('/edit/forms/'))).toBe(false);
  });

  it('scrolls the inner container until the lazy sections load before extracting', async () => {
    const page = workspacePage({
      profile_url: 'https://www.linkedin.com/in/alice/',
      name: 'Alice',
      experience: 'Engineer at Acme',
      education: 'Example University',
    }, [
      { found: [], atEnd: false, container: '#workspace' },
      { found: ['about'], atEnd: false, container: '#workspace' },
      { found: ['about', 'experience', 'education', 'featured'], atEnd: false, container: '#workspace' },
    ]);

    await expect(command.func(page, { 'profile-url': 'https://www.linkedin.com/in/alice/' }))
      .resolves.toMatchObject([{ experience: 'Engineer at Acme', education: 'Example University' }]);

    // window autoScroll stays for older layouts, but cannot move main#workspace
    expect(page.autoScroll).toHaveBeenCalledWith({ times: 4, delayMs: 700 });
    const scrollScripts = page.evaluated.filter((script) => script.includes('scrollTop'));
    expect(scrollScripts).toHaveLength(3);
    expect(scrollScripts[0]).toContain("main#workspace");
    // the extraction runs only after the scroll rounds
    expect(page.evaluated.at(-1)).toContain('readSection');
  });
});
