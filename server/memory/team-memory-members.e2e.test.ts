// #4460: team memory never crosses people on a workspace several people use
// without an organization console (an email sign-in list naming members).
//
// Through the real server: two people who each own their bots (the sign-in
// list's admins; a member uses the bots shared with them). What one
// person's bot proposes and that person confirms reaches that person's bots
// only, never the other person's bot prompt, listing or approvals, for bots in
// no section (the one shared "General" key was the leak) and for two sections
// of the same name. Entries the shared memory already held move, at the next
// start, to their author's own memory, listed for that author with where they
// came from; one whose author is unknown is listed for the admin, read by no
// bot. The prompt says this server keeps no memory shared between people.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "../auth/sessions.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { freePortBlock } from "../testing/ports.ts";

const SERVER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const posixOnly = describe.skipIf(process.platform === "win32");
const CAPABILITY_KEY = "team-memory-members-capability";
const CAROL = "carol@example.test";
const ADA = "ada@example.test";
const BOB = "bob@example.test";

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
const tokens: Record<string, string> = {};

const api = async (method: string, path: string, as?: string, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start() {
  log = "";
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

async function stop() {
  await waitForExit(child, { signal: "SIGTERM" });
}

/** The bot's shell saves a team-memory entry from this thread (#4439: at once). */
async function saveTeamMemory(botId: string, threadId: string, name: string, detail: string): Promise<string> {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId, threadId, kind: "agents" }),
  });
  expect(minted.status).toBe(201);
  const { token } = await minted.json() as { token: string };
  const proposed = await fetch(`${BASE}/api/internal/team-memory`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromBotId: botId, fromThreadId: threadId, kind: "term", name, detail }),
  });
  const body = await proposed.json() as { status: string; entryId: string };
  expect(proposed.status, JSON.stringify(body)).toBe(201);
  expect(body.status).toBe("saved");
  return body.entryId;
}

