import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostedClient } from './client.js';
import { materializeHostedOutputs, prepareHostedFiles, rewriteHostedOutputResultPaths } from './files.js';
import type { HostedCommand, HostedExecuteResponse } from './types.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

const fileCommand: HostedCommand = {
  site: 'twitter',
  name: 'post',
  command: 'twitter/post',
  description: 'Post',
  access: 'write',
  strategy: 'UI',
  browser: true,
  columns: ['ok'],
  args: [
    { name: 'text', positional: true, required: true },
    {
      name: 'images',
      file: {
        direction: 'input',
        pathKind: 'file',
        multiple: true,
        separator: ',',
        contentTypes: ['image/png'],
        maxBytes: 1024,
      },
    },
    {
      name: 'output',
      file: {
        direction: 'output',
        pathKind: 'directory',
        multiple: false,
        defaultPath: './downloads',
      },
    },
  ],
};

describe('hosted file transfer helpers', () => {
  it('reserves a default output when no file argument is provided', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const client = fakeClient();
    const command: HostedCommand = {
      ...fileCommand,
      command: 'geogebra/triangle',
      args: [{
        name: 'output',
        file: { direction: 'output', pathKind: 'file', multiple: false, defaultPath: './geogebra-triangle.png' },
      }],
    };

    const prepared = await prepareHostedFiles({ client, command, cwd: tempDir, args: {} });

    expect(prepared.args.output).toEqual({ $webcmdArtifact: {
      direction: 'output', filename: 'geogebra-triangle.png', contentType: 'application/octet-stream',
    } });
    expect(prepared.outputs).toEqual([{
      argument: 'output', pathKind: 'file', localPath: path.join(tempDir, 'geogebra-triangle.png'),
    }]);
  });

  it('prepares a mutable file reference and uploads its seed when present', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    await writeFile(path.join(tempDir, 'likes.resume.json'), '{}');
    const client = fakeClient();
    const command: HostedCommand = {
      ...fileCommand,
      command: 'likes/list',
      args: [{
        name: 'resume',
        file: {
          direction: 'input-output',
          pathKind: 'file',
          multiple: false,
          defaultPath: 'likes.resume.json',
        },
      }],
    };

    const prepared = await prepareHostedFiles({ client, command, cwd: tempDir, args: {} });

    expect(prepared.args.resume).toEqual({ $webcmdArtifact: {
      direction: 'input-output', filename: 'likes.resume.json',
      contentType: 'application/json', inputId: 'artifact_1',
    } });
    expect(prepared.outputs).toEqual([
      { argument: 'resume', pathKind: 'file', localPath: path.resolve(tempDir, 'likes.resume.json') },
    ]);
    expect(client.uploadExecutionArtifact).toHaveBeenCalledWith(expect.objectContaining({
      argument: 'resume', filename: 'likes.resume.json', contentType: 'application/json',
    }));
  });

  it('prepares a mutable file output when its first-run seed is absent', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const client = fakeClient();
    const command: HostedCommand = {
      ...fileCommand,
      command: 'likes/list',
      args: [{
        name: 'resume',
        file: {
          direction: 'input-output',
          pathKind: 'file',
          multiple: false,
          defaultPath: 'likes.resume.json',
        },
      }],
    };

    const prepared = await prepareHostedFiles({ client, command, cwd: tempDir, args: {} });

    expect(prepared.args.resume).toEqual({ $webcmdArtifact: {
      direction: 'input-output', filename: 'likes.resume.json', contentType: 'application/json',
    } });
    expect(client.uploadExecutionArtifact).not.toHaveBeenCalled();
    expect(client.prepareExecution).toHaveBeenCalledWith({ command: 'likes/list' });
  });

  it('uploads declared input files and reserves declared outputs without leaking local paths', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const one = path.join(tempDir, 'one.png');
    const two = path.join(tempDir, 'two.png');
    await writeFile(one, 'one');
    await writeFile(two, 'two');
    const client = fakeClient();

    const prepared = await prepareHostedFiles({
      client,
      command: fileCommand,
      cwd: tempDir,
      args: {
        text: 'hello',
        images: './one.png,./two.png',
      },
    });

    expect(client.prepareExecution).toHaveBeenCalledWith({ command: 'twitter/post' });
    expect(client.uploadExecutionArtifact).toHaveBeenCalledTimes(2);
    expect(client.uploadExecutionArtifact).toHaveBeenNthCalledWith(1, expect.objectContaining({
      executionId: 'exec_prepared',
      argument: 'images',
      filename: 'one.png',
      contentType: 'image/png',
      body: new Uint8Array(Buffer.from('one')),
    }));
    expect(prepared.args).toEqual({
      text: 'hello',
      images: [
        { $webcmdArtifact: { id: 'artifact_1', direction: 'input' } },
        { $webcmdArtifact: { id: 'artifact_2', direction: 'input' } },
      ],
      output: {
        $webcmdArtifact: {
          direction: 'output',
          filename: 'downloads',
          contentType: 'application/octet-stream',
        },
      },
    });
    expect(prepared.outputs).toEqual([{
      argument: 'output',
      pathKind: 'directory',
      localPath: path.join(tempDir, 'downloads'),
    }]);
    expect(JSON.stringify(prepared.args)).not.toContain(tempDir);
  });

  it('downloads output receipts, verifies hashes, and writes files atomically', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const body = new Uint8Array(Buffer.from('hello cloud'));
    const client = {
      downloadExecutionArtifact: vi.fn(async () => body),
    } as unknown as HostedClient;
    const response = responseWithArtifact({
      artifactId: 'artifact_out',
      relativePath: 'nested/result.txt',
      byteSize: body.byteLength,
      sha256: sha256Hex(body),
    });

    const materialized = await materializeHostedOutputs({
      client,
      response,
      outputs: [{
        argument: 'output',
        pathKind: 'directory',
        localPath: path.join(tempDir, 'downloads'),
      }],
    });

    await expect(readFile(path.join(tempDir, 'downloads', 'nested', 'result.txt'), 'utf8')).resolves.toBe('hello cloud');
    expect(rewriteHostedOutputResultPaths({
      file: '📁 /private/cloud-artifacts/output-directory/nested/result.txt',
    }, materialized)).toEqual({
      file: `📁 ${path.join(tempDir, 'downloads', 'nested', 'result.txt')}`,
    });
    expect(client.downloadExecutionArtifact).toHaveBeenCalledWith({
      executionId: 'exec_success',
      artifactId: 'artifact_out',
    });
  });

  it('replaces a mutable file seed with its downloaded output', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const resume = path.join(tempDir, 'likes.resume.json');
    await writeFile(resume, '{"old":true}');
    const body = new Uint8Array(Buffer.from('{"next":true}'));
    const client = { downloadExecutionArtifact: vi.fn(async () => body) } as unknown as HostedClient;

    await materializeHostedOutputs({
      client,
      response: responseWithArtifact({
        argument: 'resume', artifactId: 'artifact_resume', relativePath: 'likes.resume.json', byteSize: body.byteLength,
      }),
      outputs: [{ argument: 'resume', pathKind: 'file', localPath: resume }],
    });

    await expect(readFile(resume, 'utf8')).resolves.toBe('{"next":true}');
  });

  it('writes each mutable file output receipt to its matching target', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const first = path.join(tempDir, 'first.resume.json');
    const second = path.join(tempDir, 'second.resume.json');
    const client = Object.assign(fakeClient(), {
      downloadExecutionArtifact: vi.fn(async ({ artifactId }: { artifactId: string }) => new Uint8Array(Buffer.from(artifactId))),
    });
    const command: HostedCommand = {
      ...fileCommand,
      command: 'likes/list',
      args: [{
        name: 'resume',
        file: { direction: 'input-output', pathKind: 'file', multiple: true, separator: ',' },
      }],
    };
    const prepared = await prepareHostedFiles({
      client,
      command,
      cwd: tempDir,
      args: { resume: 'first.resume.json,second.resume.json' },
    });
    const response: HostedExecuteResponse = {
      ok: true,
      result: [],
      execution: { id: 'exec_success', command: 'likes/list', status: 'succeeded' },
      artifacts: [
        { artifactId: 'first', argument: 'resume', direction: 'output', pathKind: 'file', filename: 'first.resume.json', contentType: 'application/json', byteSize: 5, expiresAt: '2026-07-15T00:00:00.000Z' },
        { artifactId: 'second', argument: 'resume', direction: 'output', pathKind: 'file', filename: 'second.resume.json', contentType: 'application/json', byteSize: 6, expiresAt: '2026-07-15T00:00:00.000Z' },
      ],
    };

    await materializeHostedOutputs({
      client,
      response,
      outputs: prepared.outputs,
    });

    await expect(readFile(first, 'utf8')).resolves.toBe('first');
    await expect(readFile(second, 'utf8')).resolves.toBe('second');
  });

  it('validates local inputs before creating a prepared cloud execution', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const client = fakeClient();

    await expect(prepareHostedFiles({
      client,
      command: fileCommand,
      cwd: tempDir,
      args: {
        text: 'hello',
        images: './missing.png',
      },
    })).rejects.toMatchObject({ code: 'HOSTED_FILE_NOT_FOUND' });

    expect(client.prepareExecution).not.toHaveBeenCalled();
    expect(client.uploadExecutionArtifact).not.toHaveBeenCalled();
  });

  it('rejects unsafe relative output paths before downloading', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const client = {
      downloadExecutionArtifact: vi.fn(),
    } as unknown as HostedClient;

    await expect(materializeHostedOutputs({
      client,
      response: responseWithArtifact({
        artifactId: 'artifact_out',
        relativePath: '../escape.txt',
        byteSize: 0,
      }),
      outputs: [{
        argument: 'output',
        pathKind: 'directory',
        localPath: path.join(tempDir, 'downloads'),
      }],
    })).rejects.toMatchObject({ code: 'HOSTED_FILE_OUTPUT_INVALID' });
    expect(client.downloadExecutionArtifact).not.toHaveBeenCalled();
  });

  it('removes temporary files when download hash verification fails', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'webcmd-hosted-files-'));
    const client = {
      downloadExecutionArtifact: vi.fn(async () => new Uint8Array(Buffer.from('bad body'))),
    } as unknown as HostedClient;

    await expect(materializeHostedOutputs({
      client,
      response: responseWithArtifact({
        artifactId: 'artifact_out',
        relativePath: 'result.txt',
        byteSize: 8,
        sha256: sha256Hex(new Uint8Array(Buffer.from('expected'))),
      }),
      outputs: [{
        argument: 'output',
        pathKind: 'directory',
        localPath: path.join(tempDir, 'downloads'),
      }],
    })).rejects.toMatchObject({ code: 'HOSTED_FILE_HASH_MISMATCH' });

    const entries = await readdir(path.join(tempDir, 'downloads')).catch(() => []);
    expect(entries.filter(entry => entry.includes('.tmp'))).toEqual([]);
  });
});

