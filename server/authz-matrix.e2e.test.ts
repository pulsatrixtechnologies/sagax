// The authorization matrix (2026-10-27): a permanent non-regression test of
// who may touch whose things on an organization server, through the real
// server, on a throwaway home with the fake Perspicax provider and the fake
// Claude CLI. Fictional people and data only.
//
// People: A and B, two members of the same organization, and an admin.
// B owns a bot, its conversations, a sub-conversation, a room, a routine,
// memory, a vault entry, a webhook, a custom rule, a rule set, a web search
// key, and a second bot shared with A at `use`.
//
// The route list is not typed here: server/testing/authz-routes.ts expands
// every CLIENT_ALLOW row (every route a member session reaches; the rest is
// admin scope and refused at the gate) into concrete paths and names each id
// in them. A new route is aimed at automatically; one whose id has no name
// fails server/testing/authz-routes.test.ts.
//
//   foreign  A sends every (method, path) with B's ids, and a body aimed at
//            B's things where one matters (a grant to herself, a routine on
//            B's bot). Each one must be refused (403 or 404). Anything else
//            is either listed in FOREIGN_OTHER with why the answer is expected, or
//            a failure.
//   shared   the same on the bot B shares with A at `use`: every write that
//            is more than `use` (USE_WRITES) is refused.
//   own      A sends every one of them on her own things: none may be
//            refused for want of an admin.
//   privacy  no answer A gets, and nothing on A's live stream, carries B's
//            private marker; B's things read the same before and after.
//   admin    an organization admin opens no bot of B's without a grant.
//
// AUTHZ_MATRIX_OUT=<file> writes the whole matrix (every probe, its status)
// as JSON, for review.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { fillShape, memberRouteShapes, OWNED_KINDS, rowsBehindFeatures, type RouteShape, type Slot } from "./testing/authz-routes.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

/** In everything B owns that A must never read. */
const PRIVATE_MARK = "zqprivateb7f3a";
/** In the names of B's private things. */
const NAME = "zqnameb7f3a";

const ADMIN: FakeOidcUser = { sub: "01JAZMATRIXADMIN00000000AD", name: "Ada Admin", preferred_username: "ada", role: "admin", teams: [] };
const PERSON_A: FakeOidcUser = { sub: "01JAZMATRIXPERSONA000000AA", name: "Ari A", preferred_username: "ari", role: "employee", teams: [] };
const PERSON_B: FakeOidcUser = { sub: "01JAZMATRIXPERSONB000000BB", name: "Bea B", preferred_username: "bea", role: "employee", teams: [] };

/** What the server runs with (index.ts's gate features on an organization server). */
const FEATURES = { orgDirectory: true, orgPairing: true, serverCatalogue: false, sharedComputers: false } as const;

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home = "";
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie: string };
type Answer = { status: number; body: any; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

/** One request; a body is read up to 256 KB or 4 s, so a stream that opens is
 * seen (its status) without holding the matrix. */
async function api(method: string, path: string, auth?: Auth, body?: unknown): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body !== undefined && method !== "GET" ? { "content-type": "application/json" } : {}), ...(auth ? { cookie: auth.cookie } : {}) },
      body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });
    let text = "";
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      const until = Date.now() + 4_000;
      for (;;) {
        const left = until - Date.now();
        if (left <= 0 || text.length > 262_144) { void reader.cancel().catch(() => {}); break; }
        const next = await Promise.race([reader.read(), sleep(left).then(() => null)]);
        if (!next) { void reader.cancel().catch(() => {}); break; }
        if (next.done) break;
        text += decoder.decode(next.value, { stream: true });
      }
    }
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed, text };
  } catch (error) {
    return { status: 0, body: {}, text: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: cookiePair(session!) };
}

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

async function openStream(auth: Auth): Promise<{ text: () => string; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

/** A person's things, by slot kind; a kind without one gets a fake id. */
type Things = Partial<Record<Slot["kind"], string>> & { principal: string };
interface Person { auth: Auth; things: Things }

async function createBot(auth: Auth, name: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, auth, { modelSelection: { instanceId: "claude", model: "fake-model" } });
  expect(patched.status, patched.text).toBe(200);
  return { id: created.body.bot.id, threadId: created.body.bot.threadId };
}

