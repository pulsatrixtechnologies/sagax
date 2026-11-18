// #4625: the files of a person's own bots through the member API
// (server/org/org-member-routes.ts `bots/{id}/files/...`), answered by the
// admin file browser's code (server/org/org-admin-files.ts) with the member
// view: ownership (the catalogue, or the person's own surface bot), the path
// rules, the sensitive names never listed nor served, the conversation
// folders the person may read, the recursive paged listing and the secret
// mask on a text read. Fake deps around real folders.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ConsoleAssertion } from "../auth/oidc-rp.ts";
import { createOrgBotFileRoots } from "../index-leaves/orgBotFileRoots.ts";
import type { BotAttachment, BotFileRoot } from "./org-admin-files.ts";
import { createOrgMemberRoutes, type MemberRequest, type OrgMemberRouteDeps } from "./org-member-routes.ts";

const ISS = "https://perspicax.example";
const ORIGIN = "https://sagax.example";
const PLANTED_KEY = "sk-ant-abcdefghijklmnopqrstuvwxyz";
type Person = { principalId: string; name: string; admin: boolean; permissions: string[] };
const people = new Map<string, Person>();
const tokens = new Map<string, ConsoleAssertion>();
let jti = 0;
let performed: MemberRequest[] = [];
let filesAsked: Array<{ botId: string; principalId: string }> = [];

let home = "";
let outside = "";
let attachmentsDir = "";
let attachments: BotAttachment[] = [];

function token(sub: string, role: ConsoleAssertion["role"] = "employee"): string {
  jti += 1;
  const id = `t${jti}`;
  const now = Math.floor(Date.now() / 1000);
  tokens.set(id, { iss: ISS, sub, jti: `jti-files-${String(jti).padStart(8, "0")}`, iat: now, exp: now + 60, serverId: "srv", role, teams: [], actor: "console" });
  return id;
}

/** b1 is Bob's, b2 is Ann's (shared with Bob), s1 is Bob's surface bot. */
const catalogue = {
  entries: [
    { id: "b1", source: "mine", name: "Orion", owner: { principalId: "pr_bob", name: "Bob" } },
    { id: "b2", source: "shared", name: "Beacon", owner: { principalId: "pr_ann", name: "Ann" } },
  ],
};

/** #4627: a working folder set on b1, its roots then come from the real
 * server function (server/index-leaves/orgBotFileRoots.ts), member view. */
let projectCwd: string | null = null;

function leafRoots(botId: string, cwd: string): BotFileRoot[] {
  const leaf = createOrgBotFileRoots(() => ({
    ATTACHMENTS_DIR: attachmentsDir,
    TASK_WORKSPACES_DIR: join(home, "tasks"),
    workspaceDir: (id: string) => join(home, "workspaces", id),
    store: { tasks: () => [{ threadId: "t-bob" }, { threadId: "t-other" }] },
    botThreadReadable: (_bot: unknown, threadId: string) => threadId === "t-bob",
    insideDataDir: (path: string) => {
      const rel = relative(realpathSync(home), realpathSync(path));
      return !rel.startsWith("..");
    },
  }));
  return leaf({ id: botId, threadId: "t-main", cwd }, "pr_bob");
}

function rootsOf(botId: string): BotFileRoot[] {
  if (botId === "b1" && projectCwd) return leafRoots(botId, projectCwd);
  return [
    { id: "workspace", kind: "folder", dir: join(home, "workspaces", botId) },
    // Bob may read his conversation t-bob, never t-other (another person's
    // private conversation with his bot)
    { id: "tasks", kind: "folder", dir: join(home, "tasks", botId), shown: new Set(["t-bob"]) },
    { id: "project", kind: "unavailable", reason: "not_set" },
    { id: "attachments", kind: "attachments", dir: attachmentsDir },
    { id: "sandbox", kind: "unavailable", reason: "person_environment" },
    { id: "desktop", kind: "unavailable", reason: "own_computer" },
  ];
}

