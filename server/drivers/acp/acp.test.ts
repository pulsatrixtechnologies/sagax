// ACP driver contract tests, run against the scripted fake ACP CLI in
// server/testing/fake-acp-cli.ts. Covers the shared acp/core.ts runtime via
// its two harness shims (grok = fail-closed auth, gemini = lenient auth):
// normalize the ACP handshake into canonical events, keep argv/env hygiene,
// broker permission asks, and settle interrupts/crashes cleanly.
//
// The fake CLI is a shebang script Windows cannot exec directly —
// resolveCliSpawn turns it into `node <script>`, so these run everywhere.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { DATA_DIR, ensureDirs, NATIVE_DIR } from "../../config.ts";
import { BUILT_IN_DATA_SYSTEM_PROMPT } from "../../data/instructions.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { TurnNotStartedError } from "../../contracts.ts";
import { recordEvents, type EventRecorder } from "../../testing/events.ts";
import { promptSplitFingerprints, writePromptSplitReceipt } from "../prompt-split.ts";
import { GROK_TOOL_REUSE_HINT as HINT } from "./grok.ts";
import { createAcpDriver, DEFAULT_ACP_PROMPT_IDLE_MS, skipSubscriptionAuthForLocalInject, type AcpSupport } from "./core.ts";
import { GrokAgentDriver, grokAcceptsUnadvertisedImages, grokCloudConnectorEnv, grokConfigDeclaresMcp, grokConnectableConnectors } from "./grok.ts";
import { READ_ONLY_AGENT_TOOL_NAMES } from "../../agent-tool-policy.ts";
import { GeminiAgentDriver } from "./gemini.ts";
import { KimiAgentDriver } from "./kimi.ts";
import { DroidAgentDriver } from "./droid.ts";
import { CursorAgentDriver } from "./cursor.ts";
import { QwenAgentDriver } from "./qwen.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { startFakeHttpMcp } from "../../testing/fake-http-mcp-server.ts";
import * as procs from "../../procs.ts";
import * as quietStatus from "./quiet-status.ts";

/** Reviewed read-only agents tools Grok may run without its auto classifier. */
const AGENTS_READ_ONLY_ALLOW = [...READ_ONLY_AGENT_TOOL_NAMES]
  .map((name) => `MCPTool(agents__${name})`).sort().flatMap((rule) => ["--allow", rule]);

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "testing", "fake-acp-cli.ts");

/** A harness that exists only in tests: it exercises the opt-in session-config
 *  model hook so PR 1 can prove the core capability without shipping a visible
 *  engine. Real harnesses live in their own file. */
const SELECT_MODEL_SUPPORT: AcpSupport = {
  driverKind: "selectModelTest",
  displayName: "Select Model Test",
  models: { default: "m-one", options: [{ id: "m-one", label: "One" }, { id: "m-two", label: "Two" }] },
  defaultCli: "fake-select-model",
  nativeSource: "test.acp",
  loginNote: "never reached",
  selectModel: { configId: "model" },
  spawnArgs: () => [],
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: () => true,
};
const SelectModelDriver = createAcpDriver(SELECT_MODEL_SUPPORT);

/** Image input is an explicit per-harness opt-in. Keep these transport tests
 * independent from production harnesses whose native image support has not
 * been verified. */
const NativeImageDriver = createAcpDriver({
  ...SELECT_MODEL_SUPPORT,
  driverKind: "nativeImageTest",
  images: true,
});

/** Proves transformEnv can vary with the instance config, which is how the
 *  opencode driver picks its permission policy from `fullAuto`. */
const EnvPolicyDriver = createAcpDriver({
  ...SELECT_MODEL_SUPPORT,
  driverKind: "envPolicyTest",
  selectModel: undefined,
  transformEnv: (env, config) => {
    env.TEST_POLICY = config.fullAuto ? "auto" : "ask";
  },
});

/** Proves snapshot() awaits an async isAuthenticated, which is how the
 *  opencode driver answers from a discovered catalog. */
const AsyncAuthDriver = createAcpDriver({
  ...SELECT_MODEL_SUPPORT,
  driverKind: "asyncAuthTest",
  selectModel: undefined,
  isAuthenticated: async () => true,
});

const ClassifiedErrorDriver = createAcpDriver({
  ...SELECT_MODEL_SUPPORT,
  driverKind: "classifiedErrorTest",
  selectModel: undefined,
  classifyError: (error) =>
    error && typeof error === "object" && (error as { code?: unknown }).code === -32000
      ? "invalid_credentials"
      : undefined,
});

const CONTROL_PLANE_FIXTURE = {
  SAGAX_CLOUD_READY_TOKEN: "ready-should-not-leak", SAGAX_CLOUD_BOOTSTRAP: "bootstrap-should-not-leak",
  SAGAX_LICENSE_KEY: "license-should-not-leak", SAGAX_INSTALLATION_CREDENTIAL: "fleet-should-not-leak",
};

/** Grok mounts connector MCP servers through the gate (tool names Grok cannot
 * qualify, server/mcp-tool-names.ts); these tests check what is behind it. */
type AcpServer = { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> };
function ungated<T>(value: T): T {
  const servers = value as unknown as AcpServer[];
  return servers.map((server) => {
    const upstream = server.env?.find((entry) => entry.name === "SAGAX_GATE_UPSTREAM")?.value;
    if (!upstream || !server.env.some((entry) => entry.name === "SAGAX_GATE_TOOL_NAMES")) return server;
    const spec = JSON.parse(upstream) as { command: string; args: string[]; env: Record<string, string> };
    return { name: server.name, command: spec.command, args: spec.args, env: Object.entries(spec.env).map(([name, value]) => ({ name, value })) };
  }) as unknown as T;
}

describe("skipSubscriptionAuthForLocalInject", () => {
  it("is true only for a host:: inject id", () => {
    expect(skipSubscriptionAuthForLocalInject("omlx::MiniMax-M3-4bit")).toBe(true);
    expect(skipSubscriptionAuthForLocalInject("unsloth::orcarouter/Qwen3.8-27B-Uncensored-GGUF")).toBe(true);
    expect(skipSubscriptionAuthForLocalInject("grok-4.6")).toBe(false);
    expect(skipSubscriptionAuthForLocalInject(undefined)).toBe(false);
  });
});

describe("ACP decodeConfig", () => {
  it("resolves a dynamic model catalog when a support provides one", async () => {
    const support: AcpSupport = {
      driverKind: "dynamic-test",
      displayName: "Dynamic Test",
      models: { default: "fallback", options: [{ id: "fallback", label: "Fallback" }] },
      defaultCli: FAKE_CLI,
      nativeSource: "dynamic-test.acp",
      loginNote: "not authenticated",
      spawnArgs: () => [],
      pickAuthMethod: () => null,
      authFailure: "continue",
      isAuthenticated: () => true,
      resolveModels: async () => ({
        default: "dynamic-model",
        options: [{ id: "dynamic-model", label: "Dynamic model" }],
      }),
    };
    const driver = createAcpDriver(support);
    const instance = await driver.create({
      instanceId: "dynamic-test",
      displayName: "Dynamic Test",
      environment: {},
      enabled: true,
      config: driver.defaultConfig(),
    });
    expect(instance.models).toEqual({
      default: "dynamic-model",
      options: [{ id: "dynamic-model", label: "Dynamic model" }],
    });
    await instance.dispose();
  });
  it("grok defaults to the grok binary", () => {
    expect(GrokAgentDriver.decodeConfig({})).toEqual({ cli: "grok", fullAuto: false, workspace: undefined });
  });
  it("gemini defaults to the gemini binary", () => {
    expect(GeminiAgentDriver.decodeConfig(undefined)).toEqual({ cli: "gemini", fullAuto: false, workspace: undefined });
  });
  it("kimi defaults to the kimi binary and declares cross-platform setup", () => {
    expect(KimiAgentDriver.decodeConfig(undefined)).toEqual({ cli: "kimi", fullAuto: false, workspace: undefined });
    expect(KimiAgentDriver.install?.command).toMatchObject({
      darwin: expect.stringContaining("install.sh"),
      linux: expect.stringContaining("install.sh"),
      win32: expect.stringContaining("install.ps1"),
    });
    expect(KimiAgentDriver.install?.signInCommand).toBe("kimi login");
  });
  it("droid defaults to the droid binary and declares cross-platform setup", () => {
    expect(DroidAgentDriver.decodeConfig(undefined)).toEqual({ cli: "droid", fullAuto: false, workspace: undefined });
    expect(DroidAgentDriver.install?.command).toMatchObject({
      darwin: expect.stringContaining("factory.ai/cli"),
      linux: expect.stringContaining("factory.ai/cli"),
      win32: expect.stringContaining("factory.ai/cli"),
    });
    expect(DroidAgentDriver.install?.signInCommand).toBe("droid");
  });
  it("cursor defaults to its unambiguous binary and declares cross-platform setup", () => {
    expect(CursorAgentDriver.decodeConfig(undefined)).toEqual({
      cli: "cursor-agent",
      fullAuto: false,
      workspace: undefined,
    });
    expect(CursorAgentDriver.install?.command).toMatchObject({
      darwin: expect.stringContaining("cursor.com/install"),
      linux: expect.stringContaining("cursor.com/install"),
      win32: expect.stringContaining("cursor.com/install"),
    });
    expect(CursorAgentDriver.install?.signInCommand).toBe("cursor-agent login");
  });
  it("fullAuto only when explicitly true", () => {
    expect(GrokAgentDriver.decodeConfig({ fullAuto: "yes" }).fullAuto).toBe(false);
    expect(GrokAgentDriver.decodeConfig({ fullAuto: true }).fullAuto).toBe(true);
  });

  it("advertises per-bot local CUA but rejects legacy full-auto turns without a mode", async () => {
    const fullAuto = await GrokAgentDriver.create({
      instanceId: "grok-full-auto",
      displayName: "Grok Full Auto",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: true },
    });
    expect(fullAuto.adapter.capabilities.localComputerMcp).toBe(true);
    await expect(
      fullAuto.adapter.sendTurn({
        threadId: "t-full-auto-local",
        text: "click",
        integrations: {
          localComputer: {
            command: "/cua-driver",
            args: ["mcp"],
            env: {},
            platform: "linux",
            scope: "local-computer",
          },
        },
      }),
    ).rejects.toThrow(/interactive provider approvals/);
    await fullAuto.dispose();
  });
});