/** Creates what a person owns. Each step is best effort: a kind the server
 * does not let the fixture create stays a fake id, and is reported. */
async function furnish(auth: Auth, principal: string, label: string, marker: string): Promise<{ things: Things; missing: string[] }> {
  const things: Things = { principal, person: principal };
  const missing: string[] = [];
  const take = (kind: Slot["kind"], value: unknown, why: Answer) => {
    if (typeof value === "string" && value) things[kind] = value;
    else missing.push(`${kind}: ${why.status} ${why.text.slice(0, 160)}`);
  };
  const bot = await createBot(auth, `${label} ${NAME} bot`);
  things.bot = bot.id;
  things.thread = bot.threadId;
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, auth, { text: `note ${marker}` });
  expect(sent.status, sent.text).toBe(202);
  const messages = await waitFor(async () => {
    const got = (await api("GET", `/api/threads/${bot.threadId}/messages`, auth)).body.messages as Array<{ id: string; role: string; kind: string; text?: string }> | undefined;
    return got?.some((m) => m.role === "bot" && m.kind === "text" && m.text) ? got : null;
  }, 30_000);
  things.message = messages.find((m) => m.role === "user")?.id ?? messages[0]!.id;
  const task = await api("POST", `/api/bots/${bot.id}/tasks`, auth, { title: `${label} ${NAME} task` });
  take("task", task.body.task?.id ?? task.body.task?.threadId, task);
  const memory = await api("PUT", `/api/bots/${bot.id}/memory/file`, auth, { path: "memory/matrix.md", text: `- ${marker}\n` });
  if (memory.status >= 300) missing.push(`memory: ${memory.status} ${memory.text.slice(0, 160)}`);
  const room = await api("POST", "/api/groups", auth, { name: `${label} ${NAME} room`, memberIds: [bot.id], humanIds: [principal], setup: { bulletin: marker, defaultResponder: { kind: "member", botId: bot.id } } });
  take("group", room.body.group?.id, room);
  const routine = await api("POST", "/api/routines", auth, { name: `${label} ${NAME} routine`, botId: bot.id, prompt: `Report ${marker}.`, enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
  take("routine", routine.body.routine?.id, routine);
  const credential = await api("POST", "/api/me/credentials", auth, { kind: "login", name: `${label} ${NAME} portal`, username: `${label.toLowerCase()}@example.com`, password: `pw-${marker}`, domains: ["portal.example.com"] });
  take("credential", credential.body.item?.id ?? credential.body.credential?.id, credential);
  const webhook = await api("POST", "/api/webhooks", auth, { name: `${label} ${NAME} hook`, prompt: `Handle ${marker}.`, botId: bot.id, runOn: "maus" });
  take("webhook", webhook.body.webhook?.id ?? webhook.body.id, webhook);
  const rule = await api("POST", "/api/custom-rules", auth, { when: `anything about ${marker}`, behavior: "allow", botId: bot.id, riskScope: [] });
  take("customRule", rule.body.rule?.id, rule);
  const set = await api("POST", `/api/bots/${bot.id}/rules/sets`, auth, { name: `${label} rules`, text: `Never mention ${marker}.` });
  take("ruleSet", set.body.set?.id ?? set.body.ruleSet?.id ?? set.body.id, set);
  const call = await api("POST", "/api/calendar-calls", auth, { name: `${label} ${NAME} call`, description: `About ${marker}.`, botIds: [bot.id], schedule: { type: "once", at: Date.now() + 86_400_000 }, durationMinutes: 30 });
  take("calendarCall", call.body.call?.id, call);
  const search = await api("PUT", "/api/me/web-search", auth, { provider: "brave", key: `brave-${marker}` });
  if (search.status >= 300) missing.push(`web search key: ${search.status} ${search.text.slice(0, 160)}`);
  return { things, missing };
}

/** A body a probe sends, aimed at the target's things where one matters.
 * Default: an empty object (an empty write must be refused before it is
 * read, the same as a full one). */
type BodyFor = (actor: Things, target: Things) => unknown;
const BODIES: Record<string, BodyFor> = {
  "PUT /api/bots/{bot}/grants": (actor) => ({ target: `user:${actor.principal}`, level: "manage" }),
  "POST /api/bots/{bot}/direct-grants": (actor) => ({ principalId: actor.principal, target: `user:${actor.principal}` }),
  "PATCH /api/bots/{bot}": () => ({ name: "renamed by someone else" }),
  "PATCH /api/bots/{bot}/profile": () => ({ name: "renamed by someone else" }),
  "PUT /api/bots/{bot}/memory": () => ({ text: "overwritten" }),
  "PUT /api/bots/{bot}/memory/file": () => ({ path: "memory/matrix.md", text: "overwritten" }),
  "PUT /api/bots/{bot}/workspace/file": () => ({ path: "notes.md", text: "overwritten" }),
  "POST /api/bots/{bot}/messages": () => ({ text: "hello" }),
  "POST /api/groups/{group}/messages": () => ({ text: "hello" }),
  "PATCH /api/groups/{group}": (actor) => ({ name: "renamed by someone else", humanIds: [actor.principal] }),
  "PUT /api/groups/{group}/memory": () => ({ text: "overwritten" }),
  "PATCH /api/routines/{routine}": () => ({ name: "renamed by someone else", enabled: true }),
  "PATCH /api/webhooks/{webhook}": () => ({ name: "renamed by someone else" }),
  "PATCH /api/me/credentials/{credential}": () => ({ name: "renamed by someone else" }),
  "POST /api/me/credentials/{credential}/grants": (actor) => ({ botId: actor.bot, mode: "always" }),
  "POST /api/me/credentials/{credential}/notes": () => ({ notes: "overwritten" }),
  "PATCH /api/custom-rules/{customRule}": () => ({ when: "renamed by someone else" }),
  "PUT /api/bots/{bot}/rules/sets/{ruleSet}/text": () => ({ text: "overwritten" }),
  "PATCH /api/bots/{bot}/rules/sets/{ruleSet}": () => ({ name: "renamed by someone else" }),
  "PUT /api/bot-catalog/{bot}/listing": () => ({ listed: true, published: true }),
  "PUT /api/people/pr_{person}/label": () => ({ label: "set by someone else" }),
  "PATCH /api/bots/{bot}/runtime-settings": () => ({ maxTurns: 3 }),
  "PUT /api/groups/{group}/bot-payer": (actor) => ({ principalId: actor.principal }),
  "POST /api/bots/{bot}/tasks": () => ({ title: "task" }),
  "POST /api/groups/{group}/tasks": () => ({ title: "task" }),
  "PUT /api/bots/{bot}/perspicax": () => ({ enabled: true }),
  "PUT /api/bots/{bot}/inbound-mail": () => ({ localPart: "someone-else" }),
  "PUT /api/bots/{bot}/reach-me": () => ({ channels: [] }),
  "POST /api/me/credentials/{credential}/reveal": () => ({ field: "password" }),
  "POST /api/terminal/sessions/{terminalSession}/bot-input": () => ({ allowed: true }),
  // aimed at B's things through the body only
  "POST /api/routines": (_actor, target) => ({ name: "on someone else's bot", botId: target.bot, prompt: "Report.", enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } }),
  "POST /api/groups": (actor, target) => ({ name: "with someone else's bot", memberIds: [target.bot], humanIds: [actor.principal] }),
  "POST /api/webhooks": (_actor, target) => ({ name: "on someone else's bot", prompt: "x", botId: target.bot, runOn: "maus" }),
  "POST /api/custom-rules": (_actor, target) => ({ when: "anything", behavior: "allow", botId: target.bot, riskScope: [] }),
  "POST /api/calendar-calls": (_actor, target) => ({ name: "with someone else's bot", botIds: [target.bot], schedule: { type: "once", at: Date.now() + 86_400_000 } }),
  "PATCH /api/calendar-calls/{calendarCall}": () => ({ name: "renamed by someone else" }),
};

