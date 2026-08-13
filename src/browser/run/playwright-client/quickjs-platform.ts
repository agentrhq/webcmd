import { webColors } from './vendor/isomorphic/colors.js';
import type { Platform, Zone } from './vendor/isomorphic/platform.js';

type SandboxGlobals = typeof globalThis & {
  __webcmdEncodeBase64?: (bytes: Uint8Array) => string;
  __webcmdDecodeBase64?: (value: string) => Uint8Array;
  __webcmdEncodeText?: (value: string) => Uint8Array;
  __webcmdDecodeText?: (bytes: Uint8Array) => string;
  __webcmdTransportSend?: (message: string) => void;
  __webcmdWriteArtifact?: (path: string, bytes: Uint8Array) => Promise<void> | void;
};

const sandbox = globalThis as SandboxGlobals;
const noopZone: Zone = {
  push: () => noopZone,
  pop: () => noopZone,
  run: callback => callback(),
  data: () => undefined,
};

function injected<Name extends keyof SandboxGlobals>(name: Name): NonNullable<SandboxGlobals[Name]> {
  const value = sandbox[name];
  if (typeof value !== 'function') throw new Error(`${String(name)} is unavailable in the QuickJS sandbox`);
  return value as NonNullable<SandboxGlobals[Name]>;
}

export const quickjsEncoding = {
  encodeBase64: (bytes: Uint8Array) => injected('__webcmdEncodeBase64')(bytes),
  decodeBase64: (value: string) => injected('__webcmdDecodeBase64')(value),
  encodeText: (value: string) => injected('__webcmdEncodeText')(value),
  decodeText: (bytes: Uint8Array) => injected('__webcmdDecodeText')(bytes),
};

export const sendTransport = (message: string) => injected('__webcmdTransportSend')(message);

const sandboxFs = {
  promises: {
    mkdir: async () => undefined,
    writeFile: async (path: string, bytes: Uint8Array) => injected('__webcmdWriteArtifact')(path, bytes),
  },
};

const sandboxPath = {
  dirname: () => '',
  isAbsolute: (path: string) => path.startsWith('/'),
  resolve: (...paths: string[]) => paths.join('/'),
};

export const quickjsPlatform: Platform = {
  name: 'empty',
  boxedStackPrefixes: () => [],
  calculateSha1: async text => {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  },
  colors: webColors,
  createGuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const value = Math.floor(Math.random() * 16);
    return (token === 'x' ? value : (value & 3) | 8).toString(16);
  }),
  defaultMaxListeners: () => 10,
  env: {},
  fs: () => sandboxFs as never,
  inspectCustom: undefined,
  isDebugMode: () => false,
  isJSDebuggerAttached: () => false,
  isLogEnabled: () => false,
  isUnderTest: () => false,
  log: () => undefined,
  path: () => sandboxPath as never,
  pathSeparator: '/',
  showInternalStackFrames: () => false,
  streamFile: async () => { throw new Error('Streams are unavailable in the QuickJS sandbox'); },
  streamReadable: () => { throw new Error('Streams are unavailable in the QuickJS sandbox'); },
  streamWritable: () => { throw new Error('Streams are unavailable in the QuickJS sandbox'); },
  zones: { empty: noopZone, current: () => noopZone },
};
