// The console's file browser, read only (server/org/org-admin-files.ts) behind
// the organization admin API: the path rules, the link refusals, the roots,
// list, stat, read and download answers, the rights (role and a manager's
// reach), and the admin activity rows. The assertion gate itself is proven
// in org-admin-routes.test.ts.
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, symlinkSync, writeFileSync, ftruncateSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ConsoleAssertion } from "../oidc-rp.ts";
import {
  attachmentDisposition,
  FILES_MAX_DOWNLOAD_BYTES,
  FILES_MAX_READ_BYTES,
  FileRefusal,
  looksLikeText,
  parseRange,
  parseRelativePath,
  resolveInRoot,
  openNoFollow,
  type BotAttachment,
  type BotFileRoot,
  type FileAccessRecord,
} from "./org-admin-files.ts";
import { createOrgAdminRoutes, type AdminBotReach } from "./org-admin-routes.ts";

const ISS = "http://127.0.0.1:19291";
const ORIGIN = "http://127.0.0.1:19292";
const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1); // admin
const MONA = pid(2); // manager of T
const CAROL = pid(3); // in T
const BOB = pid(4); // employee
const people: Record<string, { sub: string; name: string; teams: string[] }> = {
  [ALICE]: { sub: "alice", name: "Alice", teams: [] },
  [MONA]: { sub: "mona", name: "Mona", teams: ["T"] },
  [CAROL]: { sub: "carol", name: "Carol", teams: ["T"] },
  [BOB]: { sub: "bob", name: "Bob", teams: [] },
};

let dir = "";
let outside = "";
let attachmentsDir = "";
let server: ReturnType<typeof createServer>;
let base = "";
const tokens = new Map<string, ConsoleAssertion>();
let jti = 0;
const records: Array<{ principalId: string; entry: FileAccessRecord }> = [];
let attachments: BotAttachment[] = [];

function assertion(sub: string, role: ConsoleAssertion["role"], teams: ConsoleAssertion["teams"] = []): string {
  const token = `tok${++jti}`;
  const now = Math.floor(Date.now() / 1000);
  tokens.set(token, { iss: ISS, sub, jti: `jti-files-${String(jti).padStart(10, "0")}`, iat: now, exp: now + 60, serverId: "srv", role, teams, actor: "console" });
  return token;
}
const admin = () => assertion("alice", "admin");

const reaches: Record<string, AdminBotReach> = {
  // Carol's bot: in Mona's reach through her team.
  carolbot: { ownerPrincipalId: CAROL, grantTargets: [], sectionMemberTargets: [] },
  // Bob's bot: out of Mona's reach.
  bobbot: { ownerPrincipalId: BOB, grantTargets: [], sectionMemberTargets: [] },
};

