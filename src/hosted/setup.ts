import { createInterface } from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { HostedClient } from './client.js';
import {
  defaultHostedApiBaseUrl,
  makeHostedConfig,
  makeLocalConfig,
  saveWebcmdConfig,
  type ConfigIo,
} from './config.js';

export interface SetupIo extends ConfigIo {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  fetchImpl?: typeof fetch;
  question?: (prompt: string) => Promise<string>;
  write?: (message: string) => void;
}

export async function runHostedSetup(io: SetupIo = {}): Promise<number> {
  const write = io.write ?? ((message: string) => (io.output ?? defaultOutput).write(message));
  const ownedReadline = io.question ? undefined : createInterface({
    input: io.input ?? defaultInput,
    output: io.output ?? defaultOutput,
  });
  const ask = io.question ?? ((prompt: string) => ownedReadline!.question(prompt));

  try {
    write('Webcmd setup\n');
    const mode = await ask('Use hosted Webcmd Cloud or local Webcmd? [hosted/local] ');
    if (mode.trim().toLowerCase().startsWith('l')) {
      saveWebcmdConfig(makeLocalConfig(io.now?.() ?? new Date()), io);
      write('Webcmd is now configured for local mode.\n');
      return 0;
    }

    const apiBaseUrl = defaultHostedApiBaseUrl(io.env ?? process.env);
    const apiKey = (await ask('Webcmd API key: ')).trim();
    if (!apiKey) {
      write('A Webcmd API key is required for hosted mode.\n');
      return 2;
    }

    const config = makeHostedConfig({
      apiBaseUrl,
      apiKey,
      now: io.now?.() ?? new Date(),
    });
    try {
      await new HostedClient({
        apiBaseUrl: config.hosted.apiBaseUrl,
        apiKey: config.hosted.apiKey,
        fetchImpl: io.fetchImpl,
      }).getMe();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      write(`Warning: could not verify API key yet: ${message}\n`);
    }
    saveWebcmdConfig(config, io);
    write('Webcmd is now configured for hosted mode.\n');
    return 0;
  } finally {
    ownedReadline?.close();
  }
}