/** Body-only probes that must be refused when aimed at B's things. */
const BODY_AIMED = new Set(["POST /api/routines", "POST /api/groups", "POST /api/webhooks", "POST /api/custom-rules", "POST /api/calendar-calls"]);

/** A foreign probe answered neither 403 nor 404, and why that answer is expected.
 * Keyed `METHOD template`. Kept short: each line is a decision. */
const FOREIGN_OTHER: Record<string, { statuses: number[]; why: string }> = {
  "GET /api/people/{person}/avatar": { statuses: [200, 204], why: "a colleague's photo is public inside the organization" },
  "GET /api/bot-catalog/{bot}": { statuses: [200], why: "Browse Bots answers for any id; checked for B's private marker like every answer" },
};

/** Writes a person with `use` makes on a shared bot (authz.ts: see it, open
 * its conversations, write to it), and their own choices about it. Any other
 * write must be refused. */
const USE_WRITES = new Set([
  // the person's own channels and model choice for a bot they do not own
  "PUT /api/me/bot-overrides/{bot}",
  "PUT /api/bots/{bot}/reach-me",
  "POST /api/bots/{bot}/reach-me/telegram",
  "DELETE /api/bots/{bot}/reach-me/telegram",
  "POST /api/bots/{bot}/reach-me/whatsapp",
  "PUT /api/bots/{bot}/reach-me/whatsapp",
  "DELETE /api/bots/{bot}/reach-me/whatsapp",
  "POST /api/bots/{bot}/reach-me/whatsapp/link",
  // a copy of a bot shared with them: soul, skills, settings; never its
  // threads, memory, grants or routines (routes/bot-catalog.ts)
  "POST /api/bot-catalog/{bot}/import",
  "POST /api/bots/{bot}/messages",
  "POST /api/bots/{bot}/messages/{message}/edit",
  "POST /api/bots/{bot}/read",
  "POST /api/bots/{bot}/warm",
  // splits text into speakable sentences for a voice turn; stores nothing
  "POST /api/bots/{bot}/voice/prepare",
  "POST /api/bots/{bot}/interrupt",
  "POST /api/bots/{bot}/tasks",
  "POST /api/bots/{bot}/respond",
  "POST /api/threads/{thread}/read",
  "POST /api/threads/{thread}/respond",
]);

