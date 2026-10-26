// The bot package (server/bot-zip.ts): export then import gives the same
// bot, a member's import drops host settings, a crafted zip is refused, an
// older package still imports, and nothing secret leaves.
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { Store, type BotRecord } from "./store.ts";
import { RoutineManager } from "./routines.ts";
import { botPluginsWithMarketplaces } from "./testing/plugin-stores.ts";
import { BOT_FIELD_POLICY, BotZipError, importBotZip, inspectBotZip, planBotZip, previewBotZip, writeBotZip, type BotZipHost } from "./bot-zip.ts";
import { installSkill, listSkills, setSkillEnabled } from "./skills.ts";
import { appendMemoryArchive, readMemoryFile, readMemoryLog, readMemoryTopic, workspaceDir, writeMemoryFile, writeMemoryLog, writeMemoryTopic } from "./workspace.ts";
import { readAttachment, saveImage } from "./attachments.ts";
import { botAvatarUrlFromStoredPath } from "../shared/bot-avatar.ts";
import { botFolder } from "./bot-folder.ts";
import { ZipWriter } from "./zip.ts";
import type { WebhookTrigger } from "./webhooks.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const selection = () => ({ instanceId: "fixture", model: "fixture-model" });
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-bot-zip-"));
  dirs.push(dir);
  return dir;
};

function fakeWebhooks() {
  const hooks: WebhookTrigger[] = [];
  return {
    hooks,
    list: () => hooks,
    create: (input: Record<string, unknown>) => {
      const webhook = { id: `wh-${hooks.length + 1}`, endpointId: "e", deliveryCount: 0, createdAt: 1, updatedAt: 1, runOn: "maus", ...input } as unknown as WebhookTrigger;
      hooks.push(webhook);
      return { webhook };
    },
    remove: (id: string) => {
      const index = hooks.findIndex((hook) => hook.id === id);
      if (index >= 0) hooks.splice(index, 1);
      return index >= 0;
    },
  };
}

function fixture(options: { organization?: boolean } = {}) {
  const store = new Store(selection);
  const routines = new RoutineManager({
    botState: (id) => store.bot(id) ? "ready" : "missing",
    goalState: () => "missing",
    createTask: (id, title) => store.createTask(id, title),
    startTurn: async () => { throw new Error("Import must never run a bot"); },
  });
  const plugins = botPluginsWithMarketplaces({ dataDir: DATA_DIR, gitEnvironment: () => ({}), policy: () => undefined });
  const webhooks = fakeWebhooks();
  const people = new Map([["pr_00000000-0000-4000-8000-000000000001", "ana@example.com"], ["pr_00000000-0000-4000-8000-000000000002", "bob@example.com"]]);
  const host: BotZipHost = {
    store, dataDir: DATA_DIR, appVersion: "0.4.15-test", organization: options.organization ?? false,
    routines: () => routines,
    webhooks: () => webhooks,
    plugins,
    marketplaceTokenSources: () => new Set(["acme/private-tools"]),
    emailOf: (id) => people.get(id),
    principalByEmail: (email) => [...people].find(([, value]) => value === email)?.[0],
    mcpServer: (name) => name === "docs" ? { transport: "http", url: "https://mcp.example.com/docs", valueNames: ["Authorization"] } : undefined,
    engineUsable: (value) => value.instanceId === "fixture",
    defaultSelection: selection,
    sectionExists: (name) => store.sections.includes(name),
  };
  return { store, routines, plugins, webhooks, host };
}

