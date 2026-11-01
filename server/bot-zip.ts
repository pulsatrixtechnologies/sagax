// The bot package: one bot, whole, as `<bot-name>.sagaxbot.zip`
// (docs/bot-package.md). One canonical format for the persona editor's
// Export and Import, the New bot dialog, Browse Bots > Templates and the
// organization admin console.
//
// What a zip holds:
//   manifest.json            format, versions, what is included (shared/bot-zip.ts)
//   bot.json                 the bot record's portable fields (BOT_FIELD_POLICY)
//   SOUL.md                  the standing instructions
//   avatar/<file>            an uploaded or generated picture
//   bot-folder/**            the rest of DATA_DIR/bots/<id>/ (RULES.md, history)
//   workspace/**             MEMORY.md, memory/ (topics, log/, archive.md),
//                            docs/, skills/ and every other file of the desk
//   skills.json              each skill's provenance, hash and enabled state
//   plugins/state.json       marketplaces and installed plugins, with flags
//                            (the per-bot format: the marketplaces of the one
//                            list this bot uses or keeps a token for)
//   plugins/marketplaces/<name>/marketplace.json
//   plugins/files/<marketplace>/<plugin>/**   the installed (sanitized) copies
//   routines.json, webhooks.json   owned by the bot, secrets never included
//   sharing.json             grants by email (optional)
//   conversations/**, attachments/**   threads, messages, files (optional)
//
// What never travels: tokens and secrets of any kind (marketplace tokens,
// webhook bearer tokens, MCP header values), session
// handles, and this server's own bookkeeping (BOT_FIELD_POLICY says why for
// each field). Text files pass the redactor on the way out.
//
// Import never overwrites: a new id, a name with a suffix when taken, every
// routine and webhook off, approval Full or Custom back to Ask, a member's
// copy without the host settings that stay an admin's (memberImportReset), and a rollback that
// removes everything the import wrote when any step fails.
import { readAtRestSync } from "./content-at-rest.ts";
import { botRuntimeSettingsShape } from "./bot-runtime-settings.ts";
import { exportedSecretFile, registrySettingsPath, withoutRegistrySecrets } from "./workspace-backup-policy.ts";
import { randomUUID } from "node:crypto";
import { closeSync, createWriteStream, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { z } from "zod";

import {
  BOT_ZIP_FORMAT,
  BOT_ZIP_MAX_BYTES,
  BOT_ZIP_MAX_ENTRIES,
  BOT_ZIP_NEWER_MESSAGE,
  BOT_ZIP_VERSION,
  botZipFilename,
  botZipManifestSchema,
  type BotZipExportOptions,
  type BotZipImportResult,
  type BotZipIncludes,
  type BotZipManifest,
  type BotZipPreview,
  type BotZipPreviewLine,
} from "../shared/bot-zip.ts";
import { isApprovalMode } from "../shared/approval-mode.ts";
import { botAvatarUrlFromStoredPath } from "../shared/bot-avatar.ts";
import { takeImportName } from "../shared/import-name.ts";
import { MASCOT_COLOR_NAMES } from "../shared/mascot-colors.ts";
import { isPackageDocument, parsePackageDocument } from "../shared/package-format.ts";
import { redactSecretsInText } from "../shared/redact.ts";
import { parseToolScope } from "../shared/tool-scope.ts";
import { EFFORT_LEVELS, type ModelSelection } from "../shared/wire.ts";
import { ATTACHMENTS_DIR, readAttachment, saveImage, saveImportedAttachment } from "./attachments.ts";
import { botFolder, SOUL_FILE } from "./bot-folder.ts";
import type { BotPlugins } from "./bot-plugins.ts";
import { profilePatchSchema } from "./bot-profile.ts";
import { autoOnlyDestination } from "./surface.ts";
import { memberImportReset } from "./routes/bot-catalog.ts";
import type { Routine, RoutineManager } from "./routines.ts";
import { restoreSkillManifest, setSkillEnabled, skillManifestForExport } from "./skills.ts";
import { cleanBotGrants, cleanBotPerspicax, type BotRecord, type Message, type Store, type TaskRecord } from "./store.ts";
import type { WebhookTrigger } from "./webhooks.ts";
import { TRIGGER_SOURCES, type TriggerSourceConfig } from "../shared/trigger-sources.ts";
import { storedTeamMemorySharing } from "../shared/team-memory-sharing.ts";
import { syncMemoryIndex, workspaceDir } from "./workspace.ts";
import { ZipError, ZipReader, ZipWriter } from "./zip.ts";

export class BotZipError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "BotZipError";
    this.code = code;
    this.status = status;
  }
}

// ── the bot record, field by field ───────────────────────────────────────

type FieldPolicy =
  | "identity" | "settings" | "host" | "sharing" | "conversations" | "soul" | "avatar"
  | { drop: string };

/** Every BotRecord field, and what the package does with it. A new field
 * fails to compile here until someone decides. "host": a setting of where
 * the bot runs and what it reaches on the host; a member's import keeps
 * the computer, browser and Always allow list and drops the rest
 * (memberImportReset). */
export const BOT_FIELD_POLICY: { readonly [K in keyof BotRecord]-?: FieldPolicy } = {
  id: { drop: "a new id on import" },
  name: "identity",
  title: "identity",
  description: "identity",
  notifications: "identity",
  color: "identity",
  mascotExpression: "identity",
  mascotBody: "identity",
  mascotSkin: "identity",
  mascotLook: "identity",
  avatarCrop: "identity",
  avatarZoom: "identity",
  avatarFocusX: "identity",
  avatarFocusY: "identity",
  avatarUrl: "avatar",
  soul: "soul",
  soulHash: { drop: "recomputed from SOUL.md" },
  soulDrift: { drop: "recomputed from SOUL.md" },
  instructionsLead: { drop: "recomputed from SOUL.md" },
  modelSelection: "settings",
  fallback: "settings",
  maxConcurrentThreads: "settings",
  maxParallelPerPerson: "settings",
  busySend: "settings",
  automaticRecovery: "settings",
  turnLimits: "settings",
  // #1137: who pays is its owner's choice on this server, and the default is computed
  turnPayer: { drop: "who pays is the owner's choice on this server" },
  turnPayerDefault: { drop: "computed by the server" },
  approvalSetting: { drop: "computed by the server" },
  approvalApplied: { drop: "computed by the server" },
  autoApprove: "settings",
  approvalMode: "settings",
  proactiveMode: "settings",
  alwaysAllow: "host",
  allowedRecipients: { drop: "the owner's contacts and bot ids of this server: they never travel in a package" },
  toolScope: "settings",
  speakReplies: "settings",
  finishUntil: "settings",
  finishUntilMaxRounds: "settings",
  voice: "settings",
  voiceNotes: "settings",
  emailDrafts: "settings",
  memoryEnabled: "settings",
  teamMemorySharing: "settings",
  memoryUpkeep: "settings",
  parkDirectMessages: "settings",
  approvePeerComms: "settings",
  localPrompt: "settings",
  peers: "settings",
  outbound: "settings",
  assignedSkills: "settings",
  perspicax: "settings",
  temporary: { drop: "an imported bot is never temporary (Perspicax #321)" },
  createdByBot: { drop: "a person imports the bot: it starts as a person's bot (server/bot-creation.ts)" },
  section: "settings",
  managedSections: "settings",
  projects: "settings",
  playbooks: "settings",
  pinned: "settings",
  computer: "host",
  cloudBackend: "host",
  autoStartVps: "host",
  cwd: "host",
  browser: "host",
  browserProfile: "host",
  // Enrolled unattended hosts attached so the bot can work on them
  // (Computer tab places, 2026-11-01).
  remoteHosts: "host",
  mcpServers: "host",
  mcpAccounts: "host",
  visibility: "sharing",
  grants: "sharing",
  directGrants: "sharing",
  threadId: "conversations",
  mainThreadId: { drop: "derived from the bot's threads" },
  tasks: "conversations",
  pinnedMessageId: "conversations",
  unread: { drop: "this server's read state" },
  busy: { drop: "live state" },
  activity: { drop: "live state" },
  waitingForTeammates: { drop: "live state" },
  waitingApprovals: { drop: "derived from the bot's threads" },
  botConversations: { drop: "derived from the bot's threads and its peers' threads" },
  rewound: { drop: "live state" },
  resumeCursors: { drop: "engine session handles of this server" },
  approvalGrant: { drop: "an approval change in flight" },
  fullAccessConsent: { drop: "a person's own Full access confirmation" },
  lastProfileRequestId: { drop: "a request receipt of this server" },
  lastTeamSetupReceipt: { drop: "a request receipt of this server" },
  packageBase: { drop: "organization library update bookkeeping" },
  installedPackage: { drop: "the copy is a new bot, not a library install" },
  catalog: { drop: "publishing to Browse Bots is its own step" },
  hidden: { drop: "an imported bot arrives in the sidebar" },
  chiefOfStaff: { drop: "a Primary Bot is chosen by its owner" },
  ownerUserId: { drop: "the person who imports owns the copy" },
  host: { drop: "where turns ran on this server" },
  createdAt: { drop: "the copy is created now" },
};