describe("ACP turns (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async (driver = GrokAgentDriver, mode?: string) => {
    if (mode) process.env.FAKE_ACP_MODE = mode;
    instance = await driver.create({
      instanceId: "acp-test",
      displayName: "ACP Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
  };

  let savedAgyModel: string | undefined;
  beforeEach(() => {
    savedAgyModel = process.env.AGY_ACP_DEFAULT_MODEL;
    delete process.env.AGY_ACP_DEFAULT_MODEL;
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-acp-test-"));
  });

  afterEach(async () => {
    delete process.env.FAKE_ACP_MODE;
    delete process.env.FAKE_ACP_CANCEL_REPLY;
    delete process.env.FAKE_ACP_DUMP;
    delete process.env.FAKE_ACP_RPC_DUMP;
    delete process.env.FAKE_ACP_RPC_APPEND_FILE;
    delete process.env.FAKE_ACP_RPC_FAILURE_FILE;
    delete process.env.FAKE_ACP_RPC_FAILURE_METHOD;
    delete process.env.FAKE_ACP_RPC_FAILURE_AFTER_OUTPUT;
    delete process.env.FAKE_ACP_REASONING_FAIL_TIMES;
    delete process.env.FAKE_ACP_REASONING_COUNT_FILE;
    delete process.env.SAGAX_ACP_REASONING_CONTINUE_MAX;
    delete process.env.FAKE_ACP_RPC_FAILURE_AFTER_USAGE;
    delete process.env.FAKE_ACP_LOAD_ERROR;
    delete process.env.FAKE_ACP_ALLOW_ALWAYS;
    delete process.env.FAKE_ACP_PERMISSION_ANSWER;
    delete process.env.FAKE_ACP_PERMISSION_TOOL_CALL;
    delete process.env.FAKE_ACP_PERMISSION_OPTIONS;
    delete process.env.FAKE_ACP_QUESTION_OPTIONS;
    delete process.env.FAKE_ACP_HOLD_ON_CANCELLED;
    delete process.env.XAI_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    delete process.env.CLINE_API_KEY;
    delete process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_AUTH_TOKEN;
    delete process.env.BOX_TOKEN;
    delete process.env.SAGAX_TTS_KEY;
    if (savedAgyModel !== undefined) process.env.AGY_ACP_DEFAULT_MODEL = savedAgyModel;
    else delete process.env.AGY_ACP_DEFAULT_MODEL;
    for (const name of Object.keys(CONTROL_PLANE_FIXTURE)) delete process.env[name];
    delete process.env.FAKE_ACP_MODELS;
    delete process.env.FAKE_ACP_MODEL_STICKS;
    delete process.env.FAKE_ACP_USAGE_ROOT;
    delete process.env.FAKE_ACP_LOAD_NULL;
    delete process.env.FAKE_ACP_REJECT_LIVE_LOAD_FILE;
    delete process.env.FAKE_ACP_IMAGE_CAPABILITY;
    delete process.env.FAKE_ACP_GROK_VERSION;
    delete process.env.FAKE_ACP_TOOL_MS;
    delete process.env.FAKE_ACP_USAGE_UPDATES_FILE;
    delete process.env.FAKE_ACP_DUMP_PROMPT;
    delete process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS;
    delete process.env.SAGAX_ACP_QUIET_NOTICE_MS;
    delete process.env.SAGAX_ACP_QUIET_TICK_MS;
    delete process.env.FAKE_ACP_QUIET_MS;
    delete process.env.FAKE_ACP_QWEN_LOG;
    delete process.env.FAKE_ACP_LOG_EVERY_MS;
    delete process.env.QWEN_HOME;
    delete process.env.SAGAX_ACP_SESSION_IDLE_MS;
    delete process.env.SAGAX_ACP_SESSION_IDLE_MIN_MS;
    delete process.env.FAKE_ACP_LAUNCH_COUNT_FILE;
    recorder?.stop();
    await instance?.dispose();
    vi.restoreAllMocks();
    await removeTempDir(scratch);
  });

  it("names the resolved executable when spawning it fails", async () => {
    const missing = join(scratch, "resolved-managed-runtime");
    const driver = createAcpDriver({
      ...SELECT_MODEL_SUPPORT,
      selectModel: undefined,
      resolveCommand: async () => ({ command: missing }),
    });
    instance = await driver.create({
      instanceId: "resolved-spawn-error",
      displayName: "Resolved spawn error",
      environment: {},
      enabled: true,
      config: { cli: "managed-alias", fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "t-resolved-spawn-error", text: "go" });
    await recorder.until((event) => event.type === "turn.completed");
    const error = recorder.events.find((event) => event.type === "runtime.error");
    expect(error?.message).toContain(missing);
    expect(error?.message).not.toContain("managed-alias");
  });

  it("pairs an unkeyed tool call's lifecycle events on one stable itemId", async () => {
    await create(GrokAgentDriver, "unkeyed-tool");
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-unkeyed-tool", text: "go" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    const started = recorder.events.find((e) => e.type === "item.started" && e.itemType === "tool");
    const completed = recorder.events.find((e) => e.type === "item.completed" && e.itemType === "tool");
    // The agent sent no toolCallId: without a synthetic id the completion
    // would be dropped by the itemId guard and the tool chip would never
    // show its result.
    expect(typeof started?.itemId).toBe("string");
    expect(started?.itemId).toBeTruthy();
    expect(completed?.itemId).toBe(started?.itemId);
  });

  it("normalizes a full turn into the canonical event sequence", async () => {
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-happy", text: "hi", model: "grok-4.5" });
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    expect(types).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.completed", // assistant_text before the tool, not summed on settle
      "item.started", // tool tc-1
      "item.completed", // tool tc-1 done
      "thread.token-usage.updated",
      "turn.completed",
    ]);
    expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "grokAgent")).toBe(true);
    expect(recorder.events.filter((event) => event.itemId === "tc-1")).toMatchObject([
      { type: "item.started", input: expect.stringContaining("/fixture/readme.md") },
      { type: "item.completed", output: expect.stringContaining("fixture file content") },
    ]);
    expect(JSON.stringify(recorder.events)).not.toContain("acp-input-secret");
    expect(JSON.stringify(recorder.events)).not.toContain("acp-output-secret");
    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated")!;
    expect(usage).toMatchObject({ input: 10, output: 5 });
    const text = recorder.events.find((e) => e.type === "item.completed" && (e as any).itemType === "assistant_text")!;
    expect((text as any).text).toBe("hello from fake acp");
    const done = recorder.events.at(-1)!;
    expect(done).toMatchObject({ type: "turn.completed", ok: true });
    expect(instance.adapter.hasSession("t-happy")).toBe(false);
  });

  it("sends images as negotiated ACP content blocks without copying bytes into diagnostics", async () => {
    const dump = join(scratch, "image-prompt.json");
    const imagePath = join(scratch, "tiny.webp");
    const bytes = Buffer.from("private-acp-image-bytes");
    const base64 = bytes.toString("base64");
    writeFileSync(imagePath, bytes);
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    process.env.FAKE_ACP_IMAGE_CAPABILITY = "1";
    await create(NativeImageDriver);

    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-acp-native-image",
      text: "What is this?",
      images: [{ path: imagePath, mime: "image/webp", bytes: bytes.length }],
    });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);

    expect(JSON.parse(readFileSync(`${dump}.prompt.json`, "utf8"))).toEqual([
      { type: "text", text: "What is this?" },
      { type: "image", data: base64, mimeType: "image/webp" },
    ]);
    const nativeLog = readFileSync(join(NATIVE_DIR, "t-acp-native-image.ndjson"), "utf8");
    expect(nativeLog).not.toContain(base64);
    expect(nativeLog).toContain(`[image data: ${base64.length} base64 chars]`);
  });

  it("delivers the full prompt once per native session and rides volatile changes as notes", async () => {
    const dump = join(scratch, "acp-prompt-split.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    await create();
    // The receipt store is keyed by thread and session id, so a unique thread
    // keeps the run hermetic against earlier executions of this suite.
    const threadId = "t-acp-prompt-split-" + randomUUID();
    const promptOf = () =>
      (JSON.parse(readFileSync(dump + ".prompt.json", "utf8")) as Array<{ type: string; text: string }>)[0]?.text;
    const send = async (text: string, volatile: string) => {
      const { turnId } = await instance.adapter.sendTurn({
        threadId,
        text,
        system: "Standing rules.\n\n" + volatile,
        systemStable: "Standing rules.",
        systemVolatile: volatile,
      });
      await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
      return promptOf();
    };

    // The establishing turn carries the full prompt, exactly as before.
    expect(await send("first", "Memory: likes quiet hours."))
      .toBe("Standing rules.\n\nMemory: likes quiet hours." + HINT + "\n\nfirst");
    // The pooled session already carries it: later turns go through bare.
    expect(await send("second", "Memory: likes quiet hours.")).toBe("second");
    // A changed volatile half rides the next prompt as a labelled note.
    expect(await send("third", "Memory: moved to Toronto."))
      .toBe("Context from Sagax updated since this conversation started; it replaces any earlier copy:\n\nMemory: moved to Toronto.\n\nthird");
    // A cleared volatile half is announced once, not silently dropped.
    expect(await send("fourth", "")).toContain("have been cleared");
    expect(await send("fifth", "")).toBe("fifth");
  });

  it("re-anchors the full prompt after eight bare turns on one native session", async () => {
    const dump = join(scratch, "acp-prompt-reanchor.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    await create();
    const threadId = "t-acp-prompt-reanchor-" + randomUUID();
    const promptOf = () =>
      (JSON.parse(readFileSync(dump + ".prompt.json", "utf8")) as Array<{ type: string; text: string }>)[0]?.text;
    const messages: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { turnId } = await instance.adapter.sendTurn({
        threadId,
        text: "turn " + i,
        system: "Standing rules.\n\nMemory: likes quiet hours.",
        systemStable: "Standing rules.",
        systemVolatile: "Memory: likes quiet hours.",
      });
      await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
      messages.push(promptOf()!);
    }
    // Agents can compact their own history away between turns; the re-anchor
    // backstop returns the standing instructions within a bounded window.
    const full = "Standing rules.\n\nMemory: likes quiet hours." + HINT;
    expect(messages[0]).toBe(full + "\n\nturn 0");
    for (let i = 1; i <= 8; i++) expect(messages[i]).toBe("turn " + i);
    expect(messages[9]).toBe(full + "\n\nturn 9");
  });

  // One split-prompt thread: usage() sets the context sizes the fake reports
  // on the next turn, and send() returns the prompt text the agent received.
  const SYSTEM = "Standing rules.\n\nMemory: likes quiet hours.";
  // Grok appends its standing tool line (stableSystemHint) to what it delivers
  const FULL = SYSTEM + HINT;
  const usageThread = async (name: string) => {
    const dump = join(scratch, `acp-${name}.json`);
    const usageFile = join(scratch, `acp-${name}-usage.json`);
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    process.env.FAKE_ACP_USAGE_UPDATES_FILE = usageFile;
    writeFileSync(usageFile, "[]");
    await create();
    const threadId = `t-acp-${name}-` + randomUUID();
    const usage = (...used: number[]) => writeFileSync(usageFile, JSON.stringify(used));
    const send = async (text: string, ok = true) => {
      const { turnId } = await instance.adapter.sendTurn({
        threadId,
        text,
        system: SYSTEM,
        systemStable: "Standing rules.",
        systemVolatile: "Memory: likes quiet hours.",
      });
      expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId)).toMatchObject({ ok });
      return (JSON.parse(readFileSync(dump + ".prompt.json", "utf8")) as Array<{ type: string; text: string }>)[0]?.text;
    };
    return { threadId, usage, send };
  };

  it("re-anchors the full prompt on the turn after the reported context collapses", async () => {
    const { usage, send } = await usageThread("compaction");
    expect(await send("turn 1")).toBe(FULL + "\n\nturn 1");
    usage(100000);
    expect(await send("turn 2")).toBe("turn 2");
    // the context collapses mid-turn (120000 -> 45000), so the next turn is full
    usage(120000, 45000);
    expect(await send("turn 3")).toBe("turn 3");
    usage();
    expect(await send("turn 4")).toBe(FULL + "\n\nturn 4");
    expect(await send("turn 5")).toBe("turn 5");
  });

  it("reports the agent's current context size and window so Sagax folds before the agent compacts", async () => {
    const { usage, send } = await usageThread("context-size");
    usage(90000, 120000);
    recorder.events.length = 0;
    await send("turn 1");
    const reported = recorder.events.filter((event) => event.type === "thread.token-usage.updated").at(-1);
    expect(reported).toMatchObject({ contextTokens: 120000, contextWindow: 200000 });
  });

  it("takes Grok's context size from its per-round usage when it sends no usage_update", async () => {
    process.env.FAKE_ACP_ROUND_USAGE = "1";
    try {
      const { usage, send } = await usageThread("round-usage");
      usage(60000, 131000);
      recorder.events.length = 0;
      await send("turn 1");
      const reported = recorder.events.filter((event) => event.type === "thread.token-usage.updated").at(-1);
      // the latest round's whole prompt (uncached + cached) is the context now
      expect(reported).toMatchObject({ contextTokens: 131000 });
      // and a collapse reported that way re-anchors the full prompt as well
      usage(120000, 40000);
      expect(await send("turn 2")).toBe("turn 2");
      usage();
      expect(await send("turn 3")).toBe(FULL + "\n\nturn 3");
    } finally {
      delete process.env.FAKE_ACP_ROUND_USAGE;
    }
  });

  it("keeps the split through an ordinary context dip", async () => {
    const { usage, send } = await usageThread("ordinary-dip");
    usage(108641);
    expect(await send("turn 1")).toBe(FULL + "\n\nturn 1");
    // a 17% dip is an ordinary step, not a compaction
    usage(90258);
    expect(await send("turn 2")).toBe("turn 2");
    expect(await send("turn 3")).toBe("turn 3");
  });

  it("detects a collapse against the previous turn's context", async () => {
    const { usage, send } = await usageThread("cross-turn");
    expect(await send("turn 1")).toBe(FULL + "\n\nturn 1");
    usage(150000);
    expect(await send("turn 2")).toBe("turn 2");
    // compaction before the first report: a collapse against last turn's peak
    usage(50000);
    expect(await send("turn 3")).toBe("turn 3");
    usage();
    expect(await send("turn 4")).toBe(FULL + "\n\nturn 4");
  });

  it("detects a cumulative collapse against an earlier turn's high-water mark", async () => {
    const { usage, send } = await usageThread("cumulative-collapse");
    usage(100000, 75000);
    expect(await send("turn 1")).toBe(FULL + "\n\nturn 1");
    // Neither adjacent dip exceeds 40%, but the total fall from the peak does.
    usage(50000);
    expect(await send("turn 2")).toBe("turn 2");
    usage();
    expect(await send("turn 3")).toBe(FULL + "\n\nturn 3");
    expect(await send("turn 4")).toBe("turn 4");
  });

  it.each([40000, 75000])("invalidates a rejected prompt's receipt only after compaction (usage: %s)", async (used) => {
    const failureFile = join(scratch, "compaction-failure.json");
    process.env.FAKE_ACP_RPC_FAILURE_FILE = failureFile;
    process.env.FAKE_ACP_RPC_FAILURE_AFTER_USAGE = "1";
    const { usage, send } = await usageThread("rejected-compaction");
    usage(100000);
    expect(await send("turn 1")).toBe(FULL + "\n\nturn 1");
    usage(used);
    writeFileSync(failureFile, JSON.stringify({ code: -32603, message: "Internal error after compaction" }));
    expect(await send("turn 2", false)).toBe("turn 2");
    unlinkSync(failureFile);
    usage();
    expect(await send("turn 3")).toBe(used < 60000 ? FULL + "\n\nturn 3" : "turn 3");
    expect(await send("turn 4")).toBe("turn 4");
  });

  it("ignores a zero usage report", async () => {
    const { usage, send } = await usageThread("zero-usage");
    usage(150000);
    expect(await send("turn 1")).toBe(FULL + "\n\nturn 1");
    // zero is not a measurement: no trigger, and the peak stays
    usage(0);
    expect(await send("turn 2")).toBe("turn 2");
    expect(await send("turn 3")).toBe("turn 3");
  });

  it("never triggers from a receipt written before lastUsed existed", async () => {
    const { threadId, usage, send } = await usageThread("legacy-receipt");
    // a legacy receipt has no lastUsed, so a low first reading is no collapse
    writePromptSplitReceipt(
      "grokAgent",
      JSON.stringify([threadId, "fake-acp-session"]),
      promptSplitFingerprints("Standing rules." + HINT, "Memory: likes quiet hours."),
    );
    usage(50000);
    expect(await send("turn 1")).toBe("turn 1");
    expect(await send("turn 2")).toBe("turn 2");
  });

  it("fails clearly when an image-capable adapter meets an older ACP runtime", async () => {
    const imagePath = join(scratch, "tiny.png");
    writeFileSync(imagePath, "not-read-before-capability-check");
    await create(NativeImageDriver);

    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-acp-image-unsupported",
      text: "Inspect this",
      images: [{ path: imagePath, mime: "image/png", bytes: 32 }],
    });
    const done = await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);

    expect(done).toMatchObject({ ok: false, stopReason: "rpc_error" });
    expect(recorder.events.find((event) => event.type === "runtime.error")?.message).toMatch(
      /does not advertise ACP image input/,
    );
  });

  it("keeps text-path fallback for adapters that do not advertise image input", async () => {
    const dump = join(scratch, "text-fallback.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    await create(SelectModelDriver);

    const text = '<attached-image path="/private/image.png" name="image.png" />';
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-acp-image-fallback",
      text,
      // A missing path proves the driver did not attempt native ingestion.
      images: [{ path: join(scratch, "missing.png"), mime: "image/png", bytes: 12 }],
    });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);

    expect(JSON.parse(readFileSync(`${dump}.prompt.json`, "utf8"))).toEqual([{ type: "text", text }]);
  });

  it("sends native images on Grok's verified runtime even with the false capability", async () => {
    const dump = join(scratch, "grok-image.json");
    const imagePath = join(scratch, "grok.png");
    const bytes = Buffer.from("synthetic-private-image");
    writeFileSync(imagePath, bytes);
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    process.env.FAKE_ACP_GROK_VERSION = "1.0.25";
    await create(GrokAgentDriver);
    expect(instance.adapter.capabilities.images).toBe(true);
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-grok-image", text: "Inspect", images: [{ path: imagePath, mime: "image/png", bytes: bytes.length }],
    });
    const done = await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    expect(done).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(`${dump}.prompt.json`, "utf8"))).toContainEqual({ type: "image", data: bytes.toString("base64"), mimeType: "image/png" });
    expect(readFileSync(join(NATIVE_DIR, "t-grok-image.ndjson"), "utf8")).not.toContain(bytes.toString("base64"));
  });

  it.each(["1.0.25", "1.0.62", "1.1.0", "1.12.3"])("keeps image support on later Grok 1.x releases (%s, engine parity: Grok 4.5 images)", (agentVersion) => {
    expect(grokAcceptsUnadvertisedImages({ _meta: { grokShell: true, agentVersion } })).toBe(true);
  });

  it.each([null, {}, { _meta: { grokShell: true, agentVersion: "1.0.24" } }, { _meta: { grokShell: true, agentVersion: "0.9.99" } }, { _meta: { grokShell: true, agentVersion: "2.0.3" } },
    { _meta: { grokShell: true, agentVersion: "1.0.25-preview" } },
    { _meta: { grokShell: false, agentVersion: "1.0.25" } }])("does not assume image support for unknown Grok runtime %j", (init) => {
    expect(grokAcceptsUnadvertisedImages(init)).toBe(false);
  });

  it("emits each assistant text block before the tool that follows it", async () => {
    await create(GrokAgentDriver, "interleave");
    await instance.adapter.sendTurn({ threadId: "t-interleave", text: "go", model: "grok-4.5" });
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    expect(types).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.completed", // before one
      "item.started", // tc-1
      "item.completed", // tc-1
      "content.delta",
      "item.completed", // before two
      "item.started", // tc-2
      "item.completed", // tc-2
      "content.delta",
      "thread.token-usage.updated",
      "item.completed", // after — no following tool, so settle flushes
      "turn.completed",
    ]);
    const texts = recorder.events
      .filter((e) => e.type === "item.completed" && (e as { itemType?: string }).itemType === "assistant_text")
      .map((e) => (e as { text: string }).text);
    expect(texts).toEqual(["before one", "before two", "after"]);
  });

  it("normalizes a structured ACP image block without treating it as text", async () => {
    await create(GeminiAgentDriver, "image");
    await instance.adapter.sendTurn({ threadId: "t-image", text: "draw it" });
    await recorder.until((event) => event.type === "turn.completed");

    const image = recorder.events.find(
      (event) => event.type === "item.completed" && event.itemType === "assistant_image",
    );
    expect(image).toMatchObject({
      type: "item.completed",
      itemType: "assistant_image",
      alt: "Generated image",
    });
    expect(image && "data" in image ? image.data : "").toMatch(/^iVBOR/);
    expect(
      recorder.events.some(
        (event) => event.type === "item.completed" && event.itemType === "assistant_text",
      ),
    ).toBe(false);
  });

  it("reads token usage from the root of the prompt result", async () => {
    process.env.FAKE_ACP_USAGE_ROOT = "1";
    await create();
    await instance.adapter.sendTurn({ threadId: "t-usage-root", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated");
    expect(usage).toMatchObject({ input: 10, output: 5 });
  });

  /** The fake CLI hardcodes its usage fixture, so the cache-usage tests tap
   *  the spawned child's stdout in flight and splice the wanted usage into
   *  the one reply that carries stopReason — the session/prompt result — at
   *  the root or under _meta, the two shapes real agents send. */
  const stubPromptResultUsage = (usage: Record<string, unknown>, at: "root" | "meta") => {
    const spawn = procs.spawnCli;
    vi.spyOn(procs, "spawnCli").mockImplementation((...args) => {
      const child = spawn(...args);
      const stdout = child.stdout;
      const spliceUsage = (message: any) => {
        if (message?.result && typeof message.result === "object" && "stopReason" in message.result) {
          message.result = at === "root"
            ? { ...message.result, usage: { ...usage }, _meta: {} }
            : { ...message.result, _meta: { ...message.result._meta, ...usage } };
        }
        return message;
      };
      const rewriteChunk = (chunk: string) =>
        chunk.split("\n").map((line) => {
          if (!line.includes("stopReason")) return line;
          try {
            return JSON.stringify(spliceUsage(JSON.parse(line)));
          } catch {
            return line; // not a complete wire message: pass it through untouched
          }
        }).join("\n");
      const realOn = stdout.on.bind(stdout);
      vi.spyOn(stdout, "on").mockImplementation(((event: string, listener: (chunk: string) => void) =>
        realOn(event, event === "data" ? (chunk: string) => listener(rewriteChunk(String(chunk))) : listener)) as never);
      return child;
    });
  };

  it("folds opencode cache reads into input and names them", async () => {
    stubPromptResultUsage(
      { inputTokens: 5030, outputTokens: 3, cachedReadTokens: 152960, totalTokens: 157993 },
      "root",
    );
    await create();
    await instance.adapter.sendTurn({ threadId: "t-usage-cache-exclusive", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated");
    expect(usage).toMatchObject({ input: 157990, output: 3, cachedInput: 152960 });
  });

  it("leaves input alone when totalTokens shows cache reads already inside it", async () => {
    stubPromptResultUsage(
      { inputTokens: 1000, outputTokens: 10, cachedReadTokens: 800, totalTokens: 1010 },
      "root",
    );
    await create();
    await instance.adapter.sendTurn({ threadId: "t-usage-cache-inclusive", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated");
    expect(usage).toMatchObject({ input: 1000, output: 10, cachedInput: 800 });
  });

  it("emits no cachedInput when the result reports no cache reads", async () => {
    stubPromptResultUsage({ inputTokens: 900, outputTokens: 20, totalTokens: 920 }, "root");
    await create();
    await instance.adapter.sendTurn({ threadId: "t-usage-cache-absent", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated");
    expect(usage).toMatchObject({ input: 900, output: 20 });
    expect(usage && "cachedInput" in usage).toBe(false);
  });

  it("reads cache reads from _meta usage too", async () => {
    stubPromptResultUsage(
      { inputTokens: 5030, outputTokens: 3, cachedReadTokens: 152960, totalTokens: 157993 },
      "meta",
    );
    await create();
    await instance.adapter.sendTurn({ threadId: "t-usage-cache-meta", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated");
    expect(usage).toMatchObject({ input: 157990, output: 3, cachedInput: 152960 });
  });

  it("passes ACP stdio flags and strips foreign provider keys from the child env", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.XAI_API_KEY = "xai-should-not-leak";
    process.env.OPENCODE_API_KEY = "opencode-should-not-leak";
    process.env.CLINE_API_KEY = "cline-should-not-leak";
    process.env.CURSOR_API_KEY = "cursor-should-not-leak";
    process.env.CURSOR_AUTH_TOKEN = "cursor-token-should-not-leak";
    // workspace credentials with no CLI consumer at all — held by the
    // harness (env-injected at boot by the desktop shell), used in-process
    process.env.BOX_TOKEN = "box-should-not-leak";
    process.env.SAGAX_TTS_KEY = "tts-should-not-leak";
    Object.assign(process.env, CONTROL_PLANE_FIXTURE);

    await instance.adapter.sendTurn({ threadId: "t-hygiene", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("agent");
    expect(seen.argv).toContain("stdio");
    expect(seen.argv).toContain("--permission-mode");
    expect(seen.env.XAI_API_KEY).toBeUndefined();
    expect(seen.env.OPENCODE_API_KEY).toBeUndefined();
    expect(seen.env.CLINE_API_KEY).toBeUndefined();
    expect(seen.env.CURSOR_API_KEY).toBeUndefined();
    expect(seen.env.CURSOR_AUTH_TOKEN).toBeUndefined();
    expect(seen.env.BOX_TOKEN).toBeUndefined();
    expect(seen.env.SAGAX_TTS_KEY).toBeUndefined();
    for (const name of Object.keys(CONTROL_PLANE_FIXTURE)) expect(seen.env[name]).toBeUndefined();
  });

  it.each([false, true])("mounts Data through the existing stdio transport unless excluded (excluded=%s)", async (excluded) => {
    await create();
    const dump = join(scratch, "data.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    const data = { command: process.execPath, args: [join(scratch, "data-proxy.mjs")], env: { SAGAX_DATA_TOKEN: "synthetic-turn-capability" } };
    expect(instance.adapter.capabilities.dataMcp).toBe(true);
    await instance.adapter.sendTurn({
      threadId: "t-data", text: "Update the existing result.", system: BUILT_IN_DATA_SYSTEM_PROMPT,
      integrations: { data }, ...(excluded ? { toolScope: { allow: ["native:*"] } } : {}),
    });
    expect(await recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(`${dump}.mcp.json`, "utf8"))).toEqual(excluded ? [] : [{
      name: "data", ...data, env: [{ name: "SAGAX_DATA_TOKEN", value: "synthetic-turn-capability" }],
    }]);
    const prompt = JSON.parse(readFileSync(`${dump}.prompt.json`, "utf8")) as Array<{ type: string; text?: string }>;
    expect(prompt.find(block => block.type === "text")?.text).toContain(BUILT_IN_DATA_SYSTEM_PROMPT.trim());
  });

  it("droid takes model and autonomy over the wire, never through argv", async () => {
    // `droid exec -m <id> -o acp` ignores the flag (verified against 0.196.0),
    // so a model that only reached argv would silently run the CLI's own pick.
    instance = await DroidAgentDriver.create({
      instanceId: "droid-test",
      displayName: "Droid Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);
    const dump = join(scratch, "droid-dump.json");
    process.env.FAKE_ACP_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-droid", text: "go", model: "claude-sonnet-5" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toEqual(["exec", "-o", "acp"]);
    expect(seen.argv).not.toContain("-m");

    const applied = JSON.parse(readFileSync(`${dump}.config.json`, "utf8"));
    expect(applied).toEqual([
      { method: "session/set_mode", params: { sessionId: "fake-acp-session", modeId: "auto-high" } },
      { method: "session/set_model", params: { sessionId: "fake-acp-session", modelId: "claude-sonnet-5" } },
    ]);
  });

  it("droid pins read-only mode when fullAuto is off", async () => {
    instance = await DroidAgentDriver.create({
      instanceId: "droid-safe",
      displayName: "Droid Safe",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
    const dump = join(scratch, "droid-safe.json");
    process.env.FAKE_ACP_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-droid-safe", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    // Both settings are explicit even with nothing on the turn: whatever
    // ~/.factory/settings.json pinned (including a `custom:` provider with its
    // own endpoint) must never be what the session silently runs on.
    expect(JSON.parse(readFileSync(`${dump}.config.json`, "utf8"))).toEqual([
      { method: "session/set_mode", params: { sessionId: "fake-acp-session", modeId: "normal" } },
      { method: "session/set_model", params: { sessionId: "fake-acp-session", modelId: "claude-opus-5" } },
    ]);
  });

  it("droid names the rejected setting when the agent predates session config", async () => {
    // The realistic failure is version skew: an older droid answers -32601 to
    // session/set_mode, and core surfaces the RPC message verbatim. A bare
    // "method not found" tells the user nothing, so the driver wraps it.
    process.env.FAKE_ACP_MODE = "no-session-config";
    instance = await DroidAgentDriver.create({
      instanceId: "droid-old-cli",
      displayName: "Droid Old CLI",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "t-droid-skew", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "rpc_error" });
    const err = recorder.events.find((e) => e.type === "runtime.error")!;
    expect(err.message).toContain("session/set_mode");
    expect(err.message).toContain('autonomy mode "normal"');
    expect(err.message).toMatch(/`droid` is current/);
    // The session id still reached the client, so the thread can resume rather
    // than orphaning the session droid just created.
    expect(recorder.events.some((e) => e.type === "session.started")).toBe(true);
  });

  it("mounts local CUA only on an approval-capable ACP instance", async () => {
    await create();
    const dump = join(scratch, "local-dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    await instance.adapter.sendTurn({
      threadId: "t-local",
      text: "inspect",
      integrations: {
        localComputer: {
          command: "/opt/cua driver/cua-driver",
          args: ["mcp", "--embedded", "--socket", "/run/user/1000/driver.sock"],
          env: { CUA_DRIVER_EMBEDDED: "1" },
          platform: "linux",
          generation: "generation-1",
          scope: "local-computer",
        },
      },
    });
    await recorder.until((event) => event.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpServers).toContainEqual({
      name: "computer",
      command: "/opt/cua driver/cua-driver",
      args: ["mcp", "--embedded", "--socket", "/run/user/1000/driver.sock"],
      env: [{ name: "CUA_DRIVER_EMBEDDED", value: "1" }],
    });
    expect(instance.adapter.capabilities.localComputerMcp).toBe(true);
  });

  it("mounts user-configured custom MCP servers after the built-ins", async () => {
    await create();
    const dump = join(scratch, "custom-dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    await instance.adapter.sendTurn({
      threadId: "t-custom-mcp",
      text: "go",
      integrations: {
        custom: {
          notes: { command: "npx", args: ["-y", "@x/notes-mcp"], env: { NOTES_TOKEN: "tok-1" } },
        },
      },
    });
    await recorder.until((event) => event.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(ungated(seen.mcpServers)).toContainEqual({
      name: "notes",
      command: "npx",
      args: ["-y", "@x/notes-mcp"],
      env: [{ name: "NOTES_TOKEN", value: "tok-1" }],
    });
    expect(instance.adapter.capabilities.customMcp).toBe(true);
  });

  const remoteServers = {
    docs: { type: "http" as const, url: "https://docs.example/mcp", headers: { Authorization: "Bearer tok-docs" } },
    legacy: { type: "sse" as const, url: "https://old.example/sse", headers: {} },
    notes: { command: "npx", args: [], env: {} },
  };

  /** The settings a remote-proxy mount carries in its env (mcp-gate-config.ts). */
  const proxied = (server: { command?: string; args?: string[]; env?: Array<{ name: string; value: string }> }) => {
    const value = server.env?.find((entry) => entry.name === "SAGAX_REMOTE_MCP_SERVER")?.value;
    return value === undefined ? undefined : JSON.parse(value);
  };

  it.each([
    ["advertises no remote transport", undefined],
    ["advertises http and sse", "http,sse"],
  ])("mounts every url server as Sagax's connector for an agent that %s", async (_name, transports) => {
    if (transports) process.env.FAKE_ACP_MCP_TRANSPORTS = transports;
    try {
      await create();
      const dump = join(scratch, "remote-mcp.json");
      process.env.FAKE_ACP_DUMP = dump;
      await instance.adapter.sendTurn({ threadId: "t-remote-mcp", text: "go", integrations: { custom: remoteServers } });
      await recorder.until((event) => event.type === "turn.completed");
      const seen = JSON.parse(readFileSync(dump, "utf8"));
      expect(ungated(seen.mcpServers).map((server: { name: string }) => server.name)).toEqual(["docs", "legacy", "notes"]);
      // never ACP's http/sse shape, so the agent's own client never connects
      expect(ungated(seen.mcpServers).some((server: object) => "url" in server || "type" in server)).toBe(false);
      const docs = ungated(seen.mcpServers).find((server: { name: string }) => server.name === "docs");
      expect(docs.args.join(" ")).toContain("mcp-remote-proxy");
      expect(docs.args.join(" ")).not.toContain("tok-docs");
      expect(proxied(docs)).toEqual(remoteServers.docs);
      // the agent searches tools itself: the catalog passes through
      expect(docs.env.some((entry: { name: string }) => entry.name === "SAGAX_REMOTE_MCP_DIRECTORY")).toBe(false);
      expect(proxied(ungated(seen.mcpServers).find((server: { name: string }) => server.name === "legacy"))).toEqual(remoteServers.legacy);
    } finally {
      delete process.env.FAKE_ACP_MCP_TRANSPORTS;
    }
  });

  // A server that deserializes initialize strictly (a Voluum server:
  // "Unrecognized field 'schemaValidation'") refuses grok 1.0.25's own
  // handshake (capabilities.extensions). The fake agent connects each
  // mounted server with that handshake, natively if it were handed a URL.
  it("lists a strict url server's tools through Sagax's connector, even for an agent that speaks http", async () => {
    const strict = await startFakeHttpMcp({ strictInitialize: "http-400", strictSchema: "2025-11-25",
      tools: [{ name: "report", inputSchema: { type: "object" } }, { name: "campaigns", inputSchema: { type: "object" } }],
      requireHeader: { name: "Authorization", value: "Bearer tok-voluum" } });
    process.env.FAKE_ACP_MCP_TRANSPORTS = "http,sse";
    try {
      await create(GrokAgentDriver, "mcp-tools");
      await instance.adapter.sendTurn({ threadId: "t-strict-acp", text: "go", integrations: { custom: {
        voluum: { type: "http", url: strict.url, headers: { Authorization: "Bearer tok-voluum" } },
      } } });
      expect(await recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
      const text = recorder.events.find((event) => event.type === "item.completed" && (event as { itemType?: string }).itemType === "assistant_text");
      expect((text as { text?: string } | undefined)?.text).toBe("voluum: report,campaigns");
      expect(strict.initializes).toEqual([{ protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Sagax tool proxy", version: "1" } }]);
    } finally {
      delete process.env.FAKE_ACP_MCP_TRANSPORTS;
      await strict.close();
    }
  });

  it("keeps a tool selection's gate in front of the connector", async () => {
    const strict = await startFakeHttpMcp({ strictInitialize: "http-400", tools: [{ name: "report", inputSchema: { type: "object" } }, { name: "campaigns", inputSchema: { type: "object" } }] });
    try {
      // Kimi: Grok also checks its own catalog over _x.ai/mcp/list, which
      // the fake does not keep
      await create(KimiAgentDriver, "mcp-tools");
      await instance.adapter.sendTurn({ threadId: "t-strict-acp-scoped", text: "go", toolScope: { allow: ["native:*", "mcp:voluum:report"] },
        integrations: { custom: { voluum: { type: "http", url: strict.url, headers: {} } } } });
      expect(await recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
      const text = recorder.events.find((event) => event.type === "item.completed" && (event as { itemType?: string }).itemType === "assistant_text");
      expect((text as { text?: string } | undefined)?.text).toBe("voluum: report");
      expect(strict.initializes).toHaveLength(1);
    } finally {
      await strict.close();
    }
  });

  it("surfaces a permission ask as request.opened and completes once allowed", async () => {
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({
      threadId: "t-perm",
      text: "go",
      cwd: scratch,
      integrations: {
        localComputer: {
          command: "/cua-driver",
          args: ["mcp"],
          env: {},
          platform: "linux",
          scope: "local-computer",
        },
      },
    });
    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({
      requestType: "permission",
      tool: "shell",
      approvalScope: "local-computer",
      command: { command: "echo hi", cwd: realpathSync(scratch) },
    });

    expect(await instance.adapter.respondToRequest("t-perm", (opened as any).requestId, { behavior: "allow" })).toBe("allowed-once");
    const resolved = await recorder.until((e) => e.type === "request.resolved");
    expect(resolved).toMatchObject({
      behavior: "allow",
      source: "user",
      approvalScope: "local-computer",
    });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it.each([
    { name: "full raw command", toolCall: { kind: "execute", rawInput: { command: `printf '  ${"complete input ".repeat(30)}'\n  pwd  ` } }, descriptor: true },
    { name: "title without raw input", toolCall: { kind: "execute", title: "echo display only" }, descriptor: false },
    { name: "argv raw input", toolCall: { kind: "execute", rawInput: { command: ["echo", "do not join argv"] } }, descriptor: false },
    { name: "MCP tool", toolCall: { kind: "other", title: "mcp__example__run", rawInput: { command: "echo not a shell approval" } }, descriptor: false },
    { name: "MCP execute tool", toolCall: { kind: "execute", title: "mcp__example__run", rawInput: { command: "echo not a native shell approval" } }, descriptor: false },
    { name: "question", toolCall: { toolCallId: "interaction_command", kind: "execute", rawInput: { command: "echo not a shell approval" } }, descriptor: false },
    { name: "relative cwd", toolCall: { kind: "execute", rawInput: { command: "pwd", cwd: "unknown-relative-directory" } }, descriptor: false },
  ])("keeps command grants scoped to complete shell input: $name", async ({ toolCall, descriptor }) => {
    process.env.FAKE_ACP_PERMISSION_TOOL_CALL = JSON.stringify(toolCall);
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-acp-command-descriptor", text: "go", cwd: scratch });
    const opened = await recorder.until((event) => event.type === "request.opened");
    expect(opened).toHaveProperty("command", descriptor ? { command: toolCall.rawInput?.command, cwd: realpathSync(scratch) } : undefined);
    await instance.adapter.respondToRequest("t-acp-command-descriptor", opened.requestId!, { behavior: "deny" });
    await recorder.until((event) => event.type === "turn.completed");
  });

  it.each([
    { name: "Grok's agents tool", toolCall: { kind: "other", title: "agents__list_bots", rawInput: {} }, mcpTool: "agents__list_bots" },
    { name: "a qualified MCP title", toolCall: { kind: "read", title: "mcp__agents__session_read", rawInput: {} }, mcpTool: "mcp__agents__session_read" },
    { name: "a shell command titled like a tool", toolCall: { kind: "execute", title: "agents__list_bots", rawInput: { command: "agents__list_bots" } }, mcpTool: undefined },
    { name: "a file edit", toolCall: { kind: "edit", title: "agents__list_bots", rawInput: {} }, mcpTool: undefined },
    { name: "a descriptive title", toolCall: { kind: "other", title: "List the bots", rawInput: {} }, mcpTool: undefined },
  ])("names the MCP tool of a permission ask from the agent's own title: $name", async ({ toolCall, mcpTool }) => {
    process.env.FAKE_ACP_PERMISSION_TOOL_CALL = JSON.stringify(toolCall);
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-acp-mcp-tool", text: "go", cwd: scratch });
    const opened = await recorder.until((event) => event.type === "request.opened");
    expect((opened as { mcpTool?: string }).mcpTool).toBe(mcpTool);
    await instance.adapter.respondToRequest("t-acp-mcp-tool", opened.requestId!, { behavior: "deny" });
    await recorder.until((event) => event.type === "turn.completed");
  });

  it("uses an explicit ACP shell directory and rejects conflicting directory metadata", async () => {
    const command = "pwd";
    const directory = join(scratch, "execution-directory");
    process.env.FAKE_ACP_PERMISSION_TOOL_CALL = JSON.stringify({ kind: "execute", rawInput: { command, workdir: directory } });
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-acp-explicit-cwd", text: "go", cwd: scratch });
    const opened = await recorder.until((event) => event.type === "request.opened");
    expect(opened).toHaveProperty("command", { command, cwd: directory });
    await instance.adapter.respondToRequest("t-acp-explicit-cwd", opened.requestId!, { behavior: "deny" });
    await recorder.until((event) => event.type === "turn.completed");

    // A separate process observes a new fake provider payload.
    await instance.dispose();
    recorder.stop();
    process.env.FAKE_ACP_PERMISSION_TOOL_CALL = JSON.stringify({ kind: "execute", rawInput: { command, cwd: scratch, workdir: directory } });
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-acp-conflicting-cwd", text: "go", cwd: scratch });
    const conflict = await recorder.until((event) => event.type === "request.opened");
    expect(conflict).toHaveProperty("command", undefined);
    await instance.adapter.respondToRequest("t-acp-conflicting-cwd", conflict.requestId!, { behavior: "deny" });
    await recorder.until((event) => event.type === "turn.completed");
  });

  it("emits a structured question beside the flat choices", async () => {
    await create(GrokAgentDriver, "question");
    await instance.adapter.sendTurn({ threadId: "t-question-shape", text: "go" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({
      requestType: "question",
      summary: "Which color?",
      choices: ["Blue", "Green"],
      questions: [{ question: "Which color?", options: [{ label: "Blue" }, { label: "Green" }] }],
    });
  });

  it("answers a structured card reply by recovering the picked option", async () => {
    const answer = join(scratch, "question-answer.txt");
    process.env.FAKE_ACP_PERMISSION_ANSWER = answer;
    await create(GrokAgentDriver, "question");
    await instance.adapter.sendTurn({ threadId: "t-question-answer", text: "go" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    // Exactly what the tabbed QuestionCard submits: one Q:/A: block for the
    // single question, not a bare option label.
    const outcome = await instance.adapter.respondToRequest("t-question-answer", (opened as { requestId: string }).requestId, {
      behavior: "answer",
      message: "The user answered your questions.\n\nQ: Which color?\nA: Green",
    });
    expect(outcome).toBe("answered");
    const resolved = await recorder.until((e) => e.type === "request.resolved");
    expect(resolved).toMatchObject({ behavior: "answer", source: "user" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(readFileSync(answer, "utf8")).toBe("green-id");
  });

  it("cancels a question whose answer matches no offered option", async () => {
    const answer = join(scratch, "question-cancel.txt");
    process.env.FAKE_ACP_PERMISSION_ANSWER = answer;
    await create(GrokAgentDriver, "question");
    await instance.adapter.sendTurn({ threadId: "t-question-cancel", text: "go" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    await instance.adapter.respondToRequest("t-question-cancel", (opened as { requestId: string }).requestId, {
      behavior: "answer",
      message: "Purple",
    });
    const resolved = await recorder.until((e) => e.type === "request.resolved");
    expect(resolved).toMatchObject({ behavior: "deny", source: "system" });
    const error = recorder.events.find((e) => e.type === "runtime.error") as { message: string } | undefined;
    expect(error?.message).toContain("isn't one of the choices");
    expect(error?.message).not.toContain("Agent");
    await recorder.until((e) => e.type === "turn.completed");
    expect(readFileSync(answer, "utf8")).toBe("cancelled");
  });

  it("marks an ACP question as options-only, so the card offers no free text", async () => {
    await create(GrokAgentDriver, "question");
    await instance.adapter.sendTurn({ threadId: "t-question-custom", text: "go" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({ questions: [{ question: "Which color?", custom: false }] });
  });

  // Antigravity's shape: options carry their own ids and names, and after a
  // "cancelled" outcome the agent waits for session/cancel instead of going on.
  it.each([
    { name: "a typed answer", response: { behavior: "answer", message: "The user answered your questions.\n\nQ: Which article?\nA: my own article" }, error: true },
    { name: "a closed question", response: { behavior: "deny" }, error: false },
  ])("ends the turn instead of hanging after $name matches no option", async ({ response, error }) => {
    process.env.FAKE_ACP_HOLD_ON_CANCELLED = "1";
    process.env.FAKE_ACP_QUESTION_OPTIONS = JSON.stringify([
      { optionId: "opt-0", kind: "allow_once", name: "Machines of Loving Grace (Recommended)" },
      { optionId: "opt-1", kind: "allow_once", name: "A new piece on reasoning models" },
    ]);
    const answer = join(scratch, "question-hold.txt");
    process.env.FAKE_ACP_PERMISSION_ANSWER = answer;
    await create(GrokAgentDriver, "question");
    await instance.adapter.sendTurn({ threadId: "t-question-hold", text: "go" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    await instance.adapter.respondToRequest("t-question-hold", (opened as { requestId: string }).requestId, response as never);
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ stopReason: "cancelled" });
    expect(readFileSync(answer, "utf8")).toBe("cancelled");
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(error);
  });

  it("still sends the picked option id on Antigravity's option shape", async () => {
    process.env.FAKE_ACP_HOLD_ON_CANCELLED = "1";
    process.env.FAKE_ACP_QUESTION_OPTIONS = JSON.stringify([
      { optionId: "opt-0", kind: "allow_once", name: "Machines of Loving Grace (Recommended)" },
      { optionId: "opt-1", kind: "allow_once", name: "A new piece on reasoning models" },
    ]);
    const answer = join(scratch, "question-pick.txt");
    process.env.FAKE_ACP_PERMISSION_ANSWER = answer;
    await create(GrokAgentDriver, "question");
    await instance.adapter.sendTurn({ threadId: "t-question-pick", text: "go" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(await instance.adapter.respondToRequest("t-question-pick", (opened as { requestId: string }).requestId, {
      behavior: "answer",
      message: "The user answered your questions.\n\nQ: Which color?\nA: A new piece on reasoning models",
    })).toBe("answered");
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
    expect(readFileSync(answer, "utf8")).toBe("opt-1");
  });

  it.each([false, true])("maps capped labels back to their option id, refusing collisions (%s)", async collision => {
    const label = "Green ".repeat(30);
    const answer = join(scratch, "long-question-answer.txt");
    process.env.FAKE_ACP_PERMISSION_ANSWER = answer;
    process.env.FAKE_ACP_QUESTION_OPTIONS = JSON.stringify([
      { optionId: "green-id", kind: "allow_once", name: label },
      { optionId: "other-id", kind: "allow_once", name: collision ? label + "other" : "Blue" },
    ]);
    await create(GrokAgentDriver, "question");
    await instance.adapter.sendTurn({ threadId: "t-long-question", text: "go" });
    const opened = await recorder.until(e => e.type === "request.opened");
    expect(opened).toMatchObject({ choices: expect.arrayContaining([label.trim().slice(0, 120).trim()]) });
    await instance.adapter.respondToRequest("t-long-question", (opened as { requestId: string }).requestId, {
      behavior: "answer",
      message: `The user answered your questions.\n\nQ: Which color?\nA: ${label.trim().slice(0, 120)}`,
    });
    await recorder.until(e => e.type === "turn.completed");
    expect(readFileSync(answer, "utf8")).toBe(collision ? "cancelled" : "green-id");
  });

  it("per-bot Ask surfaces permissions from a legacy full-auto instance", async () => {
    process.env.FAKE_ACP_MODE = "permission";
    const dump = join(scratch, "ask-permission-overrides-full-auto.json");
    process.env.FAKE_ACP_DUMP = dump;
    instance = await GrokAgentDriver.create({
      instanceId: "grok-ask-override",
      displayName: "Grok Ask Override",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({
      threadId: "t-ask-permission-override",
      text: "go",
      approvalMode: "ask",
    });
    const opened = await recorder.until((e) => e.type === "request.opened");
    const argv = JSON.parse(readFileSync(dump, "utf8")).argv as string[];
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("default");

    await instance.adapter.respondToRequest(
      "t-ask-permission-override",
      (opened as { requestId: string }).requestId,
      { behavior: "allow" },
    );
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("maps Auto-accept edits to Grok's native acceptEdits", async () => {
    await create(GrokAgentDriver);
    const dump = join(scratch, "grok-edits.json");
    process.env.FAKE_ACP_DUMP = dump;
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-grok-edits", text: "go", approvalMode: "edits" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    const argv = JSON.parse(readFileSync(dump, "utf8")).argv as string[];
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
  });

  it.each([false, true])("returns rejected when an allow has no native permission option (always: %s)", async (always) => {
    process.env.FAKE_ACP_PERMISSION_OPTIONS = JSON.stringify([{ optionId: "reject", kind: "reject_once" }]);
    const answer = join(scratch, "reject-only-answer.txt");
    process.env.FAKE_ACP_PERMISSION_ANSWER = answer;
    await create(GrokAgentDriver, "permission");
    const threadId = "t-reject-only";
    await instance.adapter.sendTurn({ threadId, text: "go", approvalMode: "ask" });
    const opened = await recorder.until((event) => event.type === "request.opened");
    expect(await instance.adapter.respondToRequest(threadId, "unknown-request", { behavior: "allow" })).toBe("unavailable");
    expect(await instance.adapter.respondToRequest(threadId, opened.requestId!, { behavior: "allow", always })).toBe("rejected");
    const resolved = await recorder.until((event) => event.type === "request.resolved" && event.requestId === opened.requestId);
    expect(resolved).toMatchObject({ behavior: "deny", source: "system" });
    await recorder.until((event) => event.type === "turn.completed");
    expect(readFileSync(answer, "utf8")).toBe("cancelled");
    expect(await instance.adapter.respondToRequest(threadId, opened.requestId!, { behavior: "allow" })).toBe("unavailable");
  });

  it("hands 'Always allow this session' to the agent's own allow_always option", async () => {
    process.env.FAKE_ACP_ALLOW_ALWAYS = "1";
    const answer = join(scratch, "permission-answer.txt");
    process.env.FAKE_ACP_PERMISSION_ANSWER = answer;
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-always-native", text: "go", approvalMode: "ask" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    // the card may offer it: the driver can honor a session-wide allow
    expect(opened).toHaveProperty("allowSession", true);
    await instance.adapter.respondToRequest("t-always-native", (opened as { requestId: string }).requestId, { behavior: "allow", always: true });
    await recorder.until((e) => e.type === "turn.completed");
    expect(readFileSync(answer, "utf8")).toBe("allow-always");
  });

  it("remembers the exact operation for the session when the agent offers no allow_always", async () => {
    // Grok 4.6 often omits allow_always. The driver then answers allow_once
    // and repeats the person's answer for that exact operation on the
    // resumed session — and only that operation, and only that session.
    const answer = join(scratch, "permission-answer-once.txt");
    process.env.FAKE_ACP_PERMISSION_ANSWER = answer;
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-always-memory", text: "go", approvalMode: "ask" });
    const opened = await recorder.until((e) => e.type === "request.opened");
    await instance.adapter.respondToRequest("t-always-memory", (opened as { requestId: string }).requestId, { behavior: "allow", always: true });
    await recorder.until((e) => e.type === "turn.completed");
    expect(readFileSync(answer, "utf8")).toBe("allow-once");

    // same operation on the resumed session: answered without a card
    const second = await instance.adapter.sendTurn({ threadId: "t-always-memory", text: "again", approvalMode: "ask", resumeCursor: "fake-acp-session" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    expect(recorder.events.filter((e) => e.type === "request.opened")).toHaveLength(1);
    expect(readFileSync(answer, "utf8")).toBe("allow-once");

    // a fresh native session forgets it
    // the pool keeps the native session alive between turns; stopAll closes it so the third turn really is a fresh native session
    await instance.adapter.stopAll();
    const third = await instance.adapter.sendTurn({ threadId: "t-always-memory", text: "fresh", approvalMode: "ask" });
    const reopened = await recorder.until((e) => e.type === "request.opened" && e.turnId === third.turnId);
    await instance.adapter.respondToRequest("t-always-memory", (reopened as { requestId: string }).requestId, { behavior: "deny" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === third.turnId);
    expect(recorder.events.filter((e) => e.type === "request.opened")).toHaveLength(2);
  });

  it.each(["grok-4.7", "grok-4.6", "grok-4.5", "local-model"])(
    "keeps native Grok Auto (bots opted out of the gate) when selecting and resuming %s",
    async (model) => {
      // Auto is gated by default (grok-approval-gate.ts); this is the opt-out path
      writeFileSync(join(DATA_DIR, "grok-approval-gate.json"), JSON.stringify({ bots: "none" }));
      onTestFinished(() => rmSync(join(DATA_DIR, "grok-approval-gate.json"), { force: true }));
      await create(GrokAgentDriver);
      const agents = { command: "node", args: ["/fixture/agents-proxy.mjs"], env: {} };
      for (const resumeCursor of [undefined, "fake-acp-session"]) {
        const dump = join(scratch, `grok-auto-${resumeCursor ? "resume" : "new"}.json`);
        const threadId = `t-grok-auto-${model}-${resumeCursor ? "resume" : "new"}`;
        process.env.FAKE_ACP_DUMP = dump;
        const { turnId } = await instance.adapter.sendTurn({
          threadId,
          text: "read the roster",
          model,
          effort: "high",
          approvalMode: "auto",
          resumeCursor,
          integrations: {
            agents,
            custom: { agents: { command: "must-not-shadow-agents", args: [], env: {} } },
          },
        });
        await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
        const seen = JSON.parse(readFileSync(dump, "utf8"));
        expect(seen.argv).toEqual([
          "--permission-mode", "auto", ...AGENTS_READ_ONLY_ALLOW,
          "agent", "-m", model, "--reasoning-effort", "high", "stdio",
        ]);
        const sessionMethod = resumeCursor ? "session/load" : "session/new";
        const sent = readFileSync(join(NATIVE_DIR, `${threadId}.ndjson`), "utf8")
          .trim().split("\n").map((line) => JSON.parse(line))
          .find((entry) => entry.dir === "out" && entry.msg.method === sessionMethod);
        expect(sent.msg.params.mcpServers).toEqual([{ name: "agents", ...agents, env: [] }]);
        expect(JSON.parse(readFileSync(`${dump}.config.json`, "utf8"))).toEqual([
          { method: "session/set_model", params: { sessionId: "fake-acp-session", modelId: model } },
        ]);
        expect(recorder.events.find((e) => e.type === "session.started" && e.turnId === turnId))
          .toMatchObject({ model });
      }
    },
  );

  describe("Sagax approval gate (Grok default mode)", () => {
    // An upstream MCP server that records every call it actually runs.
    const RECORDING_MCP = `
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "tools/call") appendFileSync(process.env.CALLS, process.env.SERVER + ":" + msg.params.name + "\\n");
  const result = msg.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "rec", version: "1" } }
    : msg.method === "tools/call" ? { content: [{ type: "text", text: "ran " + msg.params.name }] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
});
`;
    const flagFile = join(DATA_DIR, "grok-approval-gate.json");
    let calls: string;
    const server = (name: string) => {
      const path = join(scratch, "recording-mcp.cjs");
      writeFileSync(path, RECORDING_MCP);
      return { command: process.execPath, args: [path], env: { CALLS: calls, SERVER: name } };
    };
    const ran = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : [];
    const opened = (turnId: string) => recorder.events.filter((e) => e.type === "request.opened" && e.turnId === turnId) as Array<{ requestId: string; mcpTool?: string; requestType?: string; allowSession?: boolean }>;
    const nextCard = (turnId: string, count: number) => recorder.until(() => opened(turnId).length >= count).then(() => opened(turnId)[count - 1]!);
    const reply = (turnId: string) => (recorder.events.find((e) => e.type === "item.completed" && e.turnId === turnId
      && (e as { itemType?: string }).itemType === "assistant_text") as { text?: string } | undefined)?.text ?? "";

    beforeEach(() => {
      calls = join(scratch, "calls.log");
      process.env.FAKE_ACP_DUMP = join(scratch, "gate-dump.json");
    });
    afterEach(() => {
      rmSync(flagFile, { force: true });
      delete process.env.FAKE_ACP_MCP_CALLS;
      delete process.env.FAKE_ACP_ASK_BEFORE_MCP;
      delete process.env.FAKE_ACP_PERMISSION_ANSWER;
    });

    it("answers Grok's own use_tool ask allow-once on a gated turn, so only the gate's cards reach the person (production shape)", async () => {
      writeFileSync(flagFile, JSON.stringify({ bots: ["bot-gated"] }));
      process.env.FAKE_ACP_ASK_BEFORE_MCP = "use_tool";
      process.env.FAKE_ACP_PERMISSION_ANSWER = join(scratch, "agent-answer.txt");
      process.env.FAKE_ACP_MCP_CALLS = "agents:list_bots,agents:create_bot,third:anything";
      await create(GrokAgentDriver, "mcp-call");
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "t-gate-use-tool", botId: "bot-gated", text: "go", model: "grok-4.5", approvalMode: "auto",
        integrations: { agents: server("agents"), custom: { third: server("third") } },
      });
      // the first card is the gate's, for the write: the read ran with none
      const write = await nextCard(turnId, 1);
      expect(write).toMatchObject({ mcpTool: "agents__create_bot" });
      expect(ran()).toEqual(["agents:list_bots"]);
      // Grok's own ask was answered allow ONCE, never always
      expect(readFileSync(process.env.FAKE_ACP_PERMISSION_ANSWER!, "utf8")).toBe("allow-once");
      expect(await instance.adapter.respondToRequest("t-gate-use-tool", write.requestId, { behavior: "deny" })).toBe("rejected");
      const unknown = await nextCard(turnId, 2);
      expect(unknown).toMatchObject({ mcpTool: "third__anything" });
      await instance.adapter.respondToRequest("t-gate-use-tool", unknown.requestId, { behavior: "deny" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
      // exactly the gate's two cards: none for Grok's three use_tool asks
      expect(opened(turnId)).toHaveLength(2);
      expect(ran()).toEqual(["agents:list_bots"]);
      const lines = reply(turnId).split("\n");
      expect(lines[0]).toBe("agents:list_bots -> ran list_bots");
      expect(lines[1]).toContain("Not approved: agents__create_bot did not run");
      expect(lines[2]).toContain("Not approved: third__anything did not run");
    });

    it("keeps Grok's use_tool ask as a card for a bot that opted out", async () => {
      writeFileSync(flagFile, JSON.stringify({ off: ["other-bot"] }));
      process.env.FAKE_ACP_ASK_BEFORE_MCP = "use_tool";
      process.env.FAKE_ACP_MCP_CALLS = "agents:list_bots";
      await create(GrokAgentDriver, "mcp-call");
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "t-ungated-use-tool", botId: "other-bot", text: "go", model: "grok-4.5", approvalMode: "auto",
        integrations: { agents: server("agents") },
      });
      const card = await nextCard(turnId, 1);
      expect(card).toMatchObject({ requestType: "permission", mcpTool: "agents__list_bots" });
      await instance.adapter.respondToRequest("t-ungated-use-tool", card.requestId, { behavior: "deny" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
      expect(ran()).toEqual([]);
      expect(reply(turnId)).toContain("agents:list_bots -> refused at the agent's prompt");
    });

    it("runs Grok in default mode; reviewed reads run unasked, a write and an unknown third-party tool each wait for a card, and declining blocks", async () => {
      writeFileSync(flagFile, JSON.stringify({ bots: ["bot-gated"] }));
      process.env.FAKE_ACP_MCP_CALLS = "agents:list_bots,agents:create_bot,third:anything,agents:workspace_read";
      await create(GrokAgentDriver, "mcp-call");
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "t-gate", botId: "bot-gated", text: "go", model: "grok-4.5", approvalMode: "auto",
        integrations: { agents: server("agents"), custom: { third: server("third") } },
      });
      const write = await nextCard(turnId, 1);
      expect(write).toMatchObject({ requestType: "permission", mcpTool: "agents__create_bot" });
      expect(write.allowSession).toBeUndefined();
      expect(ran()).toEqual(["agents:list_bots"]);
      expect(await instance.adapter.respondToRequest("t-gate", write.requestId, { behavior: "deny" })).toBe("rejected");
      const unknown = await nextCard(turnId, 2);
      expect(unknown).toMatchObject({ mcpTool: "third__anything" });
      expect(await instance.adapter.respondToRequest("t-gate", unknown.requestId, { behavior: "allow" })).toBe("allowed-once");
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
      expect(opened(turnId)).toHaveLength(2);
      expect(ran()).toEqual(["agents:list_bots", "third:anything", "agents:workspace_read"]);
      const lines = reply(turnId).split("\n");
      expect(lines[0]).toBe("agents:list_bots -> ran list_bots");
      expect(lines[1]).toContain("agents:create_bot -> Not approved: agents__create_bot did not run");
      expect(lines[2]).toBe("third:anything -> ran anything");
      const seen = JSON.parse(readFileSync(process.env.FAKE_ACP_DUMP!, "utf8")) as { argv: string[]; mcpServers: Array<{ name: string; env: Array<{ name: string }> }> };
      expect(seen.argv.slice(0, 2)).toEqual(["--permission-mode", "default"]);
      expect(seen.argv).not.toContain("--allow");
      // every mounted server rides the approval gate
      for (const mounted of seen.mcpServers) {
        expect(mounted.env.map((entry) => entry.name)).toContain("SAGAX_GATE_APPROVAL_SOCKET");
      }
    });

    it("never replays an approval: an 'always allow' answer still asks for the next identical call", async () => {
      writeFileSync(flagFile, JSON.stringify({ bots: "all" }));
      process.env.FAKE_ACP_MCP_CALLS = "agents:create_bot,agents:create_bot";
      await create(GrokAgentDriver, "mcp-call");
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "t-gate-replay", botId: "any-bot", text: "go", model: "grok-4.5", approvalMode: "auto",
        integrations: { agents: server("agents") },
      });
      const first = await nextCard(turnId, 1);
      await instance.adapter.respondToRequest("t-gate-replay", first.requestId, { behavior: "allow", always: true });
      const second = await nextCard(turnId, 2);
      expect(second.requestId).not.toBe(first.requestId);
      await instance.adapter.respondToRequest("t-gate-replay", second.requestId, { behavior: "deny" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
      expect(ran()).toEqual(["agents:create_bot"]);
    });

    it("declines a held call when the turn is stopped before anyone answers", async () => {
      writeFileSync(flagFile, JSON.stringify({ bots: ["bot-gated"] }));
      process.env.FAKE_ACP_MCP_CALLS = "agents:create_bot";
      await create(GrokAgentDriver, "mcp-call");
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "t-gate-stop", botId: "bot-gated", text: "go", model: "grok-4.5", approvalMode: "auto",
        integrations: { agents: server("agents") },
      });
      const card = await nextCard(turnId, 1);
      await instance.adapter.interruptTurn("t-gate-stop");
      await recorder.until((e) => e.type === "request.resolved" && (e as { requestId?: string }).requestId === card.requestId);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(ran()).toEqual([]);
      expect(await instance.adapter.respondToRequest("t-gate-stop", card.requestId, { behavior: "allow" })).toBe("unavailable");
    });

    it("leaves an opted-out bot, and Ask, Edits and Full access, on their current modes", async () => {
      writeFileSync(flagFile, JSON.stringify({ off: ["other-bot"] }));
      await create(GrokAgentDriver);
      const cases: Array<{ botId: string; approvalMode: "auto" | "ask" | "edits" | "full"; mode: string }> = [
        { botId: "other-bot", approvalMode: "auto", mode: "auto" },
        { botId: "bot-gated", approvalMode: "ask", mode: "default" },
        { botId: "bot-gated", approvalMode: "edits", mode: "acceptEdits" },
        { botId: "bot-gated", approvalMode: "full", mode: "bypassPermissions" },
      ];
      for (const [index, entry] of cases.entries()) {
        const dump = join(scratch, `gate-off-${index}.json`);
        process.env.FAKE_ACP_DUMP = dump;
        const { turnId } = await instance.adapter.sendTurn({
          threadId: `t-gate-off-${index}`, botId: entry.botId, text: "go", model: "grok-4.5", approvalMode: entry.approvalMode,
          integrations: { agents: server("agents") },
        });
        await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
        const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; mcpServers: Array<{ env: Array<{ name: string }> }> };
        expect(seen.argv.slice(seen.argv.indexOf("--permission-mode"), seen.argv.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", entry.mode]);
        for (const mounted of seen.mcpServers) {
          expect(mounted.env.map((item) => item.name)).not.toContain("SAGAX_GATE_APPROVAL_SOCKET");
        }
      }
    });

    it("gates Auto by default: a missing, corrupt or legacy opt-in flag file is on (engine parity)", async () => {
      await create(GrokAgentDriver);
      for (const [index, content] of [undefined, "not json", JSON.stringify({ bots: "some" }), JSON.stringify({ bots: ["someone-else"] })].entries()) {
        if (content === undefined) rmSync(flagFile, { force: true }); else writeFileSync(flagFile, content);
        const dump = join(scratch, `gate-flag-${index}.json`);
        process.env.FAKE_ACP_DUMP = dump;
        const { turnId } = await instance.adapter.sendTurn({
          threadId: `t-gate-flag-${index}`, botId: "bot-gated", text: "go", model: "grok-4.5", approvalMode: "auto",
          integrations: { agents: server("agents") },
        });
        await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
        const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] };
        expect(seen.argv.slice(0, 2)).toEqual(["--permission-mode", "default"]);
        expect(seen.argv).not.toContain("--allow");
        // a solo Auto turn can call account connectors with no prompt: they stay off
        expect((seen as unknown as { env: Record<string, string> }).env.GROK_MANAGED_MCPS_ENABLED).toBe("false");
        expect((seen as unknown as { env: Record<string, string> }).env.GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED).toBe("false");
      }
    });

    it("keeps Grok's own auto mode on a solo turn whose Grok config declares MCP servers Sagax cannot gate", async () => {
      await create(GrokAgentDriver);
      const project = mkdtempSync(join(tmpdir(), "grok-project-"));
      onTestFinished(() => removeTempDir(project));
      mkdirSync(join(project, ".grok"));
      writeFileSync(join(project, ".grok", "config.toml"), "[mcp_servers.mine]\ncommand = \"node\"\n");
      for (const [index, withholdHostTools] of [false, true].entries()) {
        const dump = join(scratch, `gate-config-mcp-${index}.json`);
        process.env.FAKE_ACP_DUMP = dump;
        const { turnId } = await instance.adapter.sendTurn({
          threadId: `t-gate-config-mcp-${index}`, botId: "bot-gated", text: "go", model: "grok-4.5", approvalMode: "auto", cwd: project,
          withholdHostTools, integrations: { agents: server("agents") },
        });
        await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
        const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] };
        const mode = seen.argv[seen.argv.indexOf("--permission-mode") + 1];
        // an organization turn reaches those servers through use_tool only: still gated
        expect(mode).toBe(withholdHostTools ? "default" : "auto");
      }
    });

    it("runs Grok's own auto mode only for an explicit opt-out ({bots: \"none\"})", async () => {
      writeFileSync(flagFile, JSON.stringify({ bots: "none" }));
      await create(GrokAgentDriver);
      const dump = join(scratch, "gate-none.json");
      process.env.FAKE_ACP_DUMP = dump;
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "t-gate-none", botId: "bot-gated", text: "go", model: "grok-4.5", approvalMode: "auto",
        integrations: { agents: server("agents") },
      });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
      const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] };
      expect(seen.argv.slice(0, 2)).toEqual(["--permission-mode", "auto"]);
    });
  });

  it.each(["ask", "edits"] as const)("adds no read-only allow rules outside Auto (%s keeps every card)", async (approvalMode) => {
    await create(GrokAgentDriver);
    const dump = join(scratch, `grok-no-allow-${approvalMode}.json`);
    process.env.FAKE_ACP_DUMP = dump;
    const { turnId } = await instance.adapter.sendTurn({
      threadId: `t-grok-no-allow-${approvalMode}`,
      text: "read the roster",
      model: "grok-4.5",
      approvalMode,
      integrations: { agents: { command: "node", args: ["/fixture/agents-proxy.mjs"], env: {} } },
    });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] };
    expect(seen.argv).not.toContain("--allow");
    expect(seen.argv.join(" ")).not.toContain("MCPTool(");
  });

  it("withholds Grok host tools on an organization turn and isolates each person's GROK_HOME", async () => {
    await create(GrokAgentDriver);
    expect(instance.adapter.capabilities.withholdsHostTools).toBe(true);
    const homeA = join(scratch, "person-a");
    const dump = join(scratch, "grok-withhold.json");
    process.env.FAKE_ACP_DUMP = dump;
    const agents = { command: "node", args: ["/fixture/agents-proxy.mjs"], env: {} };
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-grok-withhold",
      text: "read the roster",
      model: "grok-4.7",
      effort: "high",
      approvalMode: "auto",
      withholdHostTools: true,
      grokCloudConnectors: true,
      access: { via: "subscription", identity: "subscription:a", engineHome: homeA },
      integrations: { agents },
    });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; env: Record<string, string> };
    expect(seen.argv).toEqual([
      "--no-subagents", "--disable-web-search",
      "--deny", "Bash", "--deny", "Read", "--deny", "Edit", "--deny", "Write", "--deny", "Grep", "--deny", "WebFetch", "--deny", "WebSearch",
      // Auto decides through Sagax (the gate, on by default): no classifier, no allow rules
      "--permission-mode", "default",
      "agent", "--no-leader", "-m", "grok-4.7", "--reasoning-effort", "high", "stdio",
    ]);
    expect(seen.argv).not.toContain("--sandbox");
    expect(seen.argv).not.toContain("--tools");
    expect(seen.argv).not.toContain("--disallowed-tools");
    expect(seen.env.HOME).toBe(homeA);
    expect(seen.env.GROK_HOME).toBe(join(homeA, ".grok"));
    expect(seen.env.XAI_API_KEY).toBeUndefined();
    expect(seen.env.GROK_AGENT).toBe("grok-build");
    expect(seen.env.GROK_MANAGED_MCPS_ENABLED).toBeUndefined();
    expect(seen.env.GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED).toBe("false");
    const profile = JSON.parse(readFileSync(`${dump}.session.json`, "utf8"))._meta.agentProfile;
    expect(profile).toMatchObject({
      injectDefaultTools: false,
      tools: ["search_tool", "use_tool"],
      model: "grok-4.7",
    });
    for (const name of ["run_terminal_command", "read_file", "write", "web_search", "web_fetch", "spawn_subagent"]) {
      expect(profile.disallowedTools).toContain(name);
      expect(profile.tools).not.toContain(name);
    }
    expect(existsSync(`${dump}.config.json`)).toBe(false);
    expect(JSON.stringify(seen)).not.toContain("xai-");

    const homeB = join(scratch, "person-b");
    const resumeDump = join(scratch, "grok-withhold-b.json");
    process.env.FAKE_ACP_DUMP = resumeDump;
    const second = await instance.adapter.sendTurn({
      threadId: "t-grok-withhold-b",
      text: "again",
      model: "grok-4.7",
      withholdHostTools: true,
      resumeCursor: "fake-acp-session",
      access: { via: "subscription", identity: "subscription:b", engineHome: homeB },
      integrations: { agents },
    });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    const loaded = readFileSync(join(NATIVE_DIR, "t-grok-withhold-b.ndjson"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line))
      .find((entry) => entry.dir === "out" && entry.msg.method === "session/load");
    expect(loaded.msg.params._meta.agentProfile.tools).toEqual(["search_tool", "use_tool"]);
    expect(loaded.msg.params._meta.agentProfile.disallowedTools).toContain("run_terminal_command");
    const seenB = JSON.parse(readFileSync(resumeDump, "utf8")) as { env: Record<string, string> };
    expect(seenB.env.HOME).toBe(homeB);
    expect(seenB.env.GROK_HOME).toBe(join(homeB, ".grok"));
    expect(seenB.env.GROK_HOME).not.toBe(join(homeA, ".grok"));
    expect(JSON.stringify(seenB)).not.toContain(homeA);
  });

  it("surfaces the connect card for an unconnected cloud connector on an own-account org turn, instead of a dead end", async () => {
    // The fake CLI answers _x.ai/mcp/list with no servers (like a grok.com
    // account that never connected Outlook): the Connect-apps card still
    // shows the connector, so the turn must point the model at the one-step
    // connect card rather than let it say it has no tool.
    const dump = join(scratch, "grok-connectable.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    await create(GrokAgentDriver);
    // A unique stable half so the fake CLI's shared session id never dedups
    // this turn's first delivery (the volatile catalog section rides it).
    const rules = "Standing rules. " + randomUUID();
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-grok-connectable-" + randomUUID(),
      text: "peux-tu lire mes courriels?",
      model: "grok-4.7",
      system: rules,
      systemStable: rules,
      systemVolatile: "",
      withholdHostTools: true,
      grokCloudConnectors: true,
      access: { via: "subscription", identity: "subscription:a", engineHome: join(scratch, "person-connectable") },
      integrations: { agents: { command: "node", args: ["/fixture/agents-proxy.mjs"], env: {} } },
    });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    const prompt = (JSON.parse(readFileSync(`${dump}.prompt.json`, "utf8")) as Array<{ type: string; text: string }>)
      .map((part) => part.text ?? "").join("\n");
    expect(prompt).toContain("Connectable but not connected yet");
    expect(prompt).toContain("Outlook (Exchange)");
    expect(prompt).toContain("agents__open_connector_setup");
    expect(prompt).not.toContain("This list is complete");
  });

  it("offers no connectable connectors on a solo turn (cloud connectors never load there)", async () => {
    const dump = join(scratch, "grok-solo-no-connectable.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    await create(GrokAgentDriver);
    const rules = "Standing rules. " + randomUUID();
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "t-grok-solo-no-connectable-" + randomUUID(),
      text: "peux-tu lire mes courriels?",
      model: "grok-4.7",
      system: rules,
      systemStable: rules,
      systemVolatile: "",
    });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    const prompt = (JSON.parse(readFileSync(`${dump}.prompt.json`, "utf8")) as Array<{ type: string; text: string }>)
      .map((part) => part.text ?? "").join("\n");
    expect(prompt).not.toContain("Connectable but not connected yet");
  });

  // Gemini and Kimi withhold their tools since 2026-10-08 (verified with
  // their real CLIs, org-host-tools.test.ts); Droid and Cursor still cannot.
  it("does not claim Droid or Cursor withhold their own tools", async () => {
    await create(DroidAgentDriver);
    expect(instance.adapter.capabilities.withholdsHostTools).toBeUndefined();
    await instance.dispose();
    await create(CursorAgentDriver);
    expect(instance.adapter.capabilities.withholdsHostTools).toBeUndefined();
  });

  it.each([
    ["ask", true, "default"],
    ["full", true, "bypassPermissions"],
    ["custom", true, "default"],
    // Auto is gated by default: Grok runs `default`, Sagax decides
    ["auto", false, "default"],
  ] as const)("Grok %s with agents mounted=%s overrides a legacy full-auto setting", async (approvalMode, mounted, nativeMode) => {
    instance = await GrokAgentDriver.create({
      instanceId: "grok-mode-override",
      displayName: "Grok",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);
    const dump = join(scratch, "grok-mode-override.json");
    process.env.FAKE_ACP_DUMP = dump;
    await instance.adapter.sendTurn({
      threadId: "t-grok-mode-override",
      text: "continue",
      approvalMode,
      resumeCursor: "fake-acp-session",
      integrations: mounted ? { agents: { command: "node", args: [], env: {} } } : undefined,
    });
    await recorder.until((e) => e.type === "turn.completed");
    expect(JSON.parse(readFileSync(dump, "utf8")).argv).toEqual([
      "--permission-mode", nativeMode, "agent", "stdio",
    ]);
  });

  it("keeps residual Grok Auto permissions interactive", async () => {
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({
      threadId: "t-grok-auto-permission",
      text: "run the command",
      approvalMode: "auto",
      integrations: { agents: { command: "node", args: [], env: {} } },
    });
    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "permission", tool: "shell" });
    expect(recorder.events.some((e) => e.type === "request.resolved")).toBe(false);
    await instance.adapter.respondToRequest("t-grok-auto-permission", opened.requestId!, { behavior: "deny" });
    expect(await recorder.until((e) => e.type === "request.resolved"))
      .toMatchObject({ behavior: "deny", source: "user" });
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("grok fails closed when the CLI advertises no cached_token (needs login)", async () => {
    await create(GrokAgentDriver, "no-auth");
    await instance.adapter.sendTurn({ threadId: "t-auth", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "auth_required" });
    const err = recorder.events.find((e) => e.type === "runtime.error")!;
    expect(err.message).toMatch(/not signed in/);
  });

  it("grok local inject does not require grok.com login", async () => {
    process.env.FAKE_ACP_MODE = "no-auth";
    mkdirSync(join(scratch, ".grok"), { recursive: true });
    instance = await GrokAgentDriver.create({
      instanceId: "acp-test",
      displayName: "ACP Test",
      environment: { HOME: scratch, GROK_HOME: join(scratch, ".grok") },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
    await instance.adapter.sendTurn({
      threadId: "t-local-auth",
      text: "go",
      model: "omlx::MiniMax-M3-4bit",
    });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(false);
  });

  it("gemini proceeds through a missing auth method (lenient login)", async () => {
    await create(GeminiAgentDriver, "no-auth");
    await instance.adapter.sendTurn({ threadId: "t-lenient", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
    expect(recorder.events.some((e) => e.provider === "geminiAgent")).toBe(true);
  });

  it("starts Gemini CLI on its stable ACP surface", async () => {
    const dump = join(scratch, "gemini-acp.json");
    process.env.FAKE_ACP_DUMP = dump;
    await create(GeminiAgentDriver);
    await instance.adapter.sendTurn({ threadId: "t-gemini-acp", text: "go", model: "gemini-test" });
    await recorder.until((e) => e.type === "turn.completed");

    const argv = JSON.parse(readFileSync(dump, "utf8")).argv as string[];
    expect(argv).toEqual(["--acp", "-m", "gemini-test"]);
    expect(argv).not.toContain("--experimental-acp");
  });

  it("rejects a second turn while one is in flight", async () => {
    await create(GrokAgentDriver, "hang");
    await instance.adapter.sendTurn({ threadId: "t-busy", text: "one" });
    await recorder.until((e) => e.type === "session.started");
    await expect(instance.adapter.sendTurn({ threadId: "t-busy", text: "two" })).rejects.toThrow(/already running/);
    await instance.adapter.interruptTurn("t-busy");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("interrupt settles a hung turn as cancelled", async () => {
    await create(GrokAgentDriver, "hang");
    await instance.adapter.sendTurn({ threadId: "t-int", text: "go" });
    await recorder.until((e) => e.type === "session.started");
    await instance.adapter.interruptTurn("t-int");
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ type: "turn.completed" });
  });

  it.each(["error", "refusal"])("a stop during the prompt leaves no error row when the agent answers the cancel with %s", async (reply) => {
    process.env.FAKE_ACP_CANCEL_REPLY = reply;
    await create(GrokAgentDriver, "hang");
    await instance.adapter.sendTurn({ threadId: "t-int-reply", text: "go" });
    await recorder.until((e) => e.type === "session.started");
    await instance.adapter.interruptTurn("t-int-reply");
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true, stopReason: "cancelled" });
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(false);
  });

  it("an exit before result becomes runtime.error + failed turn", async () => {
    await create(GrokAgentDriver, "exit-early");
    await instance.adapter.sendTurn({ threadId: "t-crash", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false });
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(true);
  });

  it("does not expire an agent while a person is answering an approval", async () => {
    process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "150";
    await create(GrokAgentDriver, "permission");
    await instance.adapter.sendTurn({ threadId: "t-idle-approval", text: "go", approvalMode: "ask" });
    const opened = await recorder.until(e => e.type === "request.opened");
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(recorder.events.some(e => e.type === "turn.completed")).toBe(false);
    await instance.adapter.respondToRequest("t-idle-approval", (opened as { requestId: string }).requestId, { behavior: "allow" });
    expect(await recorder.until(e => e.type === "turn.completed")).toMatchObject({ ok: true });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(recorder.events.some(e => e.type === "runtime.error")).toBe(false);
  });

  // MOCA-260: a quiet `sleep` or build sends nothing while it runs, and the
  // guard used to stop the turn as if the agent had hung.
  it.each([GrokAgentDriver, QwenAgentDriver])("does not expire $driverKind while a tool it started is still running", async (driver) => {
    process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "150";
    process.env.FAKE_ACP_TOOL_MS = "600";
    await create(driver, "slow-tool");
    await instance.adapter.sendTurn({ threadId: "t-slow-tool", text: "go" });
    expect(await recorder.until(e => e.type === "turn.completed")).toMatchObject({ ok: true });
    expect(recorder.events.some(e => e.type === "runtime.error")).toBe(false);
    expect(recorder.events.find(e => e.type === "item.completed" && e.itemType === "tool")).toMatchObject({ ok: true });
  });

  it.each([GrokAgentDriver, QwenAgentDriver])("still fails $driverKind when it goes silent once its tool has finished", async (driver) => {
    process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "150";
    await create(driver, "stall-after-tool");
    await instance.adapter.sendTurn({ threadId: "t-stall-tool", text: "go" });
    expect(await recorder.until(e => e.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "rpc_error" });
    expect(recorder.events.find(e => e.type === "runtime.error")?.message).toMatch(/no tool running/i);
    expect(instance.adapter.hasSession("t-stall-tool")).toBe(false);
  });

  describe("Grok stall retry", () => {
    const promptCount = (file: string) => readFileSync(file, "utf8").trim().split("\n")
      .filter((line) => JSON.parse(line).method === "session/prompt").length;
    afterEach(() => {
      delete process.env.SAGAX_GROK_STALL_RETRY_MS;
      delete process.env.FAKE_ACP_RPC_APPEND_FILE;
    });

    it("asks once more when Grok sends nothing at all, and the turn completes", async () => {
      process.env.SAGAX_GROK_STALL_RETRY_MS = "150";
      const appendFile = join(scratch, "rpc-stall.jsonl");
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      await create(GrokAgentDriver, "stall-first-prompt");
      await instance.adapter.sendTurn({ threadId: "t-stall-retry", text: "go" });
      expect(await recorder.until((e) => e.type === "turn.completed")).toMatchObject({ ok: true });
      expect(promptCount(appendFile)).toBe(2);
      const notices = recorder.events.filter((e) => e.type === "runtime.notice") as Array<{ message: string }>;
      expect(notices.some((n) => /so Sagax asked again/.test(n.message))).toBe(true);
      expect(recorder.events.some((e) => e.type === "content.delta")).toBe(true);
    });

    it("logs one latency line per turn with its stages and the stall retry", async () => {
      const lines: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].startsWith("[turn-latency]")) lines.push(args[0]);
      });
      try {
        process.env.SAGAX_GROK_STALL_RETRY_MS = "150";
        await create(GrokAgentDriver, "stall-first-prompt");
        await instance.adapter.sendTurn({ threadId: "t-latency", text: "go", receivedAt: Date.now() - 40 });
        expect(await recorder.until((e) => e.type === "turn.completed")).toMatchObject({ ok: true });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(
          /^\[turn-latency\] \S+ thread=t-latenc path=spawn queue=\d+ms setup=\d+ms ttfa=\d+ms ttft=\d+ms tools=\d+ total=\d+ms prompt=\d+ch full=\S+ in=\S+ cached=\S+ stallGuard=150ms retried ok$/,
        );
        expect(Number(/queue=(\d+)ms/.exec(lines[0]!)![1])).toBeGreaterThanOrEqual(40);
        // The stall guard is 150ms. The latency clock and setTimeout are not
        // the same instant: a busy runner reports 149. Still well above an
        // answer that skipped the guard.
        expect(Number(/ttfa=(\d+)ms/.exec(lines[0]!)![1])).toBeGreaterThanOrEqual(120);
      } finally {
        log.mockRestore();
      }
    });

    it("retries only once: a second silence is left to the idle guard", async () => {
      process.env.SAGAX_GROK_STALL_RETRY_MS = "100";
      process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "600";
      const appendFile = join(scratch, "rpc-hang.jsonl");
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      await create(GrokAgentDriver, "hang");
      await instance.adapter.sendTurn({ threadId: "t-stall-twice", text: "go" });
      expect(await recorder.until((e) => e.type === "turn.completed")).toMatchObject({ ok: false });
      expect(promptCount(appendFile)).toBe(2);
    });

    it("never retries once Grok has streamed anything", async () => {
      process.env.SAGAX_GROK_STALL_RETRY_MS = "100";
      process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "500";
      const appendFile = join(scratch, "rpc-text.jsonl");
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      await create(GrokAgentDriver, "stall-after-text");
      await instance.adapter.sendTurn({ threadId: "t-stall-text", text: "go" });
      expect(await recorder.until((e) => e.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "rpc_error" });
      expect(promptCount(appendFile)).toBe(1);
      expect((recorder.events.filter((e) => e.type === "runtime.notice") as Array<{ message: string }>)
        .some((n) => /asked again/.test(n.message))).toBe(false);
    });

    it("never retries while a permission card is open", async () => {
      process.env.SAGAX_GROK_STALL_RETRY_MS = "100";
      const appendFile = join(scratch, "rpc-perm.jsonl");
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      await create(GrokAgentDriver, "permission");
      await instance.adapter.sendTurn({ threadId: "t-stall-perm", text: "go" });
      await recorder.until((e) => e.type === "request.opened");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(promptCount(appendFile)).toBe(1);
      await instance.adapter.interruptTurn?.("t-stall-perm");
    });
  });

  // A quiet agent is not a black box: the person is told what it is doing.
  it("tells the person what a quiet agent is doing, then finishes the turn", async () => {
    // Test the driver's notices, not how fast this OS starts ps/PowerShell.
    // The process probe has its own checks in quiet-status.test.ts.
    vi.spyOn(quietStatus, "sampleProcessTree").mockResolvedValue({ cpuMs: 0, connections: 1 });
    process.env.SAGAX_ACP_QUIET_NOTICE_MS = "150";
    process.env.SAGAX_ACP_QUIET_TICK_MS = "50";
    process.env.FAKE_ACP_QUIET_MS = "700";
    await create(GrokAgentDriver, "quiet-then-answer");
    await instance.adapter.sendTurn({ threadId: "t-quiet", text: "go" });
    expect(await recorder.until(e => e.type === "turn.completed")).toMatchObject({ ok: true });
    const notices = recorder.events.filter(e => e.type === "runtime.notice") as Array<{ message: string }>;
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0].message).toMatch(/^Grok (is waiting on its model|is busy|has sent nothing)/);
    expect(recorder.events.some(e => e.type === "runtime.error")).toBe(false);
  });

  it("reads Qwen's debug log: a logged rate-limit retry is reported and keeps the turn alive", async () => {
    vi.spyOn(quietStatus, "sampleProcessTree").mockResolvedValue({ cpuMs: 0, connections: 1 });
    process.env.QWEN_HOME = scratch;
    process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "400";
    process.env.SAGAX_ACP_QUIET_NOTICE_MS = "150";
    process.env.SAGAX_ACP_QUIET_TICK_MS = "50";
    process.env.FAKE_ACP_QUIET_MS = "1200";
    process.env.FAKE_ACP_QWEN_LOG = JSON.stringify([
      "[ERROR] [OPENAI_ERROR] OpenAI API Error: 429 rate limited {",
      "[WARN] [RETRY] Attempt 1 failed with status 429. Retrying after explicit delay of 20000ms... {",
    ]);
    await create(QwenAgentDriver, "quiet-then-answer");
    await instance.adapter.sendTurn({ threadId: "t-qwen-retry", text: "go" });
    // silent on the wire three times longer than the idle limit, yet alive
    expect(await recorder.until(e => e.type === "turn.completed")).toMatchObject({ ok: true });
    const notices = (recorder.events.filter(e => e.type === "runtime.notice") as Array<{ message: string }>).map(n => n.message);
    expect(notices.some(m => /Qwen hit a rate limit \(HTTP 429\) and is retrying \(attempt 2\)\. Next try in 20 s\./.test(m))).toBe(true);
    expect(recorder.events.some(e => e.type === "runtime.error")).toBe(false);
  });

  it("preserves a streamed partial reply before disposal removes its listeners", async () => {
    await create(GrokAgentDriver, "stall-after-text");
    await instance.adapter.sendTurn({ threadId: "t-dispose-partial", text: "go" });
    await recorder.until((event) => event.type === "content.delta" && event.streamKind === "assistant_text");

    await instance.dispose();

    expect(recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "assistant_text"))
      .toEqual([expect.objectContaining({ text: "half an answer, then silence" })]);
    expect(recorder.events.filter((event) => event.type === "turn.completed"))
      .toEqual([expect.objectContaining({ threadId: "t-dispose-partial", stopReason: "cancelled" })]);
  });

  it("rejects turns started by completion listeners during disposal", async () => {
    await create(GrokAgentDriver, "stall-after-text");
    await instance.adapter.sendTurn({ threadId: "t-dispose-listener", text: "go" });
    await recorder.until((event) => event.type === "content.delta" && event.streamKind === "assistant_text");
    let followup: Promise<unknown> | undefined;
    instance.adapter.onEvent((event) => {
      if (event.type === "turn.completed" && event.threadId === "t-dispose-listener") {
        followup = instance.adapter.sendTurn({ threadId: "t-dispose-followup", text: "next" });
        void followup.catch(() => {});
      }
    });

    await instance.dispose();

    expect(followup).toBeDefined();
    await expect(followup).rejects.toThrow(/shutting down/);
    expect(instance.adapter.hasSession("t-dispose-followup")).toBe(false);
    await expect(instance.adapter.sendTurn({ threadId: "t-after-dispose", text: "late" })).rejects.toThrow(/shutting down/);
  });

  it("rejects a turn whose command resolution finishes after disposal", async () => {
    let markResolving!: () => void;
    const resolving = new Promise<void>((resolve) => { markResolving = resolve; });
    let finishCommand!: (command: { command: string }) => void;
    const command = new Promise<{ command: string }>((resolve) => { finishCommand = resolve; });
    await create(createAcpDriver({
      ...SELECT_MODEL_SUPPORT,
      resolveCommand: () => { markResolving(); return command; },
    }));
    const sending = instance.adapter.sendTurn({ threadId: "t-dispose-resolving", text: "go" });
    void sending.catch(() => {});
    await resolving;
    await instance.dispose();
    finishCommand({ command: FAKE_CLI });

    await expect(sending).rejects.toThrow(/shutting down/);
    expect(instance.adapter.hasSession("t-dispose-resolving")).toBe(false);
    expect(recorder.events).toEqual([]);
  });

  // Qwen Code goes quiet for minutes while it compresses history, backs off
  // a rate limit (up to 5 min a wait) or waits on one model request (its SDK
  // allows 600 s). At 180 s the guard cut those turns off mid-work.
  it("defaults the prompt idle guard above an agent's longest normal silence", () => {
    expect(DEFAULT_ACP_PROMPT_IDLE_MS).toBeGreaterThan(600_000);
  });

  it("an agent that goes silent mid-answer is failed and closed by the prompt idle guard", async () => {
    process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "150";
    await create(GrokAgentDriver, "stall-after-text");
    await instance.adapter.sendTurn({ threadId: "t-stall", text: "go" });

    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ type: "turn.completed", ok: false, stopReason: "rpc_error" });
    const err = recorder.events.find((e) => e.type === "runtime.error");
    expect(err?.message).toMatch(/no tool running/i);
    expect(err?.message).toContain("SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS");
    expect(err).toMatchObject({ stalled: true });
    // the streamed chunk reached the UI before the child went silent
    expect(recorder.events.some((e) => e.type === "content.delta")).toBe(true);
    expect(instance.adapter.hasSession("t-stall")).toBe(false);
  });

  it("an end_turn with no reply, image, or tool result becomes runtime.error + failed turn", async () => {
    await create(GrokAgentDriver, "empty-reply");
    await instance.adapter.sendTurn({ threadId: "t-empty", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "empty_turn" });
    expect(recorder.events.find((e) => e.type === "runtime.error")?.message)
      .toMatch(/no reply, image, or tool result/);
  });

  it("reasoning with no answer is a lost turn, not a success", async () => {
    // the shape of a provider that never leaves its thinking stream: thought
    // chunks stream, the engine still answers end_turn, and the turn must be
    // reported as failed rather than completed-with-nothing
    await create(GrokAgentDriver, "reasoning-only");
    await instance.adapter.sendTurn({ threadId: "t-reasoning", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "empty_turn" });
    expect(recorder.events.some((e) => e.type === "content.delta" && (e as any).streamKind === "reasoning_text")).toBe(true);
    expect(recorder.events.some((e) => e.type === "item.completed")).toBe(false);
    expect(recorder.events.find((e) => e.type === "runtime.error")?.message)
      .toMatch(/no reply, image, or tool result/);
  });

  it("a reasoning_only empty response is nudged on the live session and recovers", async () => {
    // Grok/xAI reporting "empty response from model (reasoning_only)" over
    // session/prompt (rpc -32603): the model spent the turn on reasoning and
    // committed no content. The driver must nudge the same session once more
    // and surface the answer, not break the bot with a hard internal error.
    process.env.FAKE_ACP_REASONING_FAIL_TIMES = "1";
    await create(GrokAgentDriver, "reasoning-only-error");
    await instance.adapter.sendTurn({ threadId: "t-reason-recover", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true, stopReason: null });
    // the nudge produced a real answer
    expect(recorder.events.some((e) => e.type === "item.completed" && (e as any).itemType === "assistant_text")).toBe(true);
    // the reasoning still streamed to the UI
    expect(recorder.events.some((e) => e.type === "content.delta" && (e as any).streamKind === "reasoning_text")).toBe(true);
    // the person was told Sagax asked it to finish, and no hard error surfaced
    expect(recorder.events.some((e) => e.type === "runtime.notice" && /reasoning/i.test((e as any).message))).toBe(true);
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(false);
  });

  it("a model that only ever reasons gives up gracefully after a bounded retry, never a hard internal error", async () => {
    const countFile = join(scratch, "reasoning-count");
    process.env.FAKE_ACP_REASONING_FAIL_TIMES = "99";
    process.env.FAKE_ACP_REASONING_COUNT_FILE = countFile;
    process.env.SAGAX_ACP_REASONING_CONTINUE_MAX = "2";
    await create(GrokAgentDriver, "reasoning-only-error");
    await instance.adapter.sendTurn({ threadId: "t-reason-giveup", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "reasoning_only" });
    const err = recorder.events.find((e) => e.type === "runtime.error") as { message?: string } | undefined;
    expect(err?.message).toMatch(/reasoning without a final answer/i);
    // never the raw internal-error string the bot saw in production
    expect(err?.message).not.toMatch(/Internal error|session\/prompt|reasoning_only/);
    // bounded: the first prompt plus exactly the two nudges, and no more
    expect(Number(readFileSync(countFile, "utf8"))).toBe(3);
    // the session was evicted so the next turn starts clean
    expect(instance.adapter.hasSession("t-reason-giveup")).toBe(false);
  });

  it("a genuine internal error without reasoning_only still surfaces (no swallowing)", async () => {
    const failureFile = join(scratch, "rpc-failure.json");
    writeFileSync(failureFile, JSON.stringify({ code: -32603, message: "Internal error", data: { details: "database connection lost", service: "session", errorName: "APIError" } }));
    process.env.FAKE_ACP_RPC_FAILURE_FILE = failureFile;
    await create(GrokAgentDriver);
    await instance.adapter.sendTurn({ threadId: "t-real-error", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "rpc_error" });
    const err = recorder.events.find((e) => e.type === "runtime.error") as { message?: string } | undefined;
    expect(err?.message).toContain("database connection lost");
  });

  it("preserves ACP error codes for provider setup classification", async () => {
    await create(ClassifiedErrorDriver, "auth-required");
    await instance.adapter.sendTurn({ threadId: "t-auth-required", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "auth_required" });
    expect(recorder.events.find((e) => e.type === "runtime.error")).toMatchObject({ setup: true });
  });

  it("selectModel confirms the requested model before prompting", async () => {
    process.env.FAKE_ACP_MODELS = "m-one,m-two";
    await create(SelectModelDriver);
    await instance.adapter.sendTurn({ threadId: "t-model", text: "go", model: "m-two" });

    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ model: "m-two" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it("a model the session does not advertise fails the turn instead of running another", async () => {
    process.env.FAKE_ACP_MODELS = "m-one,m-two";
    await create(SelectModelDriver);
    await instance.adapter.sendTurn({ threadId: "t-bad-model", text: "go", model: "m-nope" });

    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false });
    const err = recorder.events.find((e) => e.type === "runtime.error")!;
    expect(err.message).toMatch(/model not found/);
    // nothing was generated: the prompt is never sent
    expect(recorder.events.some((e) => e.type === "content.delta")).toBe(false);
  });

  // The unadvertised-model test above rides the fake's -32602, so it settles in
  // `request()` and never reaches the guard. This one is the silent case the
  // guard was written for: the agent acknowledges the switch and keeps its old
  // model, which no error surfaces.
  it("a model switch acknowledged but not applied fails the turn", async () => {
    process.env.FAKE_ACP_MODELS = "m-one,m-two";
    process.env.FAKE_ACP_MODEL_STICKS = "1";
    await create(SelectModelDriver);
    await instance.adapter.sendTurn({ threadId: "t-stuck-model", text: "go", model: "m-two" });

    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false });
    const err = recorder.events.find((e) => e.type === "runtime.error")!;
    expect(err.message).toMatch(/did not switch to m-two \(still m-one\)/);
    // the whole point: no paid turn is spent on the wrong model
    expect(recorder.events.some((e) => e.type === "content.delta")).toBe(false);
  });

  it("selects the model on a resumed session too, not just a new one", async () => {
    process.env.FAKE_ACP_MODELS = "m-one,m-two";
    await create(SelectModelDriver);
    await instance.adapter.sendTurn({
      threadId: "t-resume-model",
      text: "go",
      model: "m-two",
      // deliberately NOT "fake-acp-session", the id session/new returns: with
      // that cursor a session/load that threw and fell back to session/new
      // would emit the same sessionId and this test could not fail
      resumeCursor: "resumed-thread-1",
    });

    // session/load feeds the same sessionResult as session/new, so the model
    // hook must fire on a resumed thread as well
    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ sessionId: "resumed-thread-1", model: "m-two" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it("reuses a resume cursor when session/load returns a session", async () => {
    await create(GrokAgentDriver);
    await instance.adapter.sendTurn({
      threadId: "t-resume-truthy",
      text: "go",
      resumeCursor: "resumed-cursor-1",
    });

    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ sessionId: "resumed-cursor-1" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it("falls through to session/new when session/load returns null", async () => {
    process.env.FAKE_ACP_LOAD_NULL = "1";
    await create(GrokAgentDriver);
    await instance.adapter.sendTurn({
      threadId: "t-resume-null",
      text: "go",
      resumeCursor: "gone-cursor",
    });

    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ sessionId: "fake-acp-session" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it.each(["null", "opencode-not-found"])("rebuilds a missing native session from the canonical recovery text once (%s)", async (failure) => {
    if (failure === "null") process.env.FAKE_ACP_LOAD_NULL = "1";
    else process.env.FAKE_ACP_LOAD_ERROR = JSON.stringify({ code: -32602, message: "Session not found", data: { sessionId: "missing-cursor" } });
    const dump = join(scratch, "recovery.json");
    process.env.FAKE_ACP_DUMP = dump;
    process.env.FAKE_ACP_DUMP_PROMPT = "1";
    await create(GrokAgentDriver);
    const recoveryText = "User: Remember ALPHA.\nAssistant: Remembered.\nUser: What did I say?";
    await instance.adapter.sendTurn({
      threadId: "t-resume-history", text: "What did I say?", resumeCursor: "missing-cursor",
      recoveryText, system: "Keep current bot instructions.",
    });
    expect(await recorder.until((e) => e.type === "turn.completed")).toMatchObject({ ok: true });
    expect(recorder.events.find((e) => e.type === "session.started")).toMatchObject({ rebuilt: true });
    const prompt = JSON.parse(readFileSync(`${dump}.prompt.json`, "utf8"));
    expect(prompt).toEqual([{ type: "text", text: `Keep current bot instructions.${HINT}\n\n${recoveryText}` }]);
  });

  it.each([
    [-32000, "authentication required", "auth_required"],
    [-32602, "Invalid params", "rpc_error"],
  ])("does not replace native history after a resume refusal (%s)", async (code, message, stopReason) => {
    process.env.FAKE_ACP_LOAD_ERROR = JSON.stringify({ code, message });
    const rpcFile = join(scratch, "refused-load.json");
    process.env.FAKE_ACP_RPC_DUMP = rpcFile;
    const countFile = join(scratch, "launches");
    process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
    await create(ClassifiedErrorDriver);
    const turn = {
      threadId: "t-load-refused", text: "Continue", resumeCursor: "saved-session", recoveryText: "Prior messages\nContinue",
    };
    await instance.adapter.sendTurn(turn);
    expect(await recorder.until((e) => e.type === "turn.completed")).toMatchObject({ ok: false, stopReason });
    const methods = JSON.parse(readFileSync(rpcFile, "utf8"));
    expect(methods).toContain("session/load");
    expect(methods).not.toContain("session/new");
    expect(methods).not.toContain("session/prompt");
    const retry = await instance.adapter.sendTurn(turn);
    expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === retry.turnId)).toMatchObject({ ok: false, stopReason });
    expect(Number(readFileSync(countFile, "utf8"))).toBe(1);
  });

  it("applyTurnEnv sees the picker model after resolveTurnModel", async () => {
    const dump = join(scratch, "turn-env.json");
    process.env.FAKE_ACP_DUMP = dump;
    const TurnEnvDriver = createAcpDriver({
      ...SELECT_MODEL_SUPPORT,
      driverKind: "turnEnvTest",
      selectModel: undefined,
      resolveTurnModel: (model) => (model ? `resolved/${model}` : model),
      applyTurnEnv: (env, { model, requestedModel }) => {
        env.TEST_TURN_MODEL = `${model ?? ""}|${requestedModel ?? ""}`;
      },
    });
    instance = await TurnEnvDriver.create({
      instanceId: "turn-env-test",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({
      threadId: "t-turn-env",
      text: "go",
      model: "ollama::ornith:35b-bf16",
    });
    await recorder.until((e) => e.type === "turn.completed");

    expect(JSON.parse(readFileSync(dump, "utf8")).env.TEST_TURN_MODEL).toBe(
      "resolved/ollama::ornith:35b-bf16|ollama::ornith:35b-bf16",
    );
  });

  it("transformEnv sees the instance config", async () => {
    const dump = join(scratch, "policy.json");
    process.env.FAKE_ACP_DUMP = dump;
    instance = await EnvPolicyDriver.create({
      instanceId: "policy-test",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "t-policy", text: "go" });
    await recorder.until((e) => e.type === "turn.completed");

    expect(JSON.parse(readFileSync(dump, "utf8")).env.TEST_POLICY).toBe("auto");
  });

  it("per-bot Ask overrides a legacy full-auto instance for the whole turn", async () => {
    const dump = join(scratch, "ask-overrides-full-auto.json");
    process.env.FAKE_ACP_DUMP = dump;
    instance = await EnvPolicyDriver.create({
      instanceId: "policy-override-test",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({
      threadId: "t-policy-override",
      text: "go",
      approvalMode: "ask",
    });
    await recorder.until((e) => e.type === "turn.completed");

    expect(JSON.parse(readFileSync(dump, "utf8")).env.TEST_POLICY).toBe("ask");
  });

  it("declares effort levels for Grok only", async () => {
    await create(GrokAgentDriver);
    // The union of the Grok models' levels; each model narrows it (grok-4.5 has no X-High).
    expect(instance.adapter.capabilities.effortLevels).toEqual(["low", "medium", "high", "xhigh"]);

    await create(GeminiAgentDriver);
    expect(instance.adapter.capabilities.effortLevels).toBeUndefined();

    await create(KimiAgentDriver);
    expect(instance.adapter.capabilities.effortLevels).toBeUndefined();
  });

  it("passes effort to Grok, and omits the flag when unset", async () => {
    const withEffort = join(scratch, "grok-effort.json");
    await create(GrokAgentDriver);
    process.env.FAKE_ACP_DUMP = withEffort;
    await instance.adapter.sendTurn({ threadId: "t-effort", text: "hi", effort: "high" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(withEffort, "utf8"));
    expect(seen.argv).toContain("--reasoning-effort");
    expect(seen.argv[seen.argv.indexOf("--reasoning-effort") + 1]).toBe("high");

    const without = join(scratch, "grok-no-effort.json");
    await create(GrokAgentDriver);
    process.env.FAKE_ACP_DUMP = without;
    await instance.adapter.sendTurn({ threadId: "t-no-effort", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    expect(JSON.parse(readFileSync(without, "utf8")).argv).not.toContain("--reasoning-effort");
  });

  it("puts Grok -m after agent so ACP stdio binds the local slug", async () => {
    const dump = join(scratch, "grok-argv-order.json");
    await create(GrokAgentDriver);
    process.env.FAKE_ACP_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-argv", text: "hi", model: "grok-4.5", effort: "high" });
    await recorder.until((e) => e.type === "turn.completed");

    const argv = JSON.parse(readFileSync(dump, "utf8")).argv as string[];
    const agent = argv.indexOf("agent");
    const modelFlag = argv.indexOf("-m");
    const stdio = argv.indexOf("stdio");
    expect(agent).toBeGreaterThan(-1);
    expect(modelFlag).toBeGreaterThan(agent);
    expect(stdio).toBeGreaterThan(modelFlag);
    expect(argv[modelFlag + 1]).toBe("grok-4.5");
    expect(argv.indexOf("--reasoning-effort")).toBeGreaterThan(agent);
    expect(argv.indexOf("--permission-mode")).toBeLessThan(agent);
  });

  describe("opt-in startup recovery", () => {
    const failStartup = async (message = "503 Service Unavailable") => {
      const failureFile = join(scratch, "startup-failure.json");
      process.env.FAKE_ACP_RPC_FAILURE_FILE = failureFile;
      process.env.FAKE_ACP_RPC_FAILURE_METHOD = "session/new";
      writeFileSync(failureFile, JSON.stringify({ code: -32603, message }));
      await create();
    };

    it("rejects a transient setup failure only after its exact child stops, without terminal events", async () => {
      await failStartup();
      const kill = vi.spyOn(procs, "killCliTree");
      const failed = await instance.adapter.sendTurn({ threadId: "startup", text: "go", startupRecovery: true }).catch((error) => error);
      expect(failed).toBeInstanceOf(TurnNotStartedError);
      expect(failed.turnId).toBe(recorder.events.find((event) => event.type === "turn.started")?.turnId);
      expect(recorder.events.some((event) => event.type === "runtime.error" || event.type === "turn.completed")).toBe(false);
      expect(kill).toHaveBeenCalled();
      expect(await kill.mock.results[0].value).toBe(true);
      const child = kill.mock.calls[0][0];
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(instance.adapter.hasSession("startup")).toBe(false);
    });

    it.each([
      "503 invalid api key", "503 quota exceeded", "503 unknown model", "503 blocked by our safety systems", "unrecognized failure",
      "503 permission denied", "approval required after timeout", "503 policy restriction", "timeout blocked by policy",
    ])("keeps normal completion for %s", async (message) => {
      await failStartup(message);
      const ack = await instance.adapter.sendTurn({ threadId: "startup-terminal", text: "go", startupRecovery: true });
      expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === ack.turnId)).toMatchObject({ ok: false });
      expect(recorder.events.some((event) => event.type === "runtime.error")).toBe(true);
    });

    it("acknowledges before a prompt timeout and never offers startup recovery afterward", async () => {
      process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "100";
      await create(GrokAgentDriver, "stall-after-text");
      const ack = await instance.adapter.sendTurn({ threadId: "startup-prompt", text: "go", startupRecovery: true });
      expect(recorder.events.some((event) => event.type === "turn.completed")).toBe(false);
      expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === ack.turnId))
        .toMatchObject({ ok: false, stopReason: "rpc_error" });
    });

    it("resolves the pending ACK when Stop interrupts initialization", async () => {
      await create(GrokAgentDriver, "hang-initialize");
      const pending = instance.adapter.sendTurn({ threadId: "startup-stop", text: "go", startupRecovery: true });
      let acknowledged = false;
      void pending.then(() => { acknowledged = true; });
      await recorder.until((event) => event.type === "turn.started");
      expect(acknowledged).toBe(false);
      await instance.adapter.interruptTurn("startup-stop");
      const ack = await pending;
      await recorder.until((event) => event.type === "turn.completed" && event.turnId === ack.turnId);
      // Closing the session rejects the pending handshake ("session closed"):
      // that is the stop, not an error row.
      expect(recorder.events.some((event) => event.type === "runtime.error")).toBe(false);
      expect(recorder.events.find((event) => event.type === "turn.completed" && event.turnId === ack.turnId))
        .toMatchObject({ ok: true, stopReason: "cancelled" });
      expect(instance.adapter.hasSession("startup-stop")).toBe(false);
    });

    it("honors Stop while confirming cleanup instead of rejecting for recovery", async () => {
      await failStartup();
      const spawn = procs.spawnCli;
      let startupChild: ReturnType<typeof procs.spawnCli>;
      vi.spyOn(procs, "spawnCli").mockImplementation((...args) => startupChild = spawn(...args));
      let release!: () => void;
      let stopping!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const startedStopping = new Promise<void>((resolve) => { stopping = resolve; });
      const kill = procs.killCliTree;
      vi.spyOn(procs, "killCliTree").mockImplementation(async (child, timeout) => {
        // Delayed cleanup from another test must not release this turn's gate.
        if (child === startupChild) { stopping(); await gate; }
        return kill(child, timeout);
      });
      try {
        const pending = instance.adapter.sendTurn({ threadId: "startup-cleanup-stop", text: "go", startupRecovery: true });
        await startedStopping;
        await instance.adapter.interruptTurn("startup-cleanup-stop");
        release();
        const ack = await pending;
        expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === ack.turnId))
          .toMatchObject({ ok: true, stopReason: "cancelled" });
        expect(recorder.events.some((event) => event.type === "runtime.error")).toBe(false);
      } finally { release(); }
    });

    it("fails normally when process cleanup cannot be confirmed", async () => {
      await failStartup();
      const kill = procs.killCliTree;
      const stop = vi.spyOn(procs, "killCliTree").mockResolvedValue(false);
      try {
        const ack = await instance.adapter.sendTurn({ threadId: "startup-kill-failed", text: "go", startupRecovery: true });
        expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === ack.turnId)).toMatchObject({ ok: false });
        expect(recorder.events.some((event) => event.type === "runtime.error")).toBe(true);
      } finally {
        await Promise.all(stop.mock.calls.map(([child]) => kill(child, 0)));
      }
    });

    it.each(["request", "output"])("does not recover after pre-prompt %s activity", async (kind) => {
      const spawn = procs.spawnCli;
      vi.spyOn(procs, "spawnCli").mockImplementation((...args) => {
        const child = spawn(...args);
        const write = child.stdin.write.bind(child.stdin);
        vi.spyOn(child.stdin, "write").mockImplementation((...writeArgs) => {
          const message = JSON.parse(String(writeArgs[0]));
          if (message.method === "session/new") {
            const activity = kind === "request"
              ? { jsonrpc: "2.0", id: "before-prompt", method: "fs/read_text_file", params: { path: join(scratch, "absent") } }
              : { jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "before-prompt" } } };
            child.stdout.emit("data", Buffer.from(`${JSON.stringify(activity)}\n`));
          }
          return write(...writeArgs);
        });
        return child;
      });
      await failStartup();
      const ack = await instance.adapter.sendTurn({ threadId: "startup-activity", text: "go", startupRecovery: true });
      expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === ack.turnId)).toMatchObject({ ok: false });
    });
  });

  describe("an engine's account and HTTP failures", () => {
    /** The provider's refusal as the CLI answers session/prompt: JSON-RPC's internal error around its own line. */
    const refuse = (details: string) => {
      const failureFile = join(scratch, "prompt-failure.json");
      process.env.FAKE_ACP_RPC_FAILURE_FILE = failureFile;
      writeFileSync(failureFile, JSON.stringify({ code: -32603, message: "Internal error", data: { details, service: "session", errorName: "APIError" } }));
    };
    const failed = async (threadId: string) => {
      const ack = await instance.adapter.sendTurn({ threadId, text: "Run the morning report" });
      const completed = await recorder.until((e) => e.type === "turn.completed" && e.turnId === ack.turnId);
      const errors = recorder.events.filter((e) => e.type === "runtime.error" && e.turnId === ack.turnId);
      return { completed, errors };
    };

    it("names a Grok account out of credits as the account failure it is, in Grok's own account wording", async () => {
      // what Cloud routine runs recorded, as far as the aggregate kept it
      refuse("API error (status 402 Payment Required): Grok Build us…");
      await create(GrokAgentDriver);
      const { completed, errors } = await failed("t-grok-402");
      // Grok's driver words its own 402 (describeAccountError); the shared wording covers the other engines.
      expect(errors).toEqual([expect.objectContaining({
        message: expect.stringContaining("the usage balance of the Grok account it runs on is used up"),
        setup: true,
      })]);
      expect(completed).toMatchObject({ ok: false, stopReason: "auth_required" });
    });

    it("names any other ACP engine out of credits the same way", async () => {
      refuse("API error (status 402 Payment Required): Your plan has no credits left. Ask an admin to add more.");
      await create(GeminiAgentDriver);
      const { errors } = await failed("t-gemini-402");
      expect(errors).toEqual([expect.objectContaining({
        message: 'Your Gemini account is out of credits (Gemini says: "Your plan has no credits left"). Add credits with Gemini, then run it again.',
      })]);
    });

    it("puts another HTTP failure in plain words that keep its class, and leaves an unknown one as it was", async () => {
      refuse("API error (status 503 Service Unavailable): upstream connect error");
      await create(GrokAgentDriver);
      const outage = await failed("t-grok-503");
      expect(outage.errors).toEqual([expect.objectContaining({
        message: 'Grok had a temporary server problem (HTTP 503; Grok says: "upstream connect error"). Try again in a few minutes.',
      })]);
      expect(outage.errors[0]).not.toHaveProperty("setup");
      expect(outage.completed).toMatchObject({ ok: false, stopReason: "rpc_error" });

      refuse("Grok could not finish the session");
      await create(GrokAgentDriver);
      const unknown = await failed("t-grok-unknown");
      expect(unknown.errors).toEqual([expect.objectContaining({
        message: "Internal error: Grok could not finish the session (session/prompt, service: session, APIError)",
      })]);
    });
  });

  describe("ACP session pool (persistent child)", () => {
    let countFile: string;
    let rpcFile: string;
    const launches = () => Number(readFileSync(countFile, "utf8"));
    const rpc = () => JSON.parse(readFileSync(rpcFile, "utf8")) as string[];

    it("recovers on the next explicit turn after session establishment fails", async () => {
      countFile = join(scratch, "launches");
      const appendFile = join(scratch, "rpc-all.jsonl");
      const failureFile = join(scratch, "failure.json");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      process.env.FAKE_ACP_RPC_FAILURE_FILE = failureFile;
      process.env.FAKE_ACP_RPC_FAILURE_METHOD = "session/new";
      writeFileSync(failureFile, JSON.stringify({ code: -32603, message: "Internal error", data: {
        service: "directory", details: "OpenCode service failure", errorName: "Error",
      } }));
      await create();
      const threadId = "t-new-rpc-recovery";
      const first = await instance.adapter.sendTurn({ threadId, text: "Hello" });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId)).toMatchObject({ ok: false, stopReason: "rpc_error" });
      const calls = () => readFileSync(appendFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(launches()).toBe(1);
      expect(calls().filter((entry) => entry.method === "session/prompt")).toHaveLength(0);
      expect(recorder.events.some((e) => e.type === "session.started")).toBe(false);
      unlinkSync(failureFile);
      const next = await instance.adapter.sendTurn({ threadId, text: "Hello again" });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === next.turnId)).toMatchObject({ ok: true });
      expect(launches()).toBe(2);
      expect(calls().filter((entry) => entry.method === "session/prompt")).toHaveLength(1);
      expect(recorder.events.filter((e) => e.type === "turn.completed" && e.turnId === first.turnId)).toHaveLength(1);
    });

    it.each([false, true])("evicts internal-error processes without replaying a failed prompt (output: %s)", async (afterOutput) => {
      countFile = join(scratch, "launches");
      const appendFile = join(scratch, "rpc-all.jsonl");
      const failureFile = join(scratch, "failure.json");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      process.env.FAKE_ACP_RPC_FAILURE_FILE = failureFile;
      if (afterOutput) process.env.FAKE_ACP_RPC_FAILURE_AFTER_OUTPUT = "1";
      await create();
      const threadId = "t-rpc-recovery";
      const first = await instance.adapter.sendTurn({ threadId, text: "Remember ALPHA" });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId)).toMatchObject({ ok: true });
      writeFileSync(failureFile, JSON.stringify({ code: -32603, message: "Internal error", data: {
        details: "OpenCode service failure; api_key=fixture-secret",
        service: "session", errorName: "APIError",
        responseBody: "PRIVATE RESPONSE BODY MUST NOT APPEAR",
      } }));
      const failed = await instance.adapter.sendTurn({ threadId, text: "Do work", resumeCursor: "fake-acp-session" });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === failed.turnId)).toMatchObject({ ok: false, stopReason: "rpc_error" });
      expect(launches()).toBe(1);
      expect(instance.adapter.hasSession(threadId)).toBe(false);
      const error = recorder.events.find((e) => e.type === "runtime.error" && e.turnId === failed.turnId);
      const message = error?.type === "runtime.error" ? error.message : "";
      expect(message).toContain("Internal error: OpenCode service failure");
      expect(message).toContain("session/prompt, service: session, APIError");
      expect(message).not.toContain("fixture-secret");
      expect(message).not.toContain("PRIVATE RESPONSE");
      expect(recorder.events.filter((e) => e.type === "item.completed" && e.itemType === "tool" && e.turnId === failed.turnId)).toHaveLength(afterOutput ? 1 : 0);
      unlinkSync(failureFile);
      const next = await instance.adapter.sendTurn({ threadId, text: "Continue after the interruption", resumeCursor: "fake-acp-session" });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === next.turnId)).toMatchObject({ ok: true });
      expect(launches()).toBe(2);
      const calls = readFileSync(appendFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(calls.filter((entry) => entry.method === "session/prompt")).toHaveLength(3);
      expect(calls.filter((entry) => entry.method === "session/load")).toHaveLength(1);
      expect(recorder.events.filter((e) => e.type === "turn.completed" && e.turnId === failed.turnId)).toHaveLength(1);
    });

    it("honors explicit session reset even when a healthy child and cursor are retained", async () => {
      countFile = join(scratch, "launches");
      rpcFile = join(scratch, "rpc.json");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_DUMP = rpcFile;
      await create();
      const first = await instance.adapter.sendTurn({ threadId: "t-reset", text: "one" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      const second = await instance.adapter.sendTurn({ threadId: "t-reset", text: "rebuilt conversation", sessionReset: true, resumeCursor: "fake-acp-session" });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId)).toMatchObject({ ok: true });
      expect(launches()).toBe(2);
      expect(rpc()).toContain("session/new");
      expect(rpc()).not.toContain("session/load");
    });

    it("reuses one agent process across turns and skips the handshake", async () => {
      countFile = join(scratch, "launches");
      rpcFile = join(scratch, "rpc.json");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_DUMP = rpcFile;
      await create();
      const first = await instance.adapter.sendTurn({ threadId: "t-pool-reuse", text: "one" });
      const firstDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      expect(firstDone).toMatchObject({ ok: true });

      const second = await instance.adapter.sendTurn({
        threadId: "t-pool-reuse",
        text: "two",
        resumeCursor: "fake-acp-session",
      });
      const secondDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
      expect(secondDone).toMatchObject({ ok: true });

      // one live child per thread: the second prompt rides the same process
      expect(launches()).toBe(1);
      expect(rpc().filter((m) => m === "initialize")).toHaveLength(1);
      expect(rpc().filter((m) => m === "session/new")).toHaveLength(1);
      expect(rpc().filter((m) => m === "session/load")).toHaveLength(0);
      expect(rpc().filter((m) => m === "session/prompt")).toHaveLength(2);
      expect(recorder.events.filter((e) => e.type === "session.started")).toMatchObject([
        { sessionId: "fake-acp-session" },
        { sessionId: "fake-acp-session" },
      ]);
    });

    it("closes the idle process and resumes on the next turn", async () => {
      // Ten seconds is the lowest window the floor allows now; exercise the
      // close at the floor itself and give the poll room past it.
      process.env.SAGAX_ACP_SESSION_IDLE_MIN_MS = "10000";
      process.env.SAGAX_ACP_SESSION_IDLE_MS = "10000";
      countFile = join(scratch, "launches");
      rpcFile = join(scratch, "rpc.json");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_DUMP = rpcFile;
      await create();
      const first = await instance.adapter.sendTurn({ threadId: "t-pool-idle", text: "one" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      // the close reason is only logged, never emitted — poll the native log
      // for it rather than sleeping a fixed window past the idle deadline
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 20_000;
        const log = join(NATIVE_DIR, "t-pool-idle.ndjson");
        const check = () => {
          if (Date.now() > deadline) return reject(new Error("idle close was never logged"));
          try {
            if (readFileSync(log, "utf8").includes('"close":"idle"')) return resolve();
          } catch (error) {
            // appendNative() suppresses append errors, so the file may not exist yet
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") return reject(error);
          }
          setTimeout(check, 25);
        };
        check();
      });
      expect(launches()).toBe(1);

      const second = await instance.adapter.sendTurn({
        threadId: "t-pool-idle",
        text: "two",
        resumeCursor: "fake-acp-session",
      });
      const done = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
      expect(done).toMatchObject({ ok: true });
      expect(launches()).toBe(2);
      // the dump is per-process and overwritten on spawn, so this is the resumed child
      expect(rpc()).toContain("session/load");
      expect(rpc()).toContain("initialize");
    }, 30_000);

    it("respawns when the spawn contract changes", async () => {
      countFile = join(scratch, "launches");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      const dirA = mkdtempSync(join(scratch, "a-"));
      const dirB = mkdtempSync(join(scratch, "b-"));
      await create();
      const first = await instance.adapter.sendTurn({ threadId: "t-pool-contract", text: "one", cwd: dirA });
      const firstDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      expect(firstDone).toMatchObject({ ok: true });

      const second = await instance.adapter.sendTurn({
        threadId: "t-pool-contract",
        text: "two",
        cwd: dirB,
        resumeCursor: "fake-acp-session",
      });
      const secondDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
      expect(secondDone).toMatchObject({ ok: true });
      expect(launches()).toBe(2);
    });

    it.each([
      { driver: GrokAgentDriver, expectedLaunches: 1 },
      { driver: QwenAgentDriver, expectedLaunches: 2 },
    ])("rotating credentials refreshes $driver.driverKind with $expectedLaunches process(es)", async ({ driver, expectedLaunches }) => {
      countFile = join(scratch, "launches");
      const appendFile = join(scratch, "rpc-all.jsonl");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      instance = await driver.create({
        instanceId: "acp-test", displayName: "ACP Test", enabled: true,
        environment: { HOME: scratch, USERPROFILE: scratch },
        config: { cli: FAKE_CLI, fullAuto: false },
      });
      recorder = recordEvents(instance.adapter);
      // Qwen caches MCP clients on live load; other agents apply the new
      // credentials without a process restart. Both preserve the cursor.
      const integration = (token: string) => ({
        command: process.execPath,
        args: [FAKE_CLI],
        env: { SAGAX_COMMS_TOKEN: token },
      });
      const first = await instance.adapter.sendTurn({
        threadId: "t-pool-token",
        text: "one",
        integrations: { agents: integration("token-one") },
      });
      const firstDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      expect(firstDone).toMatchObject({ ok: true });

      const second = await instance.adapter.sendTurn({
        threadId: "t-pool-token",
        text: "two",
        resumeCursor: "fake-acp-session",
        integrations: { agents: integration("token-two") },
      });
      const secondDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
      expect(secondDone).toMatchObject({ ok: true });

      const third = await instance.adapter.sendTurn({
        threadId: "t-pool-token", text: "unchanged MCP inputs",
        resumeCursor: "fake-acp-session",
        integrations: { agents: integration("token-two") },
      });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === third.turnId)).toMatchObject({ ok: true });
      expect(launches()).toBe(expectedLaunches);
      const calls = readFileSync(appendFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).method);
      expect(calls.filter((m) => m === "initialize")).toHaveLength(expectedLaunches);
      expect(calls.filter((m) => m === "session/new")).toHaveLength(1);
      expect(calls.filter((m) => m === "session/load")).toHaveLength(1);
      expect(calls.filter((m) => m === "session/prompt")).toHaveLength(3);
      expect(recorder.events.filter((e) => e.type === "session.started").map((e) => e.sessionId)).toEqual([
        "fake-acp-session", "fake-acp-session", "fake-acp-session",
      ]);
    });

    it("keeps one native session through a call: a new turn token is a prompt, not a session/load", async () => {
      countFile = join(scratch, "launches");
      const appendFile = join(scratch, "rpc-all.jsonl");
      const dump = join(scratch, "dump.json");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      process.env.FAKE_ACP_DUMP = dump;
      await create();
      const agents = (token: string) => ({ agents: { command: process.execPath, args: [FAKE_CLI], env: { SAGAX_COMMS_TOKEN: token, SAGAX_BOT_ID: "bot-call" } } });
      const calls = () => readFileSync(appendFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).method as string)
        .filter((method) => !method.endsWith(".result") && method !== "_x.ai/mcp/list"); // the MCP settle poll (grok.ts) is not what these tests check
      const turn = async (text: string, token: string, keepWarm: boolean) => {
        const started = await instance.adapter.sendTurn({
          threadId: "t-call-warm", botId: "bot-call", text, resumeCursor: "fake-acp-session",
          integrations: agents(token), ...(keepWarm ? { keepWarm: true } : {}),
        });
        expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === started.turnId)).toMatchObject({ ok: true });
        return started;
      };
      // a written turn before the call: the session exists on the process
      const before = await turn("before the call", "token-zero", false);
      expect(before.reused).toBeUndefined();
      expect(calls().filter((m) => m === "session/load")).toHaveLength(1);
      // the call's first turn re-establishes once (its servers now name the token file)
      const first = await turn("call one", "token-one", true);
      expect(first.reused).toBeUndefined();
      expect(calls().filter((m) => m === "session/load")).toHaveLength(2);
      const tokenFile = (JSON.parse(readFileSync(`${dump}.mcp.json`, "utf8")) as Array<{ name: string; env: Array<{ name: string; value: string }> }>)
        .find((server) => server.name === "agents")!.env.find((entry) => entry.name === "SAGAX_COMMS_TOKEN_FILE")?.value;
      expect(tokenFile).toBeTruthy();
      expect(readFileSync(tokenFile!, "utf8")).toBe("token-one");
      // the call's later turns: a new token each, the same session, prompt only
      const second = await turn("call two", "token-two", true);
      const third = await turn("call three", "token-three", true);
      expect(second.reused).toBe(true);
      expect(third.reused).toBe(true);
      expect(readFileSync(tokenFile!, "utf8")).toBe("token-three");
      expect(calls().filter((m) => m === "session/load")).toHaveLength(2);
      expect(calls().slice(-2)).toEqual(["session/prompt", "session/prompt"]);
      // after the call a written turn hands its own token over the wire again
      await turn("after the call", "token-four", false);
      expect(calls().filter((m) => m === "session/load")).toHaveLength(3);
      expect(launches()).toBe(1);
      expect(calls().filter((m) => m === "initialize")).toHaveLength(1);
    });

    it("warms a call: handshake and session/load with no prompt, then the first turn is a bare prompt", async () => {
      countFile = join(scratch, "launches");
      const appendFile = join(scratch, "rpc-all.jsonl");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      await create();
      expect(instance.adapter.capabilities.warmSession).toBe(true);
      const agents = (token: string) => ({ agents: { command: process.execPath, args: [FAKE_CLI], env: { SAGAX_COMMS_TOKEN: token } } });
      const calls = () => readFileSync(appendFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).method as string)
        .filter((method) => !method.endsWith(".result") && method !== "_x.ai/mcp/list"); // the MCP settle poll (grok.ts) is not what these tests check
      const warmed = await instance.adapter.sendTurn({
        threadId: "t-call-warmup", botId: "bot-warm", text: "", resumeCursor: "fake-acp-session",
        keepWarm: true, warmOnly: true, integrations: agents("token-warm"),
      });
      // the warm is done when sendTurn returns, and the thread saw nothing
      expect(calls()).toEqual(["initialize", "authenticate", "session/load"]);
      expect(recorder.events.filter((e) => e.threadId === "t-call-warmup")).toEqual([]);
      expect(instance.adapter.hasSession("t-call-warmup")).toBe(false);
      expect(warmed.reused).toBeUndefined();
      // a second warm of the same call finds the session ready
      expect((await instance.adapter.sendTurn({
        threadId: "t-call-warmup", botId: "bot-warm", text: "", resumeCursor: "fake-acp-session",
        keepWarm: true, warmOnly: true, integrations: agents("token-warm-2"),
      })).reused).toBe(true);
      const first = await instance.adapter.sendTurn({
        threadId: "t-call-warmup", botId: "bot-warm", text: "first spoken turn", resumeCursor: "fake-acp-session",
        keepWarm: true, integrations: agents("token-one"),
      });
      expect(first.reused).toBe(true);
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId)).toMatchObject({ ok: true });
      expect(calls()).toEqual(["initialize", "authenticate", "session/load", "session/prompt"]);
      expect(launches()).toBe(1);
      // hangup closes the idle process; the next turn starts a new one
      instance.adapter.releaseWarmSession?.("t-call-warmup");
      const after = await instance.adapter.sendTurn({ threadId: "t-call-warmup", text: "in writing", resumeCursor: "fake-acp-session" });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === after.turnId)).toMatchObject({ ok: true });
      expect(launches()).toBe(2);
    });

    it("warms a new conversation with session/new, and a hangup during the call's wait closes it", async () => {
      countFile = join(scratch, "launches");
      const appendFile = join(scratch, "rpc-all.jsonl");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      await create();
      const calls = () => readFileSync(appendFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).method as string)
        .filter((method) => !method.endsWith(".result") && method !== "_x.ai/mcp/list"); // the MCP settle poll (grok.ts) is not what these tests check
      await instance.adapter.sendTurn({ threadId: "t-call-new", text: "", keepWarm: true, warmOnly: true });
      expect(calls()).toEqual(["initialize", "authenticate", "session/new"]);
      const first = await instance.adapter.sendTurn({ threadId: "t-call-new", text: "hello", keepWarm: true });
      expect(first.reused).toBe(true);
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      // the cursor is recorded by the turn, not by the warm
      expect(recorder.events.find((e) => e.type === "session.started" && e.turnId === first.turnId)).toMatchObject({ sessionId: "fake-acp-session" });
      expect(calls()).toEqual(["initialize", "authenticate", "session/new", "session/prompt"]);

      const hangup = new AbortController();
      await instance.adapter.sendTurn({ threadId: "t-call-abort", text: "", keepWarm: true, warmOnly: true, warmSignal: hangup.signal });
      expect(launches()).toBe(2);
      hangup.abort();
      const next = await instance.adapter.sendTurn({ threadId: "t-call-abort", text: "later", keepWarm: true });
      expect(next.reused).toBeUndefined();
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === next.turnId);
      expect(launches()).toBe(3);
    });

    it("primes a call's prompt cache in the background, then the spoken turn prompts again", async () => {
      countFile = join(scratch, "launches");
      const appendFile = join(scratch, "rpc-all.jsonl");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      await create();
      const agents = (token: string) => ({ agents: { command: process.execPath, args: [FAKE_CLI], env: { SAGAX_COMMS_TOKEN: token } } });
      const calls = () => readFileSync(appendFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).method as string)
        .filter((method) => !method.endsWith(".result") && method !== "_x.ai/mcp/list"); // the MCP settle poll (grok.ts) is not what these tests check
      await instance.adapter.sendTurn({
        threadId: "t-call-prime", botId: "bot-warm", text: "", resumeCursor: "fake-acp-session",
        keepWarm: true, warmOnly: true, cachePrime: true,
        system: "You are Sage, on a phone call.",
        integrations: agents("token-warm"),
      });
      await expect.poll(() => calls(), { timeout: 5_000 }).toEqual(["initialize", "authenticate", "session/load", "session/prompt"]);
      expect(recorder.events.filter((event) => event.threadId === "t-call-prime")).toEqual([]);
      expect(instance.adapter.hasSession("t-call-prime")).toBe(false);
      const first = await instance.adapter.sendTurn({
        threadId: "t-call-prime", botId: "bot-warm", text: "first spoken turn", resumeCursor: "fake-acp-session",
        keepWarm: true, system: "You are Sage, on a phone call.",
        integrations: agents("token-one"),
      });
      expect(first.reused).toBe(true);
      expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === first.turnId)).toMatchObject({ ok: true });
      expect(calls()).toEqual(["initialize", "authenticate", "session/load", "session/prompt", "session/prompt"]);
      expect(launches()).toBe(1);
    });

    it("does not load or prompt Qwen after Stop during old-process cleanup", async () => {
      const appendFile = join(scratch, "rpc-all.jsonl");
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      instance = await QwenAgentDriver.create({
        instanceId: "qwen-stop", displayName: "Qwen Stop", enabled: true,
        environment: { HOME: scratch, USERPROFILE: scratch },
        config: { cli: FAKE_CLI, fullAuto: false },
      });
      recorder = recordEvents(instance.adapter);
      const integration = (token: string) => ({ command: process.execPath, args: [FAKE_CLI], env: { SAGAX_COMMS_TOKEN: token } });
      const first = await instance.adapter.sendTurn({ threadId: "qwen-stop", text: "one", integrations: { agents: integration("one") } });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);

      let stopped!: () => void;
      let release!: () => void;
      const stopping = new Promise<void>((resolve) => { stopped = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const kill = procs.killCliTree;
      vi.spyOn(procs, "killCliTree").mockImplementationOnce(async (child) => {
        stopped();
        await gate;
        return kill(child);
      });
      try {
        const second = await instance.adapter.sendTurn({
          threadId: "qwen-stop", text: "two", resumeCursor: "fake-acp-session",
          integrations: { agents: integration("two") },
        });
        await stopping;
        await instance.adapter.interruptTurn("qwen-stop");
        release();
        // Stop races two endings: the new child's close (exit_before_result, ok false) or the
        // handshake's "session closed" (cancelled, ok true); Windows reaps fast enough to see the
        // second. Either way the turn never ends as a normal answer.
        const done = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
        expect(done).toSatisfy((e: any) => e.ok === false || e.stopReason === "cancelled");
        const calls = readFileSync(appendFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).method);
        expect(calls.filter((method) => method === "initialize")).toHaveLength(1);
        expect(calls.filter((method) => method === "session/load")).toHaveLength(0);
        expect(calls.filter((method) => method === "session/prompt")).toHaveLength(1);
        expect(instance.adapter.hasSession("qwen-stop")).toBe(false);
      } finally { release(); }
    });

    it.each(["Stop", "prompt stall", "failed cleanup"])("waits for Qwen cleanup before an immediate retry after %s", async (reason) => {
      const children: ReturnType<typeof procs.spawnCli>[] = [];
      const spawn = procs.spawnCli;
      vi.spyOn(procs, "spawnCli").mockImplementation((...args) => {
        const child = spawn(...args);
        vi.spyOn(child.stdin, "write");
        children.push(child);
        return child;
      });
      const calls = () => children.flatMap((child) => vi.mocked(child.stdin.write).mock.calls
        .map(([chunk]) => JSON.parse(String(chunk)) as { method: string; params: { sessionId?: string } }));
      let release!: () => void;
      let stopping!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const startedStopping = new Promise<void>((resolve) => { stopping = resolve; });
      const kill = procs.killCliTree;
      let rejectCleanup = reason === "failed cleanup";
      vi.spyOn(procs, "killCliTree").mockImplementation(async (child, timeout) => {
        // Hold only the original writer: Stop must still close its uninitialized replacement.
        if (child === children[0]) {
          stopping();
          await gate;
          if (rejectCleanup) return false;
        }
        return kill(child, timeout);
      });
      if (reason === "prompt stall") {
        process.env.SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS = "100";
        process.env.FAKE_ACP_MODE = "stall-after-text";
      }
      instance = await QwenAgentDriver.create({
        instanceId: "qwen-retry", displayName: "Qwen Retry", enabled: true,
        environment: { HOME: scratch, USERPROFILE: scratch },
        config: { cli: FAKE_CLI, fullAuto: false },
      });
      recorder = recordEvents(instance.adapter);
      const integration = (token: string) => ({ agents: { command: process.execPath, args: [FAKE_CLI], env: { SAGAX_COMMS_TOKEN: token } } });
      try {
        const first = await instance.adapter.sendTurn({ threadId: "qwen-retry", text: "one", integrations: integration("one") });
        expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId))
          .toMatchObject({ ok: reason !== "prompt stall" });
        if (reason !== "prompt stall") {
          const second = await instance.adapter.sendTurn({
            threadId: "qwen-retry", text: "two", resumeCursor: "fake-acp-session", integrations: integration("two"),
          });
          await startedStopping;
          if (reason === "Stop") await instance.adapter.interruptTurn("qwen-retry");
          else release();
          expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId)).toMatchObject({ ok: false });
          if (rejectCleanup) {
            expect(recorder.events.find((e) => e.type === "runtime.error" && e.turnId === second.turnId))
              .toMatchObject({ message: expect.stringMatching(/could not close its previous tool session/) });
            rejectCleanup = false;
          }
        }
        process.env.FAKE_ACP_MODE = "happy";
        const retry = await instance.adapter.sendTurn({
          threadId: "qwen-retry", text: "retry", resumeCursor: "fake-acp-session", integrations: integration("three"),
        });
        // Observe writes directly: the retry must not even initialize while cleanup is unconfirmed.
        expect(calls().filter((call) => call.method === "initialize")).toHaveLength(1);
        expect(calls().filter((call) => call.method === "session/load")).toHaveLength(0);
        release();
        expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === retry.turnId)).toMatchObject({ ok: true });
        expect(calls().filter((call) => call.method === "session/new")).toHaveLength(1);
        expect(calls().filter((call) => call.method === "session/load")).toEqual([
          expect.objectContaining({ params: expect.objectContaining({ sessionId: "fake-acp-session" }) }),
        ]);
        expect(calls().filter((call) => call.method === "session/prompt")).toHaveLength(2);
      } finally {
        release();
        await instance.dispose();
        await Promise.all(children.map((child) => kill(child, 0)));
      }
    });

    it("an agent that refuses to re-load its live session gets one fresh process, then resumes", async () => {
      countFile = join(scratch, "launches");
      const appendFile = join(scratch, "rpc-all.jsonl");
      const rejectFile = join(scratch, "reject-live-load");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      // the per-process dump would hold only the replacement child's calls;
      // the append log keeps both children's, pid-tagged
      process.env.FAKE_ACP_RPC_APPEND_FILE = appendFile;
      process.env.FAKE_ACP_REJECT_LIVE_LOAD_FILE = rejectFile;
      await create();
      const rpcAll = () =>
        readFileSync(appendFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { pid: number; method: string });
      const integration = (token: string) => ({
        command: process.execPath,
        args: [FAKE_CLI],
        env: { SAGAX_COMMS_TOKEN: token },
      });
      const first = await instance.adapter.sendTurn({
        threadId: "t-pool-reject",
        text: "one",
        integrations: { agents: integration("token-one") },
      });
      const firstDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      expect(firstDone).toMatchObject({ ok: true });

      // from here the fake refuses session/load for a session already live
      // in its own process, the way a real agent can
      writeFileSync(rejectFile, "1");
      const second = await instance.adapter.sendTurn({
        threadId: "t-pool-reject",
        text: "two",
        resumeCursor: "fake-acp-session",
        integrations: { agents: integration("token-two") },
      });
      const secondDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
      expect(secondDone).toMatchObject({ ok: true });

      // the pooled child is closed and the recorded session resumes on one
      // fresh process — the conversation is never traded for session/new
      expect(launches()).toBe(2);
      const calls = rpcAll();
      expect(calls.filter((c) => c.method === "initialize")).toHaveLength(2);
      expect(calls.filter((c) => c.method === "session/new")).toHaveLength(1);
      expect(calls.filter((c) => c.method === "session/load")).toHaveLength(2);
      expect(calls.filter((c) => c.method === "session/prompt")).toHaveLength(2);
      // the refused load and the successful one really hit two processes
      expect(new Set(calls.map((c) => c.pid)).size).toBe(2);
    });

    it("stopAll closes the pooled process; the next turn resumes", async () => {
      countFile = join(scratch, "launches");
      rpcFile = join(scratch, "rpc.json");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      process.env.FAKE_ACP_RPC_DUMP = rpcFile;
      await create();
      const first = await instance.adapter.sendTurn({ threadId: "t-pool-stop", text: "one" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      await instance.adapter.stopAll();
      const second = await instance.adapter.sendTurn({
        threadId: "t-pool-stop",
        text: "two",
        resumeCursor: "fake-acp-session",
      });
      const done = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
      expect(done).toMatchObject({ ok: true });
      expect(launches()).toBe(2);
      expect(rpc()).toContain("session/load");
    });

    it("an interrupt that the agent honors keeps the process pooled", async () => {
      countFile = join(scratch, "launches");
      process.env.FAKE_ACP_LAUNCH_COUNT_FILE = countFile;
      await create(GrokAgentDriver, "hang");
      await instance.adapter.sendTurn({ threadId: "t-pool-interrupt", text: "go" });
      await recorder.until((e) => e.type === "session.started");
      await instance.adapter.interruptTurn("t-pool-interrupt");
      const done = await recorder.until((e) => e.type === "turn.completed");
      expect(done).toMatchObject({ stopReason: "cancelled" });
      // hang never resolves prompts, so a second turn would hang too — the
      // process staying pooled is the launch count, not another prompt
      expect(launches()).toBe(1);
    });
  });
});