function richBot(fx: ReturnType<typeof fixture>) {
  const { store, routines, plugins, webhooks } = fx;
  const bot = store.createBot({ name: "Atlas", title: "Sales", description: "Prepares the weekly digest.", soul: "Cite sources.\nNever share sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789.", color: "purple", mascotBody: "circle" }, { seedMessages: false });
  const avatar = botAvatarUrlFromStoredPath(saveImage(PNG, "image/png").path)!;
  store.patchBot(bot.id, {
    avatarUrl: avatar, avatarCrop: "circle", mascotLook: { character: "owl" } as BotRecord["mascotLook"],
    modelSelection: { instanceId: "fixture", model: "fixture-model", effort: "high" }, approvalMode: "auto", autoApprove: true,
    alwaysAllow: ["Bash"], computer: "local", browser: true, cwd: tmpdir(), mcpServers: ["docs"], speakReplies: true, voice: "alloy", voiceNotes: false,
    memoryUpkeep: false, notifications: false,
    playbooks: [{ key: "digest", name: "Digest", summary: "Weekly digest", triggers: ["digest"], instructions: "Summarize." }],
    projects: [{ id: "p1", name: "Q4" }],
  });
  writeMemoryFile(bot.id, "# Memory\n\n- Ana prefers short answers.\n");
  writeMemoryTopic(bot.id, "clients.md", "# Clients\n\nAcme renews in March.\n");
  writeMemoryLog(bot.id, "2026-10-01.md", "Talked about the digest.\n");
  appendMemoryArchive(bot.id, ["- An older note."]);
  mkdirSync(join(workspaceDir(bot.id), "docs"), { recursive: true });
  writeFileSync(join(workspaceDir(bot.id), "docs", "guide.md"), "# Guide\n");
  writeFileSync(join(workspaceDir(bot.id), "RULES.md"), "Be brief.\n");
  writeFileSync(join(botFolder(bot.id), "notes.txt"), "folder note\n");
  const skill = installSkill(bot.id, "github.com/acme/skills/digest", [{ path: "SKILL.md", content: "---\nname: digest\ndescription: Weekly digest\n---\n\nWrite the digest.\n" }]);
  if ("error" in skill) throw new Error(skill.error);
  setSkillEnabled(bot.id, "digest", true);
  installSkill(bot.id, "github.com/acme/skills/off", [{ path: "SKILL.md", content: "---\nname: off\ndescription: Not on\n---\n\nOff.\n" }]);
  // a marketplace and one installed plugin, as BotPlugins leaves them
  const root = plugins.folder(bot.id);
  mkdirSync(join(root, "marketplaces", "acme", ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, "marketplaces", "acme", ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "acme", plugins: [{ name: "reviewer", source: "./plugins/reviewer" }] }));
  mkdirSync(join(root, "plugins", "acme", "reviewer", "skills", "review"), { recursive: true });
  writeFileSync(join(root, "plugins", "acme", "reviewer", "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review code\n---\nReview.\n");
  mkdirSync(join(root, "plugins", "acme", "reviewer", "agents"), { recursive: true });
  writeFileSync(join(root, "plugins", "acme", "reviewer", "agents", "critic.md"), "---\nname: critic\ndescription: A critic\n---\nCriticize.\n");
  plugins.restoreState(bot.id, {
    version: 1,
    marketplaces: { acme: { source: "acme/private-tools", url: "https://github.com/acme/private-tools.git", addedAt: 1, updatedAt: 2 } },
    plugins: { "reviewer@acme": { name: "reviewer", marketplace: "acme", enabled: true, installedAt: 1, updatedAt: 2, removed: ["hooks"], declaredMcpServers: [] } },
  });
  routines.create({ name: "Daily", prompt: "Report with token=abcdef1234567890", botId: bot.id, enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
  webhooks.create({ name: "CI", prompt: "Summarize the build", botId: bot.id, enabled: true, eventTypes: ["push"] });
  const image = saveImage(PNG, "image/png");
  const first = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "Hello", at: 100, attachments: [{ kind: "image", path: image.path, mime: "image/png" }] });
  store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "Hi Ana", at: 101, parentId: first.id });
  store.appendMessage(bot.threadId, { role: "bot", kind: "options", at: 102, card: { title: "Allow Bash?", subtitle: "rm -rf build", options: ["Allow"], requestId: "live-request", allowKey: "Bash" } });
  store.renameTask(bot.id, bot.threadId, "First");
  const second = store.createTask(bot.id, "Second", false, "p1")!;
  store.appendMessage(second.threadId, { role: "user", kind: "text", text: "Later", at: 200 });
  mkdirSync(join(DATA_DIR, "task-workspaces", bot.id, second.threadId), { recursive: true });
  writeFileSync(join(DATA_DIR, "task-workspaces", bot.id, second.threadId, "draft.md"), "draft\n");
  store.setBotGrants(bot.id, [{ target: "user:pr_00000000-0000-4000-8000-000000000002", level: "use", by: "x", at: 1 }]);
  return store.bot(bot.id)!;
}

async function exportToFile(host: BotZipHost, botId: string, options = { conversations: true, sharing: true }): Promise<string> {
  const chunks: Buffer[] = [];
  await writeBotZip(planBotZip(host, botId, options), (chunk) => { chunks.push(chunk); });
  const file = join(temp(), "atlas.sagaxbot.zip");
  writeFileSync(file, Buffer.concat(chunks));
  return file;
}