/** What a zip lists as not included, in plain words. */
export const BOT_ZIP_EXCLUDED = [
  "Tokens and secrets: marketplace tokens, webhook bearer tokens, MCP header values and connected app credentials (names only).",
  "Engine session handles, live and unread state, request receipts and the memory upkeep undo journal of this server.",
  "Achievements and per-person settings (they belong to a person, not to the bot).",
  "Rooms with other bots and the bot's place on the desktop.",
  "Context files attached to routines.",
];

// ── files ────────────────────────────────────────────────────────────────

const SKIPPED_DIRS = new Set(["node_modules"]);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const TEXT_EXT = /\.(?:md|markdown|txt|json|jsonl|ndjson|ya?ml|toml|csv|tsv|ini|cfg|conf|env|sh|bash|zsh|ps1|py|rb|js|mjs|cjs|ts|tsx|jsx|html?|css|xml|sql|log)$/i;
const MARKER = /«redacted \d+ chars»/g;

interface PlanFile {
  name: string;
  path?: string;
  data?: Buffer | string;
  size: number;
  /** Pass the redactor over it on the way out. */
  scrub: boolean;
}

/** A `.npmrc` or `.yarnrc.yml` with a registry token in it (or unreadable). */
function registryHoldsSecret(rel: string, path: string): boolean {
  try { return withoutRegistrySecrets(rel, readFileSync(path, "utf8")) !== null; } catch { return true; }
}

