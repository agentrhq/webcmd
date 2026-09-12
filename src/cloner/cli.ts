#!/usr/bin/env node
import { Command } from 'commander';
import { executeCloneCommand } from '../commands/clone.js';

const program = new Command();

program
  .name('webcmd-clone')
  .description('Download and replicate any website with full DOM rendering, asset resolution, and HTML formatting.')
  .argument('[url]', 'Target website URL to clone (prompts interactively if omitted)')
  .option('-o, --output <dir>', 'Destination output directory')
  .option('-t, --timeout <ms>', 'Navigation timeout in milliseconds', '45000')
  .option('--no-scroll', 'Disable automatic scrolling')
  .option('--no-scripts', 'Exclude dynamic script tags')
  .option('-s, --serve', 'Launch local preview server after cloning', true)
  .option('--no-serve', 'Do not launch preview server')
  .option('--no-open', 'Do not automatically open in default browser')
  .option('-p, --port <port>', 'Server port for preview', '3000')
  .option('--json', 'Output machine-readable JSON summary only', false)
  .action(async (cliUrl: string | undefined, options: any) => {
    await executeCloneCommand(cliUrl, options);
  });

program.parse(process.argv);