/** An own-thing probe may still answer 403 for a reason that is not "ask an
 * admin": a fresh sign-in, a security key. Keyed by the answer's code. */
const OWN_403_CODES = new Set([
  "reauth_required", "recent_sign_in_required", "security_key_required",
  // phone tools answer the person's paired phone only; the fixture has none
  "phone_required",
  // voice needs the person's own xAI key; the fixture has none
  "voice_no_access",
  // plugins install on the shared server for everyone: an organization setting
  "plugins_install_owner_only",
  // this server signs people in with Perspicax: no invitations at all
  "identity_perspicax",
  // the owner sets a bot's own model and notifications on the bot itself; an
  // override is for a bot shared with the person (shared/viewer-bot-overrides.ts)
  "owner_bot_settings",
]);
/** Own probes whose 401 is a provider's answer to an empty key, not Sagax's. */
const OWN_PROVIDER_401 = /^POST \/api\/me\/cloud-agent-providers\/\w+\/test$/;
/** Own probes not sent: they end A's account or session, which the matrix needs. */
const OWN_SKIP = new Set(["DELETE /api/me", "POST /api/auth/logout"]);

const key = (shape: RouteShape) => `${shape.method} ${shape.template}`;
const ownsSomething = (shape: RouteShape) => shape.pieces.some((p) => "slot" in p && OWNED_KINDS.has(p.slot.kind));
const fillFrom = (things: Things) => (slot: Slot) => {
  const value = slot.kind === "person" ? things.principal : things[slot.kind];
  if (value === undefined) return undefined;
  // the literal before the slot may end with the start of the id (`user:pr_` and `pr_<uuid>`)
  for (let cut = slot.prefix.length; cut > 0; cut--) {
    if (value.startsWith(slot.prefix.slice(-cut))) return value.slice(cut);
  }
  return value;
};
/** Whether every owned id in this shape is a real thing of `things`. */
const allReal = (shape: RouteShape, things: Things) => shape.pieces.every((p) => !("slot" in p) || !OWNED_KINDS.has(p.slot.kind) || (p.slot.kind === "person" ? true : things[p.slot.kind] !== undefined));