const deps: OrgMemberRouteDeps = {
  identity: "perspicax",
  issuer: ISS,
  publicOrigin: () => ORIGIN,
  linkServerId: () => "srv",
  verify: async (bearer) => {
    const found = tokens.get(bearer);
    if (!found) throw new Error("The assertion does not verify.");
    return found;
  },
  personFor: (_iss, sub) => {
    const person = people.get(sub);
    return person ? { principalId: person.principalId, name: person.name, active: true, admin: person.admin } : null;
  },
  permissions: (principalId) => ({ admin: false, permissions: [...people.values()].find((p) => p.principalId === principalId)?.permissions ?? [] }),
  perform: async (_person, request) => {
    performed.push(request);
    if (request.path === "/api/bot-catalog") return { status: 200, body: catalogue };
    return { status: 404, body: { error: "no" } };
  },
  threadStatus: () => "idle",
  resolvePerson: () => null,
  record: () => undefined,
  botFiles: {
    files: (botId, principalId) => {
      filesAsked.push({ botId, principalId });
      return ["b1", "b2", "s1"].includes(botId) ? { name: botId.toUpperCase(), roots: rootsOf(botId) } : null;
    },
    attachments: async () => attachments,
    surfaceOwner: (botId) => (botId === "s1" ? "pr_bob" : null),
  },
};

