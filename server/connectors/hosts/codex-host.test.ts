// The Codex connector host (#3353, connectors across engines L10): the
// ChatGPT apps of a person's own Codex sign-in, listed and called through a
// short app-server with no model, run by the fake Codex app-server replaying
// the 0.166.0 captures of measure M6 (server/testing/fake-codex-app-server.ts,
// FAKE_CODEX_CONNECTOR_REPLAY).
//
// Proof: the list reads as registry accounts with real descriptions and
// schemas; one approved call returns the tool's own result (and the
// provider's own error as is); the app-server gets zero turn/start; the call
// runs in the person's own CODEX_HOME; a missing or key sign-in posts the
// Connect card; the call route runs it through the hub under the person's
// held request with the native rule key; no process is left after a call.
//
// POSIX-gated like the other CLI tests (the fake is a shebang script).
import type { ServerResponse } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CALL_CONNECTOR_INTERNAL_PATH, createCallConnectorInternalRoute } from "../../routes/internal-connectors.ts";
import { createConnectorHub } from "../hub.ts";
import { chatgptAppsAccount, chatgptAppsProvider, chatgptAppsRuleTool } from "../providers/chatgpt-apps.ts";
import { cleanConnectorAccount } from "../registry.ts";
import type { ConnectorAccount, ConnectorAccountRef } from "../types.ts";
import { createCodexConnectorHost, type CodexConnectorLaunch } from "./codex-host.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_CODEX = join(SERVER_DIR, "testing", "fake-codex-app-server.ts");
const REPLAY = join(SERVER_DIR, "testing", "fixtures", "connectors");
const posixOnly = describe.skipIf(process.platform === "win32");

const REF: ConnectorAccountRef = { provider: "chatgpt-apps", driver: "codex", instanceId: "default", slot: "primary" };

interface MethodLine { pid: number; method: string }
interface Dump { pid: number; env: Record<string, string | undefined>; calls: Array<{ method: string; params: unknown }>; decision: unknown }

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const lines = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T) : []);

