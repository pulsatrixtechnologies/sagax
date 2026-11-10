// The Grok connector host (#3350, connectors across engines L7): one pinned
// use_tool call on the person's own Grok sign-in, run by the fake ACP CLI in
// its "pinned" mode (server/testing/fake-acp-cli.ts).
//
// Proof: exactly one call with equal arguments; an altered send (other input
// or another tool) is not run and the bot gets a plain error; the second
// account runs in its own folder; "needs sign-in" posts the Connect card; no
// process is left after the call.
//
// POSIX-gated like the other CLI tests (the fake is a shebang script).
import type { ServerResponse } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CALL_CONNECTOR_INTERNAL_PATH, createCallConnectorInternalRoute } from "../../routes/internal-connectors.ts";
import { createConnectorHub } from "../hub.ts";
import type { ConnectorAccount, ConnectorEntry } from "../types.ts";
import { createGrokConnectorHost, type GrokConnectorLaunch } from "./grok-host.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

const TOOL = "cursor__user-Mail-send_5fmessage___1";
const MAIL: ConnectorEntry = { id: "mail", name: "Mail", state: "connected", tools: [{ id: TOOL }] };
const ARGS = { to: "ana@example.com", subject: "Weekly report", body: "Done.", cc: [] as string[] };

function grokAccount(slot: "primary" | "second"): ConnectorAccount {
  return { provider: "grok-com", driver: "grokAgent", instanceId: "default", slot, key: `grok-com:default:${slot}`, label: slot === "second" ? "Grok (personal account)" : "Grok", auth: "subscription", connectors: [MAIL], at: 1 };
}

interface PinnedCall { tool: string; input: Record<string, unknown>; pid: number; grokHome: string | null; cwd: string }
interface Trace { pid: number; cwd: string; grokHome: string | null; connectorCall: boolean }

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const lines = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T) : []);