let server: Server;
let base = "";

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "sagax-member-files-"));
  outside = mkdtempSync(join(tmpdir(), "sagax-member-outside-"));
  writeFileSync(join(outside, "elsewhere.txt"), "NOT YOURS");
  attachmentsDir = join(home, "attachments");
  mkdirSync(attachmentsDir, { recursive: true });
  writeFileSync(join(attachmentsDir, "up-1.pdf"), "%PDF-1.4 fake");
  writeFileSync(join(attachmentsDir, "up-2.txt"), "a token file");
  for (const botId of ["b1", "b2", "s1"]) {
    const ws = join(home, "workspaces", botId);
    mkdirSync(join(ws, "memory"), { recursive: true });
    mkdirSync(join(ws, "reports", "2026"), { recursive: true });
    writeFileSync(join(ws, "MEMORY.md"), `# Memory of ${botId}\n`);
    writeFileSync(join(ws, "memory", "topic.md"), "topic notes\n");
    writeFileSync(join(ws, "notes.txt"), `key ${PLANTED_KEY} end`);
    writeFileSync(join(ws, "chart.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    writeFileSync(join(ws, "reports", "q1.csv"), "a,b\n1,2\n");
    writeFileSync(join(ws, "reports", "2026", "summary.pdf"), "%PDF-1.4");
    // sensitive names: never listed nor served
    writeFileSync(join(ws, ".env"), "API_KEY=planted");
    writeFileSync(join(ws, ".mcp.json"), "{\"token\":\"planted\"}");
    mkdirSync(join(ws, ".claude"), { recursive: true });
    writeFileSync(join(ws, ".claude", "settings.local.json"), "{}");
    mkdirSync(join(ws, "secrets"), { recursive: true });
    writeFileSync(join(ws, "secrets", "plain-name.txt"), "inside a secrets folder");
    writeFileSync(join(ws, "credentials.json"), "{}");
    writeFileSync(join(ws, "server.key"), "-----BEGIN KEY-----");
    writeFileSync(join(ws, "id_rsa"), "-----BEGIN KEY-----");
    // links: neither listed in a walk nor followed
    symlinkSync(outside, join(ws, "escape"));
    symlinkSync(join(ws, "notes.txt"), join(ws, "inner-link.txt"));
    const tasks = join(home, "tasks", botId);
    mkdirSync(join(tasks, "t-bob"), { recursive: true });
    mkdirSync(join(tasks, "t-other"), { recursive: true });
    writeFileSync(join(tasks, "t-bob", "draft.md"), "mine");
    writeFileSync(join(tasks, "t-other", "private.md"), "SOMEONE ELSE");
  }
  people.set("bob", { principalId: "pr_bob", name: "Bob", admin: false, permissions: ["clients.botsRead"] });
  people.set("ann", { principalId: "pr_ann", name: "Ann", admin: true, permissions: [] });
  people.set("nora", { principalId: "pr_nora", name: "Nora", admin: false, permissions: ["clients.botsMessage"] });

  const handle = createOrgMemberRoutes(deps);
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!(await handle(req, res, url))) {
      res.writeHead(418);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

beforeEach(() => {
  projectCwd = null;
  performed = [];
  filesAsked = [];
  attachments = [
    { id: "att-1", name: "report.pdf", at: 1_700_000_000_000, localPath: join(attachmentsDir, "up-1.pdf") },
    { id: "att-2", name: "token.txt", at: 1_700_000_000_001, localPath: join(attachmentsDir, "up-2.txt") },
  ];
});

async function call(path: string, who = "bob", role: ConsoleAssertion["role"] = "employee") {
  const response = await fetch(`${base}/api/org/member/${path}`, { headers: { authorization: `Bearer ${token(who, role)}` } });
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

/** Every file a recursive listing answers, page after page. */
async function walkAll(botId: string, params: Record<string, string>, who = "bob") {
  const seen: any[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 50; pages += 1) {
    const got = await call(`bots/${botId}/files/list?${q({ recursive: "1", ...params, ...(cursor ? { cursor } : {}) })}`, who);
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    seen.push(...got.body.entries);
    cursor = got.body.nextCursor;
    if (!cursor) return seen;
  }
  throw new Error("the walk never ended");
}

describe("member API: the files of the person's own bots (#4625)", () => {
  it("lists the routes in capabilities", async () => {
    const got = await call("capabilities");
    expect(got.body.routes).toEqual(expect.arrayContaining(["GET bots/{id}/files/roots", "GET bots/{id}/files/list", "GET bots/{id}/files/stat", "GET bots/{id}/files/read", "GET bots/{id}/files/download"]));
  });

  it("answers the owner: roots, a folder, a file's facts, a read and a download", async () => {
    const roots = await call("bots/b1/files/roots");
    expect(roots.status).toBe(200);
    expect(roots.body.bot).toEqual({ id: "b1", name: "B1" });
    expect(roots.body.roots).toContainEqual({ id: "workspace", available: true });
    expect(roots.body.roots).toContainEqual({ id: "project", available: false, reason: "not_set" });
    expect(roots.headers.get("x-sagax-member-api")).toBe("1");
    expect(filesAsked).toEqual([{ botId: "b1", principalId: "pr_bob" }]);

    const listed = await call(`bots/b1/files/list?${q({ root: "workspace" })}`);
    expect(listed.status).toBe(200);
    const names = listed.body.entries.map((entry: any) => entry.name);
    expect(names).toEqual(expect.arrayContaining(["memory", "reports", "MEMORY.md", "notes.txt", "chart.png"]));

    const stat = await call(`bots/b1/files/stat?${q({ root: "workspace", path: "reports/q1.csv" })}`);
    expect(stat.body).toMatchObject({ type: "file", size: 8, mime: "text/csv" });

    const read = await call(`bots/b1/files/read?${q({ root: "workspace", path: "MEMORY.md" })}`);
    expect(read.body).toMatchObject({ text: "# Memory of b1\n", binary: false, eof: true });

    const download = await call(`bots/b1/files/download?${q({ root: "workspace", path: "reports/2026/summary.pdf" })}`);
    expect(download.status).toBe(200);
    expect(download.raw.toString()).toBe("%PDF-1.4");
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(download.headers.get("content-type")).toBe("application/octet-stream");
    expect(download.headers.get("x-sagax-member-api")).toBe("1");
    expect(download.headers.get("x-sagax-admin-api")).toBeNull();
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("masks a secret in a text read; the download is the file as it is", async () => {
    const read = await call(`bots/b1/files/read?${q({ root: "workspace", path: "notes.txt" })}`);
    expect(read.status).toBe(200);
    expect(read.body.text).not.toContain(PLANTED_KEY);
    expect(read.body.text).toContain("«redacted");
    const download = await call(`bots/b1/files/download?${q({ root: "workspace", path: "notes.txt" })}`);
    expect(download.raw.toString()).toContain(PLANTED_KEY);
  });

  it("walks every root, paged, in a stable order, with the bot, kind and mime of each file", async () => {
    const all = await walkAll("b1", { limit: "2" });
    const paths = all.map((entry) => `${entry.root}:${entry.path}`);
    expect(paths).toEqual([
      "workspace:MEMORY.md",
      "workspace:chart.png",
      "workspace:memory/topic.md",
      "workspace:notes.txt",
      "workspace:reports/2026/summary.pdf",
      "workspace:reports/q1.csv",
      "tasks:t-bob/draft.md",
      "attachments:att-1",
    ]);
    expect(new Set(paths).size).toBe(paths.length);
    expect(all.find((entry) => entry.path === "chart.png")).toMatchObject({ type: "file", kind: "image", mime: "image/png", size: 6 });
    expect(all.find((entry) => entry.path === "att-1")).toMatchObject({ name: "report.pdf", kind: "pdf", modifiedAt: 1_700_000_000_000 });
    // one page at once answers the same files
    const whole = await call(`bots/b1/files/list?${q({ recursive: "1", limit: "1000" })}`);
    expect(whole.body).toMatchObject({ bot: { id: "b1", name: "B1" }, recursive: true, root: null, nextCursor: null });
    expect(whole.body.entries.map((entry: any) => `${entry.root}:${entry.path}`)).toEqual(paths);
  });

  it("searches by name and filters by kind, one root or all", async () => {
    const found = await walkAll("b1", { q: "SUMM" });
    expect(found.map((entry) => entry.path)).toEqual(["reports/2026/summary.pdf"]);
    const pdfs = await walkAll("b1", { type: "pdf" });
    expect(pdfs.map((entry) => `${entry.root}:${entry.path}`)).toEqual(["workspace:reports/2026/summary.pdf", "attachments:att-1"]);
    const some = await walkAll("b1", { type: "image,spreadsheet", root: "workspace" });
    expect(some.map((entry) => entry.path)).toEqual(["chart.png", "reports/q1.csv"]);
    expect((await call(`bots/b1/files/list?${q({ recursive: "1", type: "movie" })}`)).body.code).toBe("bad_type");
    expect((await call(`bots/b1/files/list?${q({ recursive: "1", limit: "0" })}`)).body.code).toBe("bad_limit");
    expect((await call(`bots/b1/files/list?${q({ recursive: "1", cursor: "not-a-cursor" })}`)).body.code).toBe("bad_cursor");
    const hostile = Buffer.from(JSON.stringify({ r: "workspace", p: ["..", "etc"] })).toString("base64url");
    expect((await call(`bots/b1/files/list?${q({ recursive: "1", cursor: hostile })}`)).status).toBe(400);
  });

  it("never lists nor serves a sensitive name: dotfiles, dot folders, credential and key names", async () => {
    const listed = await call(`bots/b1/files/list?${q({ root: "workspace" })}`);
    const names = listed.body.entries.map((entry: any) => entry.name);
    for (const hidden of [".env", ".mcp.json", ".claude", "secrets", "credentials.json", "server.key", "id_rsa"]) expect(names, hidden).not.toContain(hidden);
    const walked = JSON.stringify(await walkAll("b1", {}));
    for (const hidden of [".env", ".mcp.json", "settings.local.json", "plain-name.txt", "credentials.json", "server.key", "id_rsa", "token.txt", "att-2"]) expect(walked, hidden).not.toContain(hidden);
    for (const path of [".env", ".mcp.json", ".claude/settings.local.json", ".claude", "secrets/plain-name.txt", "credentials.json", "server.key", "id_rsa"]) {
      for (const action of ["stat", "read", "download", "list"]) {
        const got = await call(`bots/b1/files/${action}?${q({ root: "workspace", path })}`);
        expect(got.status, `${action} ${path}`).toBe(404);
        expect(got.raw.toString(), `${action} ${path}`).not.toMatch(/planted|BEGIN KEY|inside a secrets/);
      }
    }
    const attachmentsList = await call(`bots/b1/files/list?${q({ root: "attachments" })}`);
    expect(attachmentsList.body.entries.map((entry: any) => entry.path)).toEqual(["att-1"]);
    expect((await call(`bots/b1/files/download?${q({ root: "attachments", path: "att-2" })}`)).status).toBe(404);
  });

  it("refuses hostile paths and links, and never answers what lies outside", async () => {
    for (const path of ["..", "../workspaces/b2/MEMORY.md", "memory/../../b2", "/etc/passwd", "a\\..\\b", "memory//topic.md", "./MEMORY.md", "memory/\0x"]) {
      const got = await call(`bots/b1/files/read?${q({ root: "workspace", path })}`);
      expect(got.status, path).toBe(400);
      expect(got.body.code, path).toBe("bad_path");
    }
    for (const path of ["escape/elsewhere.txt", "escape", "inner-link.txt"]) {
      const got = await call(`bots/b1/files/download?${q({ root: "workspace", path })}`);
      expect(got.status, path).toBe(403);
      expect(got.raw.toString(), path).not.toContain("NOT YOURS");
    }
    const walked = JSON.stringify(await walkAll("b1", {}));
    expect(walked).not.toContain("escape");
    expect(walked).not.toContain("inner-link");
    expect((await call(`bots/b1/files/list?${q({ root: "nowhere" })}`)).body.code).toBe("bad_root");
    expect((await call(`bots/b1/files/list?${q({ root: "sandbox" })}`)).status).toBe(409);
  });

  it("shows only the conversation folders the person may read", async () => {
    const listed = await call(`bots/b1/files/list?${q({ root: "tasks" })}`);
    expect(listed.body.entries.map((entry: any) => entry.name)).toEqual(["t-bob"]);
    for (const path of ["t-other", "t-other/private.md"]) {
      for (const action of ["stat", "read", "download", "list"]) {
        const got = await call(`bots/b1/files/${action}?${q({ root: "tasks", path })}`);
        expect(got.status, `${action} ${path}`).toBe(404);
        expect(got.raw.toString()).not.toContain("SOMEONE ELSE");
      }
    }
    expect(JSON.stringify(await walkAll("b1", { root: "tasks" }))).not.toContain("t-other");
  });

  it("browses a working folder only inside the bot's own folders, never the data folder nor another bot's (#4627)", async () => {
    const link = join(home, "workspaces", "b1", "to-b2");
    symlinkSync(join(home, "workspaces", "b2"), link);
    try {
      for (const cwd of [home, join(home, "workspaces"), join(home, "workspaces", "b2"), join(home, "tasks", "b2"), join(home, "tasks", "b1", "t-other"), link]) {
        projectCwd = cwd;
        const roots = await call("bots/b1/files/roots");
        expect(JSON.stringify(roots.body), cwd).toContain("outside_bot_folders");
        const listed = await call(`bots/b1/files/list?${q({ root: "project", recursive: "1" })}`);
        expect(listed.status, cwd).toBe(409);
        expect(listed.raw.toString(), cwd).not.toContain("Memory of b2");
        const walked = JSON.stringify(await walkAll("b1", {}));
        expect(walked, cwd).not.toContain("SOMEONE ELSE");
        expect(walked.match(/MEMORY\.md/g)?.length ?? 0, cwd).toBe(1);
        expect(walked, cwd).not.toContain("private.md");
      }
      projectCwd = join(home, "workspaces", "b1", "reports");
      const own = await walkAll("b1", { root: "project" });
      expect(own.map((entry: any) => entry.name).sort()).toEqual(["q1.csv", "summary.pdf"]);
      projectCwd = join(home, "tasks", "b1");
      const tasks = JSON.stringify(await walkAll("b1", { root: "project" }));
      expect(tasks).toContain("draft.md");
      expect(tasks).not.toContain("private.md");
    } finally {
      rmSync(link, { force: true });
    }
  });

  it("answers 404 for a bot the person does not own, an admin's assertion included, and opens no file", async () => {
    for (const action of ["roots", "list", "stat", "read", "download"]) {
      for (const [who, role, botId] of [["bob", "employee", "b2"], ["bob", "employee", "nope"], ["ann", "admin", "b1"], ["ann", "admin", "s1"]] as const) {
        filesAsked = [];
        const got = await call(`bots/${botId}/files/${action}?${q({ root: "workspace", path: "MEMORY.md" })}`, who, role);
        expect(got.status, `${who} ${botId} ${action}`).toBe(404);
        expect(got.body).toMatchObject({ code: "not_found" });
        expect(got.raw.toString()).not.toContain("Memory of");
        expect(filesAsked, `${who} ${botId} ${action}`).toEqual([]);
      }
    }
  });

  it("answers the person's own surface bot, which no catalogue lists", async () => {
    const got = await call(`bots/s1/files/read?${q({ root: "workspace", path: "MEMORY.md" })}`);
    expect(got.status).toBe(200);
    expect(got.body.text).toBe("# Memory of s1\n");
    expect(performed).toEqual([]);
  });

  it("needs clients.botsRead", async () => {
    const got = await call("bots/b1/files/roots", "nora");
    expect(got.status).toBe(403);
    expect(got.body).toMatchObject({ code: "forbidden_permission", permission: "clients.botsRead" });
    expect(filesAsked).toEqual([]);
  });
});
