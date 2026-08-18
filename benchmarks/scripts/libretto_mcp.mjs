#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMcpBrowserTools } from "libretto-browser-tools/mcp";


function packageVersion(name) {
  const require = createRequire(import.meta.url);
  let directory = dirname(require.resolve(name));
  while (directory !== dirname(directory)) {
    try {
      return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      directory = dirname(directory);
    }
  }
  throw new Error(`Could not resolve ${name} package version`);
}


export function createFixedCdpProvider(cdpEndpoint) {
  const endpoint = new URL(cdpEndpoint);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("LIBRETTO_CDP_URL must use a loopback host");
  }
  return {
    name: "cloakbrowser",
    async createSession() {
      return { sessionId: "cloak", cdpEndpoint };
    },
    async closeSession() {
      return {};
    },
  };
}


async function main() {
  if (process.argv.includes("--version")) {
    console.log(packageVersion("libretto-browser-tools"));
    return;
  }
  const cdpEndpoint = process.env.LIBRETTO_CDP_URL;
  if (!cdpEndpoint) throw new Error("LIBRETTO_CDP_URL is required");

  const server = new McpServer({
    name: "libretto-browser-tools",
    version: packageVersion("libretto-browser-tools"),
  });
  const toolkit = registerMcpBrowserTools(
    server,
    createFixedCdpProvider(cdpEndpoint),
  );
  const transport = new StdioServerTransport();
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    const error = await toolkit.dispose();
    if (error) console.error(error);
  };
  process.once("beforeExit", dispose);
  process.once("SIGINT", () => void dispose().finally(() => process.exit(130)));
  process.once("SIGTERM", () => void dispose().finally(() => process.exit(143)));
  await server.connect(transport);
}


const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
