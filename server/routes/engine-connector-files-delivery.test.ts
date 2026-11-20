// #5140 (M-20261120-008), the person's case end to end: a bot downloads a
// spreadsheet through a claude.ai connector its engine holds itself (not
// relayed by Sagax). Claude Code writes the bytes into its own session
// folder on the Sagax server before any hook; the synchronous
// connector-files hook (the real helper, the real /api/internal/hook route)
// moves the file into the person's place and hands the engine the result
// naming it there. None stays under the engine's folder, and another
// person's turn gets its own place only. The same file reached through
// call_connector (the hub's Claude host) lands the same way. Neutral data.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { zipArchive } from "../testing/archive-fixtures.mjs";
import type { PersonPlace } from "../attachments/connector-files.ts";
import { projectBlobFolder } from "../attachments/engine-connector-files.ts";
import { createIngestEngineHook } from "../index-leaves/ingestEngineHook.ts";
import { createConnectorHub } from "../connectors/hub.ts";
import type { ConnectorAccount, ConnectorEntry } from "../connectors/types.ts";
import type { HeldDecision } from "../harness/held-requests.ts";
import { createInternalMemoryRoutes, type InternalMemoryDeps } from "./internal-memory.ts";
import { CALL_CONNECTOR_INTERNAL_PATH, createCallConnectorInternalRoute } from "./internal-connectors.ts";
import type { InternalCapabilityView } from "./internal-route.ts";

const ROOT = mkdtempSync(join(tmpdir(), "sagax-engine-connector-files-"));
const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
  rmSync(ROOT, { recursive: true, force: true });
});

const HELPER = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "omb-hook.ts");
const SHEET = zipArchive([
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "xl/workbook.xml", data: "<workbook/>" },
  { name: "xl/worksheets/sheet1.xml", data: "<worksheet><row><c>Plover</c><c>7.25</c></row></worksheet>" },
]);
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BOT = { id: "bot-a", name: "Wren", color: "blue" };
const ALICE_TURN: InternalCapabilityView = { botId: BOT.id, threadId: "t-a", generation: "g-1" };
const BOB_TURN: InternalCapabilityView = { botId: BOT.id, threadId: "t-b", generation: "g-2" };

/** Each person's computer: the files Sagax copied into its attachments folder. */
const computers = new Map<string, Map<string, Buffer>>([["alice", new Map()], ["bob", new Map()]]);
const personOf = (capability: InternalCapabilityView) => (capability.threadId === "t-a" ? "alice" : "bob");
const placesFor = (capability: InternalCapabilityView): PersonPlace[] => [{
  kind: "computer",
  save: async (name, bytes) => {
    const path = `C:\\Users\\${personOf(capability)}\\AppData\\Local\\Temp\\Sagax\\attachments\\${name}`;
    computers.get(personOf(capability))!.set(path, Buffer.from(bytes));
    return path;
  },
}];

/** The engine's own config folder for one person's turn, as Claude Code
 * lays it out on the server, and the file it saved for the connector. */
function engineSession(person: string, session: string) {
  const project = join(ROOT, person, "claude", "projects", "-workspace-bots-wren");
  const results = join(project, session, "tool-results");
  mkdirSync(results, { recursive: true });
  const blob = join(results, "mcp-claude_ai_Docs_Hub-blob-1763600000000-ab12cd.xlsx");
  writeFileSync(blob, SHEET);
  return { results, blob, transcript: join(project, `${session}.jsonl`) };
}

/** The real hook route with the real hook ingestion, on loopback, as the
 * engine's hook helper reaches it with the turn's bearer. */
