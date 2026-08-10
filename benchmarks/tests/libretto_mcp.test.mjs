import assert from "node:assert/strict";
import test from "node:test";

import { createFixedCdpProvider } from "../scripts/libretto_mcp.mjs";


test("fixed provider returns only the harness CDP endpoint", async () => {
  const provider = createFixedCdpProvider("http://127.0.0.1:43210");

  assert.equal(provider.name, "cloakbrowser");
  assert.deepEqual(await provider.createSession(), {
    sessionId: "cloak",
    cdpEndpoint: "http://127.0.0.1:43210",
  });
  assert.deepEqual(await provider.closeSession("cloak"), {});
});


test("fixed provider rejects non-loopback endpoints", () => {
  assert.throws(
    () => createFixedCdpProvider("https://remote.example"),
    /loopback/,
  );
});