/** A bot's portable view: every kept field, the picture's bytes. */
function portable(bot: BotRecord) {
  const out: Record<string, unknown> = {};
  for (const [key, policy] of Object.entries(BOT_FIELD_POLICY)) {
    if (policy === "identity" || policy === "settings" || policy === "host" || policy === "soul") {
      const value = (bot as unknown as Record<string, unknown>)[key];
      if (value !== undefined && key !== "name") out[key] = value;
    }
  }
  out.avatar = bot.avatarUrl ? readAttachment(bot.avatarUrl.split("/").pop()!)?.bytes.toString("hex") : null;
  return out;
}

function files(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
      else out[`${prefix}${name}`] = readFileSync(path, "utf8");
    }
  };
  walk(root, "");
  return out;
}

beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("bot zip round trip", () => {
  it("imports what it exported: the record, the files, skills, plugins, routines, webhooks and conversations", async () => {
    const fx = fixture({ organization: true });
    const source = richBot(fx);
    const file = await exportToFile(fx.host, source.id);
    const inspected = inspectBotZip(file);
    expect(inspected.kind).toBe("zip");
    const preview = await previewBotZip(fx.host, inspected, { asMember: false });
    expect(preview.importName).toBe("Atlas 2");
    expect(preview.hasConversations).toBe(true);
    expect(preview.needsAction.some((entry) => entry.detail.includes("acme/private-tools"))).toBe(true);
    const result = await importBotZip(fx.host, inspected, { ownerPrincipalId: "pr_00000000-0000-4000-8000-000000000001", asMember: false, conversations: true, sharing: true });
    if (inspected.kind === "zip") inspected.reader.close();
    const copy = fx.store.bot(result.botId)!;
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Atlas 2");
    expect(copy.ownerUserId).toBe("pr_00000000-0000-4000-8000-000000000001");

    // the record: every kept field equal, except the soul's redacted key
    const before = portable(source);
    const after = portable(copy);
    expect(after.soul).toContain("«redacted");
    delete before.soul;
    delete after.soul;
    // Workspace is always Auto (JC 2026-10-18): only Off travels, so the
    // source's This computer arrives as Auto.
    expect(before.computer).toBe("local");
    expect(after.computer).toBeUndefined();
    delete before.computer;
    expect(after).toEqual(before);

    // the files of the desk and the bot folder
    expect(files(workspaceDir(copy.id))).toEqual(files(workspaceDir(source.id)));
    expect(files(botFolder(copy.id))["notes.txt"]).toBe("folder note\n");
    expect(readMemoryFile(copy.id).text).toBe(readMemoryFile(source.id).text);
    expect(readMemoryTopic(copy.id, "clients.md")).toBe(readMemoryTopic(source.id, "clients.md"));
    expect(readMemoryLog(copy.id, "2026-10-01.md")).toBe(readMemoryLog(source.id, "2026-10-01.md"));

    // skills with their enabled state
    expect(listSkills(copy.id).map((skill) => [skill.name, skill.enabled])).toEqual([["digest", true], ["off", false]]);
    // plugins and marketplaces
    expect(fx.plugins.listPlugins(copy.id)).toEqual(fx.plugins.listPlugins(source.id));
    expect(fx.plugins.listMarketplaces(copy.id).map((market) => [market.name, market.source, market.plugins.map((plugin) => plugin.name)]))
      .toEqual([["acme", "acme/private-tools", ["reviewer"]]]);
    expect(fx.plugins.pluginDirs(copy.id)).toHaveLength(1);
    // routines and webhooks: on the copy, off, secrets scrubbed
    const routine = fx.routines.listRoutines().find((entry) => entry.botId === copy.id)!;
    expect(routine).toMatchObject({ name: "Daily", enabled: false });
    expect(routine.prompt).not.toContain("abcdef1234567890");
    expect(fx.webhooks.hooks.filter((hook) => hook.botId === copy.id)).toMatchObject([{ name: "CI", enabled: false, eventTypes: ["push"] }]);
    // sharing by email
    expect(copy.grants).toMatchObject([{ target: "user:pr_00000000-0000-4000-8000-000000000002", level: "use" }]);
    // conversations: two threads, the messages, the attachment bytes, a card turned into text
    expect(copy.tasks?.map((task) => task.title).sort()).toEqual(["First", "Second"]);
    const firstThread = copy.tasks!.find((task) => task.title === "First")!.threadId;
    const messages = fx.store.messagesFor(firstThread);
    expect(messages.map((message) => message.text?.split("\n")[0])).toEqual(["Hello", "Hi Ana", "Allow Bash?"]);
    expect(messages[2]).toMatchObject({ kind: "text" });
    expect(messages[2]!.card).toBeUndefined();
    const attachment = messages[0]!.attachments![0]!;
    expect(attachment.path).not.toBe(fx.store.messagesFor(source.threadId)[0]!.attachments![0]!.path);
    expect(readFileSync(attachment.path)).toEqual(PNG);
    const secondThread = copy.tasks!.find((task) => task.title === "Second")!;
    expect(secondThread.projectId).toBe("p1");
    expect(readFileSync(join(DATA_DIR, "task-workspaces", copy.id, secondThread.threadId, "draft.md"), "utf8")).toBe("draft\n");
  });

  it("keeps a typed trigger's provider, events, filters and automation, never a secret", async () => {
    const fx = fixture();
    const source = richBot(fx);
    // Even fields a list never shows are seeded here, to prove the export picks fields.
    fx.webhooks.create({
      name: "Mail", prompt: "Triage", botId: source.id, enabled: true, signingSecret: "whsec_SIGNING_SECRET", secretHash: "f".repeat(64), pendingToken: "whsec_PENDING",
      graphSubscription: { id: "sub-SECRET", clientStateHash: "abc" }, pollerCursor: { scope: "s", lastUid: 9 },
      source: { type: "email", events: ["email.received"], filters: { sender: ["*@partner.example"] }, rateLimitPerMinute: 5,
        poller: { kind: "imap", host: "imap.example.com", mailbox: "INBOX", username: "me@example.com", intervalMinutes: 10 } },
    });
    fx.webhooks.create({ name: "Alerts", prompt: "Look", botId: source.id, enabled: true, source: { type: "pagerduty", events: [], filters: { urgency: ["high"] } } });
    fx.webhooks.create({ name: "Teams", prompt: "Answer", botId: source.id, enabled: true, source: { type: "teams", events: [], filters: {}, tenantId: "t-1", graph: { connector: "ms365", account: "acct-abcdef", resource: "teams/1/channels/2/messages" } } });
    const file = await exportToFile(fx.host, source.id);
    const inspected = inspectBotZip(file);
    if (inspected.kind !== "zip") throw new Error("zip expected");
    const exported = inspected.reader.json("webhooks.json") as Array<Record<string, unknown>>;
    expect(exported.find((hook) => hook.name === "Mail")!.source).toEqual({
      type: "email", events: ["email.received"], filters: { sender: ["*@partner.example"] }, catalog: 1, rateLimitPerMinute: 5,
      poller: { kind: "imap", host: "imap.example.com", mailbox: "INBOX", intervalMinutes: 10 },
    });
    expect(exported.find((hook) => hook.name === "Teams")!.source).toEqual({ type: "teams", events: [], filters: {}, catalog: 1, tenantId: "t-1", graph: { connector: "ms365", resource: "teams/1/channels/2/messages" } });
    const text = JSON.stringify(exported);
    for (const secret of ["whsec_SIGNING_SECRET", "whsec_PENDING", "f".repeat(64), "sub-SECRET", "pollerCursor", "me@example.com", "acct-abcdef"]) expect(text).not.toContain(secret);
    const result = await importBotZip(fx.host, inspected, { ownerPrincipalId: "pr_00000000-0000-4000-8000-000000000001", asMember: false, conversations: false, sharing: false });
    inspected.reader.close();
    const copies = fx.webhooks.hooks.filter((hook) => hook.botId === result.botId);
    expect(copies.find((hook) => hook.name === "Mail")).toMatchObject({ enabled: false, source: { type: "email", poller: { kind: "imap", host: "imap.example.com" } } });
    expect(copies.find((hook) => hook.name === "Alerts")).toMatchObject({ enabled: false, source: { type: "pagerduty", filters: { urgency: ["high"] }, catalog: 1 } });
    expect(JSON.stringify(copies)).not.toContain("whsec_SIGNING_SECRET");
    expect(result.warnings).toEqual(expect.arrayContaining([
      "Trigger Mail needs the user name and password before it is turned on.",
      "Trigger Alerts needs the signing secret from PagerDuty before it is turned on.",
    ]));
  });

  it("classifies every field of the bot record", () => {
    // A new BotRecord field fails to compile in BOT_FIELD_POLICY; this keeps
    // the drop reasons readable.
    for (const policy of Object.values(BOT_FIELD_POLICY)) {
      if (typeof policy === "object") expect(policy.drop.length).toBeGreaterThan(5);
    }
  });

  it("leaves conversations and sharing out unless asked", async () => {
    const fx = fixture();
    const source = richBot(fx);
    const file = await exportToFile(fx.host, source.id, { conversations: false, sharing: false });
    const inspected = inspectBotZip(file);
    if (inspected.kind !== "zip") throw new Error("zip expected");
    expect(inspected.reader.has("conversations/tasks.json")).toBe(false);
    expect(inspected.reader.has("sharing.json")).toBe(false);
    expect(inspected.reader.under("attachments/")).toEqual([]);
    const manifest = inspected.manifest;
    expect(manifest).toMatchObject({ format: "sagax.bot", version: 1, appVersion: "0.4.15-test", bot: { id: source.id, name: "Atlas" } });
    expect(manifest.marketplaces).toEqual([{ name: "acme", source: "acme/private-tools", needsToken: true }]);
    expect(manifest.mcpServers).toEqual([{ name: "docs", transport: "http", url: "https://mcp.example.com/docs", valueNames: ["Authorization"] }]);
    expect(manifest.redacted).toBeGreaterThanOrEqual(2);
    const text = Buffer.concat(inspected.reader.under("").map((name) => inspected.reader.read(name))).toString("utf8");
    expect(text).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(text).not.toContain("abcdef1234567890");
    inspected.reader.close();
  });
});

