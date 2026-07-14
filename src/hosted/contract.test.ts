import { describe, expect, it } from 'vitest';
import { Strategy, type CliCommand } from '../registry.js';
import {
  HOSTED_CONTRACT_SCHEMA_VERSION,
  buildHostedContract,
  serializeHostedContract,
  type HostedBrowserCommandContract,
} from './contract.js';

describe('buildHostedContract', () => {
  const commands: CliCommand[] = [
    {
      site: 'web',
      name: 'profile',
      aliases: ['me'],
      description: 'Read a profile',
      access: 'read',
      strategy: Strategy.COOKIE,
      browser: true,
      domain: 'example.com',
      args: [
        {
          name: 'user',
          type: 'str',
          positional: true,
          required: true,
          help: 'Profile handle',
          choices: ['alice', 'bob'],
        },
        {
          name: 'include-private',
          type: 'bool',
          default: false,
          help: 'Include private fields',
        },
      ],
      columns: ['name', 'bio'],
      defaultFormat: 'plain',
      example: 'webcmd web profile alice',
    },
    {
      site: 'local',
      name: 'cache',
      description: 'Read local cache',
      access: 'read',
      strategy: Strategy.LOCAL,
      browser: false,
      args: [],
    },
    {
      site: 'files',
      name: 'transfer',
      description: 'Transfer a file',
      access: 'write',
      strategy: Strategy.PUBLIC,
      browser: false,
      args: [
        {
          name: 'source',
          type: 'string',
          positional: true,
          required: true,
          help: 'Source document',
          file: {
            direction: 'input',
            pathKind: 'file',
            contentTypes: ['application/pdf'],
            maxBytes: 2_000_000,
          },
        },
        {
          name: 'destination',
          type: 'string',
          help: 'Destination file',
          file: { direction: 'output', pathKind: 'directory', multiple: true },
        },
        {
          name: 'retries',
          type: 'int',
          default: 2,
          help: 'Retry count',
        },
      ],
      defaultFormat: 'markdown',
    },
    {
      site: 'app',
      name: 'editor',
      description: 'Control a desktop editor',
      access: 'write',
      strategy: Strategy.UI,
      browser: true,
      domain: 'localhost',
      args: [],
    },
  ];

  const browserCatalog: HostedBrowserCommandContract[] = [
    {
      command: 'bind',
      aliases: [],
      description: 'Bind an existing local tab',
      positionals: [],
      options: [],
      sessionPolicy: 'local-only',
    },
    {
      command: 'open',
      aliases: ['navigate'],
      description: 'Open a browser page',
      positionals: [{
        name: 'url',
        type: 'string',
        description: 'URL to open',
        positional: true,
        required: true,
        variadic: false,
      }],
      options: [],
      sessionPolicy: 'create-or-reuse',
      action: 'navigate',
    },
  ];

  it('emits the deterministic versioned public contract shape', () => {
    const contract = buildHostedContract(commands, browserCatalog, '9.8.7');

    expect(contract).toEqual({
      schemaVersion: HOSTED_CONTRACT_SCHEMA_VERSION,
      webcmdVersion: '9.8.7',
      outputFormats: ['table', 'plain', 'json', 'yaml', 'md', 'csv'],
      traceModes: ['off', 'on', 'retain-on-failure'],
      commonOptions: [
        {
          name: 'format',
          flags: '-f, --format <fmt>',
          type: 'string',
          description: 'Output format: table, plain, json, yaml, md, csv',
          positional: false,
          required: false,
          variadic: false,
          default: 'table',
          choices: ['table', 'plain', 'json', 'yaml', 'md', 'csv'],
        },
        {
          name: 'trace',
          flags: '--trace <mode>',
          type: 'string',
          description: 'Trace capture: off, on, retain-on-failure',
          positional: false,
          required: false,
          variadic: false,
          default: 'off',
          choices: ['off', 'on', 'retain-on-failure'],
        },
        {
          name: 'verbose',
          flags: '-v, --verbose',
          type: 'boolean',
          description: 'Debug output',
          positional: false,
          required: false,
          variadic: false,
          default: false,
        },
        {
          name: 'help',
          flags: '-h, --help',
          type: 'boolean',
          description: 'display help for command',
          positional: false,
          required: false,
          variadic: false,
        },
      ],
      commands: [
        {
          command: 'app/editor',
          site: 'app',
          name: 'editor',
          description: 'Control a desktop editor',
          access: 'write',
          strategy: 'UI',
          browser: true,
          domain: 'localhost',
          positionals: [],
          options: [],
          columns: [],
          aliases: [],
          defaultFormat: 'table',
          fileArguments: [],
          sessionPolicy: 'local-only',
          availability: { mode: 'local-only', reason: 'desktop-app' },
        },
        {
          command: 'files/transfer',
          site: 'files',
          name: 'transfer',
          description: 'Transfer a file',
          access: 'write',
          strategy: 'PUBLIC',
          browser: false,
          positionals: [
            {
              name: 'source',
              type: 'string',
              description: 'Source document',
              positional: true,
              required: true,
              variadic: false,
            },
          ],
          options: [
            {
              name: 'destination',
              type: 'string',
              description: 'Destination file',
              positional: false,
              required: false,
              variadic: false,
            },
            {
              name: 'retries',
              type: 'int',
              description: 'Retry count',
              positional: false,
              required: false,
              variadic: false,
              default: 2,
            },
          ],
          columns: [],
          aliases: [],
          defaultFormat: 'md',
          fileArguments: [
            {
              name: 'source',
              direction: 'input',
              pathKind: 'file',
              multiple: false,
              required: true,
              contentTypes: ['application/pdf'],
              maxBytes: 2_000_000,
            },
            {
              name: 'destination',
              direction: 'output',
              pathKind: 'directory',
              multiple: true,
              required: false,
            },
          ],
          sessionPolicy: 'create-or-reuse',
          availability: { mode: 'hosted' },
        },
        {
          command: 'local/cache',
          site: 'local',
          name: 'cache',
          description: 'Read local cache',
          access: 'read',
          strategy: 'LOCAL',
          browser: false,
          positionals: [],
          options: [],
          columns: [],
          aliases: [],
          defaultFormat: 'table',
          fileArguments: [],
          sessionPolicy: 'local-only',
          availability: { mode: 'local-only', reason: 'local-tool' },
        },
        {
          command: 'web/profile',
          site: 'web',
          name: 'profile',
          aliases: ['me'],
          description: 'Read a profile',
          access: 'read',
          strategy: 'COOKIE',
          browser: true,
          domain: 'example.com',
          positionals: [
            {
              name: 'user',
              type: 'string',
              description: 'Profile handle',
              positional: true,
              required: true,
              variadic: false,
              choices: ['alice', 'bob'],
            },
          ],
          options: [
            {
              name: 'include-private',
              type: 'boolean',
              description: 'Include private fields',
              positional: false,
              required: false,
              variadic: false,
              default: false,
            },
          ],
          columns: ['name', 'bio'],
          defaultFormat: 'plain',
          example: 'webcmd web profile alice',
          fileArguments: [],
          sessionPolicy: 'create-or-reuse',
          availability: { mode: 'hosted' },
        },
      ],
      browserCommands: [browserCatalog[0], browserCatalog[1]],
    });

    expect(serializeHostedContract(contract)).toBe(serializeHostedContract(
      buildHostedContract([...commands].reverse(), [...browserCatalog].reverse(), '9.8.7'),
    ));
  });

  it('rejects duplicate canonical commands and aliases', () => {
    const duplicate = { ...commands[0] };
    expect(() => buildHostedContract([commands[0], duplicate], [], '1.0.0'))
      .toThrow('Duplicate canonical command: web/profile');

    const aliasCollision: CliCommand = {
      ...commands[0],
      name: 'me',
      aliases: undefined,
    };
    expect(() => buildHostedContract([commands[0], aliasCollision], [], '1.0.0'))
      .toThrow('Duplicate command alias: web/me');
  });

  it('rejects incomplete file and browser session metadata', () => {
    const missingDirection = {
      ...commands[2],
      args: [{
        name: 'source',
        positional: true,
        file: {},
      }],
    } as unknown as CliCommand;
    expect(() => buildHostedContract([missingDirection], [], '1.0.0'))
      .toThrow('File argument files/transfer source must declare direction');

    const missingPathKind = {
      ...commands[2],
      args: [{
        name: 'source',
        positional: true,
        file: { direction: 'input' },
      }],
    } as unknown as CliCommand;
    expect(() => buildHostedContract([missingPathKind], [], '1.0.0'))
      .toThrow('File argument files/transfer source must declare pathKind');

    const unsupportedSeparator = {
      ...commands[2],
      args: [{
        name: 'source',
        positional: true,
        file: { direction: 'input', pathKind: 'file', separator: ':' },
      }],
    } as unknown as CliCommand;
    expect(() => buildHostedContract([unsupportedSeparator], [], '1.0.0'))
      .toThrow('File argument files/transfer source declares unsupported separator');

    const missingPolicy = [{
      command: 'open',
      aliases: [],
      description: 'Open',
      positionals: [],
      options: [],
    }] as unknown as HostedBrowserCommandContract[];
    expect(() => buildHostedContract([], missingPolicy, '1.0.0'))
      .toThrow('Browser command open must declare a known session policy');
  });
});
