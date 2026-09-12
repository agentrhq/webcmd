#!/usr/bin/env node

/**
 * @webcmd/ppt - Autonomous AI Presentation & Slide Deck Synthesizer
 */

const path = require('path');
const { CanvaPresentationAgent } = require('../src/agent/canva-agent');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
\x1b[1m\x1b[36mWebcmd PPT Synthesizer\x1b[0m
Sub-second executive slide deck generation powered by Groq ultra-fast inference and Canva presentation engine.

\x1b[1mUSAGE:\x1b[0m
  webcmd-ppt [topic] [options]
  npx @webcmd/ppt "AI in Enterprise Automation"

\x1b[1mOPTIONS:\x1b[0m
  --headed          Launch browser in visible headed mode for live rendering
  --profile <name>  Browser profile to use (default: "work")
  --key <key>       Groq API key (or set GROQ_API_KEY environment variable)
  --help, -h        Show this help message

\x1b[1mEXAMPLES:\x1b[0m
  webcmd-ppt "Autonomous Web Agents: Next-Gen Execution"
  webcmd-ppt "Q3 Engineering Roadmap" --headed
`);
  process.exit(0);
}

const headed = args.includes('--headed');
const profileIdx = args.indexOf('--profile');
const profile = profileIdx !== -1 && args[profileIdx + 1] ? args[profileIdx + 1] : 'work';
const keyIdx = args.indexOf('--key');
const groqApiKey = keyIdx !== -1 && args[keyIdx + 1] ? args[keyIdx + 1] : process.env.GROQ_API_KEY;

// Get topic argument (ignore flags)
const topicArgs = args.filter((arg, i) => !arg.startsWith('--') && (i === 0 || !args[i - 1]?.startsWith('--')));
const topic = topicArgs.join(' ') || 'Webcmd: Self-Healing Autonomous Browser Infrastructure';

async function run() {
  const agent = new CanvaPresentationAgent({
    headed,
    profile,
    groqApiKey,
    onLog: msg => console.log(msg)
  });

  try {
    const result = await agent.buildPresentation(topic);
    console.log(`\n\x1b[32m✔ Presentation successfully synthesized!\x1b[0m`);
    if (result && result.deckFilePath) {
      console.log(`\x1b[36m📂 Deck file: ${result.deckFilePath}\x1b[0m\n`);
    }
  } catch (err) {
    console.error(`\x1b[31m✖ Synthesis failed: ${err.message}\x1b[0m`);
    process.exit(1);
  } finally {
    if (agent.close && !headed) {
      await agent.close();
    }
  }
}

run();