describe("bot zip: no sign-in or key file (JC 2026-10-18 « Exclure tout »)", () => {
  it("leaves out sign-in files, keys and sealed stores of the desk and the work folders, and keeps a Keynote document", async () => {
    const fx = fixture();
    const source = richBot(fx);
    const desk = workspaceDir(source.id);
    const work = join(DATA_DIR, "task-workspaces", source.id, source.threadId);
    mkdirSync(join(desk, ".ssh"), { recursive: true });
    mkdirSync(work, { recursive: true });
    const marker = "FAKE_SECRET_DO_NOT_USE";
    for (const [dir, name] of [[desk, ".netrc"], [desk, ".git-credentials"], [desk, "server.pem"], [desk, "vault.enc"], [desk, "tls.key"], [desk, ".env"], [join(desk, ".ssh"), "config"],
      [work, "id_ed25519"], [work, ".pypirc"], [work, ".npmrc"]] as const) writeFileSync(join(dir, name), name === ".npmrc" ? `//r.example/:_authToken=${marker}\n` : `${marker} ${name}`);
    writeFileSync(join(desk, ".env.example"), "API_KEY=\n");
    writeFileSync(join(desk, "talk.key"), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("KEYNOTE")]));
    const inspected = inspectBotZip(await exportToFile(fx.host, source.id));
    if (inspected.kind !== "zip") throw new Error("zip expected");
    const names = inspected.reader.under("");
    const text = Buffer.concat(names.map((name) => inspected.reader.read(name))).toString("latin1");
    expect(text.includes(marker)).toBe(false);
    expect(names).toContain("workspace/talk.key");
    expect(names).toContain("workspace/.env.example");
    inspected.reader.close();
  });
});

