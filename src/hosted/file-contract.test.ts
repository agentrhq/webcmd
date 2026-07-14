import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HostedContract, HostedFileArgumentContract } from './contract.js';
import type { ManifestEntry } from '../manifest-types.js';

const MiB = 1024 * 1024;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type ExpectedFileArgument = HostedFileArgumentContract;

const IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
];

const MERCURY_RECEIPT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];

const INSTAGRAM_MEDIA_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
];

const EXPECTED_FILE_ARGUMENTS: Record<string, ExpectedFileArgument[]> = {
  'chatgpt/image': [{
    name: 'image',
    direction: 'input',
    pathKind: 'file',
    multiple: true,
    required: false,
    separator: ',',
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 25 * MiB,
  }, {
    name: 'op',
    direction: 'output',
    pathKind: 'directory',
    multiple: false,
    required: false,
  }],
  'chatgpt/project-file-add': [{
    name: 'file',
    direction: 'input',
    pathKind: 'file',
    multiple: true,
    required: true,
    separator: ',',
    contentTypes: [
      ...DOCUMENT_CONTENT_TYPES,
      ...IMAGE_CONTENT_TYPES,
    ],
    maxBytes: 25 * MiB,
  }],
  'claude/ask': [{
    name: 'file',
    direction: 'input',
    pathKind: 'file',
    multiple: false,
    required: false,
    contentTypes: [
      ...DOCUMENT_CONTENT_TYPES,
      ...IMAGE_CONTENT_TYPES,
    ],
    maxBytes: 25 * MiB,
  }],
  'instagram/post': [{
    name: 'media',
    direction: 'input',
    pathKind: 'file',
    multiple: true,
    required: false,
    separator: ',',
    contentTypes: INSTAGRAM_MEDIA_CONTENT_TYPES,
    maxBytes: 250 * MiB,
  }],
  'instagram/reel': [{
    name: 'video',
    direction: 'input',
    pathKind: 'file',
    multiple: false,
    required: false,
    contentTypes: ['video/mp4'],
    maxBytes: 250 * MiB,
  }],
  'mercury/reimbursement-draft': [{
    name: 'receipt',
    direction: 'input',
    pathKind: 'file',
    multiple: false,
    required: true,
    contentTypes: MERCURY_RECEIPT_CONTENT_TYPES,
    maxBytes: 25 * MiB,
  }],
  'twitter/download': [{
    name: 'output',
    direction: 'output',
    pathKind: 'directory',
    multiple: false,
    required: false,
  }],
  'twitter/post': [{
    name: 'images',
    direction: 'input',
    pathKind: 'file',
    multiple: true,
    required: false,
    separator: ',',
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 25 * MiB,
  }],
  'twitter/quote': [{
    name: 'image',
    direction: 'input',
    pathKind: 'file',
    multiple: false,
    required: false,
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 25 * MiB,
  }],
  'twitter/reply': [{
    name: 'image',
    direction: 'input',
    pathKind: 'file',
    multiple: false,
    required: false,
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 25 * MiB,
  }],
};

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(packageRoot, name), 'utf8')) as T;
}

function manifestCommand(manifest: ManifestEntry[], command: string): ManifestEntry {
  const entry = manifest.find(item => `${item.site}/${item.name}` === command);
  if (!entry) throw new Error(`Missing manifest command: ${command}`);
  return entry;
}

function contractCommand(contract: HostedContract, command: string) {
  const entry = contract.commands.find(item => item.command === command);
  if (!entry) throw new Error(`Missing hosted contract command: ${command}`);
  return entry;
}

describe('hosted file argument contract', () => {
  it('declares every real local path argument in generated artifacts', () => {
    const manifest = readJson<ManifestEntry[]>('cli-manifest.json');
    const contract = readJson<HostedContract>('hosted-contract.json');

    for (const [command, expected] of Object.entries(EXPECTED_FILE_ARGUMENTS)) {
      expect(contractCommand(contract, command).fileArguments, command).toEqual(expected);
      const manifestArgs = manifestCommand(manifest, command).args
        .filter(arg => arg.file)
        .map(arg => ({ name: arg.name, file: arg.file }));
      expect(manifestArgs, command).toEqual(expected.map(({ name, required: _required, ...file }) => ({ name, file })));
    }
  });

  it('does not treat Twitter remote image URLs as file arguments', () => {
    const contract = readJson<HostedContract>('hosted-contract.json');

    expect(contractCommand(contract, 'twitter/quote').fileArguments.map(arg => arg.name))
      .not.toContain('image-url');
    expect(contractCommand(contract, 'twitter/reply').fileArguments.map(arg => arg.name))
      .not.toContain('image-url');
  });
});
