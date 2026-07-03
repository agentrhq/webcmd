import { makeDumpCommand } from '../_shared/desktop-commands.js';

export const dumpCommand = makeDumpCommand('trae-cn', {
  example: 'WEBCMD_CDP_ENDPOINT=http://127.0.0.1:39240 WEBCMD_CDP_TARGET=talk webcmd trae-cn dump -f json',
});
