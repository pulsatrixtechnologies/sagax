// #4625 review: a bot's file sealed at rest (docs/content-encryption.md),
// through the admin file browser and the member API (the same code,
// server/org/org-admin-files.ts): one size, the plaintext one, on list,
// recursive list, stat, read and download; and a sealed file that does not
// open (its key not handed over, its bytes damaged) is a clear refusal on
// read and download, never a server error.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ConsoleAssertion } from "../auth/oidc-rp.ts";
import { DATA_DIR, EVENTS_DIR, NATIVE_DIR } from "../config.ts";
import { contentKeysForExport } from "../content-export.ts";
import { atRestInfoSync, resetAtRestState, runAtRestMigration, setAtRestFaultForTests, setAtRestGrace, useExportedContentKeys } from "../encryption/content-at-rest.ts";
import { WORKSPACE_OWNER } from "../encryption/content-keys.ts";
import { closeMessageDb, closeMessageSearch, configureContentEncryption, runContentMigration } from "../messages/message-db.ts";
import { resetMemoryJournalState } from "../memory/memory-journal.ts";
import { workspaceDir, writeMemoryTopic } from "../workspace/workspace.ts";
import type { BotFileRoot } from "./org-admin-files.ts";
import { createOrgAdminRoutes } from "./org-admin-routes.ts";
import { createOrgMemberRoutes } from "./org-member-routes.ts";

const ISS = "http://127.0.0.1:19391";
const ORIGIN = "http://127.0.0.1:19392";
const BOT = "sealbot";
const OWNER = "pr_00000000-0000-4000-8000-000000000001";
const TEXT = "---\ntitle: Clients\n---\nThe zebra account pays in quartz.\n";
const PLAIN_SIZE = Buffer.byteLength(TEXT, "utf8");

const tokens = new Map<string, ConsoleAssertion>();
let jti = 0;
function token(sub: string, role: ConsoleAssertion["role"]): string {
  const id = `seal${++jti}`;
  const now = Math.floor(Date.now() / 1000);
  tokens.set(id, { iss: ISS, sub, jti: `jti-sealed-${String(jti).padStart(10, "0")}`, iat: now, exp: now + 60, serverId: "srv", role, teams: [], actor: "console" });
  return id;
}
const verify = async (bearer: string) => {
  const found = tokens.get(bearer);
  if (!found) throw new Error("bad");
  return found;
};
const roots = (): BotFileRoot[] => [
  { id: "workspace", kind: "folder", dir: workspaceDir(BOT) },
  { id: "tasks", kind: "unavailable", reason: "not_created" },
  { id: "project", kind: "unavailable", reason: "not_set" },
  { id: "attachments", kind: "unavailable", reason: "not_created" },
  { id: "sandbox", kind: "unavailable", reason: "person_environment" },
  { id: "desktop", kind: "unavailable", reason: "own_computer" },
];

let server: Server;
let base = "";