function fakeClient() {
  let uploads = 0;
  return {
    prepareExecution: vi.fn(async () => ({
      ok: true,
      execution: { id: 'exec_prepared', command: 'twitter/post', status: 'queued' },
      fileArguments: [],
    })),
    uploadExecutionArtifact: vi.fn(async (input: { argument: string }) => {
      uploads += 1;
      return {
        ok: true,
        artifact: {
          artifactId: `artifact_${uploads}`,
          argument: input.argument,
          direction: 'input',
          pathKind: 'file',
          filename: `file_${uploads}.png`,
          contentType: 'image/png',
          byteSize: 3,
          expiresAt: '2026-07-15T00:00:00.000Z',
        },
        reference: { $webcmdArtifact: { id: `artifact_${uploads}`, direction: 'input' } },
      };
    }),
  } as unknown as HostedClient & {
    prepareExecution: ReturnType<typeof vi.fn>;
    uploadExecutionArtifact: ReturnType<typeof vi.fn>;
  };
}

function responseWithArtifact(input: {
  argument?: string;
  artifactId: string;
  relativePath: string;
  byteSize: number;
  sha256?: string;
}): HostedExecuteResponse {
  return {
    ok: true,
    result: [{ ok: true }],
    execution: { id: 'exec_success', command: 'twitter/post', status: 'succeeded' },
    artifacts: [{
      artifactId: input.artifactId,
      argument: input.argument ?? 'output',
      direction: 'output',
      pathKind: 'file',
      filename: path.basename(input.relativePath),
      contentType: 'text/plain',
      byteSize: input.byteSize,
      ...(input.sha256 !== undefined ? { sha256: input.sha256 } : {}),
      relativePath: input.relativePath,
      expiresAt: '2026-07-15T00:00:00.000Z',
    }],
  };
}

function sha256Hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}