function startsLikeZip(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && head.readUInt32LE(0) === 0x04034b50;
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Files under `root`, never following a link, skipping `node_modules` and
 * every sign-in or key file (exportedSecretFile). */
function walkFiles(root: string, options: { skip?: (rel: string) => boolean } = {}): Array<{ rel: string; path: string; size: number }> {
  const out: Array<{ rel: string; path: string; size: number }> = [];
  let rootStat;
  try { rootStat = lstatSync(root); } catch { return out; }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return out;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    let names: string[];
    try { names = readdirSync(current); } catch { continue; }
    for (const name of names.sort()) {
      const path = join(current, name);
      const rel = relative(root, path).split(sep).join("/");
      if (options.skip?.(rel)) continue;
      let stat;
      try { stat = lstatSync(path); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (!SKIPPED_DIRS.has(name)) stack.push(path);
      } else if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
        // no sign-in or key leaves in a bot export (2026-10-18, « Exclure tout »)
        if (exportedSecretFile(rel, () => startsLikeZip(path))) continue;
        if (registrySettingsPath(rel) && registryHoldsSecret(rel, path)) continue;
        out.push({ rel, path, size: stat.size });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function countMarkers(text: string): number {
  return text.match(MARKER)?.length ?? 0;
}

// ── export ───────────────────────────────────────────────────────────────

export interface BotZipHost {
  store: Store;
  dataDir: string;
  appVersion: string;
  organization: boolean;
  routines(): RoutineManager | null | undefined;
  webhooks(): {
    list(): WebhookTrigger[];
    create(input: Record<string, unknown>): { webhook: WebhookTrigger };
    remove(id: string): boolean;
  } | null | undefined;
  plugins: BotPlugins;
  /** Marketplace sources this bot reads with a stored token (names only). */
  marketplaceTokenSources(botId: string): Set<string>;
  /** A person's email, to name them in sharing.json. */
  emailOf(principalId: string): string | undefined;
  principalByEmail(email: string): string | undefined;
  /** A non-secret description of an MCP server of this installation. */
  mcpServer(name: string): { transport?: string; url?: string; command?: string; valueNames: string[] } | undefined;
  /** The engine of this selection is installed and allowed here. */
  engineUsable(selection: ModelSelection): boolean;
  defaultSelection(): Promise<ModelSelection> | ModelSelection;
  sectionExists(name: string): boolean;
  /** Why no bot can be added now (the workspace's cap), or null. */
  creationRefusal?(): string | null;
  /** Why this person may not give a bot this look (a Mastery look they have
   * not unlocked, server/achievements-mastery.ts), or null. */
  lookRefusal?(principalId: string | undefined, look: unknown): string | null;
  browserProfileExists?(id: string): boolean;
  /** A working folder this server can use. */
  cwdUsable?(path: string): boolean;
  /** An older openmaus.package document becomes bots of `owner`. */
  importLegacy?(document: unknown, owner: string, name?: string): Promise<{ botId: string; warnings: string[] }>;
}

export interface BotZipPlan {
  filename: string;
  manifest: BotZipManifest;
  files: PlanFile[];
  /** Bytes before compression; the cap is checked on this. */
  bytes: number;
}

function portableTask(task: TaskRecord): Record<string, unknown> {
  const keep = ["threadId", "title", "createdAt", "titleFromFirstMessage", "projectId", "archivedAt", "pinned", "updatedAt", "snoozedUntil",
    "modelSelection", "approvalMode", "autoApprove", "alwaysAllow", "pinnedMessageId", "surface", "cwd", "usage", "contextSummaries"] as const;
  const out: Record<string, unknown> = {};
  for (const key of keep) if ((task as unknown as Record<string, unknown>)[key] !== undefined) out[key] = structuredClone((task as unknown as Record<string, unknown>)[key]);
  if (task.openedBy) out.openedBy = { botId: task.openedBy.botId, name: task.openedBy.name, at: task.openedBy.at, ...(task.openedBy.kind ? { kind: task.openedBy.kind } : {}) };
  if (task.closedBy) out.closedBy = { botId: task.closedBy.botId, name: task.closedBy.name, at: task.closedBy.at };
  return out;
}

const LIVE_MESSAGE_FIELDS = ["queued", "queueId", "requestPending", "roomRequest", "sendId", "outboundRequest", "teamMemoryRequest", "parallelTask"] as const;
const CARD_KINDS = new Set(["options", "secret", "access", "routine.run", "goal.run"]);

/** A message as it travels: live fields out; a card (an approval, a
 * connection, a secret request, a routine run) becomes its text, so an
 * import never re-arms a request. */
function portableMessage(message: Message): Message {
  const copy = structuredClone(message) as Message & Record<string, unknown>;
  for (const key of LIVE_MESSAGE_FIELDS) delete copy[key];
  if (CARD_KINDS.has(message.kind)) {
    const parts = [message.text ?? ""];
    if (message.card) parts.push(message.card.title, message.card.subtitle, ...message.card.options, message.card.answered ? `Answer: ${message.card.answered}` : "");
    if (message.kind === "secret") parts.push("[Secret request: not included]");
    if (message.routineRun) parts.push(`[Routine: ${message.routineRun.routineName}: ${message.routineRun.status}]`, message.routineRun.summary ?? "");
    if (message.goalRun) parts.push(`[Room goal: ${message.goalRun.status}]`, message.goalRun.goal);
    if (message.access) parts.push(`[Engine access: ${message.access.reason}]`);
    for (const key of ["card", "connector", "secret", "routineRun", "goalRun", "access"]) delete copy[key];
    copy.kind = "text";
    copy.text = parts.filter(Boolean).join("\n");
  }
  if (copy.comm) copy.comm = { ...copy.comm, gone: true };
  if (copy.threadRef) copy.threadRef = { ...copy.threadRef, gone: true };
  return copy;
}

function attachmentName(path: string): string | null {
  const name = path.replaceAll("\\", "/").split("/").pop() ?? "";
  if (!/^[A-Za-z0-9-]+\.[a-z0-9]{1,8}$/.test(name)) return null;
  const full = join(ATTACHMENTS_DIR, name);
  try { return statSync(full).isFile() && dirname(full) === ATTACHMENTS_DIR ? name : null; } catch { return null; }
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp3": "audio/mpeg", ".pdf": "application/pdf",
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json", ".zip": "application/zip",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".tgz": "application/gzip", ".tsv": "text/tab-separated-values",
};

/** Everything that concerns the bot, as a list of files to write. */
export function planBotZip(host: BotZipHost, botId: string, options: BotZipExportOptions): BotZipPlan {
  const bot = host.store.bot(botId);
  if (!bot) throw new BotZipError("No such bot.", "not_found", 404);
  const files: PlanFile[] = [];
  const add = (name: string, data: string | Buffer, scrub = false) => {
    files.push({ name, data, size: typeof data === "string" ? Buffer.byteLength(data) : data.length, scrub });
  };
  const addFile = (name: string, path: string, size: number) => {
    files.push({ name, path, size, scrub: TEXT_EXT.test(name) });
  };
  const includes: BotZipIncludes = {};

  // the record
  const identity: Record<string, unknown> = {};
  const settings: Record<string, unknown> = {};
  const host_: Record<string, unknown> = {};
  const record = bot as unknown as Record<string, unknown>;
  for (const [key, policy] of Object.entries(BOT_FIELD_POLICY)) {
    // team memory sharing leaves in its stored form only ("private" or
    // nothing), so a corrupted value cannot break the import or the clone
    const value = key === "teamMemorySharing" ? storedTeamMemorySharing(bot) : record[key];
    if (value === undefined) continue;
    if (policy === "identity") identity[key] = structuredClone(value);
    else if (policy === "settings") settings[key] = structuredClone(value);
    else if (policy === "host") host_[key] = structuredClone(value);
  }
  includes.identity = true;
  const soul = bot.soul ?? "";
  add(SOUL_FILE, soul, true);
  includes.soul = soul.length > 0;

  // the picture
  let avatar: string | undefined;
  if (bot.avatarUrl) {
    const name = bot.avatarUrl.split("/").pop() ?? "";
    const stored = readAttachment(name);
    if (stored) {
      avatar = `avatar/${name}`;
      add(avatar, stored.bytes);
      includes.avatar = true;
    }
  }

  // the bot folder (SOUL.md mirror apart): RULES.md and the like
  for (const file of walkFiles(botFolder(bot.id))) {
    if (file.rel === SOUL_FILE) continue;
    addFile(`bot-folder/${file.rel}`, file.path, file.size);
    if (file.rel.toUpperCase() === "RULES.MD") includes.rules = true;
  }

  // the desk: memory, docs, skills and every other file
  let memory = 0, docs = 0, workspace = 0;
  for (const file of walkFiles(workspaceDir(bot.id))) {
    addFile(`workspace/${file.rel}`, file.path, file.size);
    if (file.rel === "MEMORY.md" || file.rel.startsWith("memory/")) memory += 1;
    else if (file.rel.startsWith("docs/")) docs += 1;
    else if (file.rel.toUpperCase() === "RULES.MD" || file.rel.startsWith("rules/")) includes.rules = true;
    else if (!file.rel.startsWith("skills/")) workspace += 1;
  }
  Object.assign(includes, { memory, docs, workspace });

  const skills = skillManifestForExport(bot.id);
  includes.skills = Object.keys(skills).length;
  if (includes.skills) add("skills.json", `${JSON.stringify(skills, null, 2)}\n`);

  // plugins and marketplaces
  const pluginState = host.plugins.stateFor(bot.id);
  const pluginRoot = host.plugins.folder(bot.id);
  const tokenSources = host.marketplaceTokenSources(bot.id);
  const marketplaces: BotZipManifest["marketplaces"] = [];
  for (const [name, market] of Object.entries(pluginState.marketplaces)) {
    marketplaces.push({ name, source: market.source, ...(market.ref ? { ref: market.ref } : {}), needsToken: tokenSources.has(market.source) });
    // the marketplace's catalogue in the installation's one list
    const manifest = join(host.plugins.marketplaceFolder(name), ".claude-plugin", "marketplace.json");
    try {
      const size = statSync(manifest).size;
      if (size <= 1_048_576) addFile(`plugins/marketplaces/${name}/marketplace.json`, manifest, size);
    } catch { /* listed without its catalogue: Update fetches it */ }
  }
  for (const plugin of Object.values(pluginState.plugins)) {
    for (const file of walkFiles(join(pluginRoot, "plugins", plugin.marketplace, plugin.name))) {
      addFile(`plugins/files/${plugin.marketplace}/${plugin.name}/${file.rel}`, file.path, file.size);
    }
  }
  includes.plugins = Object.keys(pluginState.plugins).length;
  includes.marketplaces = marketplaces.length;
  if (includes.plugins || includes.marketplaces) add("plugins/state.json", `${JSON.stringify(pluginState, null, 2)}\n`);

  // MCP servers, by name
  const mcpServers = (bot.mcpServers ?? []).map((name) => ({ name, ...(host.mcpServer(name) ?? { valueNames: [] }) }));
  includes.mcpServers = mcpServers.length;
  includes.perspicaxProfiles = bot.perspicax?.profiles.length ?? 0;

  // routines and webhooks owned by the bot
  const routines = (host.routines()?.listRoutines() ?? []).filter((routine) => routine.botId === bot.id && routine.target !== "room-goal").map((routine) => ({
    name: routine.name, prompt: routine.prompt, target: routine.target, runOn: routine.runOn, enabled: routine.enabled, schedule: routine.schedule,
    durationMinutes: routine.durationMinutes, ...(routine.timeoutMinutes !== undefined ? { timeoutMinutes: routine.timeoutMinutes } : {}),
    ...(routine.continuity !== undefined ? { continuity: routine.continuity } : {}), ...(routine.overlap ? { overlap: routine.overlap } : {}),
    ...(routine.sourceThreadId ? { sourceThreadId: routine.sourceThreadId } : {}), ...(routine.resultsThreadId ? { resultsThreadId: routine.resultsThreadId } : {}),
  }));
  includes.routines = routines.length;
  if (routines.length) add("routines.json", `${JSON.stringify(routines, null, 2)}\n`, true);
  const webhooks = (host.webhooks()?.list() ?? []).filter((hook) => hook.botId === bot.id).map((hook) => ({
    name: hook.name, prompt: hook.prompt, runOn: hook.runOn, enabled: hook.enabled, ...(hook.delivery ? { delivery: hook.delivery } : {}),
    ...(hook.eventTypes?.length ? { eventTypes: hook.eventTypes } : {}), ...(hook.maxPendingRuns !== undefined ? { maxPendingRuns: hook.maxPendingRuns } : {}),
    ...(hook.source ? { source: exportedSource(hook.source) } : {}),
  }));
  includes.webhooks = webhooks.length;
  if (webhooks.length) add("webhooks.json", `${JSON.stringify(webhooks, null, 2)}\n`, true);

  // sharing, people by email
  if (options.sharing) {
    const grants = (bot.grants ?? []).flatMap((grant): Array<{ team: string; level: string } | { email: string; level: string }> => {
      if (grant.target.startsWith("team:")) return [{ team: grant.target.slice(5), level: grant.level }];
      const email = host.emailOf(grant.target.slice(5));
      return email ? [{ email, level: grant.level }] : [];
    });
    const sharing = { ...(bot.visibility !== undefined ? { visibility: bot.visibility } : {}), grants };
    includes.sharing = grants.length + (bot.visibility !== undefined ? 1 : 0);
    add("sharing.json", `${JSON.stringify(sharing, null, 2)}\n`);
  }

  // conversations, messages and their files
  if (options.conversations) {
    // A confidential thread (server/confidential-threads.ts) never leaves in
    // an export, whoever asks: not its messages, its files, nor its record.
    const tasks = (bot.tasks ?? []).filter((task) => task.confidential !== true);
    let messages = 0;
    const attachments = new Set<string>();
    for (const task of tasks) {
      const thread = host.store.messagesFor(task.threadId).map(portableMessage);
      for (const message of thread) {
        for (const attachment of message.attachments ?? []) {
          const name = attachmentName(attachment.path);
          if (name) attachments.add(name);
        }
      }
      messages += thread.length;
      add(`conversations/threads/${task.threadId}.json`, `${JSON.stringify({ activeLeafId: host.store.activeLeaf(task.threadId), messages: thread })}\n`, true);
      for (const file of walkFiles(join(host.dataDir, "task-workspaces", bot.id, task.threadId))) {
        addFile(`conversations/files/${task.threadId}/${file.rel}`, file.path, file.size);
      }
    }
    const active = tasks.some((task) => task.threadId === bot.threadId) ? bot.threadId : tasks[0]?.threadId;
    add("conversations/tasks.json", `${JSON.stringify({ active, tasks: tasks.map(portableTask) }, null, 2)}\n`, true);
    for (const name of attachments) {
      const path = join(ATTACHMENTS_DIR, name);
      addFile(`attachments/${name}`, path, statSync(path).size);
    }
    Object.assign(includes, { conversations: tasks.length, messages, attachments: attachments.size });
  }

  const confidentialSelected = bot.tasks?.some((task) => task.threadId === bot.threadId && task.confidential === true) === true;
  const document = {
    identity, settings, host: host_, ...(avatar ? { avatar } : {}),
    exportedFrom: { id: bot.id, createdAt: bot.createdAt, ...(confidentialSelected ? {} : { threadId: bot.threadId }) },
  };
  add("bot.json", `${JSON.stringify(document, null, 2)}\n`, true);

  const manifest: BotZipManifest = {
    format: BOT_ZIP_FORMAT, version: BOT_ZIP_VERSION, appVersion: host.appVersion, exportedAt: Date.now(),
    bot: { id: bot.id, name: bot.name }, includes, redacted: 0, marketplaces, mcpServers, excluded: BOT_ZIP_EXCLUDED,
  };
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  return { filename: botZipFilename(bot.name), manifest, files, bytes };
}

/** Write a plan to `sink`, the manifest last (with the redaction count). */
export async function writeBotZip(plan: BotZipPlan, sink: (chunk: Buffer) => Promise<void> | void): Promise<{ bytes: number; redacted: number }> {
  if (plan.bytes > BOT_ZIP_MAX_BYTES) throw new BotZipError("This bot is larger than 512 MB. Export it without conversations, or remove large files from its folder.", "too_large", 413);
  const zip = new ZipWriter(sink);
  let redacted = 0;
  for (const file of plan.files) {
    let data: Buffer | string;
    try {
      data = file.data ?? readAtRestSync(file.path!);
    } catch {
      continue;
    }
    if (file.scrub) {
      const text = typeof data === "string" ? data : data.toString("utf8");
      if (typeof data === "string" || !text.includes("�")) {
        const out = redactSecretsInText(text);
        redacted += Math.max(0, countMarkers(out) - countMarkers(text));
        data = out;
      }
    }
    await zip.add(file.name, data);
  }
  const manifest = { ...plan.manifest, redacted };
  await zip.add("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await zip.finish();
  return { bytes: zip.bytes, redacted };
}

// ── reading a file ───────────────────────────────────────────────────────

/** Stream an upload to `file` (created new, 0600), refusing more than the
 * cap or fewer bytes than the request declared. */
export async function stageBotZipUpload(request: IncomingMessage, file: string): Promise<number> {
  const length = Number(request.headers["content-length"]);
  if (!Number.isSafeInteger(length) || length <= 0) throw new BotZipError("Send the file with its length.", "length_required", 411);
  if (length > BOT_ZIP_MAX_BYTES) throw new BotZipError("The file is larger than 512 MB.", "too_large", 413);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > BOT_ZIP_MAX_BYTES ? new BotZipError("The file is larger than 512 MB.", "too_large", 413) : null, chunk);
    },
  });
  try {
    await pipeline(request.iterator({ destroyOnReturn: false }), limit, createWriteStream(file, { flags: "wx", mode: 0o600 }));
    if (bytes !== length) throw new BotZipError("The upload was incomplete. Choose the file again.", "incomplete");
    return bytes;
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  }
}