describe("ACP snapshot", () => {
  it("a missing binary is unavailable", async () => {
    const instance = await GrokAgentDriver.create({
      instanceId: "grok-missing",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: "definitely-not-a-real-grok-binary", fullAuto: false },
    });
    const snap = await instance.snapshot();
    expect(snap.state).toBe("unavailable");
    await instance.dispose();
  });

  it("kimi checks KIMI_CODE_HOME before the child HOME", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "omb-kimi-auth-"));
    const kimiHome = join(scratch, "custom-kimi-home");
    const childHome = join(scratch, "child-home");
    mkdirSync(join(childHome, ".kimi-code", "credentials"), { recursive: true });
    writeFileSync(join(childHome, ".kimi-code", "credentials", "kimi-code.json"), "{}");

    const instance = await KimiAgentDriver.create({
      instanceId: "kimi-custom-home",
      displayName: undefined,
      environment: { KIMI_CODE_HOME: kimiHome, HOME: childHome },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      expect((await instance.snapshot()).authenticated).toBe(false);
      mkdirSync(join(kimiHome, "credentials"), { recursive: true });
      writeFileSync(join(kimiHome, "credentials", "kimi-code.json"), "{}");
      expect((await instance.snapshot()).authenticated).toBe(true);
    } finally {
      await instance.dispose();
      await removeTempDir(scratch);
    }
  });

  it("droid resolves the signed-in CLI before falling back to FACTORY_API_KEY", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "omb-droid-auth-"));
    // FACTORY_HOME_OVERRIDE replaces the CLI's HOME, not its data root: droid
    // writes <home>/.factory/auth.v2.file either way (verified against 0.196.0).
    const overrideHome = join(scratch, "custom-home");
    const childHome = join(scratch, "child-home");
    mkdirSync(join(childHome, ".factory"), { recursive: true });
    writeFileSync(join(childHome, ".factory", "auth.v2.file"), "{}");

    // The child env inherits process.env (core.ts childEnv), so a developer
    // machine with a real FACTORY_API_KEY exported would otherwise satisfy
    // every case here and prove nothing about the on-disk lookup.
    // Windows resolves the driver home from USERPROFILE first, so every
    // case pins both to its scratch home like the qwen turn test does.
    const make = (environment: Record<string, string>) =>
      DroidAgentDriver.create({
        instanceId: "droid-auth",
        displayName: undefined,
        environment: { FACTORY_API_KEY: "", ...(environment.HOME ? { USERPROFILE: environment.HOME } : {}), ...environment },
        enabled: true,
        config: { cli: FAKE_CLI, fullAuto: false },
      });

    const instances: ProviderInstance[] = [];
    try {
      // FACTORY_HOME_OVERRIDE wins: the child HOME's credential must not count.
      const overridden = await make({ FACTORY_HOME_OVERRIDE: overrideHome, HOME: childHome });
      instances.push(overridden);
      expect((await overridden.snapshot()).authenticated).toBe(false);
      mkdirSync(join(overrideHome, ".factory"), { recursive: true });
      writeFileSync(join(overrideHome, ".factory", "auth.v2.file"), "{}");
      expect((await overridden.snapshot()).authenticated).toBe(true);

      // A logged-out override is not rescued by a key on the way past it, but
      // the key alone still authenticates when nothing is signed in on disk.
      const loggedOutWithKey = await make({
        FACTORY_HOME_OVERRIDE: join(scratch, "empty-home"),
        HOME: childHome,
        FACTORY_API_KEY: "fk-test",
      });
      instances.push(loggedOutWithKey);
      expect((await loggedOutWithKey.snapshot()).authenticated).toBe(true);

      const fromHome = await make({ HOME: childHome });
      instances.push(fromHome);
      expect((await fromHome.snapshot()).authenticated).toBe(true);

      // secure_auth_storage writes the keychain/keyring variant instead of
      // auth.v2.file, so a fresh macOS login has only this one.
      const keychainHome = join(scratch, "keychain-home");
      mkdirSync(join(keychainHome, ".factory"), { recursive: true });
      writeFileSync(join(keychainHome, ".factory", "auth.v2.loginkeychain"), "{}");
      const fromKeychain = await make({ HOME: keychainHome });
      instances.push(fromKeychain);
      expect((await fromKeychain.snapshot()).authenticated).toBe(true);

      const neither = await make({ HOME: join(scratch, "empty") });
      instances.push(neither);
      expect((await neither.snapshot()).authenticated).toBe(false);
    } finally {
      for (const i of instances) await i.dispose();
      await removeTempDir(scratch);
    }
  });

  it("droid reads custom models, favourites order, and the configured default", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "omb-droid-models-"));
    mkdirSync(join(scratch, ".factory"), { recursive: true });
    writeFileSync(
      join(scratch, ".factory", "settings.json"),
      JSON.stringify({
        customModels: [
          { id: "custom:LMStudio-Qwen-0", displayName: "Qwen (local)" },
          { id: "custom:Azure-Opus-0", displayName: "Azure Opus" },
        ],
        modelFavorites: ["custom:Azure-Opus-0", "custom:LMStudio-Qwen-0"],
        sessionDefaultSettings: { model: "custom:LMStudio-Qwen-0" },
      }),
    );

    const instance = await DroidAgentDriver.create({
      instanceId: "droid-models",
      displayName: undefined,
      environment: { HOME: scratch, USERPROFILE: scratch },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      // favourites first in the user's own order, then the built-in slice
      expect(instance.models.options.slice(0, 2)).toEqual([
        { id: "custom:Azure-Opus-0", label: "Azure Opus", custom: true },
        { id: "custom:LMStudio-Qwen-0", label: "Qwen (local)", custom: true },
      ]);
      expect(instance.models.options.some((o) => o.id === "claude-opus-5")).toBe(true);
      expect(instance.models.default).toBe("custom:LMStudio-Qwen-0");
    } finally {
      await instance.dispose();
      await removeTempDir(scratch);
    }
  });

  it("droid falls back to the built-in catalog when settings.json is unreadable", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "omb-droid-nosettings-"));
    mkdirSync(join(scratch, ".factory"), { recursive: true });
    writeFileSync(join(scratch, ".factory", "settings.json"), "{ not json");

    const instance = await DroidAgentDriver.create({
      instanceId: "droid-models-fallback",
      displayName: undefined,
      environment: { HOME: scratch },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      expect(instance.models.default).toBe("claude-opus-5");
      expect(instance.models.options.every((o) => !o.id.startsWith("custom:"))).toBe(true);
    } finally {
      await instance.dispose();
      await removeTempDir(scratch);
    }
  });

  it("kimi resolves default credentials from the child HOME", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "omb-kimi-home-"));
    const credentialDir = join(scratch, ".kimi-code", "credentials");
    mkdirSync(credentialDir, { recursive: true });
    writeFileSync(join(credentialDir, "kimi-code.json"), "{}");

    const instance = await KimiAgentDriver.create({
      instanceId: "kimi-child-home",
      displayName: undefined,
      environment: { HOME: scratch },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      expect((await instance.snapshot()).authenticated).toBe(true);
    } finally {
      await instance.dispose();
      await removeTempDir(scratch);
    }
  });

  it("awaits an async isAuthenticated", async () => {
    const instance = await AsyncAuthDriver.create({
      instanceId: "async-auth",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    try {
      // without the await this is a Promise: truthy, but not `true`
      expect((await instance.snapshot()).authenticated).toBe(true);
    } finally {
      await instance.dispose();
    }
  });
});

