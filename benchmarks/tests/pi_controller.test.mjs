import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createPiToolConfiguration } from "../scripts/pi_toolkit.mjs";

const controller = fileURLToPath(
  new URL("../scripts/pi_controller.mjs", import.meta.url),
);

test("Pi sidecar reports its pinned SDK version without starting a session", () => {
  const result = spawnSync(process.execPath, [controller, "--version"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout.trim(),
    /^@earendil-works\/pi-coding-agent 0\.80\.6$/,
  );
});

test("Pi sidecar loads stored Codex subscription credentials", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-auth-"));
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: "test-access",
        refresh: "test-refresh",
        expires: Date.now() + 60_000,
      },
    }),
  );
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  delete env.OPENAI_API_KEY;

  try {
    const result = spawnSync(
      process.execPath,
      [
        controller,
        "--check-auth",
        "--model",
        "openai-codex/gpt-5.6-sol",
        "--tool",
        "libretto",
      ],
      { encoding: "utf8", env },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "ok");
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("Pi sidecar rejects unsupported thinking levels before starting a session", () => {
  const result = spawnSync(
    process.execPath,
    [controller, "--model", "openai/gpt-5.6-sol", "--thinking", "ultra"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported Pi thinking level: ultra/);
});

test("Pi sidecar rejects a missing explicitly selected skill", () => {
  const missing = "/definitely/missing/webcmd-usage";
  const result = spawnSync(
    process.execPath,
    [
      controller,
      "--model",
      "openai/gpt-5.6-sol",
      "--skill-path",
      missing,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pi skill path does not exist/);
  assert.match(result.stderr, /webcmd skills add --provider codex --scope user/);
});

test("Pi sidecar validates every explicitly selected skill", () => {
  const first = mkdtempSync(join(tmpdir(), "pi-skill-"));
  const missing = "/definitely/missing/webcmd-browser";
  writeFileSync(join(first, "SKILL.md"), "---\nname: first\n---\n");

  try {
    const result = spawnSync(
      process.execPath,
      [
        controller,
        "--model",
        "openai/gpt-5.6-sol",
        "--skill-path",
        first,
        "--skill-path",
        missing,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(missing));
  } finally {
    rmSync(first, { recursive: true, force: true });
  }
});

test("Pi Libretto configuration exposes only the benchmark browser tools", async () => {
  const configuration = await createPiToolConfiguration("libretto", {
    LIBRETTO_CDP_URL: "http://127.0.0.1:43210",
  });

  try {
    assert.equal(configuration.noTools, "builtin");
    assert.deepEqual(
      configuration.customTools.map((tool) => tool.name),
      [
        "browser_open",
        "browser_exec",
        "browser_snapshot",
        "browser_status",
        "browser_close",
      ],
    );
  } finally {
    await configuration.dispose();
  }
});