export type InspectedBotZip =
  | { kind: "zip"; reader: ZipReader; manifest: BotZipManifest; document: PortableBot }
  | { kind: "legacy"; document: unknown; name: string; agents: number; skills: number; routines: number };

const portableBotSchema = z.object({
  identity: z.record(z.string(), z.unknown()).default({}),
  settings: z.record(z.string(), z.unknown()).default({}),
  host: z.record(z.string(), z.unknown()).default({}),
  avatar: z.string().max(200).optional(),
  exportedFrom: z.object({ id: z.string().max(128), threadId: z.string().max(128).optional() }).partial().optional(),
});
type PortableBot = z.infer<typeof portableBotSchema>;

/** Open an uploaded file: a sagax.bot zip, or an older package document. */
export function inspectBotZip(path: string): InspectedBotZip {
  const head = Buffer.alloc(4);
  const fd = readFileHead(path, head);
  if (fd === 0) throw new BotZipError("The file is empty.", "invalid_zip");
  if (head[0] === 0x50 && head[1] === 0x4b) {
    let reader: ZipReader;
    try {
      reader = ZipReader.open(path, { maxEntries: BOT_ZIP_MAX_ENTRIES, maxTotalBytes: BOT_ZIP_MAX_BYTES, maxEntryBytes: MAX_FILE_BYTES });
    } catch (error) {
      if (error instanceof ZipError) throw new BotZipError(error.message, error.code === "too_large" || error.code === "zip_bomb" ? "too_large" : "invalid_zip", error.code === "too_large" || error.code === "zip_bomb" ? 413 : 400);
      throw error;
    }
    try {
      if (!reader.has("manifest.json")) throw new BotZipError("This zip is not a Sagax bot: it has no manifest.json.", "invalid_zip");
      const raw = reader.json("manifest.json") as { format?: unknown; version?: unknown };
      if (raw && typeof raw === "object" && raw.format === BOT_ZIP_FORMAT && typeof raw.version === "number" && raw.version > BOT_ZIP_VERSION) {
        throw new BotZipError(BOT_ZIP_NEWER_MESSAGE, "newer_version");
      }
      const manifest = botZipManifestSchema.safeParse(raw);
      if (!manifest.success) throw new BotZipError(`This zip is not a Sagax bot: ${manifest.error.issues[0]?.message ?? "invalid manifest"}.`, "invalid_zip");
      if (!reader.has("bot.json")) throw new BotZipError("This bot zip has no bot.json.", "invalid_zip");
      const document = portableBotSchema.safeParse(reader.json("bot.json"));
      if (!document.success) throw new BotZipError("This bot zip has an unreadable bot.json.", "invalid_zip");
      return { kind: "zip", reader, manifest: manifest.data, document: document.data };
    } catch (error) {
      reader.close();
      if (error instanceof ZipError) throw new BotZipError(error.message, "invalid_zip");
      throw error;
    }
  }
  // An older package (openmaus.package JSON or a BotMRR Markdown playbook).
  const size = statSync(path).size;
  if (size > 4 * 1024 * 1024 + 64 * 1024) throw new BotZipError("This file is neither a bot zip nor a Sagax package.", "invalid_zip");
  const text = readFileSync(path, "utf8");
  let raw: unknown = text;
  try { raw = JSON.parse(text); } catch { /* Markdown playbook */ }
  if (!isPackageDocument(raw)) throw new BotZipError("This file is neither a bot zip nor a Sagax package.", "invalid_zip");
  try {
    const document = parsePackageDocument(raw, { trust: "file" });
    const pkg = document.package as { name?: string; agents?: Array<{ name: string }>; skills?: { entries?: unknown[] }; routines?: unknown[] };
    return { kind: "legacy", document: raw, name: pkg.agents?.[0]?.name ?? pkg.name ?? "Bot", agents: pkg.agents?.length ?? 0, skills: pkg.skills?.entries?.length ?? 0, routines: pkg.routines?.length ?? 0 };
  } catch (error) {
    throw new BotZipError(error instanceof Error ? error.message.slice(0, 300) : "Invalid package.", "invalid_package");
  }
}

function readFileHead(path: string, into: Buffer): number {
  const fd = openSync(path, "r");
  try { return readSync(fd, into, 0, into.length, 0); } finally { closeSync(fd); }
}

export function closeInspected(inspected: InspectedBotZip): void {
  if (inspected.kind === "zip") inspected.reader.close();
}

// ── preview ──────────────────────────────────────────────────────────────

export interface BotZipImportViewer {
  /** An organization member (not an admin): host settings are dropped. */
  asMember: boolean;
}

const HOST_LABELS: Record<string, string> = {
  computer: "Computer", cloudBackend: "Cloud computer", autoStartVps: "Start the cloud computer", cwd: "Working folder",
  browser: "Browser", browserProfile: "Browser profile", mcpServers: "MCP servers", alwaysAllow: "Always allowed tools",
};

/** Host settings a member's copy keeps (2026-10-26): they work in the
 * member's own environment. The rest stays an admin's (memberImportReset). */
const MEMBER_HOST_KEYS: ReadonlySet<string> = new Set(["computer", "browser", "alwaysAllow"]);

function line(part: string, detail: string, key?: string, params?: Record<string, string | number>): BotZipPreviewLine {
  return { part, detail, ...(key ? { key: `botZip.line.${key}` } : {}), ...(params ? { params } : {}) };
}