describe("bot zip: team memory sharing", () => {
  const OWNER = "pr_00000000-0000-4000-8000-000000000001";
  /** Export, then import as an admin or a member; the copy. */
  const roundTrip = async (fx: ReturnType<typeof fixture>, botId: string, asMember: boolean, edit?: (document: any) => void) => {
    const plan = planBotZip(fx.host, botId, { conversations: false, sharing: false });
    const record = plan.files.find((entry) => entry.name === "bot.json")!;
    const document = JSON.parse(String(record.data));
    if (edit) {
      edit(document);
      record.data = `${JSON.stringify(document, null, 2)}\n`;
      record.size = Buffer.byteLength(String(record.data));
    }
    const chunks: Buffer[] = [];
    await writeBotZip(plan, (chunk) => { chunks.push(chunk); });
    const file = join(temp(), "copy.sagaxbot.zip");
    writeFileSync(file, Buffer.concat(chunks));
    const inspected = inspectBotZip(file);
    try {
      const result = await importBotZip(fx.host, inspected, { ownerPrincipalId: OWNER, asMember, conversations: false, sharing: false });
      return { exported: document.settings as Record<string, unknown>, copy: fx.store.bot(result.botId)! };
    } finally {
      if (inspected.kind === "zip") inspected.reader.close();
    }
  };

  it("an invalid stored value exports as private, and import and duplication succeed", async () => {
    const fx = fixture({ organization: true });
    const source = fx.store.createBot({ name: "Corrupt" }, { seedMessages: false });
    // a hand edit or a future option: never written by the API
    fx.store.patchBot(source.id, { teamMemorySharing: "everyone" } as unknown as Partial<BotRecord>);
    for (const asMember of [false, true]) {
      const { exported, copy } = await roundTrip(fx, source.id, asMember);
      expect(exported.teamMemorySharing, `exported, asMember ${asMember}`).toBe("private");
      expect(copy.teamMemorySharing, `imported, asMember ${asMember}`).toBe("private");
      // a duplicate of the copy: export and import again
      const again = await roundTrip(fx, copy.id, asMember);
      expect(again.copy.teamMemorySharing, `duplicated, asMember ${asMember}`).toBe("private");
    }
  });

  it("shared and absent leave no field; private stays private", async () => {
    const fx = fixture();
    const absent = fx.store.createBot({ name: "Absent" }, { seedMessages: false });
    const shared = fx.store.createBot({ name: "Shared" }, { seedMessages: false });
    fx.store.patchBot(shared.id, { teamMemorySharing: "shared" });
    const kept = fx.store.createBot({ name: "Kept" }, { seedMessages: false });
    fx.store.patchBot(kept.id, { teamMemorySharing: "private" });
    for (const bot of [absent, shared]) {
      const { exported, copy } = await roundTrip(fx, bot.id, false);
      expect("teamMemorySharing" in exported, bot.name).toBe(false);
      expect(copy.teamMemorySharing, bot.name).toBeUndefined();
    }
    const { exported, copy } = await roundTrip(fx, kept.id, true);
    expect(exported.teamMemorySharing).toBe("private");
    expect(copy.teamMemorySharing).toBe("private");
  });

  it("an archive that carries an unknown value still imports, as private", async () => {
    const fx = fixture();
    const source = fx.store.createBot({ name: "Older archive" }, { seedMessages: false });
    for (const value of ["everyone", "", 7]) {
      const { copy } = await roundTrip(fx, source.id, false, (document) => { document.settings = { ...document.settings, teamMemorySharing: value }; });
      expect(copy.teamMemorySharing, JSON.stringify(value)).toBe("private");
    }
    const { copy } = await roundTrip(fx, source.id, false, (document) => { document.settings = { ...document.settings, teamMemorySharing: "shared" }; });
    expect(copy.teamMemorySharing).toBeUndefined();
  });
});