beforeAll(async () => {
  const admin = createOrgAdminRoutes({
    identity: "perspicax",
    issuer: ISS,
    publicOrigin: () => ORIGIN,
    linkServerId: () => "srv",
    verify,
    principalFor: (_iss, sub) => (sub === "owner" ? { id: OWNER, name: "Owner", disabled: false } : null),
    person: (id) => ({ principalId: id, sub: "owner", name: "Owner" }),
    teamPeople: () => [],
    bots: () => [],
    usageRows: () => [],
    approvalsFor: () => [],
    answer: async () => ({ ok: true }),
    audit: () => ({ rows: [], next: null }),
    files: {
      reach: (botId) => (botId === BOT ? { ownerPrincipalId: OWNER, grantTargets: [], sectionMemberTargets: [] } : null),
      botFiles: (botId) => (botId === BOT ? { name: "Seal", roots: roots() } : null),
      attachments: async () => [],
      record: () => undefined,
    },
  });
  const member = createOrgMemberRoutes({
    identity: "perspicax",
    issuer: ISS,
    publicOrigin: () => ORIGIN,
    linkServerId: () => "srv",
    verify,
    personFor: (_iss, sub) => (sub === "owner" ? { principalId: OWNER, name: "Owner", active: true, admin: false } : null),
    permissions: () => ({ admin: false, permissions: ["clients.botsRead"] }),
    perform: async (_person, request) => request.path === "/api/bot-catalog"
      ? { status: 200, body: { entries: [{ id: BOT, source: "mine", name: "Seal", owner: { principalId: OWNER } }] } }
      : { status: 404, body: {} },
    threadStatus: () => "idle",
    resolvePerson: () => null,
    record: () => undefined,
    botFiles: {
      files: (botId) => (botId === BOT ? { name: "Seal", roots: roots() } : null),
      attachments: async () => [],
      surfaceOwner: () => null,
    },
  });
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void (async () => {
      if (await admin(req, res, url)) return;
      if (await member(req, res, url)) return;
      res.writeHead(418);
      res.end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  await closeMessageSearch();
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(EVENTS_DIR, { recursive: true });
  mkdirSync(NATIVE_DIR, { recursive: true });
  process.env.SAGAX_MCP_OAUTH_KEY = "cd".repeat(32); // a synthetic vault key, this process only
  resetAtRestState();
  resetMemoryJournalState();
  setAtRestGrace(0);
  setAtRestFaultForTests(null);
  useExportedContentKeys(null);
  configureContentEncryption({ mode: "on", autoMigrate: false, resolveBotOwner: () => WORKSPACE_OWNER, resolveOwner: () => ({ owner: WORKSPACE_OWNER, confidential: false }) });
  writeMemoryTopic(BOT, "clients.md", TEXT);
  for (let i = 0; i < 20; i++) {
    const pass = await runAtRestMigration({ sliceMs: Infinity });
    for (let j = 0; j < 100 && !runContentMigration(Infinity).done; j++);
    if (!pass.sealed && !pass.opened && !pass.resealed && !pass.logs) break;
  }
});
afterEach(async () => {
  setAtRestFaultForTests(null);
  useExportedContentKeys(null);
  resetAtRestState();
  await closeMessageSearch();
  closeMessageDb();
  delete process.env.SAGAX_MCP_OAUTH_KEY;
});

const topic = () => join(workspaceDir(BOT), "memory", "clients.md");
/** The same request through the admin API and through the member API. */
const both = (action: string, query: string) => [
  { via: "admin", url: `${base}/api/org/admin/files/${BOT}/${action}?${query}`, role: "admin" as const },
  { via: "member", url: `${base}/api/org/member/bots/${BOT}/files/${action}?${query}`, role: "employee" as const },
];
async function get(url: string, role: ConsoleAssertion["role"]) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token("owner", role)}` } });
  const raw = Buffer.from(await response.arrayBuffer());
  let body: any = null;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    body = null;
  }
  return { status: response.status, body, raw };
}

describe("a bot's file sealed at rest, admin and member file routes", () => {
  it("has one size, the plaintext one, on list, recursive list, stat, read and download", async () => {
    const onDisk = readFileSync(topic()).length;
    expect(atRestInfoSync(topic())?.sealed).toBe(true);
    expect(onDisk).not.toBe(PLAIN_SIZE);
    for (const call of both("list", "root=workspace&path=memory")) {
      const got = await get(call.url, call.role);
      expect(got.status, call.via).toBe(200);
      expect(got.body.entries.find((entry: any) => entry.name === "clients.md")?.size, call.via).toBe(PLAIN_SIZE);
    }
    const walked = await get(`${base}/api/org/member/bots/${BOT}/files/list?recursive=1`, "employee");
    expect(walked.body.entries.find((entry: any) => entry.path === "memory/clients.md")?.size).toBe(PLAIN_SIZE);
    for (const call of both("stat", "root=workspace&path=memory/clients.md")) {
      expect((await get(call.url, call.role)).body.size, call.via).toBe(PLAIN_SIZE);
    }
    for (const call of both("read", "root=workspace&path=memory/clients.md")) {
      const got = await get(call.url, call.role);
      expect(got.body, call.via).toMatchObject({ size: PLAIN_SIZE, length: PLAIN_SIZE, eof: true, binary: false, text: TEXT });
    }
    for (const call of both("download", "root=workspace&path=memory/clients.md")) {
      const got = await get(call.url, call.role);
      expect(got.status, call.via).toBe(200);
      expect(got.raw.toString("utf8"), call.via).toBe(TEXT);
    }
  });

  it("refuses clearly a sealed file whose key is not handed over", async () => {
    const stored = contentKeysForExport().map((key) => key.keyId);
    useExportedContentKeys([], stored);
    for (const action of ["read", "download"]) {
      for (const call of both(action, "root=workspace&path=memory/clients.md")) {
        const got = await get(call.url, call.role);
        expect(got.status, `${call.via} ${action}`).toBe(503);
        expect(got.body, `${call.via} ${action}`).toMatchObject({ code: "content_locked" });
      }
    }
  });

  it("refuses clearly a sealed file that does not open", async () => {
    const size = readFileSync(topic()).length;
    const fd = openSync(topic(), "r+");
    try {
      writeSync(fd, Buffer.from("XXXXXXXX"), 0, 8, size - 8);
    } finally {
      closeSync(fd);
    }
    for (const call of both("read", "root=workspace&path=memory/clients.md")) {
      const got = await get(call.url, call.role);
      expect(got.status, call.via).toBe(422);
      expect(got.body, call.via).toMatchObject({ code: "content_unreadable" });
      expect(got.raw.toString("utf8")).not.toContain("zebra");
    }
  });
});
