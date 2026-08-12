import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { QuickJSHost } from './quickjs-host.js';
import { BROWSER_RUN_PLAYWRIGHT_VERSION } from './types.js';

const execFileAsync = promisify(execFile);

describe('Playwright QuickJS client build', () => {
  it('pins the sandbox client to the host Playwright version', async () => {
    const [readme, manifest, packageJson, bundle] = await Promise.all([
      readFile('src/browser/run/playwright-client/README.md', 'utf8'),
      readFile('src/browser/run/playwright-client/vendor-manifest.json', 'utf8'),
      readFile('node_modules/playwright-core/package.json', 'utf8'),
      readFile('src/browser/run/generated/playwright-client.js', 'utf8'),
    ]);

    expect(readme).toContain('v1.61.1');
    expect(readme).toContain('39e3553a4f283a41134d75d7e404484bd9e6865a');
    expect(readme).toContain('Apache-2.0');
    expect(JSON.parse(packageJson).version).toBe(BROWSER_RUN_PLAYWRIGHT_VERSION);
    expect(JSON.parse(manifest)).toMatchObject({
      version: BROWSER_RUN_PLAYWRIGHT_VERSION,
      commit: '39e3553a4f283a41134d75d7e404484bd9e6865a',
      license: 'Apache-2.0',
    });
    expect(bundle).toContain('Playwright v1.61.1 (39e3553a4f283a41134d75d7e404484bd9e6865a, Apache-2.0)');
    await expect(execFileAsync(process.execPath, [
      'scripts/build-playwright-sandbox-client.mjs',
      '--check',
    ])).resolves.toBeDefined();
  });

  it('rejects a vendored source edit even after the bundle is regenerated', async () => {
    const file = 'src/browser/run/playwright-client/vendor/client/artifact.ts';
    const original = await readFile(file, 'utf8');
    try {
      await writeFile(file, `${original}\n// test drift\n`);
      await expect(execFileAsync(process.execPath, [
        'scripts/build-playwright-sandbox-client.mjs',
        '--check',
      ])).rejects.toThrow(/provenance|vendor/i);
    } finally {
      await writeFile(file, original);
    }
  });

  it('handles binary transport, logical artifacts, and memory uploads without Node globals', async () => {
    const bundle = await readFile('src/browser/run/generated/playwright-client.js', 'utf8');
    const host = await QuickJSHost.create();
    try {
      await expect(host.executeScript(`
        delete globalThis.Buffer;
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        globalThis.__webcmdEncodeBase64 = bytes => {
          let output = '';
          for (let index = 0; index < bytes.length; index += 3) {
            const chunk = (bytes[index] << 16) | ((bytes[index + 1] || 0) << 8) | (bytes[index + 2] || 0);
            output += alphabet[(chunk >>> 18) & 63] + alphabet[(chunk >>> 12) & 63]
              + (index + 1 < bytes.length ? alphabet[(chunk >>> 6) & 63] : '=')
              + (index + 2 < bytes.length ? alphabet[chunk & 63] : '=');
          }
          return output;
        };
        globalThis.__webcmdDecodeBase64 = value => {
          const output = [];
          for (let index = 0; index < value.length; index += 4) {
            const a = alphabet.indexOf(value[index]), b = alphabet.indexOf(value[index + 1]);
            const c = value[index + 2] === '=' ? 64 : alphabet.indexOf(value[index + 2]);
            const d = value[index + 3] === '=' ? 64 : alphabet.indexOf(value[index + 3]);
            const chunk = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
            output.push((chunk >>> 16) & 255);
            if (c !== 64) output.push((chunk >>> 8) & 255);
            if (d !== 64) output.push(chunk & 255);
          }
          return new Uint8Array(output);
        };
        globalThis.__webcmdEncodeText = value => new Uint8Array([]);
        globalThis.__webcmdDecodeText = bytes => '';
        const messages = [];
        globalThis.__webcmdTransportSend = message => messages.push(JSON.parse(message));
        let artifact;
        globalThis.__webcmdWriteArtifact = (path, bytes) => { artifact = { path, bytes: Array.from(bytes) }; };
        ${bundle}
        (async () => {
          const client = __WebcmdPlaywrightClient;
          const connection = client.createConnection();
          if (!connection.isRemote()) throw new Error('connection is not remote');
          if (typeof Buffer !== 'undefined' || typeof process !== 'undefined' || typeof require !== 'undefined') throw new Error('Node global exposed');

          let screenshot;
          connection._callbacks.set(1, { resolve: value => { screenshot = value; }, reject: error => { throw error; }, type: 'Page', method: 'screenshot' });
          connection.dispatch({ id: 1, result: { binary: 'AAEC' } });
          if (!(screenshot.binary instanceof Uint8Array) || screenshot.binary.join(',') !== '0,1,2') throw new Error('binary result failed');

          const upload = client.tBinary(new Uint8Array([3, 4]), '', { binary: 'toBase64' });
          if (upload !== 'AwQ=') throw new Error('binary request failed');

          const typedArgument = client.serializeArgument(new Uint8Array([6, 7]));
          if (!(typedArgument.value.ta.b instanceof Uint8Array) || typedArgument.value.ta.b.join(',') !== '6,7') throw new Error('typed argument serialization failed');

          const payloads = await client.convertInputFiles(client.quickjsPlatform, {
            name: 'memory.bin', mimeType: 'application/octet-stream', buffer: new Uint8Array([5]),
          }, {});
          if (payloads.payloads[0].buffer[0] !== 5) throw new Error('memory upload failed');
          let pathRejected = false;
          try { await client.convertInputFiles(client.quickjsPlatform, '/host/file.txt', {}); } catch (error) { pathRejected = /paths are unavailable/i.test(String(error)); }
          if (!pathRejected) throw new Error('path upload was not rejected');

          connection.dispatch({ guid: '', method: '__create__', params: { type: 'Artifact', guid: 'artifact', initializer: { absolutePath: '/host/secret' } } });
          connection.dispatch({ guid: 'artifact', method: '__create__', params: { type: 'Stream', guid: 'stream', initializer: {} } });
          const downloaded = connection.getObjectWithKnownName('artifact');
          let pathUnavailable = false;
          try { await downloaded.pathAfterFinished(); } catch (error) { pathUnavailable = /path is not available/i.test(String(error)); }
          if (!pathUnavailable) throw new Error('artifact path leaked');
          const save = downloaded.saveAs('download.bin');
          const saveAsStream = messages.pop();
          if (saveAsStream.method !== 'saveAsStream') throw new Error('artifact used server path');
          connection.dispatch({ id: saveAsStream.id, result: { stream: { guid: 'stream' } } });
          await new Promise(resolve => setTimeout(resolve, 0));
          const firstRead = messages.pop();
          connection.dispatch({ id: firstRead.id, result: { binary: 'AAEC' } });
          await new Promise(resolve => setTimeout(resolve, 0));
          const finalRead = messages.pop();
          connection.dispatch({ id: finalRead.id, result: { binary: '' } });
          await save;
          if (artifact.path !== 'download.bin' || artifact.bytes.join(',') !== '0,1,2') throw new Error('artifact write failed');
          return true;
        })()
      `)).resolves.toBe(true);
    } finally {
      host.dispose();
    }
  });
});