describe("bot zip import rules", () => {
  it("a member's copy drops computer, browser and host tools, and Full access arrives as Ask", async () => {
    const fx = fixture({ organization: true });
    const source = richBot(fx);
    fx.store.patchBot(source.id, { approvalMode: "full" });
    const file = await exportToFile(fx.host, source.id);
    const inspected = inspectBotZip(file);
    const preview = await previewBotZip(fx.host, inspected, { asMember: true });
    expect(preview.skipped.some((entry) => entry.part === "host")).toBe(true);
    expect(preview.skipped.some((entry) => entry.part === "approval")).toBe(true);
    const member = await importBotZip(fx.host, inspected, { ownerPrincipalId: "pr_00000000-0000-4000-8000-000000000002", asMember: true, conversations: false, sharing: false });
    const copy = fx.store.bot(member.botId)!;
    expect(copy).toMatchObject({ computer: "off", browser: false, mcpServers: [] });
    expect(copy.cwd).toBeUndefined();
    expect(copy.alwaysAllow).toBeUndefined();
    expect(copy.approvalMode).toBe("ask");
    expect(copy.tasks).toHaveLength(1);
    const admin = await importBotZip(fx.host, inspected, { ownerPrincipalId: "pr_00000000-0000-4000-8000-000000000001", asMember: false, conversations: false, sharing: false });
    // Workspace is always Auto (JC 2026-10-18): a place does not travel.
    expect(fx.store.bot(admin.botId)).toMatchObject({ browser: true, mcpServers: ["docs"], alwaysAllow: ["Bash"], approvalMode: "ask" });
    expect(fx.store.bot(admin.botId)!.computer).toBeUndefined();
    expect(fx.store.bot(admin.botId)!.name).toBe("Atlas 3");
    if (inspected.kind === "zip") inspected.reader.close();
  });

  it("a Mastery look the importer has not unlocked stays the default", async () => {
    const fx = fixture();
    const source = richBot(fx);
    const file = await exportToFile(fx.host, source.id);
    const inspected = inspectBotZip(file);
    const host = { ...fx.host, lookRefusal: () => "This look is locked until the achievement \"Ten Hands\" is unlocked." };
    const result = await importBotZip(host, inspected, { ownerPrincipalId: "pr_00000000-0000-4000-8000-000000000001", asMember: false, conversations: false, sharing: false });
    expect(fx.store.bot(result.botId)!.mascotLook).toBeUndefined();
    expect(result.warnings.some((warning) => warning.includes("Ten Hands"))).toBe(true);
    if (inspected.kind === "zip") inspected.reader.close();
  });

  it("an unknown engine falls back to the default model", async () => {
    const fx = fixture();
    const source = richBot(fx);
    const file = await exportToFile(fx.host, source.id);
    const inspected = inspectBotZip(file);
    const host = { ...fx.host, engineUsable: () => false, defaultSelection: () => ({ instanceId: "other", model: "m" }) };
    const result = await importBotZip(host, inspected, { ownerPrincipalId: undefined, asMember: false, conversations: false, sharing: false });
    expect(fx.store.bot(result.botId)!.modelSelection).toMatchObject({ instanceId: "other", model: "m" });
    expect(result.warnings.some((warning) => warning.includes("fixture"))).toBe(true);
    if (inspected.kind === "zip") inspected.reader.close();
  });
});

