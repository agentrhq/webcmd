import { execa } from 'execa';

/**
 * Runs native Webcmd adapter commands deterministically.
 */
export async function runWebcmdAdapter(command, args = []) {
  try {
    const nodeBin = process.execPath || 'node';
    const { stdout } = await execa(nodeBin, ['./bin/webcmd.js', command, ...args, '-f', 'json']);
    return { success: true, data: JSON.parse(stdout) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