describe("grokCloudConnectorEnv", () => {
  it("keeps cloud connectors off on a solo turn, where default mode can call them unasked", () => {
    expect(grokCloudConnectorEnv(undefined)).toEqual({
      GROK_MANAGED_MCPS_ENABLED: "false",
      GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "false",
    });
  });

  it("lets an organization turn on the person's own xAI sign-in fetch the account connectors", () => {
    expect(grokCloudConnectorEnv(undefined, true, true)).toEqual({ GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "false" });
  });

  it("keeps them off when the account is not the person's own (review of #943: payer is not the speaker)", () => {
    for (const own of [undefined, false]) {
      expect(grokCloudConnectorEnv(undefined, true, own)).toEqual({
        GROK_MANAGED_MCPS_ENABLED: "false",
        GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "false",
      });
    }
  });

  it("turns cloud connectors off when a tool selection cannot list them", () => {
    expect(grokCloudConnectorEnv({ allow: ["native:read_file"] })).toEqual({
      GROK_MANAGED_MCPS_ENABLED: "false",
      GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: "false",
    });
  });
});

describe("grokConnectableConnectors", () => {
  it("names the xAI cloud connectors on an own-account organization turn so an unconnected one is actionable", () => {
    const connectable = grokConnectableConnectors(true);
    const ids = connectable.map((connector) => connector.id);
    expect(ids).toContain("outlook");
    expect(ids).toContain("microsoft-teams");
    expect(ids).toContain("gmail");
    expect(connectable.find((connector) => connector.id === "outlook")?.label).toBe("Outlook (Exchange)");
  });

  it("offers nothing on any turn that does not load the account connectors (solo, foreign, member on another's bot)", () => {
    expect(grokConnectableConnectors(false)).toEqual([]);
  });
});

