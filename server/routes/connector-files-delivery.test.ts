// #5138 (M-20261120-008), the person's case end to end through the real
// internal routes: a bot downloads a spreadsheet attached to a ticket
// (Perspicax `documents_download`), the file lands on the person's own
// computer (not on the Sagax server, not in the engine's answer), and the
// bot hands it to the chat with attach_file. Another person's turn never
// reads it. Neutral sample data only.
import type { ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { zipArchive } from "../testing/archive-fixtures.mjs";

// attachments.ts reads DATA_DIR at import time.
const DATA_ROOT = mkdtempSync(join(tmpdir(), "sagax-connector-files-"));
process.env.SAGAX_DATA_DIR = join(DATA_ROOT, "data");
const { createInternalIntegrationsRoutes } = await import("./internal-integrations.ts");
const { handleInternalSessionsFiles } = await import("./internal-sessions-files.ts");
const { sandboxBridgeForwardHeaders } = await import("../perspicax/sandbox-bridge-forward.ts");
const { ATTACHMENTS_DIR } = await import("../attachments/attachments.ts");
const { readAtRestSync } = await import("../encryption/content-at-rest.ts");
type PersonPlace = import("../attachments/connector-files.ts").PersonPlace;
type IntegrationsDeps = import("./internal-integrations.ts").InternalIntegrationsDeps;
type SessionsDeps = import("./internal-sessions-types.ts").InternalSessionsDeps;
type Capability = import("./internal-route.ts").InternalCapabilityView;

afterAll(() => rmSync(DATA_ROOT, { recursive: true, force: true }));

const SHEET = zipArchive([
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "xl/workbook.xml", data: "<workbook/>" },
  { name: "xl/worksheets/sheet1.xml", data: "<worksheet><row><c>Wren</c><c>12.50</c></row></worksheet>" },
]);
const SHA = "cd".repeat(32);
const DOWNLOAD = {
  jsonrpc: "2.0",
  id: 41,
  result: {
    content: [
      { type: "text", text: JSON.stringify({ binary: { bytes: SHEET.length, content_type: "application/octet-stream", sha256: SHA }, handle: null, headers: { "content-type": "application/octet-stream" } }) },
      { type: "resource", resource: { uri: `pulsatrix://result/${SHA}`, mimeType: "application/octet-stream", blob: SHEET.toString("base64") } },
    ],
    isError: false,
  },
};
const FRAME = { jsonrpc: "2.0", id: 41, method: "tools/call", params: { name: "cw_psa_action", arguments: { action: "documents_download", args: { id: 1001 } } } };

const BOT = { id: "bot-a", name: "Wren", color: "blue", threadId: "t-a" };
const ALICE_TURN: Capability = { botId: BOT.id, threadId: "t-a", generation: "g-1" };
const BOB_TURN: Capability = { botId: BOT.id, threadId: "t-b", generation: "g-2" };

/** Each person's computer: the files Sagax copied into its attachments folder. */
const computers = new Map<string, Map<string, Buffer>>([["alice", new Map()], ["bob", new Map()]]);
const personOf = (capability: Capability) => (capability.threadId === "t-a" ? "alice" : "bob");
const ROOT = "C:\\Users\\person\\AppData\\Local\\Temp\\Sagax\\attachments";
const placesFor = (capability: Capability): PersonPlace[] => [{
  kind: "computer",
  save: async (name, bytes) => {
    const path = `${ROOT}\\${name}`;
    computers.get(personOf(capability))!.set(path, Buffer.from(bytes));
    return path;
  },
}];

/** What the engine reads back from the Perspicax route. */
async function engineCall(capability: Capability, headers: Record<string, string> = {}): Promise<string> {
  const route = createInternalIntegrationsRoutes({
    bot: (id: string) => (id === BOT.id ? BOT : null),
    isConfidentialThread: () => false,
    confidentialPerspicaxRefusal: () => null,
    misuseToolFrameText: () => null,
    perspicaxMounted: () => true,
    perspicaxRelay: async () => ({ status: 200, body: structuredClone(DOWNLOAD) }),
    connectorFilePlaces: placesFor,
  } as unknown as IntegrationsDeps);
  let body = "";
  const res = { headersSent: false, writeHead: () => undefined, end: (payload?: string) => { body = payload ?? ""; } } as unknown as ServerResponse;
  await route({
    res, path: "/api/internal/perspicax/mcp", method: "POST", headers, capability,
    json: (() => { throw new Error("unexpected json answer"); }) as never,
    readBody: async () => structuredClone(FRAME) as never,
  });
  return body;
}

