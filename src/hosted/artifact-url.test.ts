import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../errors.js';
import { parseExecutionArtifactDownloadUrl } from './artifact-url.js';

const apiBaseUrl = 'https://api.example.com';

describe('parseExecutionArtifactDownloadUrl', () => {
  it('extracts execution and artifact ids from the approved route', () => {
    expect(parseExecutionArtifactDownloadUrl(
      'https://api.example.com/v1/executions/exec_1/artifacts/trace_a',
      apiBaseUrl,
    )).toEqual({ executionId: 'exec_1', artifactId: 'trace_a' });
  });

  it('rejects a foreign origin before any request is implied', () => {
    expect(() => parseExecutionArtifactDownloadUrl(
      'https://evil.example/v1/executions/exec_1/artifacts/trace_a',
      apiBaseUrl,
    )).toThrow(/origin/i);
  });

  it('rejects a malformed path', () => {
    expect(() => parseExecutionArtifactDownloadUrl(
      'https://api.example.com/v1/artifacts/trace_a',
      apiBaseUrl,
    )).toThrow(/path/i);
  });

  it('rejects malformed percent-encoding as an argument error', () => {
    expect(() => parseExecutionArtifactDownloadUrl(
      'https://api.example.com/v1/executions/exec_%ZZ/artifacts/trace_a',
      apiBaseUrl,
    )).toThrow(ArgumentError);
  });

  it('accepts the configured API pathname prefix', () => {
    expect(parseExecutionArtifactDownloadUrl(
      'https://api.example.com/api/v1/executions/exec_1/artifacts/trace_a',
      'https://api.example.com/api',
    )).toEqual({ executionId: 'exec_1', artifactId: 'trace_a' });
  });
});