posixOnly("#4460 team memory stays with its person on a workspace with members and no console", () => {
  const makeBot = async (as: string, name: string, section?: string) => {
    const created = await api("POST", "/api/bots", as, { name });
    expect(created.status, created.text).toBe(201);
    const id = created.body.bot.id as string;
    const patched = await api("PATCH", `/api/bots/${id}`, as, { modelSelection: { instanceId: "grok", model: "fake-model" }, computer: "off", ...(section ? { section } : {}) });
    expect(patched.status, patched.text).toBe(200);
    return { id, threadId: created.body.bot.threadId as string };
  };
  const promptOf = async (as: string, botId: string) => {
    const preview = await api("GET", `/api/bots/${botId}/system-prompt`, as);
    expect(preview.status, preview.text).toBe(200);
    return (preview.body.sections as Array<{ id: string; text: string }>).find((section) => section.id === "team-memory")?.text ?? "";
  };
  const listed = async (as: string, section = "") => (await api("GET", `/api/team-memory?section=${encodeURIComponent(section)}`, as)).body.entries as Array<{ name: string; movedFrom?: string }> ?? [];

  beforeAll(async () => {
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-team-memory-members-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [ADA, BOB], members: [CAROL] },
      instances: { grok: { driver: "grokAgent", config: { cli: join(SERVER_DIR, "testing", "fake-acp-cli.ts"), fullAuto: true } } },
    }));
    const role = (email: string) => (email !== CAROL ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [ADA, BOB, CAROL]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] }).token;
    registry.close();
    await start();
  }, 40_000);

  afterAll(async () => {
    if (child) await stop();
    if (home) await removeTempDir(home);
  });

  it("keeps what one person's bot saved from the other person's ungrouped bot: prompt, listing, approvals", async () => {
    const adaBot = await makeBot(ADA, "Ada helper");
    const bobBot = await makeBot(BOB, "Bob helper");
    const entryId = await saveTeamMemory(bobBot.id, bobBot.threadId, "Zephyr", "Zephyr is the name of Bob's scheduling bot");
    // #4439: no card for anyone
    for (const as of [ADA, BOB]) expect(JSON.stringify((await api("GET", "/api/approvals", as)).body)).not.toContain(entryId);

    const bobPrompt = await promptOf(BOB, bobBot.id);
    expect(bobPrompt).toContain("Zephyr");
    expect(bobPrompt).toContain("Your own memory");
    expect(bobPrompt).toContain("This server keeps no memory shared between people.");
    expect(bobPrompt).toContain("only that person's bots read it");
    expect(bobPrompt).not.toContain("shared prompts");
    expect(await promptOf(ADA, adaBot.id)).not.toContain("Zephyr");
    expect(JSON.stringify(await listed(ADA))).not.toContain("Zephyr");
    expect(JSON.stringify(await listed(BOB))).toContain("Zephyr");
    // a member manages their own memory, no admin
    expect((await api("GET", "/api/team-memory?section=", CAROL)).status).toBe(200);
  }, 60_000);

  it("keeps two sections of the same name apart", async () => {
    const adaOps = await makeBot(ADA, "Ada ops", "Ops");
    const bobOps = await makeBot(BOB, "Bob ops", "Ops");
    const entryId = await saveTeamMemory(adaOps.id, adaOps.threadId, "Nimbus", "Nimbus is the board Ada dispatches from");
    expect(JSON.stringify((await api("GET", "/api/approvals", BOB)).body)).not.toContain(entryId);
    expect((await api("DELETE", `/api/team-memory/${entryId}?section=Ops`, BOB)).status).toBeOneOf([403, 404]);
    expect(await promptOf(ADA, adaOps.id)).toContain("Nimbus");
    expect(await promptOf(BOB, bobOps.id)).not.toContain("Nimbus");
    expect(JSON.stringify(await listed(BOB, "Ops"))).not.toContain("Nimbus");
    expect(JSON.stringify((await api("GET", "/api/memory-manager/sources", BOB)).body)).not.toContain("Nimbus");
  }, 60_000);

  // last: it restarts the server
  it("moves entries the shared memory held to their author's own memory; an unknown author's are listed for the admin", async () => {
    const adaBot = await makeBot(ADA, "Ada legacy");
    const bobBot = await makeBot(BOB, "Bob legacy", "Ops");
    await stop();
    const file = join(home, ".sagax", "team-memory.json");
    const at = Date.now() - 14 * 86_400_000;
    const entry = (id: string, name: string, botId: string) => ({
      id, kind: "term", name, detail: `${name} detail`, aliases: [], status: "accepted",
      source: { botId, botName: "legacy", threadId: "", at }, updatedAt: at,
    });
    writeFileSync(file, JSON.stringify({ version: 1, sections: {
      "": [entry("legacy-ada", "Corvid", adaBot.id), entry("legacy-nobody", "Orphan", "")],
      Ops: [entry("legacy-bob", "Pelican", bobBot.id)],
    } }));
    await start();
    const adaPrompt = await promptOf(ADA, adaBot.id);
    expect(adaPrompt).toContain("Corvid");
    expect(adaPrompt).toContain("[moved from the former shared \"General\" memory]");
    expect(adaPrompt).not.toContain("Pelican");
    expect(adaPrompt).not.toContain("Orphan");
    const bobPrompt = await promptOf(BOB, bobBot.id);
    expect(bobPrompt).toContain("Pelican");
    expect(bobPrompt).not.toContain("Corvid");
    expect(bobPrompt).not.toContain("Orphan");
    expect((await listed(ADA)).find((row) => row.name === "Corvid")?.movedFrom).toBe("General");
    expect((await listed(BOB)).find((row) => row.name === "Pelican")?.movedFrom).toBe("Ops");
    // the entry with no known author was the whole server's: an admin's
    // memory page lists it, a member's does not
    const adminSources = (await api("GET", "/api/memory-manager/sources", ADA)).body.sources as Array<{ section?: string; owner?: string }>;
    const unclaimed = adminSources.find((source) => source.owner === "unclaimed");
    expect(unclaimed, JSON.stringify(adminSources)).toBeTruthy();
    expect(JSON.stringify(await listed(ADA, unclaimed!.section))).toContain("Orphan");
    expect(JSON.stringify((await api("GET", "/api/memory-manager/sources", CAROL)).body)).not.toContain("unclaimed");
    expect(JSON.stringify(await listed(CAROL, unclaimed!.section))).not.toContain("Orphan");
    const stored = readFileSync(file, "utf8");
    for (const name of ["Corvid", "Pelican", "Orphan"]) expect(stored).toContain(name);
  }, 90_000);
});