posixOnly("Grok connector host (#3350)", () => {
  let root = "";
  let callsFile = "";
  let traceFile = "";
  const homes = { primary: "", second: "" };
  let pinned = "obey";

  beforeAll(() => {
    chmodSync(FAKE_ACP, 0o755);
    root = realpathSync(mkdtempSync(join(tmpdir(), "sagax-grok-host-")));
    callsFile = join(root, "calls.jsonl");
    traceFile = join(root, "launches.jsonl");
    for (const slot of ["primary", "second"] as const) {
      const dir = join(root, "ana", slot);
      mkdirSync(join(dir, ".grok"), { recursive: true });
      writeFileSync(join(dir, ".grok", "auth.json"), "{}");
      homes[slot] = dir;
    }
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  const launch = (principalId: string, account: ConnectorAccount): GrokConnectorLaunch | undefined => {
    if (principalId !== "ana@example.com") return undefined;
    const dir = homes[account.slot];
    return {
      cli: FAKE_ACP,
      env: {
        ...process.env,
        HOME: dir,
        GROK_HOME: join(dir, ".grok"),
        FAKE_ACP_MODE: "pinned",
        FAKE_ACP_PINNED: pinned,
        FAKE_ACP_PINNED_CALLS: callsFile,
        FAKE_ACP_LAUNCH_TRACE_FILE: traceFile,
      },
    };
  };
  const host = createGrokConnectorHost({ launch, gate: (_label, run) => run(), timeoutMs: 30_000 });
  const reset = (variant: string) => {
    pinned = variant;
    rmSync(callsFile, { force: true });
    rmSync(traceFile, { force: true });
  };
  const run = (slot: "primary" | "second" = "primary", args: Record<string, unknown> = ARGS) =>
    host.call({ principalId: "ana@example.com", account: grokAccount(slot), connector: MAIL, tool: TOOL, arguments: args, engine: "claudeAgent" });
  const traces = () => lines<Trace>(traceFile).filter((trace) => trace.connectorCall);

  it("makes exactly one call, with arguments equal to the approved ones", async () => {
    reset("obey");
    const result = await run();
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain(`pinned result of ${TOOL}`);
    const calls = lines<PinnedCall>(callsFile);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tool).toBe(TOOL);
    expect(calls[0]!.input).toEqual(ARGS);
    expect(traces()).toHaveLength(1);
  }, 40_000);

  it("does not run an altered send (other input) and answers a plain error", async () => {
    reset("alter-input");
    const result = await run();
    expect(result.isError).toBe(true);
    expect(result.needsSignIn).toBeFalsy();
    expect(result.text).toMatch(/other input than the approved call, so it was not run/);
    expect(lines<PinnedCall>(callsFile)).toHaveLength(0);
  }, 40_000);

  it("does not run another tool than the approved one", async () => {
    reset("other-tool");
    const result = await run();
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/instead of the approved .*, so it was not run/);
    expect(lines<PinnedCall>(callsFile)).toHaveLength(0);
  }, 40_000);

  it("runs the second account in its own folder", async () => {
    reset("obey");
    const result = await run("second");
    expect(result.isError).toBeFalsy();
    const [trace] = traces();
    expect(trace?.grokHome).toBe(join(homes.second, ".grok"));
    expect(realpathSync(trace!.cwd)).toBe(homes.second);
    const [call] = lines<PinnedCall>(callsFile);
    expect(call?.grokHome).toBe(join(homes.second, ".grok"));
    expect(call?.grokHome).not.toContain(homes.primary);
  }, 40_000);

  it("leaves no process after the call, obeyed (prompt left open) or refused", async () => {
    const pids: number[] = [];
    for (const variant of ["obey", "alter-input", "other-tool"]) {
      reset(variant);
      await run();
      pids.push(...traces().map((trace) => trace.pid));
    }
    expect(pids).toHaveLength(3);
    for (const pid of pids) expect(alive(pid)).toBe(false);
  }, 90_000);

  it("posts the Connect card on needs sign-in, through call_connector", async () => {
    reset("needs-sign-in");
    const cards: Array<{ botId: string; threadId: string; principalId: string; slot: string }> = [];
    const handler = createCallConnectorInternalRoute({
      ownsThread: (botId, threadId) => botId === "b1" && threadId === "t1",
      principal: () => "Ana@Example.com",
      confined: () => false,
      accounts: (principalId) => (principalId === "ana@example.com" ? [grokAccount("primary")] : []),
      hub: () => createConnectorHub([host]),
      hold: () => ({ engine: "claudeAgent", decision: Promise.resolve({ behavior: "allow" as const }) }),
      signInCard: ({ botId, threadId, principalId, account }) => { cards.push({ botId, threadId, principalId, slot: account.slot }); return true; },
    });
    let payload: Record<string, unknown> = {};
    await handler({
      res: {} as ServerResponse,
      path: CALL_CONNECTOR_INTERNAL_PATH,
      method: "POST",
      json: ((_res: ServerResponse, _code: number, body: Record<string, unknown>) => { payload = body; }) as never,
      capability: { botId: "b1", threadId: "t1", generation: "g" },
      readBody: async () => ({ connector: "Mail", tool: TOOL, arguments: ARGS }),
    });
    expect(cards).toEqual([{ botId: "b1", threadId: "t1", principalId: "ana@example.com", slot: "primary" }]);
    expect(payload.ok).toBe(false);
    expect(payload.signIn).toBe(true);
    expect(String(payload.error)).toMatch(/Connect card is posted/);
    expect(lines<PinnedCall>(callsFile)).toHaveLength(0);
    for (const trace of traces()) expect(alive(trace.pid)).toBe(false);
  }, 40_000);

  it("answers needs sign-in without starting Grok when the sign-in folder has none", async () => {
    reset("obey");
    const result = await host.call({ principalId: "ben@example.com", account: grokAccount("primary"), connector: MAIL, tool: TOOL, arguments: ARGS, engine: "claudeAgent" });
    expect(result).toMatchObject({ isError: true, needsSignIn: true });
    expect(traces()).toHaveLength(0);
  });
});