posixOnly("Codex connector host (#3353)", () => {
  let root = "";
  let home = "";
  let methodLog = "";
  let dumpFile = "";
  let extra: Record<string, string> = {};

  beforeAll(() => {
    chmodSync(FAKE_CODEX, 0o755);
    root = realpathSync(mkdtempSync(join(tmpdir(), "sagax-codex-host-")));
    home = join(root, "ana", "codex");
    mkdirSync(home, { recursive: true });
    methodLog = join(root, "methods.jsonl");
    dumpFile = join(root, "dump.json");
  });
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });
  beforeEach(() => {
    extra = {};
    rmSync(methodLog, { force: true });
    rmSync(dumpFile, { force: true });
  });

  const launchFor = (): CodexConnectorLaunch => ({
    cli: FAKE_CODEX,
    env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "sk-must-not-reach", FAKE_CODEX_CONNECTOR_REPLAY: REPLAY, FAKE_CODEX_METHOD_LOG: methodLog, FAKE_CODEX_DUMP: dumpFile, ...extra },
  });
  const host = () => createCodexConnectorHost({ launch: (principalId) => (principalId === "ana" ? launchFor() : undefined), gate: (_label, run) => run(), timeoutMs: 15_000, listTimeoutMs: 15_000 });

  async function listed(): Promise<ConnectorAccount> {
    const listing = await host().listApps(launchFor());
    expect(listing?.auth).toBe("subscription");
    return chatgptAppsAccount(REF, "ChatGPT", listing!);
  }

  it("lists the ChatGPT apps by connector, with descriptions and schemas, and no turn", async () => {
    const account = await listed();
    expect(account.auth).toBe("subscription");
    expect(account.connectors.map((entry) => entry.name).sort()).toEqual(["Example Chat", "Example Mail"]);
    const mail = account.connectors.find((entry) => entry.name === "Example Mail")!;
    expect(mail.state).toBe("connected");
    expect(mail.tools.map((tool) => tool.id)).toEqual(["example_mail.list_categories", "example_mail.list_messages", "example_mail.send_email"]);
    expect(mail.tools[0]!.description).toMatch(/categories/i);
    expect(mail.tools[1]!.inputSchema).toMatchObject({ type: "object" });
    // the registry keeps them across a restart
    expect(cleanConnectorAccount(JSON.parse(JSON.stringify(account)))?.connectors.find((entry) => entry.name === "Example Mail")?.tools[1]?.inputSchema).toMatchObject({ type: "object" });
    const methods = lines<MethodLine>(methodLog).map((line) => line.method);
    expect(methods).toContain("mcpServerStatus/list");
    expect(methods).not.toContain("turn/start");
  });

  it("runs one approved call with no model turn and returns the tool's own result", async () => {
    const mail = (await listed()).connectors.find((entry) => entry.name === "Example Mail")!;
    rmSync(methodLog, { force: true });
    const result = await host().call({ principalId: "ana", account: { ...REF, key: "chatgpt-apps:default:primary", label: "ChatGPT", auth: "subscription", connectors: [mail], at: 1 }, connector: mail, tool: "example_mail.list_messages", arguments: { folder: "Inbox" }, engine: "grokAgent" });
    expect(result).toEqual({ text: 'FAKE_CODEX_APP example_mail.list_messages {"folder":"Inbox"}' });
    const methods = lines<MethodLine>(methodLog);
    expect(methods.filter((line) => line.method === "mcpServer/tool/call")).toHaveLength(1);
    expect(methods.filter((line) => line.method === "turn/start")).toHaveLength(0);
    const dump = JSON.parse(readFileSync(dumpFile, "utf8")) as Dump;
    // the person's own sign-in, never a key
    expect(dump.env.CODEX_HOME).toBe(home);
    expect(dump.env.OPENAI_API_KEY).toBeUndefined();
    expect(dump.calls.find((call) => call.method === "mcpServer/tool/call")?.params).toMatchObject({ server: "codex_apps", tool: "example_mail.list_messages", arguments: { folder: "Inbox" }, threadId: "codex-thread-1" });
    // no process left
    expect(new Set(methods.map((line) => line.pid)).size).toBe(1);
    expect(alive(methods[0]!.pid)).toBe(false);
  });

  it("returns the provider's own error as is", async () => {
    const mail = (await listed()).connectors.find((entry) => entry.name === "Example Mail")!;
    const result = await host().call({ principalId: "ana", account: { ...REF, key: "k", label: "ChatGPT", auth: "subscription", connectors: [mail], at: 1 }, connector: mail, tool: "example_mail.list_categories", arguments: {}, engine: "codex" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/MailboxNotEnabledForRESTAPI/);
    expect(result.needsSignIn).toBeUndefined();
  });

  it("answers Codex's own ask for the approved call as the person decided", async () => {
    extra = { FAKE_CODEX_CONNECTOR_ASK: "1" };
    const mail = (await listed()).connectors.find((entry) => entry.name === "Example Mail")!;
    const result = await host().call({ principalId: "ana", account: { ...REF, key: "k", label: "ChatGPT", auth: "subscription", connectors: [mail], at: 1 }, connector: mail, tool: "example_mail.send_email", arguments: { to: "ana@example.com" }, engine: "codex" });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("FAKE_CODEX_APP example_mail.send_email");
    expect((JSON.parse(readFileSync(dumpFile, "utf8")) as Dump).decision).toEqual({ action: "accept", content: {} });
  });

  it("posts the Connect card when the person has no ChatGPT sign-in on Codex", async () => {
    const mail = (await listed()).connectors.find((entry) => entry.name === "Example Mail")!;
    const account: ConnectorAccount = { ...REF, key: "k", label: "ChatGPT", auth: "subscription", connectors: [mail], at: 1 };
    // another person: never Ana's sign-in
    expect((await host().call({ principalId: "bob", account, connector: mail, tool: "example_mail.list_messages", arguments: {}, engine: "codex" })).needsSignIn).toBe(true);
    for (const mode of ["none", "api-key"]) {
      extra = { FAKE_CODEX_ACCOUNT_MODE: mode };
      rmSync(methodLog, { force: true });
      const result = await host().call({ principalId: "ana", account, connector: mail, tool: "example_mail.list_messages", arguments: {}, engine: "codex" });
      expect(result.needsSignIn).toBe(true);
      expect(lines<MethodLine>(methodLog).map((line) => line.method)).not.toContain("mcpServer/tool/call");
    }
    extra = { FAKE_CODEX_ACCOUNT_MODE: "none" };
    expect((await host().listApps(launchFor()))?.auth).toBe("none");
  });

  it("the registry provider reads the person's own sign-ins only", async () => {
    const codex = host();
    const provider = chatgptAppsProvider({
      signIns: (principalId) => (principalId === "ana" ? ["default"] : []),
      list: async (principalId) => (principalId === "ana" ? codex.listApps(launchFor()) : undefined),
    });
    expect(provider.accounts("bob")).toEqual([]);
    expect(provider.accounts("ana")).toEqual([REF]);
    const read = await provider.read("ana", REF);
    expect(read?.connectors.map((entry) => entry.name).sort()).toEqual(["Example Chat", "Example Mail"]);
    expect(provider.peek("ana", REF)).toEqual(read);
    expect(provider.peek("bob", REF)).toBeUndefined();
  });

  it("call_connector runs it through the hub under the held request, with the native rule key", async () => {
    const account = await listed();
    const hub = createConnectorHub([host()]);
    expect(hub.callable("chatgpt-apps")).toBe(true);
    const mail = account.connectors.find((entry) => entry.name === "Example Mail")!;
    expect(hub.ruleTool("chatgpt-apps", mail, "example_mail.list_messages")).toBe("codex_apps__example_mail.list_messages");
    expect(chatgptAppsRuleTool(mail, "codex_apps__example_mail.list_messages")).toBe("codex_apps__example_mail.list_messages");
    const holds: Array<{ mcpTool: string; outbound: boolean }> = [];
    const route = createCallConnectorInternalRoute({
      ownsThread: () => true,
      principal: () => "ana",
      confined: () => false,
      accounts: (principalId) => (principalId === "ana" ? [account] : []),
      hub: () => hub,
      hold: (request) => {
        holds.push({ mcpTool: request.mcpTool, outbound: request.outbound });
        return { engine: "pi", decision: Promise.resolve({ behavior: "allow" as const }) };
      },
    } as Parameters<typeof createCallConnectorInternalRoute>[0]);
    let answer: Record<string, unknown> | undefined;
    await route({
      res: {} as ServerResponse,
      path: CALL_CONNECTOR_INTERNAL_PATH,
      method: "POST",
      capability: { botId: "b1", threadId: "t1" },
      readBody: async () => ({ connector: "Example Mail", tool: "example_mail.list_messages", arguments: { folder: "Inbox" } }),
      json: (_res: unknown, _status: number, body: Record<string, unknown>) => { answer = body; },
    } as never);
    expect(holds).toEqual([{ mcpTool: "codex_apps__example_mail.list_messages", outbound: false }]);
    expect(answer).toMatchObject({ ok: true, connector: "Example Mail", account: "ChatGPT", result: 'FAKE_CODEX_APP example_mail.list_messages {"folder":"Inbox"}' });
    expect(lines<MethodLine>(methodLog).map((line) => line.method)).not.toContain("turn/start");
    await hub.close();
  });
});