/** attach_file through the real route; the chat messages it posted. */
async function attach(capability: Capability, path: string) {
  const posted: Array<{ attachments?: Array<{ kind: string; path: string; name?: string }> }> = [];
  const sent: Array<{ status: number; body: unknown }> = [];
  const deps = {
    ownsThread: () => ({ group: undefined }),
    attachmentVm: async () => undefined,
    personDirectTurn: () => true,
    messageFileRoots: () => [join(DATA_ROOT, "bot-folder")],
    dataDir: () => process.env.SAGAX_DATA_DIR!,
    isActive: () => true,
    appendMessage: (_threadId: string, message: unknown) => { posted.push(message as never); return { id: "m" }; },
    personPlaceFile: async (turn: Capability, wanted: string, maxBytes: (name: string) => number) => {
      const bytes = computers.get(personOf(turn))!.get(wanted);
      if (!bytes) return null;
      const name = wanted.split("\\").at(-1)!;
      expect(bytes.length).toBeLessThanOrEqual(maxBytes(name));
      return { name, bytes };
    },
  } as unknown as SessionsDeps;
  await handleInternalSessionsFiles(deps, {
    res: {} as ServerResponse, path: "/api/internal/attach-file", method: "POST", capability,
    json: ((_res: ServerResponse, status: number, body: unknown) => { sent.push({ status, body }); }) as never,
    readBody: async () => ({ path }),
  }, BOT as never);
  return { posted, sent };
}

describe("a file a bot downloads reaches the person, never the Sagax server (M-20261120-008)", () => {
  it("lands on the person's computer, the engine gets its path, and attach_file posts it in the chat", async () => {
    const answer = await engineCall(ALICE_TURN);

    // the engine never gets the bytes: nothing for it to write on this server
    expect(answer).not.toContain(SHEET.toString("base64"));
    expect(answer).not.toContain("\"blob\"");
    const alice = computers.get("alice")!;
    expect(alice.size).toBe(1);
    const [path, onComputer] = [...alice][0]!;
    expect(onComputer.equals(SHEET)).toBe(true);
    expect(path.endsWith(".xlsx")).toBe(true);
    expect(JSON.parse(answer).result.content[1].text).toContain(path);

    // the bot hands it over with the path it was given
    const { posted, sent } = await attach(ALICE_TURN, path);
    expect(sent).toEqual([{ status: 200, body: expect.objectContaining({ ok: true, bytes: SHEET.length }) }]);
    const attachment = posted[0]!.attachments![0]!;
    expect(attachment.kind).toBe("file");
    expect(attachment.name).toMatch(/\.xlsx$/);
    // the chat's own private store holds the copy the person opens
    expect(attachment.path.startsWith(ATTACHMENTS_DIR)).toBe(true);
    expect(readAtRestSync(attachment.path).equals(SHEET)).toBe(true);
  });

  it("another person's turn never reads it", async () => {
    const [path] = [...computers.get("alice")!.keys()];
    const { posted, sent } = await attach(BOB_TURN, path!);
    expect(posted).toEqual([]);
    expect(sent[0]!.status).toBe(404);
  });

  it("a script in the person's server environment gets the file as it is: it is already there", async () => {
    const before = computers.get("alice")!.size;
    const answer = await engineCall(ALICE_TURN, sandboxBridgeForwardHeaders());
    expect(JSON.parse(answer).result.content[1].resource.blob).toBe(SHEET.toString("base64"));
    expect(computers.get("alice")!.size).toBe(before);
    // a header without this process's secret claims nothing
    const forged = await engineCall(ALICE_TURN, { "x-sagax-environment-bridge": "x".repeat(43) });
    expect(forged).not.toContain(SHEET.toString("base64"));
  });
});
