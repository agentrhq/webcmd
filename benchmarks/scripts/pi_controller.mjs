import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createPiToolConfiguration } from "./pi_toolkit.mjs";

const SDK_PACKAGE = JSON.parse(
  readFileSync(
    new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")),
    "utf8",
  ),
);
const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function emit(event) {
  console.log(
    JSON.stringify(event, (key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (key === "data" && typeof value === "string" && value.length > 10_000) {
        return `[omitted ${value.length} characters]`;
      }
      return value;
    }),
  );
}

function selectedModel(args) {
  const index = args.indexOf("--model");
  const selector = index >= 0 ? args[index + 1] : "openai/gpt-4o";
  if (!selector) throw new Error("--model requires a value");
  const separator = selector.indexOf("/");
  return separator < 0
    ? { provider: "openai", modelId: selector, selector: `openai/${selector}` }
    : {
        provider: selector.slice(0, separator),
        modelId: selector.slice(separator + 1),
        selector,
      };
}

function selectedThinkingLevel(args) {
  const index = args.indexOf("--thinking");
  if (index < 0) return "medium";
  const level = args[index + 1];
  if (!level) throw new Error("--thinking requires a value");
  if (!THINKING_LEVELS.has(level)) {
    throw new Error(`Unsupported Pi thinking level: ${level}`);
  }
  return level;
}

function selectedTool(args) {
  const index = args.indexOf("--tool");
  if (index < 0) return "webcmd";
  const tool = args[index + 1];
  if (!tool || tool.startsWith("--")) throw new Error("--tool requires a value");
  if (!new Set(["webcmd", "dev-browser", "libretto"]).has(tool)) {
    throw new Error(`Unsupported Pi benchmark tool: ${tool}`);
  }
  return tool;
}

function selectedSkillPaths(args, required) {
  const paths = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--skill-path") continue;
    const path = args[index + 1];
    if (!path || path.startsWith("--")) {
      throw new Error("--skill-path requires a value");
    }
    if (!existsSync(join(path, "SKILL.md"))) {
      throw new Error(
        `Pi skill path does not exist: ${path}. Run: webcmd skills add --provider codex --scope user`,
      );
    }
    paths.push(path);
    index += 1;
  }
  if (required && paths.length === 0) {
    throw new Error("--skill-path requires a value");
  }
  return paths;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    console.log(`${SDK_PACKAGE.name} ${SDK_PACKAGE.version}`);
    return;
  }

  const { provider, modelId, selector } = selectedModel(args);
  const thinkingLevel = selectedThinkingLevel(args);
  const tool = selectedTool(args);
  const checkingAuth = args.includes("--check-auth");
  const skillPaths = checkingAuth
    ? []
    : selectedSkillPaths(args, tool !== "libretto");
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  const model = modelRegistry.find(provider, modelId);
  if (!model) throw new Error(`Model ${selector} not found`);
  if (!modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`No credentials configured for ${provider}`);
  }
  if (checkingAuth) {
    console.log("ok");
    return;
  }

  const cwd = process.cwd();
  const agentDir = join(cwd, ".pi");
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    additionalSkillPaths: skillPaths,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    systemPrompt:
      "You are an AI agent in a controlled browser benchmark. Follow the user prompt exactly and report only evidence you observed.",
  });
  await resourceLoader.reload();

  const toolConfiguration = await createPiToolConfiguration(tool);
  let session;
  let unsubscribe = () => {};
  try {
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      model,
      thinkingLevel,
      authStorage,
      modelRegistry,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(cwd),
      tools: toolConfiguration.tools,
      noTools: toolConfiguration.noTools,
      customTools: toolConfiguration.customTools,
    }));
    unsubscribe = session.subscribe((event) => {
      if (
        event.type === "message_end" ||
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_end"
      ) {
        emit(event);
      }
    });
    const startedAt = Date.now();
    await session.prompt(readFileSync(0, "utf8"));
    emit({
      type: "result",
      result: session.getLastAssistantText() || "",
      duration_ms: Date.now() - startedAt,
    });
  } finally {
    unsubscribe();
    session?.dispose();
    await toolConfiguration.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