async function harness(capability: InternalCapabilityView): Promise<{ url: string; tokenFile: string }> {
  const host = {
    IDENTITY: { kind: "perspicax" },
    liveTurnByThread: new Map([["t-a", "turn-a"], ["t-b", "turn-b"]]),
    personPlaces: { placesForTurn: placesFor },
    // what the background PostToolUse spill reads (unchanged here)
    unwrapAgentsBridge: () => null,
    runLifecycleEvent: async () => undefined,
    store: { activePath: () => [] },
    reportBackgroundError: () => undefined,
  };
  const ingest = createIngestEngineHook(() => host);
  const route = createInternalMemoryRoutes({
    bot: (id: string) => (id === BOT.id ? BOT : null),
    ingestHook: (turn: InternalCapabilityView, body: unknown) => ingest(turn, body),
  } as unknown as InternalMemoryDeps);
  const token = `token-${capability.threadId}`;
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { raw += chunk; });
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(); return; }
      // the real route's body limit (server/harness/http.ts readBody)
      if (Buffer.byteLength(raw) > 1_000_000) { res.writeHead(413); res.end(); return; }
      void route({
        res,
        path: req.url ?? "",
        method: req.method ?? "",
        capability,
        json: ((out: ServerResponse, status: number, body: unknown) => { out.writeHead(status, { "content-type": "application/json" }); out.end(JSON.stringify(body)); }) as never,
        readBody: async () => JSON.parse(raw) as never,
      } as never);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const tokenFile = join(ROOT, `${capability.threadId}.token`);
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, tokenFile };
}