export async function previewBotZip(host: BotZipHost, inspected: InspectedBotZip, viewer: BotZipImportViewer, name?: string): Promise<BotZipPreview> {
  const taken = new Set(host.store.bots.map((bot) => bot.name.trim().toLowerCase()));
  if (inspected.kind === "legacy") {
    return {
      kind: "legacy", name: inspected.name, importName: takeImportName(name ?? inspected.name, taken), includes: { identity: true, skills: inspected.skills, routines: inspected.routines },
      hasConversations: false, hasSharing: false,
      created: [line("bot", `${inspected.agents || 1} bot(s) from an older Sagax package`, "legacyBots", { count: inspected.agents || 1 }), ...(inspected.skills ? [line("skills", `${inspected.skills} skill(s), off`, "legacySkills", { count: inspected.skills })] : []), ...(inspected.routines ? [line("routines", `${inspected.routines} routine(s), off`, "legacyRoutines", { count: inspected.routines })] : [])],
      skipped: [line("format", "An older package carries no memory, conversations, plugins or settings.", "legacyFormat")],
      needsAction: [],
    };
  }
  const { manifest, document, reader } = inspected;
  const includes = manifest.includes;
  const created: BotZipPreviewLine[] = [];
  const skipped: BotZipPreviewLine[] = [];
  const needsAction: BotZipPreviewLine[] = [];
  const settings = document.settings;
  created.push(line("identity", "Name, label, description, colour and mascot", "identity"));
  if (includes.avatar) created.push(line("avatar", "Picture", "avatar"));
  if (includes.soul) created.push(line("soul", "SOUL.md", "soul"));
  if (includes.rules) created.push(line("rules", "RULES.md", "rules"));
  if (includes.memory) created.push(line("memory", `${includes.memory} memory file(s)`, "memory", { count: includes.memory }));
  if (includes.docs) created.push(line("docs", `${includes.docs} file(s) in docs/`, "docs", { count: includes.docs }));
  if (includes.workspace) created.push(line("workspace", `${includes.workspace} other file(s)`, "workspace", { count: includes.workspace }));
  if (includes.skills) {
    const skills = reader.has("skills.json") ? Object.entries(reader.json("skills.json") as Record<string, { enabled?: boolean }>) : [];
    const on = skills.filter(([, entry]) => entry?.enabled === true).map(([skill]) => skill);
    created.push(line("skills", `${skills.length} skill(s)${on.length ? `; on: ${on.join(", ")}` : ""}`, on.length ? "skillsOn" : "skills", { count: skills.length, names: on.join(", ") }));
  }
  if (includes.plugins) created.push(line("plugins", `${includes.plugins} plugin(s)`, "plugins", { count: includes.plugins }));
  for (const market of manifest.marketplaces) {
    if (market.needsToken) needsAction.push(line("marketplace", `${market.name} (${market.source}) was read with a token: add a credential on the GitHub plugin's page (Capabilities > Sources > GitHub connection), pick it for this source, then Update.`, "marketplaceToken", { name: market.name, source: market.source }));
  }
  if (manifest.marketplaces.length) created.push(line("marketplaces", manifest.marketplaces.map((market) => market.name).join(", "), "marketplaces", { names: manifest.marketplaces.map((market) => market.name).join(", ") }));
  const selection = settings.modelSelection as ModelSelection | undefined;
  if (selection && typeof selection.instanceId === "string") {
    if (host.engineUsable(selection)) created.push(line("model", `${selection.instanceId} ${selection.model}${selection.effort ? ` (${selection.effort})` : ""}`, "model", { model: `${selection.instanceId} ${selection.model}${selection.effort ? ` (${selection.effort})` : ""}` }));
    else skipped.push(line("model", `${selection.instanceId} is not available here: the default model is used.`, "modelMissing", { engine: selection.instanceId }));
  }
  const mode = settings.approvalMode;
  if (mode === "full" || mode === "custom") skipped.push(line("approval", `${mode === "full" ? "Full access" : "Custom"} arrives as Ask: turn it on again in Permissions.`, mode === "full" ? "approvalFull" : "approvalCustom"));
  else if (typeof mode === "string") created.push(line("approval", mode, "approval", { mode }));
  const hostKeys = Object.keys(document.host);
  if (viewer.asMember && hostKeys.length) {
    const kept = hostKeys.filter((key) => MEMBER_HOST_KEYS.has(key));
    const dropped = hostKeys.filter((key) => !MEMBER_HOST_KEYS.has(key));
    if (kept.length) created.push(line("host", kept.map((key) => HOST_LABELS[key] ?? key).join(", "), "host", { names: kept.map((key) => HOST_LABELS[key] ?? key).join(", ") }));
    if (dropped.length) skipped.push(line("host", `Not for a member's copy: ${dropped.map((key) => HOST_LABELS[key] ?? key).join(", ")}.`, "hostSkipped", { names: dropped.map((key) => HOST_LABELS[key] ?? key).join(", ") }));
  } else {
    if (hostKeys.length) created.push(line("host", hostKeys.map((key) => HOST_LABELS[key] ?? key).join(", "), "host", { names: hostKeys.map((key) => HOST_LABELS[key] ?? key).join(", ") }));
    for (const server of manifest.mcpServers) {
      if (!host.mcpServer(server.name)) needsAction.push(line("mcp", `MCP server ${server.name} is not installed here${server.url ? ` (${server.url})` : ""}: add it in Capabilities.`, "mcpMissing", { name: server.name }));
    }
  }
  const profiles = (settings.perspicax as { profiles?: string[] } | undefined)?.profiles ?? [];
  if (profiles.length) {
    if (host.organization) created.push(line("perspicax", `${profiles.length} Perspicax profile(s)`, "perspicax", { count: profiles.length }));
    else skipped.push(line("perspicax", "Perspicax profiles: an organization server only.", "perspicaxSkipped"));
  }
  if (includes.routines) created.push(line("routines", `${includes.routines} routine(s), off until you turn them on`, "routines", { count: includes.routines }));
  if (includes.webhooks) created.push(line("webhooks", `${includes.webhooks} webhook(s), off, each with a new token`, "webhooks", { count: includes.webhooks }));
  if (includes.conversations) created.push(line("conversations", `${includes.conversations} thread(s), ${includes.messages ?? 0} message(s), ${includes.attachments ?? 0} attachment(s), if you include them`, "conversations", { count: includes.conversations, messages: includes.messages ?? 0, attachments: includes.attachments ?? 0 }));
  if (includes.sharing) {
    if (host.organization) created.push(line("sharing", "Sharing by email, if you include it", "sharing"));
    else skipped.push(line("sharing", "Sharing: an organization server only.", "sharingSkipped"));
  }
  if (typeof settings.section === "string" && !host.sectionExists(settings.section)) skipped.push(line("team", `Team ${settings.section} does not exist here.`, "team", { name: settings.section }));
  return {
    kind: "zip", name: manifest.bot.name, importName: takeImportName(name ?? manifest.bot.name, taken), appVersion: manifest.appVersion, exportedAt: manifest.exportedAt,
    includes, hasConversations: (includes.conversations ?? 0) > 0, hasSharing: (includes.sharing ?? 0) > 0, created, skipped, needsAction,
  };
}

// ── import ───────────────────────────────────────────────────────────────

export interface BotZipImportOptions extends BotZipImportViewer {
  ownerPrincipalId: string | undefined;
  name?: string;
  conversations: boolean;
  sharing: boolean;
}

const effortSchema = z.enum(EFFORT_LEVELS);
const selectionSchema = z.object({
  instanceId: z.string().min(1).max(80), model: z.string().min(1).max(200), effort: effortSchema.optional(), variant: z.string().max(80).optional(), auto: z.literal(true).optional(),
  fast: z.object({ instanceId: z.string().min(1).max(80), model: z.string().min(1).max(200) }).optional(),
});
const settingsSchema = z.object({
  modelSelection: selectionSchema.optional(),
  fallback: z.array(z.object({ instanceId: z.string().min(1).max(80), model: z.string().min(1).max(200) })).max(10).optional(),
  maxConcurrentThreads: botRuntimeSettingsShape.maxConcurrentThreads,
  maxParallelPerPerson: botRuntimeSettingsShape.maxParallelPerPerson,
  busySend: botRuntimeSettingsShape.busySend,
  turnLimits: botRuntimeSettingsShape.turnLimits,
  automaticRecovery: z.object({ enabled: z.boolean(), backup: selectionSchema.optional() }).optional(),
  autoApprove: z.boolean().optional(),
  approvalMode: z.string().refine(isApprovalMode).optional(),
  speakReplies: z.boolean().optional(),
  finishUntil: z.string().max(400).optional(),
  finishUntilMaxRounds: z.number().int().min(1).max(50).optional(),
  voice: z.string().max(200).optional(),
  voiceNotes: z.boolean().optional(),
  emailDrafts: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  // read as the bot reads it (shared/team-memory-sharing.ts): an archive
  // written before export normalized it still imports, unknown as private
  teamMemorySharing: z.unknown().optional(),
  memoryUpkeep: z.boolean().optional(),
  parkDirectMessages: z.boolean().optional(),
  approvePeerComms: z.boolean().optional(),
  localPrompt: z.enum(["compact", "full"]).optional(),
  peers: z.array(z.string().max(128)).max(500).optional(),
  outbound: z.object({ policy: z.enum(["ask", "allow"]), dailyCap: z.number().int().min(0).max(100_000) }).optional(),
  assignedSkills: z.array(z.string().max(64)).max(200).optional(),
  section: z.string().max(60).optional(),
  managedSections: z.array(z.string().max(60)).max(100).optional(),
  projects: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(120), emoji: z.string().max(16).optional() })).max(200).optional(),
  playbooks: z.array(z.object({ key: z.string().max(64), name: z.string().max(100), summary: z.string().max(300), triggers: z.array(z.string().max(100)).max(30), instructions: z.string().max(24_000) })).max(80).optional(),
  pinned: z.boolean().optional(),
});
const hostSchema = z.object({
  computer: z.enum(["cloud", "vm", "local", "browser", "off"]).optional(),
  cloudBackend: z.enum(["box", "vps"]).optional(),
  autoStartVps: z.boolean().optional(),
  cwd: z.string().max(4_096).optional(),
  browser: z.boolean().optional(),
  browserProfile: z.string().max(200).optional(),
  mcpServers: z.array(z.string().max(64)).max(100).optional(),
  alwaysAllow: z.array(z.string().max(1_024)).max(500).optional(),
});
const routineSchema = z.object({
  name: z.string(), prompt: z.string(), target: z.string().optional(), runOn: z.string().optional(), schedule: z.unknown(),
  durationMinutes: z.number().optional(), timeoutMinutes: z.number().optional(), continuity: z.boolean().optional(), overlap: z.enum(["skip", "queue"]).optional(),
  sourceThreadId: z.string().optional(), resultsThreadId: z.string().optional(),
});
const webhookSchema = z.object({
  name: z.string(), prompt: z.string(), runOn: z.enum(["maus", "cloud"]).optional(), delivery: z.enum(["run", "post"]).optional(),
  eventTypes: z.array(z.string()).max(20).optional(), maxPendingRuns: z.number().int().optional(),
  // A typed trigger's provider, events, filters and automation settings;
  // the webhook manager validates it on create like any other.
  source: z.record(z.string(), z.unknown()).optional(),
});