interface Row { phase: string; method: string; template: string; path: string; status: number; code?: string; note?: string }

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
      SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key-matrix",
      SAGAX_ORG_NAME: "Matrix Org",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 30_000;
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

/** B's things as B reads them, without what moves on its own. */
async function snapshot(b: Person): Promise<Record<string, unknown>> {
  const VOLATILE = /(^at$|At$|^ts$|updated|lastRun|nextRun|seen|unread|running|presence|status|activity|busy|lease|warm|cursor|version|etag|hash)/i;
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !VOLATILE.test(k)).map(([k, v]) => [k, clean(v)]));
    }
    return value;
  };
  const t = b.things;
  const reads: Record<string, [string, string, unknown?]> = {
    grants: ["GET", `/api/bots/${t.bot}/grants`],
    memory: ["GET", `/api/bots/${t.bot}/memory/file?path=${encodeURIComponent("memory/matrix.md")}`],
    rules: ["GET", `/api/bots/${t.bot}/rules`],
    routines: ["GET", "/api/routines"],
    groups: ["GET", "/api/groups"],
    webhooks: ["GET", "/api/webhooks"],
    customRules: ["GET", "/api/custom-rules"],
    credentials: ["POST", "/api/me/credentials/list", {}],
    webSearch: ["GET", "/api/me/web-search"],
    runtime: ["GET", `/api/bots/${t.bot}/runtime-settings`],
    toolGrants: ["GET", `/api/bots/${t.bot}/tool-grants`],
  };
  const out: Record<string, unknown> = {};
  for (const [name, [method, path, body]] of Object.entries(reads)) {
    const got = await api(method, path, b.auth, body);
    out[name] = { status: got.status, body: clean(got.body) };
  }
  const bots = (await api("GET", "/api/bots", b.auth)).body.bots as Array<Record<string, unknown>>;
  const mine = bots.find((x) => x.id === t.bot) ?? {};
  out.bot = clean({ name: mine.name, description: mine.description, approvalMode: mine.approvalMode, modelSelection: mine.modelSelection, ownerPrincipalId: mine.ownerPrincipalId });
  const messages = (await api("GET", `/api/threads/${t.thread}/messages`, b.auth)).body.messages as Array<{ id: string; role: string; text?: string }>;
  out.thread = messages.map((m) => [m.id, m.role, m.text]);
  return out;
}

