import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { inspectTraeShellScript } from './utils.js';

export const statusCommand = cli({
  site: 'trae-cn',
  name: 'status',
  access: 'read',
  description: 'Check active CDP connection to Trae CN and summarize the current workspace/model',
  example: 'WEBCMD_CDP_ENDPOINT=http://127.0.0.1:39240 WEBCMD_CDP_TARGET=talk webcmd trae-cn status -f json',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  columns: ['Status', 'Title', 'Workspace', 'Model', 'Agent', 'Turns', 'ComposerReady', 'Url'],
  func: async (page) => {
    const info = await page.evaluate(inspectTraeShellScript());
    return [{
      Status: 'Connected',
      Title: info.title || '',
      Workspace: info.workspace || '',
      Model: info.model || '',
      Agent: info.agent || '',
      Turns: info.turns ?? 0,
      ComposerReady: info.composerReady ? 'yes' : 'no',
      Url: info.url || '',
    }];
  },
});