/** A typed trigger's settings as exported: the provider, events, filters,
 * rate limit, tenant, Graph connector name and resource, poller server. No
 * secret ever: not the signing secret, the Graph clientState or
 * subscription, the poller's password or ICS link (those never sit on the
 * source), and not the user name or connector account either, which belong
 * to this server's people. */
function exportedSource(source: TriggerSourceConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { type: source.type, events: source.events, filters: source.filters, catalog: source.catalog ?? 1 };
  if (source.includeBotComments) out.includeBotComments = true;
  if (source.rateLimitPerMinute !== undefined) out.rateLimitPerMinute = source.rateLimitPerMinute;
  if (source.tenantId) out.tenantId = source.tenantId;
  if (source.graph) out.graph = { connector: source.graph.connector, ...(source.graph.resource ? { resource: source.graph.resource } : {}) };
  if (source.poller) {
    const { username: _username, ...poller } = source.poller;
    out.poller = poller;
  }
  return out;
}
const sharingSchema = z.object({
  visibility: z.union([z.literal("everyone"), z.literal("admins"), z.object({ people: z.array(z.string().max(320)).max(1_000) })]).optional(),
  grants: z.array(z.union([
    z.object({ email: z.string().max(320), level: z.enum(["use", "run", "edit", "manage"]) }),
    z.object({ team: z.string().max(64), level: z.enum(["use", "run", "edit", "manage"]) }),
  ])).max(1_000).default([]),
});
const tasksSchema = z.object({ active: z.string().max(128).optional(), tasks: z.array(z.record(z.string(), z.unknown())).max(5_000) });
const threadSchema = z.object({ activeLeafId: z.string().max(128).nullable().optional(), messages: z.array(z.record(z.string(), z.unknown())).max(200_000) });

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Write one archive file under `root`, refusing any path that leaves it. */
function writeUnder(root: string, rel: string, data: Buffer): void {
  const target = join(root, ...rel.split("/"));
  const back = relative(root, target);
  if (!back || back.startsWith("..") || back.split(sep).includes("..")) throw new BotZipError(`Unsafe path in the zip: ${rel}`, "unsafe_path");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, data, { mode: 0o600 });
}

/** Import an inspected zip as a new bot. Nothing existing is overwritten;
 * any failure removes what this import wrote. */
