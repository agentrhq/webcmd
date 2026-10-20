import { startServer } from '../src/web-ui-server.js';

const port = Number(process.env.PORT) || 3000;

async function main() {
  console.log('\x1b[36m%s\x1b[0m', '═══════════════════════════════════════════════════════');
  console.log('\x1b[1m\x1b[35m%s\x1b[0m', '   ⚡ WEBCMD AI-AGENT DASHBOARD & BROWSER RUNNER ⚡   ');
  console.log('\x1b[36m%s\x1b[0m', '═══════════════════════════════════════════════════════');
  console.log('Starting Webcmd Web UI server...');

  try {
    const info = await startServer(port);
    console.log();
    console.log('\x1b[32m✔ Server active:\x1b[0m  \x1b[1mhttp://localhost:%d\x1b[0m', info.port);
    console.log('\x1b[90m  API endpoints:\x1b[0m  http://localhost:%d/api/health', info.port);
    console.log('\x1b[90m  Sessions API:\x1b[0m   http://localhost:%d/api/sessions', info.port);
    console.log('\x1b[90m  Learned Sites:\x1b[0m  http://localhost:%d/api/sites', info.port);
    console.log('\x1b[90m  Workflows:\x1b[0m      http://localhost:%d/api/workflows', info.port);
    console.log();
    console.log('\x1b[33mPress Ctrl+C to stop the Web UI server.\x1b[0m');
  } catch (err: any) {
    console.error('\x1b[31mFailed to start Web UI server:\x1b[0m', err.message);
    process.exit(1);
  }
}

main();
