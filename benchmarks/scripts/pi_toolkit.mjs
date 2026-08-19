import { createPiBrowserTools } from "libretto-browser-tools/pi";

import { createFixedCdpProvider } from "./libretto_mcp.mjs";


const LIBRETTO_TOOLS = new Set([
  "browser_open",
  "browser_exec",
  "browser_snapshot",
  "browser_status",
  "browser_close",
]);


export async function createPiToolConfiguration(tool, env = process.env) {
  if (tool !== "libretto") {
    return {
      tools: ["bash", "read"],
      customTools: [],
      async dispose() {},
    };
  }

  const cdpEndpoint = env.LIBRETTO_CDP_URL;
  if (!cdpEndpoint) throw new Error("LIBRETTO_CDP_URL is required");
  const toolkit = createPiBrowserTools(createFixedCdpProvider(cdpEndpoint));
  return {
    noTools: "builtin",
    customTools: toolkit.tools.filter(({ name }) => LIBRETTO_TOOLS.has(name)),
    dispose: () => toolkit.dispose(),
  };
}