async function crafted(entries: Array<{ name: string; data: Buffer | string; raw?: boolean }>): Promise<string> {
  const chunks: Buffer[] = [];
  const zip = new ZipWriter((chunk) => { chunks.push(chunk); });
  for (const entry of entries) await zip.add(entry.name, entry.data);
  await zip.finish();
  const file = join(temp(), "crafted.zip");
  writeFileSync(file, Buffer.concat(chunks));
  return file;
}

/** A zip written by hand, so a hostile name can be put in it. */
function handZip(name: string, data: Buffer, options: { declared?: number; symlink?: boolean } = {}): string {
  const body = deflateRawSync(data);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(options.declared ?? data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(options.declared ?? data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(((options.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38); central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  const centralStart = 30 + nameBytes.length + body.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nameBytes.length, 12); end.writeUInt32LE(centralStart, 16);
  const file = join(temp(), "hand.zip");
  writeFileSync(file, Buffer.concat([local, nameBytes, body, central, nameBytes, end]));
  return file;
}

describe("bot zip safety", () => {
  it("refuses path traversal, absolute paths, links and zip bombs before reading anything", () => {
    for (const name of ["../escape.txt", "workspace/../../escape.txt", "/etc/passwd", "C:/Windows/x", "workspace\\..\\x"]) {
      expect(() => inspectBotZip(handZip(name, Buffer.from("x")))).toThrow(BotZipError);
    }
    expect(() => inspectBotZip(handZip("workspace/link", Buffer.from("/etc/passwd"), { symlink: true }))).toThrow(/symbolic link/);
    const bomb = Buffer.alloc(8 * 1024 * 1024);
    expect(() => inspectBotZip(handZip("workspace/bomb.bin", bomb))).toThrow(BotZipError);
    // a file that claims less than it inflates to
    expect(() => {
      const inspected = inspectBotZip(handZip("manifest.json", Buffer.from("{\"format\":\"sagax.bot\"}"), { declared: 4 }));
      if (inspected.kind === "zip") inspected.reader.close();
    }).toThrow();
  });

  it("refuses a zip without a manifest, a newer version, and a file that is not a bot", async () => {
    await expect(crafted([{ name: "bot.json", data: "{}" }]).then(inspectBotZip)).rejects.toThrow(/no manifest/);
    await expect(crafted([{ name: "manifest.json", data: JSON.stringify({ format: "sagax.bot", version: 99 }) }, { name: "bot.json", data: "{}" }]).then(inspectBotZip)).rejects.toThrow(/newer Sagax/);
    const text = join(temp(), "notes.txt");
    writeFileSync(text, "hello");
    expect(() => inspectBotZip(text)).toThrow(/neither a bot zip/);
  });

  it("rolls back everything when a part of the zip is invalid", async () => {
    const fx = fixture();
    const before = fx.store.bots.length;
    const manifest = { format: "sagax.bot", version: 1, appVersion: "x", exportedAt: 1, bot: { id: "b", name: "Bad" }, includes: {} };
    const file = await crafted([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "bot.json", data: JSON.stringify({ identity: { name: "Bad" }, settings: {}, host: {} }) },
      { name: "workspace/MEMORY.md", data: "# Memory\n" },
      { name: "conversations/tasks.json", data: "{\"tasks\": \"not a list\"}" },
    ]);
    const inspected = inspectBotZip(file);
    await expect(importBotZip(fx.host, inspected, { ownerPrincipalId: undefined, asMember: false, conversations: true, sharing: false })).rejects.toThrow(/not valid/);
    expect(fx.store.bots.length).toBe(before);
    if (inspected.kind === "zip") inspected.reader.close();
  });
});

describe("older packages", () => {
  it("reads an openmaus.package document and imports it through the package importer", async () => {
    const fx = fixture();
    const document = {
      format: "openmaus.package", version: 2,
      package: { id: "atlas", release: "1.0.0", name: "Atlas", tagline: "Sales digest", summary: "One bot.", category: "Sales", author: { name: "JC" }, license: "MIT",
        outcomes: ["A digest"], setupMinutes: 5, requirements: { apps: [], capabilities: [] }, team: { name: "Sales" },
        agents: [{ key: "atlas", name: "Atlas", soul: "Cite sources.", appearance: { color: "purple" } }] },
    };
    const file = join(temp(), "atlas.json");
    writeFileSync(file, JSON.stringify(document));
    const inspected = inspectBotZip(file);
    expect(inspected).toMatchObject({ kind: "legacy", name: "Atlas", agents: 1 });
    const preview = await previewBotZip(fx.host, inspected, { asMember: false });
    expect(preview.kind).toBe("legacy");
    let received: unknown = null;
    const host = { ...fx.host, importLegacy: async (doc: unknown, owner: string) => {
      received = doc;
      const bot = fx.store.createBot({ name: "Atlas", ...(owner ? { ownerUserId: owner } : {}) }, { seedMessages: false });
      return { botId: bot.id, warnings: [] };
    } };
    const result = await importBotZip(host, inspected, { ownerPrincipalId: "pr_00000000-0000-4000-8000-000000000001", asMember: false, conversations: false, sharing: false });
    expect(received).toEqual(document);
    expect(fx.store.bot(result.botId)?.name).toBe("Atlas");
  });
});

describe("bot zip and confidential threads (server/confidential-threads.ts)", () => {
  it("never exports a confidential thread: not its messages, files, record or id", () => {
    const fx = fixture({ organization: true });
    const bot = richBot(fx);
    const secret = fx.store.createTask(bot.id, "Merger plan", true, undefined, undefined, undefined, "pr_00000000-0000-4000-8000-000000000002", undefined, false, undefined, true)!;
    fx.store.appendMessage(secret.threadId, { role: "user", kind: "text", text: "the target is CONFIDENTIAL-ACME", at: 300 });
    mkdirSync(join(DATA_DIR, "task-workspaces", bot.id, secret.threadId), { recursive: true });
    writeFileSync(join(DATA_DIR, "task-workspaces", bot.id, secret.threadId, "plan.md"), "CONFIDENTIAL-ACME\n");
    expect(fx.store.bot(bot.id)!.threadId).toBe(secret.threadId);
    const plan = planBotZip(fx.host, bot.id, { conversations: true, sharing: true });
    const names = plan.files.map((file) => file.name);
    expect(names.some((name) => name.includes(secret.threadId))).toBe(false);
    const text = plan.files.map((file) => ("data" in file && file.data !== undefined ? String(file.data) : "")).join("\n");
    expect(text).not.toContain("CONFIDENTIAL-ACME");
    expect(text).not.toContain("Merger plan");
    expect(text).not.toContain(secret.threadId);
    expect(names).toContain("conversations/tasks.json");
    expect(plan.manifest.includes.conversations).toBe(2);
  });
});
