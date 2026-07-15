import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import './company.js';

const { normalizeCompanyInfo, normalizeCompanyUrl } = await import('./company.js').then((module) => module.__test__);

function makePage(evaluateResult) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(evaluateResult),
  };
}

describe('linkedin company', () => {
  it('registers the company command', () => {
    const command = getRegistry().get('linkedin/company');
    expect(command).toMatchObject({
      access: 'read',
      browser: true,
      strategy: 'cookie',
      columns: ['name', 'industry', 'size', 'headquarters', 'founded', 'website', 'specialties', 'followers', 'about', 'url'],
    });
  });

  it('normalizes bare names, paths, and URLs to the about page', () => {
    expect(normalizeCompanyUrl('nvidia')).toBe('https://www.linkedin.com/company/nvidia/about/');
    expect(normalizeCompanyUrl('/company/nvidia')).toBe('https://www.linkedin.com/company/nvidia/about/');
    expect(normalizeCompanyUrl('https://www.linkedin.com/company/databricks/'))
      .toBe('https://www.linkedin.com/company/databricks/about/');
  });

  it('rejects invalid company identifiers as argument errors', () => {
    for (const value of [
      '',
      'bad name!',
      'https://www.linkedin.com/in/someone/',
      'https://evil.example/company/nvidia/',
      'https://www.linkedin.com/company/%E0%A4%A',
    ]) {
      expect(() => normalizeCompanyUrl(value)).toThrow(ArgumentError);
    }
  });

  it('maps extracted company facts to a row', async () => {
    const command = getRegistry().get('linkedin/company');
    const page = makePage({
      url: 'https://www.linkedin.com/company/nvidia/about/',
      name: 'NVIDIA',
      industry: 'Computer Hardware Manufacturing',
      size: '10,001+ employees',
      headquarters: 'Santa Clara, CA',
      founded: '1993',
      website: 'http://www.nvidia.com',
      specialties: 'GPU, AI',
      followers: '42040089',
      about: 'Accelerated computing.',
    });

    await expect(command.func(page, { company: 'nvidia' })).resolves.toEqual([{
      name: 'NVIDIA',
      industry: 'Computer Hardware Manufacturing',
      size: '10,001+ employees',
      headquarters: 'Santa Clara, CA',
      founded: '1993',
      website: 'http://www.nvidia.com',
      specialties: 'GPU, AI',
      followers: 42040089,
      about: 'Accelerated computing.',
      url: 'https://www.linkedin.com/company/nvidia/about/',
    }]);
    expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/company/nvidia/about/');
  });

  it('fails closed when no company name is found', async () => {
    const command = getRegistry().get('linkedin/company');
    const page = makePage({ url: 'https://www.linkedin.com/company/ghost/about/', name: '' });

    await expect(command.func(page, { company: 'ghost' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('normalizes emitted URLs and rejects non-company extraction URLs', () => {
    expect(normalizeCompanyInfo({
      url: 'https://www.linkedin.com/company/nvidia/posts/?trk=public_profile',
      name: 'NVIDIA',
      followers: '123',
    }, 'https://www.linkedin.com/company/nvidia/about/')).toMatchObject({
      url: 'https://www.linkedin.com/company/nvidia/about/',
      followers: 123,
    });

    for (const url of [
      'https://www.linkedin.com/in/not-a-company/',
      'https://evil.example/company/nvidia/',
    ]) {
      expect(() => normalizeCompanyInfo({ url, name: 'NVIDIA' }, 'https://www.linkedin.com/company/nvidia/about/'))
        .toThrow(CommandExecutionError);
    }
  });

  it('rejects malformed follower counts', () => {
    expect(() => normalizeCompanyInfo({
      url: 'https://www.linkedin.com/company/nvidia/about/',
      name: 'NVIDIA',
      followers: 'many',
    }, 'https://www.linkedin.com/company/nvidia/about/')).toThrow(CommandExecutionError);
  });
});