/** Claude Code running the connector-files hook command for one call. */
function hook(payload: unknown, env: { url: string; tokenFile: string }): Promise<string> {
  return new Promise((resolve) => {
    const { FORCE_COLOR: _fc, NO_COLOR: _nc, ...clean } = process.env;
    const child = spawn(process.execPath, [HELPER, "connector-files"], {
      env: { ...clean, SAGAX_HOOK_URL: env.url, SAGAX_HOOK_TOKEN_FILE: env.tokenFile },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.on("close", () => resolve(out));
    child.stdin.end(JSON.stringify(payload));
  });
}

/** The PostToolUse event Claude Code sends for the connector's download. */
function downloaded(session: string, transcript: string, blob: string) {
  return {
    hook_event_name: "PostToolUse",
    session_id: session,
    transcript_path: transcript,
    cwd: "/workspace/bots/wren",
    tool_name: "mcp__claude_ai_Docs_Hub__download_file",
    tool_input: { file_id: "42" },
    tool_use_id: "toolu_download",
    tool_response: [{ type: "text", text: `[Resource from claude_ai_Docs_Hub at docs://files/42] Binary content (${XLSX}, 1.2KB) saved to ${blob}` }],
  };
}

describe("a file the engine's own claude.ai connector returns reaches the person, never stays on the Sagax server (#5140)", () => {
  it("lands on the person's computer, none is left under the engine's folder, and the engine reads the person's path", async () => {
    const session = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
    const { results, blob, transcript } = engineSession("alice", session);
    const answer = await hook(downloaded(session, transcript, blob), await harness(ALICE_TURN));

    expect(readdirSync(results)).toEqual([]);
    const alice = computers.get("alice")!;
    expect(alice.size).toBe(1);
    const [path, onComputer] = [...alice][0]!;
    expect(onComputer.equals(SHEET)).toBe(true);
    expect(path).toMatch(/\.xlsx$/);
    const output = JSON.parse(answer).hookSpecificOutput as { hookEventName: string; updatedMCPToolOutput: Array<{ type: string; text: string }> };
    expect(output.hookEventName).toBe("PostToolUse");
    const text = output.updatedMCPToolOutput[0]!.text;
    expect(text).toContain(path);
    expect(text).not.toContain(blob);
    expect(text).toContain("attach_file");
  });

  it("a picture the connector returns (over 1 MiB) stays for the model, and its saved copy leaves the server for the person's place", async () => {
    // what the organization server held: pictures of the engine's own claude.ai connector
    const session = "8d7e6f5a-4b3c-4d2e-9f1a-0b2c3d4e5f6a";
    const { results, transcript } = engineSession("alice", session);
    for (const name of readdirSync(results)) rmSync(join(results, name));
    // over the route's 1 MB body once in base64: the picture never travels to Sagax
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]), Buffer.alloc(1_200_000, 7)]);
    const saved = join(results, "mcp-claude_ai_Docs_Hub-blob-1763600000005-pp11qq.png");
    writeFileSync(saved, png);
    const picture = { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } };
    const event = { ...downloaded(session, transcript, saved), tool_name: "mcp__claude_ai_Docs_Hub__render_chart", tool_response: [picture, { type: "text", text: `[Image source: ${saved}]` }] };
    const answer = await hook(event, await harness(ALICE_TURN));

    expect(readdirSync(results)).toEqual([]);
    const [path, onComputer] = [...computers.get("alice")!].find(([name]) => name.endsWith(".png"))!;
    expect(onComputer.equals(png)).toBe(true);
    const output = (JSON.parse(answer).hookSpecificOutput as { updatedMCPToolOutput: unknown[] }).updatedMCPToolOutput;
    expect(output[0]).toEqual(picture);
    expect(JSON.stringify(output[1])).toContain(JSON.stringify(path).slice(1, -1));
  });

  it("another person's turn puts that person's file in their own place only", async () => {
    const session = "6b5c4d3e-2f1a-4b0c-9d8e-7f6a5b4c3d2e";
    const { results, blob, transcript } = engineSession("bob", session);
    const before = computers.get("alice")!.size;
    await hook(downloaded(session, transcript, blob), await harness(BOB_TURN));
    expect(readdirSync(results)).toEqual([]);
    expect(computers.get("bob")!.size).toBe(1);
    expect(computers.get("alice")!.size).toBe(before);
  });

  it("the same file reached through call_connector (the hub's Claude host) lands in the person's place too", async () => {
    const config = join(ROOT, "carol", "claude");
    const staging = "/tmp/sagax-claude-connector-Qw12Er";
    const folder = projectBlobFolder(config, staging);
    const results = join(folder.root, "7c6d5e4f-3a2b-4c1d-8e9f-0a1b2c3d4e5f", "tool-results");
    mkdirSync(results, { recursive: true });
    const blob = join(results, "mcp-claude_ai_Docs_Hub-blob-1763600000009-ff00aa.xlsx");
    const other = zipArchive([{ name: "xl/workbook.xml", data: "<workbook/>" }, { name: "xl/worksheets/sheet1.xml", data: "<worksheet><row><c>Tern</c></row></worksheet>" }]);
    writeFileSync(blob, other);
    const entry: ConnectorEntry = { id: "docs", name: "Docs Hub", state: "connected", tools: [{ id: "download_file" }] };
    const roster: ConnectorAccount[] = [{ provider: "claude-ai", driver: "claudeAgent", instanceId: "i1", slot: "primary", key: "k", label: "Claude", auth: "subscription", connectors: [entry], at: 1 }];
    const hub = createConnectorHub([{
      provider: "claude-ai",
      call: async () => ({ text: `[Resource from claude_ai_Docs_Hub at docs://files/42] Binary content (${XLSX}, 1.2KB) saved to ${blob}`, engineFolder: folder }),
    }]);
    const route = createCallConnectorInternalRoute({
      ownsThread: () => true,
      principal: () => "alice@example.com",
      confined: () => false,
      accounts: () => roster,
      hub: () => hub,
      hold: () => ({ engine: "codexAgent", decision: Promise.resolve({ behavior: "allow" } as HeldDecision) }),
      connectorFilePlaces: placesFor,
    });
    let payload: Record<string, unknown> = {};
    const before = computers.get("alice")!.size;
    await route({
      res: {} as ServerResponse,
      path: CALL_CONNECTOR_INTERNAL_PATH,
      method: "POST",
      json: ((_res: ServerResponse, _status: number, body: Record<string, unknown>) => { payload = body; }) as never,
      capability: ALICE_TURN,
      readBody: async () => ({ connector: "Docs Hub", tool: "download_file", arguments: { file_id: "42" } }),
    });
    expect(readdirSync(results)).toEqual([]);
    const alice = computers.get("alice")!;
    expect(alice.size).toBe(before + 1);
    const [path, onComputer] = [...alice].at(-1)!;
    expect(onComputer.equals(other)).toBe(true);
    expect(payload).toMatchObject({ ok: true });
    expect(String(payload.result)).toContain(path);
    expect(String(payload.result)).not.toContain(blob);
  });
});