function rootsOf(botId: string): BotFileRoot[] {
  return [
    { id: "workspace", kind: "folder", dir: join(dir, "workspaces", botId) },
    { id: "tasks", kind: "unavailable", reason: "not_created" },
    { id: "project", kind: "unavailable", reason: "outside_server_data" },
    { id: "attachments", kind: "attachments", dir: attachmentsDir },
    { id: "sandbox", kind: "unavailable", reason: "person_environment" },
    { id: "desktop", kind: "unavailable", reason: "own_computer" },
  ];
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sagax-admin-files-"));
  outside = mkdtempSync(join(tmpdir(), "sagax-admin-outside-"));
  writeFileSync(join(outside, "secret.txt"), "not yours");
  attachmentsDir = join(dir, "attachments");
  mkdirSync(attachmentsDir, { recursive: true });
  for (const botId of ["carolbot", "bobbot"]) {
    const ws = join(dir, "workspaces", botId);
    mkdirSync(join(ws, "memory"), { recursive: true });
    mkdirSync(join(ws, "Zeta"), { recursive: true });
    writeFileSync(join(ws, "MEMORY.md"), "# Memory\n\n- café au lait\n");
    writeFileSync(join(ws, "memory", "topic.md"), "topic notes\n");
    writeFileSync(join(ws, "alpha.txt"), "0123456789");
    writeFileSync(join(ws, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    symlinkSync(outside, join(ws, "escape"));
    symlinkSync(join(ws, "alpha.txt"), join(ws, "inner-link.txt"));
  }
  writeFileSync(join(attachmentsDir, "up-1.pdf"), "%PDF-1.4 fake");
  writeFileSync(join(outside, "planted.pdf"), "%PDF planted");

  const handler = createOrgAdminRoutes({
    identity: "perspicax",
    issuer: ISS,
    publicOrigin: () => ORIGIN,
    linkServerId: () => "srv",
    verify: async (token) => {
      const found = tokens.get(token);
      if (!found) throw new Error("bad");
      return found;
    },
    principalFor: (_iss, sub) => {
      const found = Object.entries(people).find(([, person]) => person.sub === sub);
      return found ? { id: found[0], name: found[1].name, disabled: false } : null;
    },
    person: (id) => ({ principalId: id, sub: people[id]?.sub ?? null, name: people[id]?.name ?? id }),
    teamPeople: (teamIds) => Object.entries(people).filter(([, person]) => person.teams.some((team) => teamIds.includes(team))).map(([id]) => id),
    bots: () => [],
    usageRows: () => [],
    approvalsFor: () => [],
    answer: async () => ({ ok: true }),
    audit: () => ({ rows: [], next: null }),
    files: {
      reach: (botId) => reaches[botId] ?? null,
      botFiles: (botId) => (reaches[botId] ? { name: botId.toUpperCase(), roots: rootsOf(botId) } : null),
      attachments: async () => attachments,
      record: (principalId, entry) => records.push({ principalId, entry }),
    },
  });
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handler(req, res, new URL(req.url ?? "/", "http://127.0.0.1")).then((handled) => {
      if (!handled) {
        res.writeHead(418);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

beforeEach(() => {
  records.length = 0;
  attachments = [{ id: "att-1", name: "report.pdf", at: 1_700_000_000_000, localPath: join(attachmentsDir, "up-1.pdf") }];
});

async function call(path: string, token: string | undefined = admin(), init: RequestInit = {}) {
  const response = await fetch(`${base}/api/org/admin/files/${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const raw = Buffer.from(await response.arrayBuffer());
  let body: any = null;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    body = null;
  }
  return { status: response.status, body, raw, headers: response.headers };
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

describe("the path rules", () => {
  it("takes a relative path of plain segments, the root as empty", () => {
    expect(parseRelativePath(null)).toEqual([]);
    expect(parseRelativePath("")).toEqual([]);
    expect(parseRelativePath("memory/topic.md")).toEqual(["memory", "topic.md"]);
    expect(parseRelativePath("dossier é/notes ..md")).toEqual(["dossier é", "notes ..md"]);
  });

  it("refuses traversal, absolute paths, backslashes, NUL, empty segments and long names", () => {
    for (const bad of ["..", "../x", "a/../b", "a/..", ".", "./a", "/etc/passwd", "a//b", "a/", "a\\..\\b", "a\0b", "x".repeat(256), `${"a/".repeat(600)}b`]) {
      expect(() => parseRelativePath(bad), bad.slice(0, 40)).toThrow(FileRefusal);
    }
  });

  it("refuses a link anywhere on the way, inside or outside the root", () => {
    const ws = join(dir, "workspaces", "carolbot");
    expect(() => resolveInRoot(ws, ["escape", "secret.txt"])).toThrow(/Links are not followed/);
    expect(() => resolveInRoot(ws, ["escape"])).toThrow(/Links are not followed/);
    expect(() => resolveInRoot(ws, ["inner-link.txt"])).toThrow(/Links are not followed/);
    expect(resolveInRoot(ws, ["memory", "topic.md"]).stat.isFile()).toBe(true);
    expect(() => resolveInRoot(join(dir, "nowhere"), [])).toThrow(/does not exist yet/);
  });

  it("does not follow a parent directory replaced by a symlink", async () => {
    const root = join(dir, "nofollow");
    const outside = join(dir, "outside-secret");
    mkdirSync(join(root, "parent"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, "parent", "note.txt"), "INSIDE");
    writeFileSync(join(outside, "note.txt"), "OUTSIDE");
    const rootDir = realpathSync(root);
    const opened = await openNoFollow(rootDir, ["parent", "note.txt"]);
    const inside = Buffer.alloc(6);
    await opened.read(inside, 0, 6, 0);
    await opened.close();
    expect(inside.toString()).toBe("INSIDE");
    rmSync(join(root, "parent"), { recursive: true });
    symlinkSync(outside, join(root, "parent"));
    await expect(openNoFollow(rootDir, ["parent", "note.txt"])).rejects.toThrow(/Links are not followed/);
  });

  it("bounds a read range and reads text and binary apart", () => {
    expect(parseRange(null, null)).toEqual({ offset: 0, length: FILES_MAX_READ_BYTES });
    expect(parseRange("5", "10")).toEqual({ offset: 5, length: 10 });
    for (const [o, l] of [["-1", "1"], ["1.5", "1"], ["0", "0"], ["0", String(FILES_MAX_READ_BYTES + 1)], ["x", null]] as const) {
      expect(() => parseRange(o, l)).toThrow(FileRefusal);
    }
    expect(looksLikeText(Buffer.from("café"), false)).toBe(true);
    // a character cut by the range is still text when more follows
    expect(looksLikeText(Buffer.from("café").subarray(0, 4), true)).toBe(true);
    expect(looksLikeText(Buffer.from("café").subarray(0, 4), false)).toBe(false);
    expect(looksLikeText(Buffer.from([0x41, 0x00, 0x42]), false)).toBe(false);
  });

  it("names a download in ASCII and in UTF-8", () => {
    expect(attachmentDisposition("rapport é\"x.pdf")).toBe("attachment; filename=\"rapport __x.pdf\"; filename*=UTF-8''rapport%20%C3%A9%22x.pdf");
  });
});

describe("the files routes", () => {
  it("lists a bot's roots, the server environment and the owner's computer as unavailable", async () => {
    const answer = await call("carolbot/roots");
    expect(answer.status).toBe(200);
    expect(answer.headers.get("x-sagax-admin-api")).toBe("1");
    expect(answer.body).toEqual({
      bot: { id: "carolbot", name: "CAROLBOT" },
      roots: [
        { id: "workspace", available: true },
        { id: "tasks", available: false, reason: "not_created" },
        { id: "project", available: false, reason: "outside_server_data" },
        { id: "attachments", available: true },
        { id: "sandbox", available: false, reason: "person_environment" },
        { id: "desktop", available: false, reason: "own_computer" },
      ],
    });
    expect(JSON.stringify(answer.body)).not.toContain(dir);
  });

  it("lists a folder: folders first, links shown as links, never a host path", async () => {
    const answer = await call(`carolbot/list?${q({ root: "workspace" })}`);
    expect(answer.status).toBe(200);
    expect(answer.body.entries.map((e: { name: string; type: string }) => `${e.type}:${e.name}`)).toEqual([
      "dir:memory", "dir:Zeta", "file:alpha.txt", "link:escape", "file:image.png", "link:inner-link.txt", "file:MEMORY.md",
    ]);
    expect(answer.body.truncated).toBe(false);
    expect(JSON.stringify(answer.body)).not.toContain(dir);
    const nested = await call(`carolbot/list?${q({ root: "workspace", path: "memory" })}`);
    expect(nested.body).toMatchObject({ root: "workspace", path: "memory", entries: [{ name: "topic.md", path: "memory/topic.md", type: "file", size: 12 }] });
    expect(records).toEqual([]);
  });

  it("stats and reads a file by range, and records each read", async () => {
    const stat = await call(`carolbot/stat?${q({ root: "workspace", path: "MEMORY.md" })}`);
    expect(stat.body).toMatchObject({ name: "MEMORY.md", type: "file", mime: "text/markdown" });
    const read = await call(`carolbot/read?${q({ root: "workspace", path: "alpha.txt", offset: "2", length: "3" })}`);
    expect(read.body).toMatchObject({ size: 10, offset: 2, length: 3, eof: false, binary: false, text: "234" });
    const tail = await call(`carolbot/read?${q({ root: "workspace", path: "alpha.txt", offset: "8" })}`);
    expect(tail.body).toMatchObject({ offset: 8, length: 2, eof: true, text: "89" });
    const binary = await call(`carolbot/read?${q({ root: "workspace", path: "image.png" })}`);
    expect(binary.body).toMatchObject({ binary: true, mime: "image/png" });
    expect(binary.body.text).toBeUndefined();
    expect(records.map((r) => [r.principalId, r.entry.action, r.entry.path, r.entry.bytes])).toEqual([
      [ALICE, "bot.files.read", "alpha.txt", 3],
      [ALICE, "bot.files.read", "alpha.txt", 2],
      [ALICE, "bot.files.read", "image.png", 7],
    ]);
  });

  it("downloads a file as an attachment of octet-stream, and records it", async () => {
    const answer = await call(`carolbot/download?${q({ root: "workspace", path: "memory/topic.md" })}`);
    expect(answer.status).toBe(200);
    expect(answer.raw.toString("utf8")).toBe("topic notes\n");
    expect(answer.headers.get("content-type")).toBe("application/octet-stream");
    expect(answer.headers.get("content-disposition")).toContain("filename=\"topic.md\"");
    expect(answer.headers.get("x-sagax-file-type")).toBe("text/markdown");
    expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
    expect(answer.headers.get("x-sagax-admin-api")).toBe("1");
    expect(answer.headers.get("content-length")).toBe("12");
    expect(records).toEqual([{ principalId: ALICE, entry: { action: "bot.files.download", botId: "carolbot", botName: "CAROLBOT", root: "workspace", path: "memory/topic.md", bytes: 12 } }]);
  });

  it("refuses a download over the cap before sending a byte", async () => {
    const big = join(dir, "workspaces", "carolbot", "big.bin");
    const fd = openSync(big, "w");
    ftruncateSync(fd, FILES_MAX_DOWNLOAD_BYTES + 1);
    closeSync(fd);
    try {
      const answer = await call(`carolbot/download?${q({ root: "workspace", path: "big.bin" })}`);
      expect(answer).toMatchObject({ status: 413, body: { code: "too_large" } });
      expect(records).toEqual([]);
    } finally {
      rmSync(big);
    }
  });

  it("refuses traversal, links and unknown paths, and never reads outside", async () => {
    const cases: Array<[string, number, string]> = [
      [q({ root: "workspace", path: "../bobbot/MEMORY.md" }), 400, "bad_path"],
      [`root=workspace&path=%2e%2e%2fbobbot`, 400, "bad_path"],
      [q({ root: "workspace", path: "/etc/passwd" }), 400, "bad_path"],
      [q({ root: "workspace", path: "escape/secret.txt" }), 403, "link_refused"],
      [q({ root: "workspace", path: "escape" }), 403, "link_refused"],
      [q({ root: "workspace", path: "inner-link.txt" }), 403, "link_refused"],
      [q({ root: "workspace", path: "missing.txt" }), 404, "not_found"],
      [q({ root: "workspace", path: "alpha.txt/x" }), 404, "not_found"],
      [q({ root: "home", path: "x" }), 400, "bad_root"],
      [q({ root: "sandbox" }), 409, "root_person_environment"],
      [q({ root: "desktop" }), 409, "root_own_computer"],
      [q({ root: "tasks" }), 409, "root_not_created"],
    ];
    for (const [query, status, code] of cases) {
      for (const action of ["stat", "read", "download"]) {
        const answer = await call(`carolbot/${action}?${query}`);
        expect([action, query, answer.status, answer.body?.code]).toEqual([action, query, status, code]);
        expect(answer.raw.toString("utf8")).not.toContain("not yours");
      }
    }
    expect((await call(`carolbot/read?${q({ root: "workspace", path: "memory" })}`)).body.code).toBe("not_a_file");
    expect((await call(`carolbot/list?${q({ root: "workspace", path: "alpha.txt" })}`)).body.code).toBe("not_a_folder");
    expect(records).toEqual([]);
  });

  it("serves the attachments of the bot's conversations by id only", async () => {
    const list = await call(`carolbot/list?${q({ root: "attachments" })}`);
    expect(list.body.entries).toEqual([{ name: "report.pdf", path: "att-1", type: "file", size: 13, modifiedAt: 1_700_000_000_000 }]);
    const download = await call(`carolbot/download?${q({ root: "attachments", path: "att-1" })}`);
    expect(download.raw.toString("utf8")).toBe("%PDF-1.4 fake");
    expect(download.headers.get("content-disposition")).toContain("report.pdf");
    expect((await call(`carolbot/download?${q({ root: "attachments", path: "up-1.pdf" })}`)).body.code).toBe("not_found");
    expect((await call(`carolbot/stat?${q({ root: "attachments", path: "att-1/x" })}`)).body.code).toBe("not_found");
    // an attachment record pointing outside the store is refused
    attachments = [{ id: "att-2", name: "planted.pdf", at: 1, localPath: join(outside, "planted.pdf") }];
    expect((await call(`carolbot/download?${q({ root: "attachments", path: "att-2" })}`)).body.code).toBe("outside_root");
  });

  it("gates by role and a manager's reach, and takes GET only", async () => {
    expect(await call("carolbot/roots", assertion("bob", "employee"))).toMatchObject({ status: 403, body: { code: "forbidden_role" } });
    const team = [{ id: "T", name: "T", manager: true }];
    expect((await call("carolbot/roots", assertion("mona", "manager", team))).status).toBe(200);
    expect(await call("bobbot/roots", assertion("mona", "manager", team))).toMatchObject({ status: 404, body: { code: "not_found" } });
    expect(await call(`bobbot/download?${q({ root: "workspace", path: "alpha.txt" })}`, assertion("mona", "manager", team))).toMatchObject({ status: 404 });
    expect((await call("bobbot/roots", admin())).status).toBe(200);
    expect(await call("nobot/roots")).toMatchObject({ status: 404, body: { code: "not_found" } });
    expect(await call("carolbot/roots", admin(), { method: "POST" })).toMatchObject({ status: 405, body: { code: "method_not_allowed" } });
    expect(await call("carolbot/delete")).toMatchObject({ status: 404, body: { code: "not_found" } });
    expect(await call("bad.id/roots")).toMatchObject({ status: 404 });
    expect(await call("carolbot/roots", "")).toMatchObject({ status: 401, body: { code: "assertion_missing" } });
    expect(records).toEqual([]);
  });
});
