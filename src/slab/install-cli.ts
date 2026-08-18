#!/usr/bin/env node
import { createSlabInstallerIo, installSlabMacos } from './install.js';

if (process.platform === 'darwin' && process.env.WEBCMD_INSTALL_SLAB === '1') {
  installSlabMacos(createSlabInstallerIo()).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
