// Command variables (server/vault/credential-command-env.ts) in the ACP engines'
// own shells: the engine process gets them only when the turn carries them,
// never under a name an engine bills, and a revoke starts a fresh process.
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../../config.ts";
import type { ProviderDriver, ProviderInstance } from "../../contracts.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { recordEvents, type EventRecorder } from "../../testing/events.ts";
import { GeminiAgentDriver } from "./gemini.ts";
import { GrokAgentDriver } from "./grok.ts";
import { QwenAgentDriver } from "./qwen.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "testing", "fake-acp-cli.ts");
// Fake test data only.
const FAKE_VALUE = "fake-command-variable-value";

describe.each([
  ["Grok Build", GrokAgentDriver],
  ["Gemini", GeminiAgentDriver],
  ["Qwen", QwenAgentDriver],
] as Array<[string, ProviderDriver<any>]>)("command variables in %s (ACP)", (_name, driver) => {
  let instance: ProviderInstance | undefined;
  let recorder: EventRecorder | undefined;
  let scratch: string;
  beforeEach(() => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "sagax-acp-cmdvar-"));
    process.env.FAKE_ACP_DUMP = join(scratch, "dump.json");
  });
  afterEach(async () => {
    delete process.env.FAKE_ACP_DUMP;
    recorder?.stop();
    await instance?.dispose();
    await removeTempDir(scratch);
  });

  const turn = async (threadId: string, commandEnvironment?: Record<string, string>) => {
    const { turnId } = await instance!.adapter.sendTurn({ threadId, text: "hello", ...(commandEnvironment ? { commandEnvironment } : {}) });
    await recorder!.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    return JSON.parse(readFileSync(process.env.FAKE_ACP_DUMP!, "utf8")) as { env: Record<string, string>; pid: number; argv: string[] };
  };

  it("are in the engine's environment only when the turn carries them, and leave at the revoke", async () => {
    instance = await driver.create({ instanceId: "acp-cmdvar", displayName: "ACP", environment: {}, enabled: true, config: { cli: FAKE_CLI, fullAuto: false } });
    recorder = recordEvents(instance.adapter);
    const none = await turn("t-cmdvar-none");
    expect(none.env.EXAMPLE_API_KEY).toBeUndefined();

    const on = await turn("t-cmdvar", { EXAMPLE_API_KEY: FAKE_VALUE });
    expect(on.env.EXAMPLE_API_KEY).toBe(FAKE_VALUE);
    // never on the command line
    expect(JSON.stringify(on.argv)).not.toContain(FAKE_VALUE);

    // revoked: the next turn gets a fresh process without it
    const off = await turn("t-cmdvar");
    expect(off.pid).not.toBe(on.pid);
    expect(off.env.EXAMPLE_API_KEY).toBeUndefined();
  });

  it("never take a name the engine reads as its own sign-in", async () => {
    instance = await driver.create({ instanceId: "acp-cmdvar-owned", displayName: "ACP", environment: {}, enabled: true, config: { cli: FAKE_CLI, fullAuto: false } });
    recorder = recordEvents(instance.adapter);
    const dump = await turn("t-cmdvar-owned", { OPENAI_API_KEY: FAKE_VALUE, XAI_API_KEY: FAKE_VALUE, EXAMPLE_API_KEY: FAKE_VALUE });
    expect(dump.env.OPENAI_API_KEY).toBeUndefined();
    expect(dump.env.XAI_API_KEY).toBeUndefined();
    expect(dump.env.EXAMPLE_API_KEY).toBe(FAKE_VALUE);
  });
});