export async function importBotZip(host: BotZipHost, inspected: InspectedBotZip, options: BotZipImportOptions): Promise<BotZipImportResult> {
  if (inspected.kind === "legacy") {
    if (!host.importLegacy || (!options.ownerPrincipalId && host.organization)) throw new BotZipError("Older packages cannot be imported here.", "unsupported");
    const result = await host.importLegacy(inspected.document, options.ownerPrincipalId ?? "", options.name);
    return { botId: result.botId, name: host.store.bot(result.botId)?.name ?? inspected.name, warnings: result.warnings };
  }
  const { reader, manifest, document } = inspected;
  const store = host.store;
  const warnings: string[] = [];
  const taken = new Set(store.bots.map((bot) => bot.name.trim().toLowerCase()));
  const identityParsed = profilePatchSchema.safeParse(Object.fromEntries(Object.entries(document.identity).filter(([key]) => key !== "color" && key !== "mascotExpression")));
  if (!identityParsed.success) throw new BotZipError(`The bot's identity is not valid: ${identityParsed.error.issues[0]?.message ?? "invalid"}.`, "invalid_zip");
  const identity = identityParsed.data;
  const color = typeof document.identity.color === "string" && (MASCOT_COLOR_NAMES as readonly string[]).includes(document.identity.color) ? document.identity.color as BotRecord["color"] : undefined;
  const expression = typeof document.identity.mascotExpression === "string" ? document.identity.mascotExpression as BotRecord["mascotExpression"] : undefined;
  const settingsParsed = settingsSchema.safeParse(document.settings);
  if (!settingsParsed.success) throw new BotZipError(`The bot's settings are not valid: ${settingsParsed.error.issues[0]?.path.join(".")} ${settingsParsed.error.issues[0]?.message ?? ""}`.trim(), "invalid_zip");
  const settings = settingsParsed.data;
  const hostParsed = hostSchema.safeParse(document.host);
  const hostSettings = hostParsed.success ? hostParsed.data : {};
  if (!hostParsed.success) warnings.push("Host settings were not valid and were left out.");
  const toolScope = parseToolScope(document.settings.toolScope);

  const soulText = reader.has(SOUL_FILE) ? reader.text(SOUL_FILE) : "";
  if (Buffer.byteLength(soulText) > 24_000) throw new BotZipError("SOUL.md is larger than 24000 bytes.", "invalid_zip");

  const refusal = host.creationRefusal?.();
  if (refusal) throw new BotZipError(refusal, "limit", 409);
  if (settings.managedSections?.length) warnings.push("Additional teams a Primary Bot coordinates are not imported: the copy is not a Primary Bot.");
  let selection: ModelSelection = settings.modelSelection ? { ...settings.modelSelection } as ModelSelection : await host.defaultSelection();
  if (!host.engineUsable(selection)) {
    warnings.push(`${selection.instanceId} is not available here: the bot uses the default model.`);
    selection = await host.defaultSelection();
  }
  const name = takeImportName(options.name?.trim() || identity.name || manifest.bot.name, taken);
  const section = settings.section && host.sectionExists(settings.section) ? settings.section : undefined;
  if (settings.section && !section) warnings.push(`Team ${settings.section} does not exist here: the bot is outside a team.`);

  const createdRoutines: string[] = [];
  const createdWebhooks: string[] = [];
  const createdAttachments: string[] = [];
  let botId: string | null = null;
  try {
    const bot = store.createBot({
      name, title: identity.title, description: identity.description, soul: soulText,
      ...(color ? { color } : {}), ...(expression ? { mascotExpression: expression } : {}),
      mascotBody: identity.mascotBody, mascotSkin: identity.mascotSkin,
      modelSelection: selection, ...(section ? { section } : {}),
      ...(options.ownerPrincipalId ? { ownerUserId: options.ownerPrincipalId } : {}),
      ...(toolScope.ok && toolScope.scope ? { toolScope: toolScope.scope } : {}),
    }, { seedMessages: false });
    botId = bot.id;
    const id = bot.id;

    // the picture
    let avatarUrl: string | undefined;
    if (document.avatar && reader.has(document.avatar) && /^avatar\/[A-Za-z0-9-]+\.(?:png|jpg|gif|webp)$/.test(document.avatar)) {
      const ext = extname(document.avatar);
      const saved = saveImage(reader.read(document.avatar), MIME_BY_EXT[ext] ?? "image/png");
      createdAttachments.push(saved.path);
      avatarUrl = botAvatarUrlFromStoredPath(saved.path) ?? undefined;
    }

    // settings, clamped
    const lookRefused = identity.mascotLook !== undefined ? host.lookRefusal?.(options.ownerPrincipalId, identity.mascotLook) ?? null : null;
    if (lookRefused) warnings.push(`The mascot look stays the default: ${lookRefused}`);
    const mode = settings.approvalMode;
    const projects = settings.projects?.filter((project) => SAFE_SEGMENT.test(project.id));
    const patch: Partial<BotRecord> = {
      ...(identity.notifications !== undefined ? { notifications: identity.notifications } : {}),
      ...(identity.mascotLook !== undefined && !lookRefused ? { mascotLook: identity.mascotLook } : {}),
      ...(identity.avatarCrop ? { avatarCrop: identity.avatarCrop } : {}),
      ...(identity.avatarZoom !== undefined ? { avatarZoom: identity.avatarZoom } : {}),
      ...(identity.avatarFocusX !== undefined ? { avatarFocusX: identity.avatarFocusX } : {}),
      ...(identity.avatarFocusY !== undefined ? { avatarFocusY: identity.avatarFocusY } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(identity.voice !== undefined ? { voice: identity.voice } : settings.voice !== undefined ? { voice: settings.voice } : {}),
      ...(settings.speakReplies !== undefined ? { speakReplies: settings.speakReplies } : {}),
      ...(settings.finishUntil ? { finishUntil: settings.finishUntil.replace(/[\r\n]+/g, " ").trim() } : {}),
      ...(settings.finishUntilMaxRounds !== undefined ? { finishUntilMaxRounds: settings.finishUntilMaxRounds } : {}),
      ...(settings.voiceNotes !== undefined ? { voiceNotes: settings.voiceNotes } : {}),
      ...(settings.emailDrafts !== undefined ? { emailDrafts: settings.emailDrafts } : {}),
      ...(settings.memoryEnabled !== undefined ? { memoryEnabled: settings.memoryEnabled } : {}),
      ...(storedTeamMemorySharing(settings) ? { teamMemorySharing: "private" as const } : {}),
      ...(settings.memoryUpkeep !== undefined ? { memoryUpkeep: settings.memoryUpkeep } : {}),
      ...(settings.parkDirectMessages !== undefined ? { parkDirectMessages: settings.parkDirectMessages } : {}),
      ...(settings.approvePeerComms !== undefined ? { approvePeerComms: settings.approvePeerComms } : {}),
      ...(settings.localPrompt !== undefined ? { localPrompt: settings.localPrompt } : {}),
      ...(settings.peers ? { peers: settings.peers.filter((peer) => peer !== id && store.bot(peer)) } : {}),
      ...(settings.outbound ? { outbound: settings.outbound } : {}),
      ...(settings.fallback ? { fallback: settings.fallback.filter((entry) => host.engineUsable(entry as ModelSelection)) } : {}),
      ...(settings.maxConcurrentThreads !== undefined ? { maxConcurrentThreads: settings.maxConcurrentThreads } : {}),
      ...(settings.maxParallelPerPerson !== undefined ? { maxParallelPerPerson: settings.maxParallelPerPerson } : {}),
      ...(settings.busySend !== undefined ? { busySend: settings.busySend } : {}),
      ...(settings.turnLimits ? { turnLimits: settings.turnLimits } : {}),
      // A backup this server cannot run arrives off, never pointing nowhere.
      ...(settings.automaticRecovery ? {
        automaticRecovery: settings.automaticRecovery.enabled && settings.automaticRecovery.backup && host.engineUsable(settings.automaticRecovery.backup as ModelSelection)
          ? { enabled: true, backup: settings.automaticRecovery.backup as ModelSelection }
          : { enabled: false },
      } : {}),
      ...(settings.assignedSkills ? { assignedSkills: settings.assignedSkills } : {}),
      ...(projects?.length ? { projects } : {}),
      ...(settings.playbooks ? { playbooks: settings.playbooks } : {}),
      ...(settings.pinned !== undefined ? { pinned: settings.pinned } : {}),
      ...(mode && mode !== "full" && mode !== "custom" ? { approvalMode: mode as BotRecord["approvalMode"], ...(settings.autoApprove !== undefined ? { autoApprove: settings.autoApprove } : {}) } : { approvalMode: "ask", autoApprove: false }),
    };
    // This computer, the cloud computer and Off travel. A Local VM or the
    // browser does not: those still arrive as Auto. 2026-10-26: a member's
    // copy keeps its computer, browser and Always allow list too.
    const worksOn = autoOnlyDestination(hostSettings.computer);
    Object.assign(patch, {
      ...(worksOn ? { computer: worksOn } : {}),
      ...(hostSettings.browser !== undefined ? { browser: hostSettings.browser } : {}),
      ...(hostSettings.alwaysAllow ? { alwaysAllow: hostSettings.alwaysAllow } : {}),
    });
    if (!options.asMember) {
      Object.assign(patch, {
        ...(hostSettings.cloudBackend ? { cloudBackend: hostSettings.cloudBackend } : {}),
        ...(hostSettings.autoStartVps !== undefined ? { autoStartVps: hostSettings.autoStartVps } : {}),
        ...(hostSettings.cwd && (host.cwdUsable?.(hostSettings.cwd) ?? true) ? { cwd: hostSettings.cwd } : {}),
        ...(hostSettings.browserProfile && (host.browserProfileExists?.(hostSettings.browserProfile) ?? true) ? { browserProfile: hostSettings.browserProfile } : {}),
        ...(hostSettings.mcpServers ? { mcpServers: hostSettings.mcpServers } : {}),
      });
    } else {
      // a package is not provably the member's own bot: no MCP server
      Object.assign(patch, memberImportReset());
    }
    if (!options.asMember && hostSettings.cwd && !(host.cwdUsable?.(hostSettings.cwd) ?? true)) warnings.push(`The working folder ${hostSettings.cwd} is not usable here: the bot works in its own folder.`);
    if (!options.asMember && hostSettings.browserProfile && !(host.browserProfileExists?.(hostSettings.browserProfile) ?? true)) warnings.push("The browser profile is not on this server: the bot uses its own browser session.");
    store.patchBot(id, patch);
    store.patchTask(id, bot.threadId, { approvalMode: patch.approvalMode, autoApprove: patch.autoApprove === true });
    const profiles = cleanBotPerspicax(document.settings.perspicax);
    if (profiles && host.organization) store.setBotPerspicax(id, profiles.profiles);

    // the bot folder and the desk
    for (const entry of reader.under("bot-folder/")) writeUnder(botFolder(id), entry.slice("bot-folder/".length), reader.read(entry));
    const desk = workspaceDir(id);
    mkdirSync(desk, { recursive: true, mode: 0o700 });
    for (const entry of reader.under("workspace/")) writeUnder(desk, entry.slice("workspace/".length), reader.read(entry));
    syncMemoryIndex(id);

    // skills: the manifest lands off, then what was on is turned on again
    // where its SKILL.md still matches the reviewed hash
    if (reader.has("skills.json")) {
      const manifestValue = reader.json("skills.json") as Record<string, { enabled?: boolean }>;
      restoreSkillManifest(id, manifestValue);
      for (const [skill, entry] of Object.entries(manifestValue ?? {})) {
        if (entry?.enabled !== true) continue;
        const result = setSkillEnabled(id, skill, true);
        if ("error" in result) warnings.push(`Skill ${skill} stays off: ${result.error}.`);
      }
    }

    // plugins: files first, then the state that names them
    if (reader.has("plugins/state.json")) {
      const pluginRoot = host.plugins.folder(id);
      for (const entry of reader.under("plugins/files/")) writeUnder(join(pluginRoot, "plugins"), entry.slice("plugins/files/".length), reader.read(entry));
      for (const entry of reader.under("plugins/marketplaces/")) {
        const [, , market, file] = entry.split("/");
        if (!market || file !== "marketplace.json" || !SAFE_SEGMENT.test(market)) continue;
        writeUnder(join(pluginRoot, "marketplaces", market, ".claude-plugin"), "marketplace.json", reader.read(entry));
      }
      host.plugins.restoreState(id, reader.json("plugins/state.json"));
    }

    // conversations (when chosen and present)
    const threadIds = new Map<string, string>();
    if (options.conversations && reader.has("conversations/tasks.json")) {
      const parsedTasks = tasksSchema.safeParse(reader.json("conversations/tasks.json"));
      if (!parsedTasks.success) throw new BotZipError("The conversations in this zip are not valid.", "invalid_zip");
      const keptProjects = new Set((projects ?? []).map((project) => project.id));
      const fresh = store.bot(id)!;
      const tasks: TaskRecord[] = [];
      for (const [index, raw] of parsedTasks.data.tasks.entries()) {
        const oldThread = typeof raw.threadId === "string" && SAFE_SEGMENT.test(raw.threadId) ? raw.threadId : null;
        if (!oldThread || threadIds.has(oldThread)) continue;
        const threadId = index === 0 ? fresh.threadId : randomUUID();
        threadIds.set(oldThread, threadId);
        const taskMode = raw.approvalMode;
        const task: TaskRecord = {
          threadId, title: typeof raw.title === "string" ? raw.title.slice(0, 200) : "Conversation", createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
          resumeCursors: {}, activity: "idle", busy: false, unread: false,
          ...(raw.titleFromFirstMessage === true ? { titleFromFirstMessage: true as const } : {}),
          ...(typeof raw.projectId === "string" && keptProjects.has(raw.projectId) ? { projectId: raw.projectId } : {}),
          ...(typeof raw.archivedAt === "number" ? { archivedAt: raw.archivedAt } : {}),
          ...(raw.pinned === true ? { pinned: true } : {}),
          // confidential is permanent: exports leave such threads out, and an
          // import never makes one ordinary (server/confidential-threads.ts)
          ...(raw.confidential === true ? { confidential: true as const } : {}),
          ...(typeof raw.updatedAt === "number" ? { updatedAt: raw.updatedAt } : {}),
          ...(typeof raw.snoozedUntil === "number" ? { snoozedUntil: raw.snoozedUntil } : {}),
          ...(typeof taskMode === "string" && isApprovalMode(taskMode) && taskMode !== "full" && taskMode !== "custom" ? { approvalMode: taskMode } : {}),
          ...(typeof raw.pinnedMessageId === "string" ? { pinnedMessageId: raw.pinnedMessageId } : {}),
          ...(Array.isArray(raw.contextSummaries) ? { contextSummaries: raw.contextSummaries as TaskRecord["contextSummaries"] } : {}),
          ...(raw.openedBy && typeof raw.openedBy === "object" ? { openedBy: raw.openedBy as TaskRecord["openedBy"] } : {}),
          ...(raw.closedBy && typeof raw.closedBy === "object" ? { closedBy: raw.closedBy as TaskRecord["closedBy"] } : {}),
          ...(!options.asMember && typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
          ...(Array.isArray(raw.alwaysAllow) ? { alwaysAllow: (raw.alwaysAllow as unknown[]).filter((tool): tool is string => typeof tool === "string") } : {}),
        } as TaskRecord;
        const taskSelection = selectionSchema.safeParse(raw.modelSelection);
        if (taskSelection.success && host.engineUsable(taskSelection.data as ModelSelection)) task.modelSelection = taskSelection.data as ModelSelection;
        tasks.push(task);
      }
      if (tasks.length) {
        const active = parsedTasks.data.active ? threadIds.get(parsedTasks.data.active) : undefined;
        store.patchBot(id, { tasks, threadId: active ?? tasks[0]!.threadId });
        const attachmentPaths = new Map<string, string>();
        for (const [oldThread, threadId] of threadIds) {
          const file = `conversations/threads/${oldThread}.json`;
          if (!reader.has(file)) continue;
          const thread = threadSchema.safeParse(reader.json(file));
          if (!thread.success) throw new BotZipError(`A conversation in this zip is not valid: ${oldThread}.`, "invalid_zip");
          const messages: Message[] = [];
          for (const raw of thread.data.messages) {
            if (typeof raw.id !== "string" || (raw.role !== "user" && raw.role !== "bot") || typeof raw.at !== "number") continue;
            const message = portableMessage(raw as unknown as Message);
            if (message.attachments?.length) {
              message.attachments = message.attachments.flatMap((attachment) => {
                const nameInZip = attachment.path.replaceAll("\\", "/").split("/").pop() ?? "";
                const zipped = `attachments/${nameInZip}`;
                if (!reader.has(zipped)) return [];
                let path = attachmentPaths.get(zipped);
                if (!path) {
                  try {
                    const saved = saveImportedAttachment(reader.read(zipped), attachment.mime || MIME_BY_EXT[extname(nameInZip)] || "");
                    createdAttachments.push(saved.path);
                    path = saved.path;
                    attachmentPaths.set(zipped, path);
                  } catch {
                    return [];
                  }
                }
                return [{ ...attachment, path }];
              });
            }
            messages.push(message);
          }
          const leaf = thread.data.activeLeafId && messages.some((message) => message.id === thread.data.activeLeafId) ? thread.data.activeLeafId : null;
          if (messages.length) store.importTranscript(threadId, messages, leaf);
          for (const entry of reader.under(`conversations/files/${oldThread}/`)) {
            writeUnder(join(host.dataDir, "task-workspaces", id, threadId), entry.slice(`conversations/files/${oldThread}/`.length), reader.read(entry));
          }
        }
      }
    }

    // routines and webhooks: off, on the new bot
    const routineManager = host.routines();
    if (reader.has("routines.json") && routineManager) {
      const list = z.array(routineSchema).max(200).safeParse(reader.json("routines.json"));
      for (const routine of list.success ? list.data : []) {
        try {
          const created: Routine = routineManager.create({
            name: routine.name, prompt: routine.prompt, botId: id, enabled: false, schedule: routine.schedule as Routine["schedule"],
            ...(routine.target ? { target: routine.target } : {}), ...(routine.runOn ? { runOn: routine.runOn } : {}),
            ...(routine.durationMinutes !== undefined ? { durationMinutes: routine.durationMinutes } : {}),
            ...(routine.timeoutMinutes !== undefined ? { timeoutMinutes: routine.timeoutMinutes } : {}),
            ...(routine.continuity !== undefined ? { continuity: routine.continuity } : {}),
            ...(routine.overlap ? { overlap: routine.overlap } : {}),
            ...(routine.resultsThreadId && threadIds.get(routine.resultsThreadId) ? { resultsThreadId: threadIds.get(routine.resultsThreadId) } : {}),
            ...(routine.sourceThreadId && threadIds.get(routine.sourceThreadId) ? { sourceThreadId: threadIds.get(routine.sourceThreadId) } : {}),
          } as Parameters<RoutineManager["create"]>[0], undefined, options.ownerPrincipalId ? { actorPrincipalId: options.ownerPrincipalId } : undefined);
          createdRoutines.push(created.id);
        } catch (error) {
          warnings.push(`Routine ${routine.name} was not imported: ${error instanceof Error ? error.message : String(error)}.`);
        }
      }
    }
    const webhookManager = host.webhooks();
    if (reader.has("webhooks.json") && webhookManager) {
      const list = z.array(webhookSchema).max(100).safeParse(reader.json("webhooks.json"));
      for (const hook of list.success ? list.data : []) {
        try {
          // An export without a catalog predates it: keep its “every event” as it was.
          const created = webhookManager.create({ ...hook, ...(hook.source ? { source: { catalog: 1, ...hook.source } } : {}), botId: id, enabled: false });
          createdWebhooks.push(created.webhook.id);
          const source = created.webhook.source;
          if (source) {
            // The secrets stayed behind: say what this copy still needs.
            const needs = [
              TRIGGER_SOURCES[source.type].secretMode === "provided" ? `the signing secret from ${TRIGGER_SOURCES[source.type].label}` : "",
              source.poller ? (source.poller.kind === "ics" ? "the calendar's private ICS link" : "the user name and password") : "",
              !source.poller && !source.graph && TRIGGER_SOURCES[source.type].secretMode === "generated" ? `the new secret and URL in ${TRIGGER_SOURCES[source.type].label}` : "",
            ].filter(Boolean);
            if (needs.length) warnings.push(`Trigger ${hook.name} needs ${needs.join(" and ")} before it is turned on.`);
          }
        } catch (error) {
          warnings.push(`Webhook ${hook.name} was not imported: ${error instanceof Error ? error.message : String(error)}.`);
        }
      }
    }

    // sharing, by email
    if (options.sharing && host.organization && reader.has("sharing.json")) {
      const sharing = sharingSchema.safeParse(reader.json("sharing.json"));
      if (sharing.success) {
        const grants = sharing.data.grants.flatMap((grant) => {
          if ("team" in grant) return [{ target: `team:${grant.team}`, level: grant.level, by: options.ownerPrincipalId ?? "", at: Date.now() }];
          const principal = host.principalByEmail(grant.email);
          if (!principal || principal === options.ownerPrincipalId) {
            if (!principal) warnings.push(`${grant.email} is not a person of this server: not shared.`);
            return [];
          }
          return [{ target: `user:${principal}`, level: grant.level, by: options.ownerPrincipalId ?? "", at: Date.now() }];
        });
        const clean = cleanBotGrants(grants);
        if (clean.length) store.setBotGrants(id, clean);
        if (sharing.data.visibility !== undefined) store.patchBot(id, { visibility: sharing.data.visibility });
      }
    }
    return { botId: id, name, warnings };
  } catch (error) {
    // Everything this import wrote goes; nothing that existed is touched.
    const routineManager = host.routines();
    for (const routine of createdRoutines) { try { routineManager?.remove(routine); } catch { /* best effort */ } }
    for (const hook of createdWebhooks) { try { host.webhooks()?.remove(hook); } catch { /* best effort */ } }
    if (botId) {
      try { store.deleteBot(botId); } catch { /* best effort */ }
      rmSync(host.plugins.folder(botId), { recursive: true, force: true });
      rmSync(join(host.dataDir, "task-workspaces", botId), { recursive: true, force: true });
      rmSync(workspaceDir(botId), { recursive: true, force: true });
      rmSync(botFolder(botId), { recursive: true, force: true });
    }
    for (const path of createdAttachments) rmSync(path, { force: true });
    if (error instanceof ZipError) throw new BotZipError(error.message, "invalid_zip");
    throw error;
  }
}