describe("grokConfigDeclaresMcp", () => {
  it("finds an MCP server table in GROK_HOME's config or the project's, and nothing else", () => {
    const home = mkdtempSync(join(tmpdir(), "grok-home-"));
    const project = mkdtempSync(join(tmpdir(), "grok-cwd-"));
    try {
      const env = { GROK_HOME: home };
      expect(grokConfigDeclaresMcp(env, project)).toBe(false);
      writeFileSync(join(home, "config.toml"), "[models]\ndefault = \"grok-4.5\"\n[model.local]\nmodel = \"x\"\n# [mcp_servers.commented]\n");
      expect(grokConfigDeclaresMcp(env, project)).toBe(false);
      writeFileSync(join(home, "config.toml"), "[models]\n  [mcp_servers.pulsatrix_dispatch]\nurl = \"https://x\"\n");
      expect(grokConfigDeclaresMcp(env, project)).toBe(true);
      writeFileSync(join(home, "config.toml"), "[ \"mcp_servers\" . a ]\n");
      expect(grokConfigDeclaresMcp(env, project)).toBe(true);
      writeFileSync(join(home, "config.toml"), "");
      mkdirSync(join(project, ".grok"));
      writeFileSync(join(project, ".grok", "config.toml"), "[mcp_servers]\na = { command = \"node\" }\n");
      expect(grokConfigDeclaresMcp(env, project)).toBe(true);
      expect(grokConfigDeclaresMcp(env, undefined)).toBe(false);
      // a parent folder's config counts, as Grok reads it
      const sub = join(project, "a", "b");
      mkdirSync(sub, { recursive: true });
      expect(grokConfigDeclaresMcp(env, sub)).toBe(true);
      // a dotted key or an assignment counts too
      writeFileSync(join(project, ".grok", "config.toml"), "");
      expect(grokConfigDeclaresMcp(env, sub)).toBe(false);
      for (const text of ["mcp_servers.x.command = \"node\"\n", "mcp_servers = { x = { command = \"node\" } }\n"]) {
        writeFileSync(join(project, ".grok", "config.toml"), text);
        expect(grokConfigDeclaresMcp(env, sub)).toBe(true);
      }
      // a config override is never read here: it counts as declaring
      writeFileSync(join(project, ".grok", "config.toml"), "");
      expect(grokConfigDeclaresMcp({ ...env, GROK_CONFIG: "/elsewhere.toml" }, sub)).toBe(true);
      expect(grokConfigDeclaresMcp({ ...env, GROK_CONFIG_PATH: "/elsewhere.toml" }, sub)).toBe(true);
    } finally {
      removeTempDir(home);
      removeTempDir(project);
    }
  });
});