posixOnly("authorization matrix: person and person, member and admin (2026-10-27)", () => {
  const rows: Row[] = [];
  let a: Person;
  let b: Person;
  let admin: Auth;
  let shared: Things;
  let missingA: string[] = [];
  let missingB: string[] = [];
  const shapes = memberRouteShapes(FEATURES);

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ADMIN });
    idp.directoryPeople = [ADMIN, PERSON_A, PERSON_B].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "sagax-authz-matrix-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    await start();
    admin = await signIn(ADMIN);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", admin)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    const id = (login: string) => people.find((p) => p.login === login)!.principalId;
    const authA = await signIn(PERSON_A);
    const authB = await signIn(PERSON_B);
    const furnishedB = await furnish(authB, id("bea"), "Bea", PRIVATE_MARK);
    const furnishedA = await furnish(authA, id("ari"), "Ari", "zqowna0000");
    a = { auth: authA, things: furnishedA.things };
    b = { auth: authB, things: furnishedB.things };
    missingA = furnishedA.missing;
    missingB = furnishedB.missing;
    // B's second bot, shared with A at use
    const s = await createBot(authB, "Bea shared bot");
    const granted = await api("PUT", `/api/bots/${s.id}/grants`, authB, { target: `user:${a.things.principal}`, level: "use" });
    expect(granted.status, granted.text).toBe(200);
    shared = { ...b.things, bot: s.id, thread: s.threadId };
  }, 180_000);

  afterAll(async () => {
    if (process.env.AUTHZ_MATRIX_OUT) writeFileSync(process.env.AUTHZ_MATRIX_OUT, JSON.stringify({ missingA, missingB, behindFeatures: rowsBehindFeatures(FEATURES), rows }, null, 1));
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("the fixture owns a real thing of every kind it aims at", () => {
    // what could not be created stays a fake id; listed so a regression in
    // the fixture never quietly turns real probes into fake ones
    expect(missingB).toEqual([]);
  });

  it("privacy: no read A may make, and no search, carries B's private marker", async () => {
    const failures: string[] = [];
    const reads = shapes.filter((shape) => shape.method === "GET" && !ownsSomething(shape)).map((shape) => fillShape(shape, fillFrom(a.things)));
    for (const q of [PRIVATE_MARK, NAME]) reads.push(`/api/search?q=${q}`);
    reads.push("/api/bots?messages=1");
    for (const path of reads) {
      const got = await api("GET", path, a.auth);
      rows.push({ phase: "privacy", method: "GET", template: path, path, status: got.status, code: got.body?.code });
      if (got.text.includes(PRIVATE_MARK)) failures.push(`GET ${path}: ${got.status} carries B's private marker`);
    }
    expect(failures).toEqual([]);
  }, 300_000);

  it("foreign: A is refused every route on B's things, and no answer carries B's private marker", async () => {
    const before = await snapshot(b);
    const stream = await openStream(a.auth);
    const failures: string[] = [];
    for (const shape of shapes) {
      const k = key(shape);
      const aimed = ownsSomething(shape) || BODY_AIMED.has(k);
      if (!aimed) continue;
      if (OWN_SKIP.has(k)) continue;
      const path = fillShape(shape, fillFrom(b.things));
      const body = shape.method === "GET" ? undefined : (BODIES[k]?.(a.things, b.things) ?? {});
      const got = await api(shape.method, path, a.auth, body);
      rows.push({ phase: "foreign", method: shape.method, template: shape.template, path, status: got.status, code: got.body?.code });
      if (got.text.includes(PRIVATE_MARK)) failures.push(`${k}: answer carries B's private marker (${got.status})`);
      if (got.status === 403 || got.status === 404) continue;
      // aimed at B through the body only: any refusal (a 400 that names the bot) holds
      if (BODY_AIMED.has(k) && !ownsSomething(shape) && got.status >= 400 && got.status < 500) continue;
      // B owns no such thing in the fixture (a fake id): a 4xx reaches nothing of B's
      if (!allReal(shape, b.things) && got.status >= 400 && got.status < 500) continue;
      // under /api/me the handler reads the session's own person: a fake id names A's own (absent) thing
      if (!allReal(shape, b.things) && shape.template.startsWith("/api/me/")) continue;
      const other = FOREIGN_OTHER[k];
      if (other?.statuses.includes(got.status)) continue;
      failures.push(`${k}: ${got.status} ${got.text.slice(0, 200)}`);
    }
    await sleep(500);
    stream.close();
    for (const frame of stream.text().split("\n\n").filter((f) => f.includes(PRIVATE_MARK))) failures.push(`A's live stream carried B's private marker: ${frame.slice(0, 600)}`);
    expect(failures).toEqual([]);
    expect(await snapshot(b)).toEqual(before);
  }, 600_000);

  it("shared at use: A writes to the bot and reads it, nothing more", async () => {
    const failures: string[] = [];
    for (const shape of shapes) {
      const kinds = shape.pieces.flatMap((p) => ("slot" in p ? [p.slot.kind] : []));
      if (!kinds.includes("bot") && !kinds.includes("thread")) continue;
      const k = key(shape);
      if (shape.method === "GET") continue;
      const path = fillShape(shape, fillFrom(shared));
      const body = BODIES[k]?.(a.things, shared) ?? {};
      const got = await api(shape.method, path, a.auth, body);
      rows.push({ phase: "shared-use", method: shape.method, template: shape.template, path, status: got.status, code: got.body?.code });
      if (USE_WRITES.has(k)) continue;
      if (got.status >= 200 && got.status < 300) failures.push(`${k}: ${got.status} at use ${got.text.slice(0, 200)}`);
    }
    expect(failures).toEqual([]);
  }, 600_000);

  it("webhooks: aimed only at one's own bots or a bot shared at run, never moved to another's", async () => {
    const mine = await api("POST", "/api/webhooks", a.auth, { name: "Ari hook", prompt: "x", botId: a.things.bot, runOn: "maus" });
    expect(mine.status, mine.text).toBe(201);
    const hookId = mine.body.webhook.id as string;
    // never moved to B's bot, nor to the bot B shares at use only
    for (const botId of [b.things.bot, shared.bot]) {
      const moved = await api("PATCH", `/api/webhooks/${hookId}`, a.auth, { botId });
      expect(moved.status, moved.text).toBe(404);
    }
    expect((await api("POST", "/api/webhooks", a.auth, { name: "on a shared bot", prompt: "x", botId: shared.bot, runOn: "maus" })).status).toBe(404);
    // at run, A aims one at the shared bot; B sees it, as the bot's owner
    expect((await api("PUT", `/api/bots/${shared.bot}/grants`, b.auth, { target: `user:${a.things.principal}`, level: "run" })).status).toBe(200);
    const atRun = await api("POST", "/api/webhooks", a.auth, { name: "Ari on shared", prompt: "x", botId: shared.bot, runOn: "maus" });
    expect(atRun.status, atRun.text).toBe(201);
    expect(((await api("GET", "/api/webhooks", b.auth)).body.webhooks as Array<{ id: string }>).map((w) => w.id)).toContain(atRun.body.webhook.id);
    expect((await api("DELETE", `/api/webhooks/${atRun.body.webhook.id}`, a.auth)).status).toBe(200);
    expect((await api("PUT", `/api/bots/${shared.bot}/grants`, b.auth, { target: `user:${a.things.principal}`, level: "use" })).status).toBe(200);
    // her own, she manages to the end without an admin
    expect((await api("DELETE", `/api/webhooks/${hookId}`, a.auth)).status).toBe(200);
  }, 120_000);

  it("admin: an organization admin opens none of B's conversations, memory or vault", async () => {
    const failures: string[] = [];
    for (const shape of shapes) {
      if (shape.method !== "GET" || !ownsSomething(shape)) continue;
      const path = fillShape(shape, fillFrom(b.things));
      const got = await api("GET", path, admin);
      rows.push({ phase: "admin", method: "GET", template: shape.template, path, status: got.status, code: got.body?.code });
      if (got.text.includes(PRIVATE_MARK)) failures.push(`${key(shape)}: ${got.status} carries B's private marker`);
    }
    expect(failures).toEqual([]);
  }, 600_000);

  it("own: A does everything on her own things without an admin", async () => {
    const failures: string[] = [];
    // reads, then writes, then deletions; whole things (a bot, a room, a
    // routine) are deleted last so the probes before them still find them
    const rank = (shape: RouteShape) => {
      if (shape.method === "GET") return 0;
      if (shape.method !== "DELETE") return 1;
      if (shape.template === "/api/bots/{bot}") return 4;
      return /^\/api\/(groups|routines|webhooks|custom-rules|me\/credentials)\/\{[a-zA-Z]+\}$/.test(shape.template) ? 3 : 2;
    };
    const ordered = [...shapes].sort((x, y) => rank(x) - rank(y));
    for (const shape of ordered) {
      const k = key(shape);
      if (OWN_SKIP.has(k)) continue;
      const path = fillShape(shape, fillFrom(a.things));
      const body = shape.method === "GET" ? undefined : (BODIES[k]?.(a.things, a.things) ?? {});
      const got = await api(shape.method, path, a.auth, body);
      rows.push({ phase: "own", method: shape.method, template: shape.template, path, status: got.status, code: got.body?.code, note: got.status === 403 ? got.text.slice(0, 200) : undefined });
      if (got.text.includes(PRIVATE_MARK)) failures.push(`${k}: A's own answer carries B's private marker`);
      // a fake id is no thing of A's: its refusal says nothing about autonomy
      const real = allReal(shape, a.things);
      if (real && got.status === 403 && !OWN_403_CODES.has(got.body?.code)) failures.push(`${k}: 403 on A's own thing ${got.text.slice(0, 200)}`);
      if (real && got.status === 401 && !OWN_PROVIDER_401.test(k)) failures.push(`${k}: 401 on A's own thing`);
    }
    expect(failures).toEqual([]);
  }, 900_000);
});
