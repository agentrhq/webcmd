import { cli, Strategy } from '@agentrhq/webcmd/registry';

export const setupCommand = cli({
  site: 'trae-cn',
  name: 'setup',
  access: 'read',
  description: 'Show local setup commands for controlling Trae CN with Webcmd',
  example: 'webcmd trae-cn setup -f table',
  strategy: Strategy.LOCAL,
  browser: false,
  args: [],
  columns: ['Step', 'Command', 'Purpose'],
  func: async () => [
    {
      Step: '1. Launch Trae CN with CDP',
      Command: 'open -a "Trae CN" --args --remote-debugging-port=39240',
      Purpose: 'Start Trae CN with a Chrome DevTools Protocol endpoint',
    },
    {
      Step: '2. Point Webcmd at Trae',
      Command: 'export WEBCMD_CDP_ENDPOINT="http://127.0.0.1:39240"',
      Purpose: 'Tell Webcmd which local Trae CDP endpoint to use',
    },
    {
      Step: '3. Select a workspace target',
      Command: 'export WEBCMD_CDP_TARGET="talk"',
      Purpose: 'Choose the Trae workspace/window title when multiple targets are open',
    },
    {
      Step: '4. List Trae targets',
      Command: 'webcmd trae-cn targets -f table',
      Purpose: 'Find the right workspace target and spot windows with ApprovalPending=yes',
    },
    {
      Step: '5. Verify connection',
      Command: 'webcmd trae-cn status -f json',
      Purpose: 'Confirm workspace, model, agent, turn count, and composer readiness',
    },
    {
      Step: '6. Start a fresh task',
      Command: 'webcmd trae-cn new "请执行你的任务" -f json',
      Purpose: 'Create a new task and send the first prompt',
    },
    {
      Step: '7. Monitor progress',
      Command: 'webcmd trae-cn watch --stream true --duration 120',
      Purpose: 'Read in-app running/completed state as JSONL without approving terminal/delete confirmations',
    },
    {
      Step: '8. Approve blockers when needed',
      Command: 'webcmd trae-cn approve --approve-kinds terminal,delete -f json',
      Purpose: 'Click visible Trae prompts for terminal command or delete confirmations',
    },
    {
      Step: '9. Opt in to auto-approve when needed',
      Command: 'webcmd trae-cn watch --stream true --duration 120 --auto-approve true',
      Purpose: 'Explicitly opt in when you want watch to approve terminal/delete prompts while monitoring',
    },
    {
      Step: '10. Read result',
      Command: 'webcmd trae-cn read --limit 5 --max-chars 12000 -f json',
      Purpose: 'Fetch recent user/assistant turns from the current task',
    },
    {
      Step: 'Auto-run boundary',
      Command: 'rm, mv, chmod, dd, truncate, kill, destructive git/database commands',
      Purpose: 'Trae CN may still stop these as high-risk even when command mode is 自动运行; Webcmd approves them only after explicit --auto-approve true or approve',
    },
    {
      Step: 'Help',
      Command: 'webcmd trae-cn --help -f yaml',
      Purpose: 'Get all Trae CN commands, args, examples, and output columns in structured form',
    },
  ],
});
