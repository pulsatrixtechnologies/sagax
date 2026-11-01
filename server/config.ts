// Config + data dirs. One file, ~/.sagax/config.json, env fallbacks:
//   { "xai": {"key":"xai-…"}, "box": {"token":"…"},
//     "instances": { "<instanceId>": {"driver":"grok", …} } }
import { DEFAULT_MAX_PARALLEL_PER_PERSON, MAX_PARALLEL_PER_PERSON } from "../shared/parallel-tasks.ts";
import { readFileSync, mkdirSync, existsSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { normalizeImageGenerationUrl, type ImageGenerationConfig } from "../shared/image-generation.ts";

import { writeFileAtomic } from "./atomic.ts";
import { applyStoredEngineEnv } from "./engine-api-keys.ts";
import { migrateConfigPlaintextKeys, readOnboardingEngineKey } from "./onboarding-engine-key.ts";
import { withoutComputerEngine } from "./computer-engine-removal.ts";
import { newBotDefaultsSchema, type NewBotDefaults } from "./new-bot-defaults.ts";
import { loopDetectorConfigSchema, type LoopDetectorConfig } from "./loop-detector.ts";
import { EFFORT_LEVELS, type LiveSettings } from "../shared/wire.ts";
import { isModelVariant, type InstanceConfigMap, type ModelSelection } from "./contracts.ts";
import { PROVIDER_ICON_PRESETS, providerIconError } from "../shared/provider-icon.ts";
import type { McpServerSpec } from "./contracts.ts";
import type { MailSettings } from "./mail-config.ts";
import { isRemoteMcpServer, parseStoredMcpServer, reservedMcpServerLog, reservedMcpServerName } from "./mcp-registry.ts";
import { parseJson, schemaIssue, type JsonObject, type JsonValue } from "./schema.ts";
import { isPersonalBrowserProfileId } from "../shared/person-settings.ts";
import { browserEgressConfigSchema, type BrowserEgressConfig } from "./browser/egress/policy.ts";
import { currentEnvName, defaultDataDir } from "../electron/legacy-names.mjs";

const optionalText = z.string().optional();
const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const LEGACY_BROWSER_PROFILE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const BROWSER_PROFILE_ID = /^[a-z0-9_-]{1,40}$/;

/** Fish Audio speech models (`tts.fishModel`). `s2.1-pro-free` is Fish's
 * free developer tier; an unset model means `s2.1-pro`. */
export const FISH_TTS_MODELS = ["s2.1-pro", "s2.1-pro-free"] as const;
export type FishTtsModel = (typeof FISH_TTS_MODELS)[number];

export const DEFAULT_ROOM_TURN_TIMEOUT_MINUTES = 5;
export const MIN_ROOM_TURN_TIMEOUT_MINUTES = 1;
export const MAX_ROOM_TURN_TIMEOUT_MINUTES = 1_440;
/** Per-call ceiling for a bot's MCP tools (tools/call on the chat MCP
 * transport). 10 minutes matches the historic constant in
 * chat-mcp-tools.ts; a single tool call that runs longer is cut at this
 * deadline because its execution outcome can no longer be trusted. */
export const DEFAULT_MCP_CALL_TIMEOUT_MINUTES = 10;
export const MIN_MCP_CALL_TIMEOUT_MINUTES = 1;
export const MAX_MCP_CALL_TIMEOUT_MINUTES = 60;
export const DEFAULT_MAX_CONCURRENT_BOT_THREADS = 3;
export const MAX_CONCURRENT_BOT_THREADS = 16;
/** Bounds for threads.eventLogMaxBytes: the floor keeps the kept tail large
 * enough to still serve the event inspector's recent-line window; the
 * ceiling just rejects absurd hand edits. */
export const MIN_THREAD_EVENT_LOG_BYTES = 256 * 1024;
export const MAX_THREAD_EVENT_LOG_BYTES = 4 * 1024 * 1024 * 1024;
export const DEFAULT_LOCAL_VM_MODE = "shared" as const;
export const DEFAULT_LOCAL_VM_MAX_INSTANCES = 2;
export const MIN_LOCAL_VM_MAX_INSTANCES = 1;
export const MAX_LOCAL_VM_MAX_INSTANCES = 8;
/** Idle window before an unused Local VM is stopped: no turn on it, no
 * open viewer, no running command. Stopping removes only the disposable
 * container (this desktop image cannot safely resume); the durable folder
 * is kept and the next use starts it again. */
export const DEFAULT_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 10;
export const MIN_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_LOCAL_VM_IDLE_TIMEOUT_MINUTES = 1_440;

export function isValidSshAlias(value: unknown): value is string {
  return typeof value === "string" && SSH_ALIAS.test(value);
}

const CDP_PORT = /^[0-9]{1,5}$/;
const CDP_URL = /^(https?|wss?):\/\/\S+$/i;

/** A bare TCP port (agent-browser's `--cdp <port>` shorthand) or an
 * http(s)/ws(s) URL to a Chrome DevTools Protocol endpoint. */
export function isValidCdpTarget(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  if (CDP_PORT.test(value)) {
    const port = Number(value);
    return port >= 1 && port <= 65535;
  }
  return CDP_URL.test(value);
}

/** Keep the persisted VPS shape deliberately smaller than an SSH connection. */
export function normalizeVpsConfig(raw: unknown): { sshAlias?: string } {
  if (raw === undefined || raw === null) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("vps must be an object containing an SSH config alias");
  }
  const alias = (raw as Record<string, unknown>).sshAlias;
  if (alias === undefined || alias === "") return {};
  if (!isValidSshAlias(alias)) {
    throw new Error("vps.sshAlias must be a simple SSH config alias (letters, numbers, dot, dash, or underscore)");
  }
  return { sshAlias: alias };
}

const vpsConfigSchema = z.object({
  sshAlias: z.string().refine((value) => value === "" || isValidSshAlias(value), {
    message: "must be a simple SSH config alias",
  }).optional(),
});
/** Attach a bot's browser to a Chrome the operator already has running,
 * instead of agent-browser spawning its own (#1396). Deliberately a
 * server-owned config field, not an env-var passthrough: the ambient
 * process environment must never redirect a bot's browser
 * (server/browser-live.test.ts pins this guarantee down). */
const browserEngineConfigSchema = z.object({
  attachCdpUrl: z.string().trim().max(2048).refine((value) => value === "" || isValidCdpTarget(value), {
    message: "browserEngine.attachCdpUrl must be a CDP port (1-65535) or an http(s)/ws(s) URL",
  }).optional(),
  /** What the bots' browsers may reach past the public internet
   * (server/browser/egress/policy.ts, port of OpenMausBot #2930). */
  egress: browserEgressConfigSchema.optional(),
  idleTimeoutMinutes: z.number().int().min(1).max(60).optional(), // an unused browser closes after this (browserIdleMs)
});
const roomConfigSchema = z.object({
  turnTimeoutMinutes: z
    .number()
    .int()
    .min(MIN_ROOM_TURN_TIMEOUT_MINUTES)
    .max(MAX_ROOM_TURN_TIMEOUT_MINUTES),
});
const mcpConfigSchema = z.object({
  /** Ceiling (minutes) for one bot MCP tool call. Missing values resolve to
   * 10, preserving the historic chat-mcp-tools constant. */
  callTimeoutMinutes: z
    .number()
    .int()
    .min(MIN_MCP_CALL_TIMEOUT_MINUTES)
    .max(MAX_MCP_CALL_TIMEOUT_MINUTES)
    .optional(),
}).strict();
/** Isolation for bot desktops. Migration note (issue #1654): switching
 * modes changes lease keys and vm-home directories, so desktops cold-start
 * under the new mode — a pool seat lives in vm-homes/pool-N — while the old
 * mode's workspaces stay on disk until removed. maxInstances caps per-bot
 * desktops in per-bot mode, or the pool's seat count in pool mode; it is
 * not a total across modes. Default stays "shared". */
const localVmConfigSchema = z.object({
  mode: z.enum(["shared", "per-bot", "pool"]).optional(),
  maxInstances: z
    .number()
    .int()
    .min(MIN_LOCAL_VM_MAX_INSTANCES)
    .max(MAX_LOCAL_VM_MAX_INSTANCES)
    .optional(),
  idleTimeoutMinutes: z
    .number()
    .int()
    .min(MIN_LOCAL_VM_IDLE_TIMEOUT_MINUTES)
    .max(MAX_LOCAL_VM_IDLE_TIMEOUT_MINUTES)
    .optional(),
});
/** A named, shareable browser session ("Work", "Client A"). The id names a
 * durable Electron partition; user-controlled characters never reach it. */
const browserProfileSchema = z.object({
  // "guest" is the throwaway session's reserved id, never a saved profile
  // Lowercase is part of the storage contract: durable Chromium partition
  // directories would otherwise collide on case-insensitive filesystems.
  id: z.string().regex(BROWSER_PROFILE_ID).refine((id) => id !== "guest", "guest is reserved")
    // a person's own profile ids (shared/person-settings.ts, #1098)
    .refine((id): boolean => !isPersonalBrowserProfileId(id), "mine- ids are a person's own profiles"),
  name: z.string().trim().min(1).max(40),
}).strict();
// #567 accepted mixed-case and duplicate ids. This schema exists only at the
// persisted-data boundary so an existing config can be read and migrated;
// API patches and save inputs continue to use browserProfileSchema above.
const legacyBrowserProfileSchema = z.object({
  id: z.string().regex(LEGACY_BROWSER_PROFILE_ID).refine((id) => id !== "guest", "guest is reserved"),
  name: z.string().trim().min(1).max(40),
  /** Exact #567 Electron partition identity. This is persisted only by the
   * migration boundary; config PATCH callers cannot choose or redirect it. */
  partitionId: z.string().regex(LEGACY_BROWSER_PROFILE_ID).refine((id) => id !== "guest", "guest is reserved").optional(),
}).strict();

interface StoredBrowserProfileMigration {
  profiles: BrowserProfile[];
  /** Exact legacy id to its first canonical entry. Duplicate legacy ids are
   * inherently ambiguous, so bots deterministically retain the first one. */
  aliases: ReadonlyMap<string, string>;
}

function suffixedBrowserProfileId(base: string, unavailable: ReadonlySet<string>): string {
  for (let suffix = 2; ; suffix += 1) {
    const ending = `-${suffix}`;
    const candidate = `${base.slice(0, 40 - ending.length)}${ending}`;
    if (candidate !== "guest" && !unavailable.has(candidate)) return candidate;
  }
}

function migrateStoredBrowserProfiles(
  profiles: Array<z.output<typeof legacyBrowserProfileSchema>>,
): StoredBrowserProfileMigration {
  const requestedPartitions = profiles.map((profile) => profile.partitionId ?? profile.id);
  const rawBases = profiles.map((profile) => profile.id.toLowerCase());

  // Canonical logical ids must be stable even if bots.json is migrated before
  // config.json is rewritten. Give an exact lowercase spelling first claim on
  // its id, then the first case variant. Generated ids avoid every legacy base
  // and partition spelling, so applying the same legacy alias map again cannot
  // reinterpret a previously migrated bot reference.
  const canonicalIds: Array<string | undefined> = Array(profiles.length).fill(undefined);
  const used = new Set<string>();
  const baseOwner = new Map<string, number>();
  rawBases.forEach((base, index) => {
    if (base === "guest") return;
    const current = baseOwner.get(base);
    if (current === undefined || (profiles[index]!.id === base && profiles[current]!.id !== base)) {
      baseOwner.set(base, index);
    }
  });
  for (const [base, index] of baseOwner) {
    canonicalIds[index] = base;
    used.add(base);
  }
  const reserved = new Set([
    "guest",
    ...rawBases,
    ...requestedPartitions.map((partitionId) => partitionId.toLowerCase()),
  ]);
  rawBases.forEach((base, index) => {
    if (canonicalIds[index] !== undefined) return;
    const id = suffixedBrowserProfileId(base, new Set([...reserved, ...used]));
    canonicalIds[index] = id;
    used.add(id);
  });

  // Chromium partition directories collide by case on Windows and default
  // macOS volumes. Pick one safe owner for every case-folded identity. Prefer
  // the profile whose canonical id matches that partition; every loser gets a
  // new partition named after its collision-safe logical id.
  const partitionWinner = new Map<string, number>();
  requestedPartitions.forEach((partitionId, index) => {
    const folded = partitionId.toLowerCase();
    const current = partitionWinner.get(folded);
    if (current === undefined) {
      partitionWinner.set(folded, index);
      return;
    }
    const score = (candidate: number) => canonicalIds[candidate] === folded ? 1 : 0;
    if (score(index) > score(current)) partitionWinner.set(folded, index);
  });

  let effectivePartitions = requestedPartitions.map((partitionId, index) =>
    partitionWinner.get(partitionId.toLowerCase()) === index ? partitionId : canonicalIds[index]!,
  );

  // An earlier implementation could produce a cycle such as
  // `foo-2 -> partition foo-2-2` and `foo-2-2 -> partition FOO-2`. The
  // partitions are distinct today, but deleting and re-adding either id would
  // join the other account. Move the *logical id owner* to a fresh id while
  // retaining both exact durable partitions. Fresh ids avoid every raw id, so
  // the old->new bot aliases below remain fixed points across repeated starts.
  const conflictingIdOwners = new Set<number>();
  canonicalIds.forEach((id, owner) => {
    effectivePartitions.forEach((partitionId, partitionOwner) => {
      if (partitionOwner !== owner && partitionId.toLowerCase() === id) conflictingIdOwners.add(owner);
    });
  });
  const unavailable = new Set([...reserved, ...used]);
  for (const owner of conflictingIdOwners) {
    const id = suffixedBrowserProfileId(rawBases[owner]!, unavailable);
    canonicalIds[owner] = id;
    unavailable.add(id);
  }
  if (conflictingIdOwners.size > 0) {
    effectivePartitions = requestedPartitions.map((partitionId, index) =>
      partitionWinner.get(partitionId.toLowerCase()) === index ? partitionId : canonicalIds[index]!,
    );
  }

  const aliases = new Map<string, string>();
  const canonical: BrowserProfile[] = profiles.map((profile, index) => {
    const id = canonicalIds[index]!;
    const partitionId = effectivePartitions[index]!;
    const migrated: BrowserProfile = { id, name: profile.name };
    if (partitionId !== id) migrated.partitionId = partitionId;
    // Exact duplicates are inherently ambiguous. Preserve the first mapping;
    // later duplicate records get isolated ids but existing bot references
    // cannot be distinguished from the first record.
    if (!aliases.has(profile.id)) aliases.set(profile.id, id);
    return migrated;
  });
  return { profiles: canonical, aliases };
}

const legacyBrowserProfilesSchema = z.array(legacyBrowserProfileSchema).max(20);
const storedBrowserProfilesSchema = legacyBrowserProfilesSchema.transform(
  (profiles) => migrateStoredBrowserProfiles(profiles).profiles,
);
const browserProfilesSchema = z.array(browserProfileSchema).max(20).superRefine((profiles, ctx) => {
  const seen = new Set<string>();
  profiles.forEach((profile, index) => {
    if (!seen.has(profile.id)) {
      seen.add(profile.id);
      return;
    }
    ctx.addIssue({
      code: "custom",
      path: [index, "id"],
      message: `browser profile id ${profile.id} is duplicated`,
    });
  });
});
// Deliberately non-strict: an unknown flag (such as `skillRecorder`, the
// pre-rename name a stale client may still PATCH) is dropped as a no-op
// instead of failing the whole stored config or the request.
const featureConfigSchema = z.object({
  /** Bots may draft skills (skill_manage, the Verify card's Save as skill,
   * /learn) for your review. On unless explicitly switched off in Settings;
   * every draft still waits for review. */
  skillAuthoring: z.boolean().optional(),
  /** Show each tool run in the transcript. Off unless explicitly enabled. */
  showToolCalls: z.boolean().optional(),
  /** Run a routine inside the conversation it reports to, instead of a hidden
   * thread. Off unless explicitly enabled. The run still starts from its own
   * instructions, but the messages stay in that chat. */
  routinesInConversation: z.boolean().optional(),
  /** Templates in the sidebar's bottom menu (the team library). Off unless
   * explicitly enabled; a package install link still opens the library. */
  templates: z.boolean().optional(),
  /** VPS Computer (a bot's computer on the person's own VPS): Settings card,
   * bot pickers. Off unless explicitly enabled (experimental). */
  vpsComputer: z.boolean().optional(),
  /** Boat Computer (a cloud computer, "Boat"): Settings card, bot pickers,
   * team map. Off unless explicitly enabled (experimental). */
  boatComputer: z.boolean().optional(),
  /** Settings > Decision model. Off unless explicitly enabled (experimental).
   * Does not change whether the decider runs. */
  decisionModel: z.boolean().optional(),
  /** The Data window (a bot's DuckDB results in a window of their own,
   * opened from the chat header). Off unless explicitly enabled
   * (experimental). */
  dataWindow: z.boolean().optional(),
  /** The meeting notetaker (join_meeting, server/meetings): a bot joins a
   * Google Meet and takes notes. Off unless explicitly enabled
   * (experimental: not yet validated on a real meeting). */
  meetingNotetaker: z.boolean().optional(),
  /** Settings > General's Routines in the conversation row and Group turns
   * card. Off unless explicitly enabled (experimental): hidden only, their
   * saved values keep applying. */
  routineGroupSettings: z.boolean().optional(),
  /** Experimental built-in browser. Off until explicitly enabled; each bot
   * also has its own switch. */
  browser: z.boolean().optional(),
  /** Opt-in computer sharing (a desktop lending folders, a terminal or
   * computer control to a workspace). Off until explicitly enabled; there is
   * no Settings toggle — see sharedComputersEnabled. */
  sharedComputers: z.boolean().optional(),
  /** Claude bots also load the MCP servers and connectors from this
   * machine's own Claude Code setup (Capabilities > Installed switch). Off by
   * default: each extra tool costs tokens on every model call. */
  claudeUserMcp: z.boolean().optional(),
  /** LLM-generated titles for new bot threads. Off until explicitly
   * enabled; a one-shot that fails or answers junk leaves the first-message
  * snippet in place — see llmThreadTitlesEnabled. */
  llmThreadTitles: z.boolean().optional(),
  /** Before each turn, passages from the bot's own memory files and earlier
   * conversations that share words with the message ride into the turn.
   * Read-only; on unless explicitly switched off — see autoRecallEnabled. */
  autoRecall: z.boolean().optional(),
  /** Skills referenced by bots instead of per-workspace copies.
   * Available unless explicitly switched off. */
  skillsLibrary: z.boolean().optional(),
});
/** First-run progress. Kept in the workspace config rather than a browser so
 * it survives cleared site data and is shared by every paired client. Hint
 * ids are short renderer-chosen slugs; the list is capped so a buggy client
 * cannot grow the file without bound. */
const onboardingConfigSchema = z.object({
  /** ISO timestamp of finishing (or skipping to the end of) the welcome flow. */
  completedAt: z.string().trim().max(40).optional(),
  /** Which welcome flow was completed; a newer flow may re-show itself. */
  version: z.number().int().min(0).max(1000).optional(),
  reelSeen: z.boolean().optional(),
  hintsSeen: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
  /** The desktop launch screen's choice: no server (solo) or an
   * organization server (src/lib/launch.ts). */
  launchMode: z.enum(["solo", "server"]).optional(),
  /** OMB Cloud home only: when a bot's turn first finished on this machine
   * (cloud-home.ts firstCloudTurnPatch). Written by the server, read by the
   * Cloud's setup checklist. */
  firstTurnAt: z.string().trim().max(40).optional(),
}).strict();
const instanceConfigSchema = z.object({
  driver: z.string().min(1),
  displayName: optionalText,
  accentColor: optionalText,
  icon: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("preset"), preset: z.enum(PROVIDER_ICON_PRESETS) }).strict(),
    z.object({ kind: z.literal("custom"), dataUrl: z.string() }).strict()
      .refine((icon) => providerIconError(icon) === null, { message: "Invalid provider icon" }),
  ]).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  access: z.enum(["subscription", "custom", "api"]).optional(),
  config: z.json().optional(),
});
const instanceConfigMapSchema = z.record(z.string(), instanceConfigSchema);
const defaultModelSelectionSchema = z.object({
  instanceId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(500),
  effort: z.enum(EFFORT_LEVELS).optional(),
  variant: z.string().refine(isModelVariant, "invalid model variant").optional(),
}).refine((selection) => selection.variant === undefined || selection.effort === undefined,
  "choose either a model variant or an effort level");
const automaticRecoverySchema = z.object({
  enabled: z.boolean(),
  backup: defaultModelSelectionSchema.optional(),
}).strict().refine((recovery) => !recovery.enabled || recovery.backup !== undefined,
  { message: "Choose a backup model before enabling automatic recovery", path: ["backup"] });
const threadsConfigSchema = z.object({
  maxConcurrentPerBot: z.number().int().min(1).max(MAX_CONCURRENT_BOT_THREADS),
  /** Parallel tasks (shared/parallel-tasks.ts) one person may have running on
   * one bot at once; more wait for one of theirs to finish. Absent: 3. */
  maxParallelPerPerson: z.number().int().min(1).max(MAX_PARALLEL_PER_PERSON).optional(),
  /** Cap each per-thread events/ and native/ NDJSON log at this many
   * bytes; absent (the default) keeps today's unbounded growth (#1280). */
  eventLogMaxBytes: z.number().int().min(MIN_THREAD_EVENT_LOG_BYTES).max(MAX_THREAD_EVENT_LOG_BYTES).optional(),
  /** Days a closed or archived thread's event logs survive (#1280).
   * Absent keeps them forever. */
  eventLogRetentionDays: z.number().int().min(1).max(3650).optional(),
}).strict();
/** PATCH threads: every knob is independently patchable, and null clears an
 * event-log knob back to its absent (off) default. */
const threadsPatchSchema = threadsConfigSchema.extend({
  maxConcurrentPerBot: threadsConfigSchema.shape.maxConcurrentPerBot.optional(),
  maxParallelPerPerson: z.number().int().min(1).max(MAX_PARALLEL_PER_PERSON).nullable().optional(),
  eventLogMaxBytes: threadsConfigSchema.shape.eventLogMaxBytes.nullable(),
  eventLogRetentionDays: threadsConfigSchema.shape.eventLogRetentionDays.nullable(),
});
const appConfigSchema = z.object({
  /** Verified by the dedicated domain endpoint, never a generic config patch. */
  customDomain: z.string().optional(),
  /** Who may sign in with an emailed code (server/account-signin.ts):
   * addresses or `@domain` entries; admins get every scope, members chat only. */
  signIn: z.object({ admins: z.array(z.string().max(320)).max(500).optional(), members: z.array(z.string().max(320)).max(5000).optional() }).optional(),
  // Slice 8: the interim organization (`org`) was removed; an older
  // config.json that still has it loads, the key is dropped on read and
  // never written back. A solo server keeps its email sign-in list,
  // invitations and mail transport (above and below).
  /** Organization server settings (SAGAX_IDENTITY=perspicax, slice 3). The
   * slice 3 switch `memberBotsUseOrgKey` was retired on 2026-10-01 (the
   * organization's key now serves whenever an admin set one,
   * engine-credentials.ts): an older config.json that still has it loads,
   * the key is dropped on read and removed at the next start
   * (dropRetiredOrganizationKeys). */
  organization: z.object({
    /** Slice 8: the window to attach people from before Perspicax
     * (server/interim-attach-routes.ts), written at the first organization
     * start that found any. */
    interimAttach: z.object({ since: z.number().finite().nonnegative(), days: z.number().int().min(0).max(90) }).optional(),
    /** Whether bots of the organization may run with Full access
     * (server/org-full-access.ts). Absent means allowed; an admin turns it
     * off in Settings > Organization. */
    allowFullAccess: z.boolean().optional(),
    /** 2026-10-16: a bot a member owns runs its commands in its owner's
     * own isolated environment (their server environment, their Local VM)
     * without an approval card (server/member-environment.ts). Absent means
     * on; an admin turns it off in Settings > Organization. */
    memberEnvironmentAutonomy: z.boolean().optional(),
    /** 2026-10-16: new threads start confidential unless the person
     * says otherwise (server/confidential-threads.ts). Absent means off; an
     * admin turns it on in Settings > Organization. */
    confidentialThreadsByDefault: z.boolean().optional(),
    /** 2026-10-16: a bot a member owns runs its Auto and Auto-accept edits
     * levels as such unless this is false (server/member-auto-approval.ts).
     * Absent means allowed; an admin turns it off in Settings >
     * Organization. */
    memberAutoApproval: z.boolean().optional(),
    /** 2026-10-18: whether people may export their credential vault in clear
     * (Settings > Credentials > Export, server/routes/credential-vault.ts).
     * Absent means allowed; an admin turns it off in Settings >
     * Organization. Organization servers only; a solo server always allows. */
    allowVaultExport: z.boolean().optional(),
    /** When the one-time pass, the first time the setting above was off,
     * set members' saved Auto and Auto-accept edits levels back to Ask
     * (server/member-auto-approval.ts). */
    memberAutoResetAt: z.number().finite().nonnegative().optional(),
    /** Where bots' Claude Code plugins may come from (server/bot-plugins.ts).
     * Absent means any marketplace; an admin may keep a list. */
    pluginMarketplaces: z.union([
      z.object({ mode: z.literal("any") }).strict(),
      z.object({ mode: z.literal("list"), allow: z.array(z.string().max(300)).max(100) }).strict(),
    ]).optional(),
    /** The organization's GitHub OAuth App (device flow) for "Connecter
     * GitHub"; SAGAX_GITHUB_CLIENT_ID provides a default. */
    githubClientId: z.string().max(128).optional(),
    /** 2026-10-08, the console's Settings: the engine instances bots may be
     * switched to from the console. Absent means every engine. */
    allowedEngines: z.array(z.string().max(80)).max(100).optional(),
    /** 2026-10-30: a member may run an engine outside `allowedEngines` on
     * their own subscription or key (the #1098 exception, now the admin's
     * choice). Absent or false: an engine off the list is off for everyone,
     * admins included. */
    ownAccountsOutsideList: z.boolean().optional(),
    /** 2026-10-30 (lot 2): models the organization turned off, as
     * `<engine>/<model>` (shared/offered-models.ts). Off for everyone. */
    disabledModels: z.array(z.string().max(300)).max(2000).optional(),
    /** #1098: folders of the server's disk an admin opened to members as
     * working folders, keyed by principal id or `*` for every member
     * (server/member-folders.ts). */
    memberFolders: z.record(z.string().max(200), z.array(z.string().max(1024)).max(50)).optional(),
  }).optional(),
  /** When stored person references became principal ids (server/identity-migration.ts). */
  identityMigratedAt: z.number().optional(),
  /** When every bot thread got its owner (server/thread-privacy.ts). */
  privateThreadsMigratedAt: z.number().optional(),
  invites: z.array(z.object({
    token: z.string().min(1),
    email: z.string().max(320),
    createdAt: z.number(),
    expiresAt: z.number(),
    usedAt: z.number().optional(),
    revokedAt: z.number().optional(),
  })).max(5000).optional(),
  /** Mail transport for server-issued sign-in codes and invitations
   * (server/mail-config.ts, server/mailer.ts). Saved by Settings > Email
   * (server/mail-routes.ts), never by a generic config patch; a saved field
   * wins over its SAGAX_MAIL_* environment default. */
  mail: z.object({
    provider: z.enum(["smtp", "sendgrid", "twilio"]).optional(),
    from: optionalText,
    fromName: optionalText,
    smtp: z.object({
      host: optionalText,
      port: z.number().int().min(1).max(65535).optional(),
      secure: z.enum(["tls", "starttls", "none"]).optional(),
      user: optionalText,
      password: optionalText,
    }).optional(),
    sendgrid: z.object({ apiKey: optionalText }).optional(),
    twilio: z.object({ apiKeySid: optionalText, apiKeySecret: optionalText }).optional(),
  }).optional(),
  defaultModelSelection: defaultModelSelectionSchema.optional(),
  automaticRecovery: automaticRecoverySchema.optional(),
  newBotDefaults: newBotDefaultsSchema.optional(),
  /** CLI-only launch preferences. Never enable remote access implicitly. */
  cliStartup: z.object({
    access: z.enum(["local", "tunnel", "tailscale", "public-url"]),
    publicUrl: z.string().url().optional(),
    phone: z.enum(["ios", "android"]).optional(),
  }).optional(),
  mistral: z.object({ key: optionalText }).optional(),
  cerebras: z.object({ key: optionalText }).optional(),
  groq: z.object({ key: optionalText, url: optionalText }).optional(),
  xai: z.object({ key: optionalText, url: optionalText }).optional(),
  /** Anthropic API key for Claude Code billed per token, handed only to
   * Claude instances; `url` only for a proxy or a test double. Never a
   * personal-login OAuth token. */
  anthropic: z.object({ key: optionalText, url: optionalText, everyClaudeBot: z.boolean().optional() }).optional(),
  /** OpenAI's own API key, for the `openai` instance only. Codex keeps its
   * own ChatGPT or API login and never reads this. */
  openai: z.object({ key: optionalText }).optional(),
  /** OpenRouter key, for the `openrouter` instance only. */
  openrouter: z.object({ key: optionalText }).optional(),
  /** Monthly spend limit for the whole workspace, against the cost engines
   * report to the usage ledger. Enforced while the `budgets` feature is on:
   * always in the open-source edition (server/enterprise.ts). */
  budgets: z
    .object({
      monthlyUsd: z.number().min(0).max(1_000_000).optional(),
      warnAtPercent: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
  /** The operator's own sell prices per million tokens, keyed by model id,
   * `driver/model`, or `default`. Read while the `billing` feature is on:
   * always in the open-source edition. */
  billing: z
    .object({
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      prices: z
        .record(
          z.string().min(1).max(160),
          z.object({
            inputPerMillion: z.number().min(0).max(1_000_000),
            outputPerMillion: z.number().min(0).max(1_000_000),
            cachedInputPerMillion: z.number().min(0).max(1_000_000).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  /** `model` seeds the default selection; `provider` pins an OpenRouter
   * upstream (e.g. "fireworks"). Both are non-secret and optional. */
  openaiCompat: z
    .object({ key: optionalText, url: optionalText, model: optionalText, provider: optionalText })
    .optional(),
  /** 2026-10-30: the keys of the named OpenAI-compatible servers added from
   * the app (server/openai-compat-servers.ts), by engine instance id. Each
   * server's name and address live in its `instances` entry; only the key
   * is here, write-only, handed to that one instance. */
  openaiCompatServers: z.record(z.string().max(80), z.object({ key: optionalText }).strict()).optional(),
  /** 2026-10-30 (lot 2): on a solo server, the models its person turned off
   * (`<engine>/<model>`, shared/offered-models.ts). */
  disabledModels: z.array(z.string().max(300)).max(2000).optional(),
  /** Historical config section name "box" (the persisted config.json key); the
   * provider is Boat now and the key is kept for compatibility. */
  box: z.object({ token: optionalText }).optional(),
  vps: vpsConfigSchema.optional(),
  /** Optional OpenCode key; persisted write-only and passed only to its child.
   * `providerKeys`: keys for OpenCode's other providers (Venice, Groq…) by the
   * environment name OpenCode reads, also write-only and only for its child.
   * Settings changes go through mergeOpenCodeProviderKeys; the stored copy
   * is read loosely (storedAppConfigSchema). */
  opencodeGo: z.object({ apiKey: optionalText, providerKeys: z.record(z.string(), z.string()).optional() }).optional(),
  /** Voice settings and the selected voice id. `provider` picks the
   * engine: "elevenlabs" (default; needs `key`), "fish" (needs its own
   * `fishKey`; `fishModel` picks its speech model), "system" (the Mac's
   * built-in voices, no key), "xai" (Grok TTS, on the xAI key `xai.key`
   * since 2026-10-14), or "chatterbox" (a local OpenAI-compatible
   * Chatterbox server; `baseUrl` and `model` are settings, not secrets).
   * `xaiKey` is the Grok voice key of older builds, read only to fold it
   * into `xai.key` (migrateGrokVoiceKey, loadConfig, foldGrokVoiceKeyPatch). */
  tts: z.object({
    key: optionalText,
    fishKey: optionalText,
    xaiKey: optionalText,
    voice: optionalText,
    provider: z.enum(["elevenlabs", "fish", "system", "chatterbox", "xai"]).optional(),
    baseUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => !value || /^https?:\/\//i.test(value), "the Chatterbox server address must start with http:// or https://")
      .optional(),
    model: optionalText,
    fishModel: z.enum(FISH_TTS_MODELS).optional(),
  }).optional(),
  /** The decision model (server/decider): a fast classifier that picks
   * things for bots, starting with who answers a room message. `key` is
   * write-only like every credential; `baseUrl` points at a Jev-compatible
   * server instead of TypeSafe's (an operator setting with no UI); `jobs`
   * switches each decision on or off. Not `decisions`: that section is the
   * authorization log's retention. */
  decider: z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(["jev", "off"]).optional(),
    key: optionalText,
    baseUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => !value || /^https?:\/\//i.test(value), "the decision model address must start with http:// or https://")
      .optional(),
    jobs: z.object({ roomRouting: z.boolean().optional() }).optional(),
  }).optional(),
  /** Live calls use the OpenAI provider. `voice` is a built-in voice name. */
  live: z.object({
    voice: z.string().trim().max(40).regex(/^[a-z]*$/, "a Live voice is a lowercase built-in voice name").optional(),
    readTypedReplies: z.boolean().optional(),
    idleMinutes: z.number().int().min(1).max(60).optional(),
  }).optional(),
  /** Avatar provider credentials stay separate; choosing a router never reuses a cloud key. */
  imageGen: z.object({
    provider: z.enum(["openai", "xai", "custom"]).optional(),
    key: optionalText,
    customApiKey: optionalText,
    customUrl: z.string().trim().max(2048).transform((value, ctx) => {
      if (!value) return "";
      try { return normalizeImageGenerationUrl(value); } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message });
        return z.NEVER;
      }
    }).optional(),
    customModel: z.string().trim().max(200).refine(
      (value) => !["\r", "\n", "\0"].some((character) => value.includes(character)),
      "Use a model ID without control characters",
    ).optional(),
  }).optional(),
  /** Non-secret profile details; aboutMe is shared with every bot. */
  profile: z.object({
    name: optionalText,
    email: optionalText,
    aboutMe: z.string().max(24_000).optional(),
    avatarUrl: z.string().max(300_000).optional(),
  }).optional(),
  /** UI language override (BCP-47, lowercase). Empty/absent = follow the
   * system language. Unknown tags degrade to English in the renderer. */
  language: optionalText,
  rooms: roomConfigSchema.optional(),
  mcp: mcpConfigSchema.optional(),
  context: z.object({
    rebuildBytes: z.number().int().min(1_024).max(1_000_000).optional(),
    compactAt: z.number().positive().max(10_000_000).optional(),
    autoCompact: z.boolean().optional(),
    /** Debugging only, never in the app: bots whose threads Sagax does not
     * fold on its own. Their engines then compact the way they would
     * without Sagax, and the person may notice it. */
    autoCompactOffBots: z.array(z.string().min(1).max(200)).max(1_000).optional(),
    /** Hours of quiet after which a thread's engine session is not resumed
     * but rebuilt from Sagax's summary (server/stale-session.ts; default 6,
     * 0 turns the check off). */
    staleSessionHours: z.number().min(0).max(24 * 365).optional(),
    /** Saved engine session size (bytes) past which it is not resumed
     * (default 2 MB, 0 off), once quiet for staleSessionColdMinutes.
     * Engines that report no size: time only. */
    staleSessionBytes: z.number().int().min(0).max(10_000_000_000).optional(),
    /** Minutes of quiet before the size check applies (default 60). */
    staleSessionColdMinutes: z.number().min(0).max(24 * 60 * 30).optional(),
  }).optional(),
  /** Stops a run that repeats itself (server/loop-detector.ts). Absent
   * fields take the defaults; `enabled: false` turns it off. */
  loopDetector: loopDetectorConfigSchema.optional(),
  /** Memory upkeep timing, for bots with Memory upkeep switched on. */
  memory: z.object({
    /** Quiet time after a turn before its facts are captured (ms). */
    captureQuietMs: z.number().int().min(1_000).max(24 * 60 * 60_000).optional(),
    /** Local hour (0-23) after which the nightly tidy-up runs. */
    tidyHour: z.number().int().min(0).max(23).optional(),
    /** Recall by meaning beside FTS5 (server/semantic-index.ts). On unless
     * false, or SAGAX_SEMANTIC_RECALL=0. */
    semanticRecall: z.boolean().optional(),
    /** An OpenAI-compatible embeddings endpoint the person runs (Ollama,
     * LM Studio, a local MLX server): `http://127.0.0.1:11434/v1`. Empty:
     * the built-in vectors only. */
    embeddingsUrl: z.string().max(2_000).refine((value) => value === "" || /^https?:\/\/[^\s]+$/i.test(value), "an http(s) address").optional(),
    /** The embedding model that endpoint serves, e.g. `nomic-embed-text`. */
    embeddingsModel: z.string().max(200).optional(),
  }).strict().optional(),
  /** Routines a bot creates through the approval flow. */
  routines: z.object({
    /** Start them paused (default true): the owner resumes them when ready. */
    newPaused: z.boolean().optional(),
  }).strict().optional(),
  threads: threadsConfigSchema.optional(),
  /** The authorization decision log (server/decision-log.ts): days of month
   * files kept, at least; SAGAX_DECISION_RETENTION_DAYS wins when set. */
  decisions: z.object({ retentionDays: z.number().int().min(1).max(3650).optional() }).strict().optional(),
  localVm: localVmConfigSchema.optional(),
  features: featureConfigSchema.optional(),
  onboarding: onboardingConfigSchema.optional(),
  /** CDP attach target for a bot's browser; see browserEngineConfigSchema. */
  browserEngine: browserEngineConfigSchema.optional(),
  browserProfiles: browserProfilesSchema.optional(),
  instances: instanceConfigMapSchema.optional(),
  /** User-configured MCP servers, mounted into every capable engine. Kept
   * loosely typed HERE on purpose: parseStoredConfig throws away the whole
   * file on a schema error, and one bad server entry must degrade to a
   * skipped entry (customMcpServers), never to a vanished config. */
  mcpServers: z.record(z.string(), z.unknown()).optional(),
  /** Connectors the engines bring with a person's own account
   * (server/harness-connectors.ts). Retired: they are always on and nothing
   * reads this block any more. It stays in the schema only so a config that
   * still holds `claudeAi: false` keeps loading (the value is ignored). */
  harnessConnectors: z.object({ claudeAi: z.boolean().optional() }).strict().optional(),
});
const storedAppConfigSchema = appConfigSchema.extend({
  browserProfiles: storedBrowserProfilesSchema.optional(),
  /** Read loosely, like mcpServers: a hand-edited provider key that isn't
   * text is dropped here, and a bad name or key later
   * (openCodeProviderKeys), never the whole file. */
  opencodeGo: z.object({
    apiKey: optionalText,
    providerKeys: z.record(z.string(), z.unknown()).catch({})
      .transform((keys) => Object.fromEntries(Object.entries(keys).filter((entry): entry is [string, string] => typeof entry[1] === "string")))
      .optional(),
  }).optional(),
});
const appConfigPatchSchema = appConfigSchema.omit({ instances: true, mcpServers: true, harnessConnectors: true, cliStartup: true, customDomain: true, identityMigratedAt: true, privateThreadsMigratedAt: true, invites: true, mail: true })
  .extend({ threads: threadsPatchSchema.optional() });
const jsonObjectSchema = z.record(z.string(), z.json());

export interface AppConfig {
  customDomain?: string;
  signIn?: { admins?: string[]; members?: string[] };

  /** Organization server settings (slice 3); see appConfigSchema. */
  organization?: {
    interimAttach?: { since: number; days: number };
    allowFullAccess?: boolean;
    memberEnvironmentAutonomy?: boolean;
    confidentialThreadsByDefault?: boolean;
    memberAutoApproval?: boolean;
    allowVaultExport?: boolean;
    memberAutoResetAt?: number;
    pluginMarketplaces?: { mode: "any" } | { mode: "list"; allow: string[] };
    githubClientId?: string;
    allowedEngines?: string[];
    /** 2026-10-30: own subscriptions and keys run engines outside the list. */
    ownAccountsOutsideList?: boolean;
    /** 2026-10-30: models the organization turned off (`<engine>/<model>`). */
    disabledModels?: string[];
    /** #1098: folders of the server's disk an admin opened to members as
     * working folders, by principal id or `*` (server/member-folders.ts). */
    memberFolders?: Record<string, string[]>;
  };
  /** When stored person references became principal ids (server/identity-migration.ts). */
  identityMigratedAt?: number;
  /** When every bot thread got its owner (server/thread-privacy.ts). */
  privateThreadsMigratedAt?: number;
  invites?: Array<{
    token: string;
    email: string;
    createdAt: number;
    expiresAt: number;
    usedAt?: number;
    revokedAt?: number;
  }>;
  mail?: MailSettings;
  /** CLI mirror of `newBotDefaults.profile.modelSelection`. The template wins:
   * saving defaults writes this field, and a CLI write of this field copies
   * into the template when one is already stored. */
  defaultModelSelection?: ModelSelection;
  /** Off by default; one backup attempt only before any work starts. */
  automaticRecovery?: { enabled: boolean; backup?: ModelSelection };
  /** UI creation template. Saving it never mutates a bot or grants access.
   * Its model selection effort is the only new-bot effort. */
  newBotDefaults?: NewBotDefaults;
  cliStartup?: {
    access: "local" | "tunnel" | "tailscale" | "public-url";
    publicUrl?: string;
    phone?: "ios" | "android";
  };
  mcpServers?: Record<string, unknown>;
  /** See appConfigSchema.harnessConnectors. */
  harnessConnectors?: { claudeAi?: boolean };
  language?: string;
  xai?: { key?: string; url?: string };
  mistral?: { key?: string };
  cerebras?: { key?: string };
  groq?: { key?: string; url?: string };
  /** Legacy every-Claude selection migration marker. False after old
   * paid choices move onto claudeApi; never changes credential routing. */
  anthropic?: { key?: string; url?: string; everyClaudeBot?: boolean };
  openai?: { key?: string };
  openrouter?: { key?: string };
  budgets?: { monthlyUsd?: number; warnAtPercent?: number };
  decisions?: { retentionDays?: number };
  billing?: { currency?: string; prices?: Record<string, { inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion?: number }> };
  openaiCompat?: { key?: string; url?: string; model?: string; provider?: string };
  /** 2026-10-30: each named OpenAI-compatible server's key, by instance id. */
  openaiCompatServers?: Record<string, { key?: string }>;
  /** 2026-10-30: a solo server's own model switches (`<engine>/<model>` off). */
  disabledModels?: string[];
  /** Persisted under the historical config key "box" (ascii.dev renamed Box to Boat). */
  box?: { token?: string };
  /** A named host from the user's SSH config. Authentication stays with SSH. */
  vps?: { sshAlias?: string };
  /** Shell resources offered in the in-chat terminal (credentials stay with SSH). */
  terminalShell?: {
    unraidSshAlias?: string;
    hosts?: Array<{ id: string; label: string; hostLabel?: string; alias: string; provider?: string }>;
  };
  opencodeGo?: { apiKey?: string; providerKeys?: Record<string, string> };
  tts?: { key?: string; fishKey?: string; xaiKey?: string; voice?: string; provider?: "elevenlabs" | "fish" | "system" | "chatterbox" | "xai"; baseUrl?: string; model?: string; fishModel?: FishTtsModel };
  /** The decision model; see the schema above and server/decider. */
  decider?: { enabled?: boolean; provider?: "jev" | "off"; key?: string; baseUrl?: string; jobs?: { roomRouting?: boolean } };
  imageGen?: ImageGenerationConfig;
  live?: { voice?: string; readTypedReplies?: boolean; idleMinutes?: number };
  profile?: { name?: string; email?: string; aboutMe?: string; avatarUrl?: string };
  rooms?: { turnTimeoutMinutes: number };
  mcp?: { callTimeoutMinutes?: number };
  threads?: { maxConcurrentPerBot: number; maxParallelPerPerson?: number; eventLogMaxBytes?: number; eventLogRetentionDays?: number };
  context?: { rebuildBytes?: number; compactAt?: number; autoCompact?: boolean; autoCompactOffBots?: string[]; staleSessionHours?: number; staleSessionBytes?: number; staleSessionColdMinutes?: number };
  loopDetector?: LoopDetectorConfig;
  memory?: { captureQuietMs?: number; tidyHour?: number; semanticRecall?: boolean; embeddingsUrl?: string; embeddingsModel?: string };
  routines?: { newPaused?: boolean };
  /** Shared preserves the historical singleton. Per-bot gives every bot a
   * separate container, durable workspace, viewer and lease. Pool runs N
   * seats shared by all conversations, with per-thread affinity (#1654). */
  localVm?: { mode?: "shared" | "per-bot" | "pool"; maxInstances?: number; idleTimeoutMinutes?: number };
  /** Opt-in product experiments. Every flag defaults to disabled. */
  features?: { skillAuthoring?: boolean; showToolCalls?: boolean; browser?: boolean; sharedComputers?: boolean; claudeUserMcp?: boolean; llmThreadTitles?: boolean; autoRecall?: boolean; routinesInConversation?: boolean; templates?: boolean; vpsComputer?: boolean; boatComputer?: boolean; decisionModel?: boolean; dataWindow?: boolean; meetingNotetaker?: boolean; routineGroupSettings?: boolean; skillsLibrary?: boolean };
  /** First-run progress; see onboardingConfigSchema. */
  onboarding?: { completedAt?: string; version?: number; reelSeen?: boolean; hintsSeen?: string[]; launchMode?: "solo" | "server"; firstTurnAt?: string };
  /** Named browser sessions any bot can be pointed at. */
  browserProfiles?: BrowserProfile[];
  /** CDP target of a Chrome the operator already has running (a bare port,
   * e.g. "9333", or an http(s)/ws(s) URL). When set, a bot's browser
   * attaches to it instead of agent-browser spawning its own (#1396). */
  browserEngine?: { attachCdpUrl?: string; egress?: BrowserEgressConfig; idleTimeoutMinutes?: number };
  instances?: InstanceConfigMap;
}
export type BrowserProfile = z.output<typeof browserProfileSchema> & {
  /** Exact durable Electron partition inherited from #567. Internal and
   * immutable; omit from PATCH/config UI payloads. Absent means `id`. */
  partitionId?: string;
};
export type ConfigPatch = z.output<typeof appConfigPatchSchema>;

/** Resolve a canonical profile record to its exact durable Electron
 * partition identity. Callers must never substitute the display/API id. */
export function browserProfilePartitionId(profile: BrowserProfile): string {
  return profile.partitionId ?? profile.id;
}

/** Every durable partition must have one owner, and no other profile may use
 * that partition's folded name as its logical id. Otherwise deleting and
 * re-adding the logical id can silently attach a bot to the retained account. */
export function browserProfileRoutingConflict(
  profiles: readonly BrowserProfile[],
): string | null {
  const logicalOwner = new Map(profiles.map((profile, index) => [profile.id.toLowerCase(), index]));
  const partitionOwner = new Map<string, number>();
  for (const [index, profile] of profiles.entries()) {
    const partitionId = browserProfilePartitionId(profile);
    const foldedPartition = partitionId.toLowerCase();
    const existingPartitionOwner = partitionOwner.get(foldedPartition);
    if (existingPartitionOwner !== undefined && existingPartitionOwner !== index) {
      return `browser profiles cannot share the durable session “${partitionId}”`;
    }
    partitionOwner.set(foldedPartition, index);
    const otherLogicalOwner = logicalOwner.get(foldedPartition);
    if (otherLogicalOwner !== undefined && otherLogicalOwner !== index) {
      return `browser profile id “${profiles[otherLogicalOwner]!.id}” is already used by another durable session`;
    }
  }
  return null;
}

/** A list replacement cannot recycle a removed partition in the same write.
 * Electron erases that partition only after commit, so allowing a new profile
 * to claim its case-folded name would race new activity against the wipe. */
export function browserProfileReplacementConflict(
  currentProfiles: readonly BrowserProfile[],
  nextProfiles: readonly BrowserProfile[],
): string | null {
  const routingConflict = browserProfileRoutingConflict(nextProfiles);
  if (routingConflict) return routingConflict;
  const currentIds = new Set(currentProfiles.map((profile) => profile.id));
  const nextIds = new Set(nextProfiles.map((profile) => profile.id));
  const removedPartitions = new Set(
    currentProfiles
      .filter((profile) => !nextIds.has(profile.id))
      .map((profile) => browserProfilePartitionId(profile).toLowerCase()),
  );
  const reused = nextProfiles.find((profile) =>
    !currentIds.has(profile.id)
    && removedPartitions.has(browserProfilePartitionId(profile).toLowerCase()));
  return reused
    ? `browser profile “${reused.name}” cannot reuse a session that is being erased; delete it first, then add the new profile`
    : null;
}

export interface BrowserProfilePartitionTarget {
  /** Canonical application identity: bot references and reuse locks use it. */
  profileId: string;
  /** Exact Electron storage identity: view routing and cleanup use it. */
  partitionId: string;
}

export function browserProfilePartitionTarget(
  config: Pick<AppConfig, "browserProfiles">,
  profileId: string,
): BrowserProfilePartitionTarget | null {
  const profile = config.browserProfiles?.find((candidate) => candidate.id === profileId);
  return profile ? { profileId: profile.id, partitionId: browserProfilePartitionId(profile) } : null;
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const EFFORT_LEVEL_SET = new Set<string>(EFFORT_LEVELS);

/** `newBots.effort` used to be a second new-bot default. Fold it into the
 * template's model selection when that selection names no effort and no
 * variant, then drop the key. Effort with nowhere to hang it is dropped:
 * the template is the only new-bot effort. */
export function foldLegacyNewBotEffort(value: JsonValue): JsonValue {
  if (!isJsonRecord(value) || !Object.hasOwn(value, "newBots")) return value;
  const doc: Record<string, JsonValue> = { ...value };
  const legacy = doc.newBots;
  delete doc.newBots;
  const effort = isJsonRecord(legacy) ? legacy.effort : undefined;
  if (typeof effort !== "string" || !EFFORT_LEVEL_SET.has(effort)) return doc;

  const defaults = isJsonRecord(doc.newBotDefaults) ? { ...doc.newBotDefaults } : undefined;
  const profile = defaults && isJsonRecord(defaults.profile) ? { ...defaults.profile } : undefined;
  const selection = profile && isJsonRecord(profile.modelSelection) ? { ...profile.modelSelection } : undefined;
  const canTakeEffort = (candidate: Record<string, JsonValue> | undefined) =>
    Boolean(candidate && candidate.effort == null && candidate.variant == null && candidate.instanceId && candidate.model);
  if (canTakeEffort(selection) && selection && profile && defaults) {
    selection.effort = effort;
    profile.modelSelection = selection;
    defaults.profile = profile;
    doc.newBotDefaults = defaults;
    return doc;
  }
  if (!selection) {
    const mirror = isJsonRecord(doc.defaultModelSelection) ? { ...doc.defaultModelSelection } : undefined;
    if (canTakeEffort(mirror) && mirror) {
      mirror.effort = effort;
      doc.defaultModelSelection = mirror;
      const nextProfile = profile ?? {};
      nextProfile.modelSelection = { ...mirror };
      const nextDefaults = defaults ?? {};
      nextDefaults.profile = nextProfile;
      doc.newBotDefaults = nextDefaults;
    }
  }
  return doc;
}

/** Composio was removed: connected apps now come only from the engines'
 * own connectors (Claude, Grok) and the Pulsatrix MCP servers. An older
 * config.json may still carry a top-level `composio` block (the project key
 * and session ids); strip it before strict parsing so an existing workspace
 * never fails to load, and so the stored key (never displayed) does not
 * survive the next write. */
export function stripLegacyComposioConfig(value: JsonValue): JsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("composio" in value)) return value;
  const { composio: _removed, ...rest } = value as Record<string, JsonValue>;
  return rest;
}

export function parseStoredConfig(value: JsonValue): AppConfig {
  const parsed = storedAppConfigSchema.safeParse(stripLegacyComposioConfig(foldLegacyLiveKey(foldLegacyNewBotEffort(value))));
  if (!parsed.success) throw new Error(schemaIssue(parsed.error, "Invalid stored configuration"));
  return parsed.data;
}

/** Exact old→canonical profile ids from #567's persisted config. Store
 * hydration uses this to migrate bot references in the same write that
 * resets other transient bot state. Invalid/non-legacy config is inert. */
export function loadBrowserProfileIdAliases(): ReadonlyMap<string, string> {
  try {
    const document = z.object({ browserProfiles: legacyBrowserProfilesSchema.optional() }).safeParse(
      parseJson(readFileSync(join(DATA_DIR, "config.json"), "utf8")),
    );
    if (!document.success || !document.data.browserProfiles) return new Map();
    return migrateStoredBrowserProfiles(document.data.browserProfiles).aliases;
  } catch {
    return new Map();
  }
}

export function parseConfigPatch(value: JsonValue): ConfigPatch {
  const parsed = appConfigPatchSchema.safeParse(value);
  if (!parsed.success) {
    throw Object.assign(new Error(schemaIssue(parsed.error, "Invalid configuration")), { status: 400 });
  }
  return parsed.data;
}

export function vpsSshAlias(cfg: AppConfig): string | null {
  return isValidSshAlias(cfg.vps?.sshAlias) ? cfg.vps.sshAlias : null;
}

/** Read-and-revalidate accessor, same shape as vpsSshAlias above: even
 * though loadConfig()/parseStoredConfig() already schema-validate this
 * field, callers that forward it into a child process environment get a
 * second, cheap guarantee rather than trusting a hand-edited config.json. */
export function browserEngineAttachCdpUrl(cfg: AppConfig): string | null {
  return isValidCdpTarget(cfg.browserEngine?.attachCdpUrl) ? cfg.browserEngine.attachCdpUrl : null;
}

export function roomTurnTimeoutMinutes(cfg: AppConfig): number {
  return cfg.rooms?.turnTimeoutMinutes ?? DEFAULT_ROOM_TURN_TIMEOUT_MINUTES;
}

export function mcpCallTimeoutMinutes(cfg: AppConfig): number {
  return cfg.mcp?.callTimeoutMinutes ?? DEFAULT_MCP_CALL_TIMEOUT_MINUTES;
}

export const LIVE_IDLE_MINUTES_DEFAULT = 5;

/** Non-secret Live settings. The key only shows up as `configured`. */
/** Upstream's Live calls (OpenAI realtime) are off unless the server runs with
 * SAGAX_LIVE_CALLS=1: Sagax's own voice call engine is the call path. */
export function liveCallsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAGAX_LIVE_CALLS === "1";
}

/** Live calls use the same OpenAI provider as the rest of the bot. */
export function liveCallKey(cfg: AppConfig): string {
  return cfg.openai?.key?.trim() || "";
}

export function liveSettingsFor(cfg: AppConfig, env: NodeJS.ProcessEnv = process.env): LiveSettings {
  const minutes = cfg.live?.idleMinutes;
  return {
    enabled: liveCallsEnabled(env),
    configured: Boolean(liveCallKey(cfg)),
    voice: cfg.live?.voice ?? "",
    readTypedReplies: cfg.live?.readTypedReplies ?? true,
    idleMinutes: Number.isInteger(minutes) && minutes! >= 1 && minutes! <= 60 ? minutes! : LIVE_IDLE_MINUTES_DEFAULT,
  };
}


/** Accepts a full config or a parsed patch: the concurrency limit may be
 * read from either, and a patch may legitimately omit it. */
export function maxConcurrentBotThreads(cfg: { threads?: { maxConcurrentPerBot?: number } }): number {
  return cfg.threads?.maxConcurrentPerBot ?? DEFAULT_MAX_CONCURRENT_BOT_THREADS;
}

/** Parallel tasks one person may have running on one bot at once. */
export function maxParallelTasksPerPerson(cfg: { threads?: { maxParallelPerPerson?: number } }): number {
  return cfg.threads?.maxParallelPerPerson ?? DEFAULT_MAX_PARALLEL_PER_PERSON;
}

/** Size cap for each per-thread events/ and native/ NDJSON log. Null (the
 * default) means unbounded growth — rotation is strictly opt-in (#1280). */
export function threadEventLogMaxBytes(cfg: AppConfig): number | null {
  const cap = cfg.threads?.eventLogMaxBytes;
  return typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? cap : null;
}

/** Days a closed or archived bot thread's event logs survive before the
 * retention sweep removes them (#1280). Null — the default — keeps them
 * forever. */
export function threadEventLogRetentionDays(cfg: AppConfig): number | null {
  return cfg.threads?.eventLogRetentionDays ?? null;
}

export function localVmMode(cfg: AppConfig, env: NodeJS.ProcessEnv = process.env): "shared" | "per-bot" | "pool" {
  const mode = cfg.localVm?.mode ?? DEFAULT_LOCAL_VM_MODE;
  // Organization mode never runs a VM per bot: each person has one server
  // environment (server/user-sandbox-routing.ts). A saved per-bot choice
  // from before reads as shared there.
  return mode === "per-bot" && env.SAGAX_IDENTITY?.trim().toLowerCase() === "perspicax" ? "shared" : mode;
}

export function localVmMaxInstances(cfg: AppConfig): number {
  return cfg.localVm?.maxInstances ?? DEFAULT_LOCAL_VM_MAX_INSTANCES;
}

export function localVmIdleTimeoutMinutes(cfg: AppConfig): number {
  return cfg.localVm?.idleTimeoutMinutes ?? DEFAULT_LOCAL_VM_IDLE_TIMEOUT_MINUTES;
}

/** On by default; only an explicit `false` (the Settings toggle, or a legacy
 * `skillRecorder: false` carried over at startup) switches it off. */
export function skillAuthoringEnabled(cfg: AppConfig): boolean {
  return cfg.features?.skillAuthoring !== false;
}

/** Automatic recall is read-only, so it is on unless switched off. */
export function autoRecallEnabled(cfg: AppConfig): boolean {
  return cfg.features?.autoRecall !== false;
}

/** Recall by meaning (server/semantic-index.ts): on unless the config says
 * false or the process was started with SAGAX_SEMANTIC_RECALL=0. */
export function semanticRecallEnabled(cfg: AppConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  if (/^(0|off|false|no)$/i.test(env.SAGAX_SEMANTIC_RECALL?.trim() ?? "")) return false;
  return cfg.memory?.semanticRecall !== false;
}

/** The person's embeddings endpoint, or null for the built-in vectors. */
export function semanticEmbeddingEndpoint(cfg: AppConfig): { url: string; model: string } | null {
  const url = cfg.memory?.embeddingsUrl?.trim() ?? "";
  const model = cfg.memory?.embeddingsModel?.trim() ?? "";
  return url && model ? { url, model } : null;
}

export const DEFAULT_CAPTURE_QUIET_MS = 2 * 60_000;
export const DEFAULT_TIDY_HOUR = 3;

export function captureQuietMs(cfg: AppConfig): number {
  return cfg.memory?.captureQuietMs ?? DEFAULT_CAPTURE_QUIET_MS;
}

export function tidyHour(cfg: AppConfig): number {
  return cfg.memory?.tidyHour ?? DEFAULT_TIDY_HOUR;
}

/** Routines a bot creates for its own person start live unless
 * `routines.newPaused` is true. The creator's explicit `enabled` wins. */
export const DEFAULT_NEW_ROUTINES_PAUSED = false;

export function newRoutinesPaused(cfg: AppConfig): boolean {
  return cfg.routines?.newPaused ?? DEFAULT_NEW_ROUTINES_PAUSED;
}

export function showToolCallsEnabled(cfg: AppConfig): boolean {
  return cfg.features?.showToolCalls === true;
}

/** A routine's turns are posted in the conversation that receives its card.
 * Off by default, so scheduled work stays in a hidden thread. */
export function routinesInConversationEnabled(cfg: AppConfig): boolean {
  return cfg.features?.routinesInConversation === true;
}

/** The sidebar's Templates entry. Off by default (experimental). */
export function vpsComputerEnabled(cfg: AppConfig): boolean {
  return cfg.features?.vpsComputer === true;
}

export function boatComputerEnabled(cfg: AppConfig): boolean {
  return cfg.features?.boatComputer === true;
}

/** Settings > Decision model. Off unless explicitly enabled. The decider
 * itself is unchanged: this only shows or hides that Settings section. */
export function decisionModelEnabled(cfg: AppConfig): boolean {
  return cfg.features?.decisionModel === true;
}

/** The Data window and the chat header's Data button. Off unless
 * explicitly enabled in Settings > Experimental features. */
/** The meeting notetaker. Off by default (experimental); the server
 * enforces it: no join_meeting tool, and the meeting routes, the internal
 * route and the card's answer refuse while it is off. */
export function meetingNotetakerEnabled(cfg: AppConfig): boolean {
  return cfg.features?.meetingNotetaker === true;
}

export function dataWindowEnabled(cfg: AppConfig): boolean {
  return cfg.features?.dataWindow === true;
}

/** Settings > General shows Routines in the conversation and Group turns.
 * Off unless explicitly enabled; display only, never their values. */
export function routineGroupSettingsEnabled(cfg: AppConfig): boolean {
  return cfg.features?.routineGroupSettings === true;
}

export function templatesEnabled(cfg: AppConfig): boolean {
  return cfg.features?.templates === true;
}

/** Workspace-level gate for the experimental built-in browser. A bot's own
 * switch sits under it, so either can withhold the browser. Off until the
 * desktop's first-run welcome turns it on. */
export function builtInBrowserEnabled(cfg: AppConfig): boolean {
  return cfg.features?.browser === true;
}

/** Opt-in computer sharing: the routes, the agent tools, the advertised
 * capability and the desktop connector. Off unless an explicit `true` turns
 * it on, because the reviewed feature still has open security holes (a
 * read-only folder grant could be escalated to a shell).
 *
 * Deliberately NOT a Settings toggle: this is a maintainer-only escape hatch
 * for an unfinished feature, not a user preference. Someone who needs it
 * enables it by hand in `~/.sagax/config.json`
 * (`{"features": {"sharedComputers": true}}`) and restarts the server. */
export function sharedComputersEnabled(cfg: AppConfig): boolean {
  return cfg.features?.sharedComputers === true;
}

/** Claude bots also see the MCP servers of this machine's own Claude Code
 * setup, the way Codex bots already read ~/.codex/config.toml. The switch
 * is under Capabilities > Installed; the Claude driver then omits
 * --strict-mcp-config while keeping skills, hooks and the personal
 * CLAUDE.md out. 2026-10-27 (#1098): unset, it is on for a solo server (the
 * person's own computer and Claude Code setup) and off on an organization's
 * shared server, whose Claude Code setup is not any one person's. */
export function claudeUserMcpEnabled(cfg: AppConfig, organization = false): boolean {
  return cfg.features?.claudeUserMcp ?? !organization;
}

/** Opt-in generated titles for new bot threads: a cheap provider one-shot
 * names the row instead of the first-message snippet. Off until enabled by
 * hand in ~/.sagax/config.json
 * (`{"features": {"llmThreadTitles": true}}`); a one-shot that fails or
 * answers anything unusable leaves the snippet untouched. */
export function llmThreadTitlesEnabled(cfg: AppConfig): boolean {
  return cfg.features?.llmThreadTitles === true;
}


/** Skills library, available unless explicitly switched off. */
export function skillsLibraryEnabled(cfg: AppConfig): boolean {
  return cfg.features?.skillsLibrary !== false;
 }

/** What each engine is launched with, as far as a config write can change
 * it: its instance config (driver, settings, and the credentials
 * instanceConfigs() injects), plus the workspace env its driver falls back to
 * when that environment lacks a value — which syncCredentialEnv rewrites on
 * the same save. */
export function engineLaunches(configs: InstanceConfigMap, env: Record<string, string | undefined> = process.env): Record<string, unknown> {
  return Object.fromEntries(Object.entries(configs).map(([id, entry]) =>
    [id, { ...entry, fallbackEnv: Object.fromEntries(fallbackEnv(entry).map((name) => [name, env[name]])) }]));
}

/** The workspace env an in-process API-key driver reads when the instance's
 * own environment lacks it (mistral.ts, cerebras.ts, grok.ts,
 * openai-compat.ts): an instance with its own address gets no injected key,
 * yet still reads the saved one from here. OpenAI's and OpenRouter's own
 * instances read only their own key. */
function fallbackEnv(entry: InstanceConfigMap[string]): string[] {
  const config = typeof entry.config === "object" && entry.config !== null && !Array.isArray(entry.config)
    ? entry.config as { apiKeyEnv?: unknown } : {};
  const named = typeof config.apiKeyEnv === "string" && config.apiKeyEnv ? config.apiKeyEnv : undefined;
  switch (entry.driver) {
    case "mistral": return ["MISTRAL_API_KEY"];
    case "cerebras": return ["CEREBRAS_API_KEY"];
    case "grok": return [named ?? "XAI_API_KEY"];
    case "openai-compat":
      return named && Object.values(API_KEY_FLEET).some((own) => (own.config as { apiKeyEnv?: string } | undefined)?.apiKeyEnv === named)
        ? [named]
        : [...new Set([named ?? "OPENAI_COMPAT_API_KEY", "OPENAI_COMPAT_API_KEY", "OPENAI_COMPAT_URL", "OPENAI_COMPAT_MODEL", "OPENAI_COMPAT_PROVIDER"])];
    default: return [];
  }
}

/** The engines a config write changed (engineLaunches before and after):
 * each instance added, removed, or launched differently. Only these need
 * rebuilding. A write that repeats the saved values, or touches a section no
 * driver reads (the guided tour writes `onboarding` on every step), changes
 * none, and no turn is interrupted for it. */
export function changedInstanceIds(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((id) => !isDeepStrictEqual(before[id], after[id]));
}

// SAGAX_DATA_DIR (or OMB_DATA_DIR) isolates test/soak rigs from the user's real
// fleet. The default is ~/.sagax; a first start moves ~/.openmausbot there
// unless a running copy still holds it (electron/legacy-names.mjs).
export const DATA_DIR = process.env.SAGAX_DATA_DIR ?? defaultDataDir({ home: homedir() });
const LEGACY_DATA_DIR = join(homedir(), ".opengrokbot");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const NATIVE_DIR = join(DATA_DIR, "native");

export function ensureDirs() {
  // one-time migration from the pre-rename data dir — bots, transcripts,
  // config and keys all carry over
  if (!existsSync(DATA_DIR) && existsSync(LEGACY_DATA_DIR)) {
    try {
      renameSync(LEGACY_DATA_DIR, DATA_DIR);
    } catch {
      /* cross-device or busy — fall through to a fresh dir */
    }
  }
  for (const dir of [DATA_DIR, EVENTS_DIR, NATIVE_DIR]) mkdirSync(dir, { recursive: true });
  migrateLegacyFeatureFlags();
  migrateLegacyNewBotEffort();
  migrateGrokVoiceKey();
  migrateLiveProviderKey();
  migrateOnboardingEngineKeys();
}

/** Retire the old Live-only slot without overwriting an OpenAI provider
 * already chosen by the person. The next write persists this same fold. */
export function foldLegacyLiveKey(value: JsonValue): JsonValue {
  if (!isJsonRecord(value) || !isJsonRecord(value.live) || !Object.hasOwn(value.live, "key")) return value;
  const { key: legacy, ...live } = value.live;
  const openai = isJsonRecord(value.openai) ? value.openai : {};
  const saved = typeof openai.key === "string" ? openai.key.trim() : "";
  const key = typeof legacy === "string" ? legacy.trim() : "";
  return { ...value, live, ...(key && !saved && !process.env.SAGAX_OPENAI_API_KEY?.trim() ? { openai: { ...openai, key } } : {}) };
}

function migrateLiveProviderKey(): void {
  const path = join(DATA_DIR, "config.json");
  try {
    const raw = parseJson(readFileSync(path, "utf8"));
    const next = foldLegacyLiveKey(raw);
    if (next !== raw) writeFileAtomic(path, JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch { /* A later config save retries the fold. */ }
}

/** Heal an install that was onboarded by an older CLI: a provider API key
 * written in clear into config.json is moved into the encrypted engine-key
 * store and stripped from the file, once, before the server's first
 * loadConfig(). Fail-safe — a key that cannot be sealed stays exactly where
 * it is, and the move is idempotent. Solo only: an organization server keeps
 * its shared-key semantics. The key is never logged. */
function migrateOnboardingEngineKeys(): void {
  if (process.env.SAGAX_IDENTITY?.trim().toLowerCase() === "perspicax") return;
  try {
    const moved = migrateConfigPlaintextKeys(DATA_DIR, [OPENAI_API_INSTANCE, OPENROUTER_API_INSTANCE]);
    if (moved) console.log(`[config] sealed ${moved} onboarding API key(s): removed from config.json, kept in the encrypted store`);
  } catch (error) {
    console.error(`[config] could not seal onboarding API keys: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** What happens to a Grok voice key of an older build: it becomes the xAI
 * key when none is saved, else the xAI key stays and the duplicate goes.
 * Never logged with its value. */
export type GrokVoiceKeyFold = "moved" | "dropped" | null;

export function grokVoiceKeyFoldMessage(fold: Exclude<GrokVoiceKeyFold, null>): string {
  return fold === "moved"
    ? "[config] the Grok voice key is now the xAI key (Grok voice and bots on Grok share one key)"
    : "[config] Grok voice key not kept: an xAI key is already saved and Grok voice uses it";
}

/** 2026-10-14: Grok voice runs on the xAI key, so `tts.xaiKey` is folded
 * into `xai.key` once, here, before the server's first loadConfig(). An
 * `XAI_API_KEY` in the environment counts as a saved xAI key. */
function migrateGrokVoiceKey(): void {
  const p = join(DATA_DIR, "config.json");
  try {
    if (!existsSync(p)) return;
    const raw = parseJson(readFileSync(p, "utf8"));
    if (!isJsonRecord(raw) || !isJsonRecord(raw.tts) || !Object.hasOwn(raw.tts, "xaiKey")) return;
    const voiceKey = typeof raw.tts.xaiKey === "string" ? raw.tts.xaiKey.trim() : "";
    const savedXai = isJsonRecord(raw.xai) && typeof raw.xai.key === "string" ? raw.xai.key.trim() : "";
    const envXai = process.env.XAI_API_KEY?.trim() ?? "";
    const tts: JsonObject = { ...raw.tts };
    delete tts.xaiKey;
    const next: JsonObject = { ...raw, tts };
    let fold: GrokVoiceKeyFold = null;
    if (voiceKey && !savedXai && !envXai) {
      next.xai = { ...(isJsonRecord(raw.xai) ? raw.xai : {}), key: voiceKey };
      fold = "moved";
    } else if (voiceKey) {
      fold = "dropped";
    }
    writeFileAtomic(p, JSON.stringify(next, null, 2), { mode: 0o600 });
    if (fold) console.log(grokVoiceKeyFoldMessage(fold));
  } catch (error) {
    // The key stays in the file: loadConfig() still folds it in memory.
    console.error(`[config] could not fold the Grok voice key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The same rule for a save: a client of an older build (or a bot's
 * credential card) sending `tts.xaiKey` sets the xAI key when none is
 * saved; otherwise the value is not kept. Clearing it clears nothing. */
export function foldGrokVoiceKeyPatch(
  patch: { tts?: { xaiKey?: string } & Record<string, unknown>; xai?: { key?: string; url?: string } },
  savedXaiKey: string | undefined,
  { allowMove = true }: { allowMove?: boolean } = {},
): GrokVoiceKeyFold {
  if (patch.tts?.xaiKey === undefined) return null;
  const voiceKey = patch.tts.xaiKey.trim();
  delete patch.tts.xaiKey;
  if (Object.keys(patch.tts).length === 0) delete patch.tts;
  if (!voiceKey) return null;
  if (allowMove && !savedXaiKey?.trim() && patch.xai?.key === undefined) {
    patch.xai = { ...patch.xai, key: voiceKey };
    return "moved";
  }
  return "dropped";
}

/** `features.skillRecorder` became `features.skillAuthoring` when the Teach a
 * skill recorder was removed. featureConfigSchema is non-strict, so
 * parseStoredConfig would silently drop the old key (reading the opt-in as
 * off) while saveConfig's raw section merge would carry it on disk forever.
 * Rewrite it once, here, before the server's single loadConfig() at boot: an
 * explicit `skillAuthoring` already on disk wins over the legacy key, and a
 * file without the legacy key is left untouched. */
function migrateLegacyFeatureFlags(): void {
  const p = join(DATA_DIR, "config.json");
  try {
    if (!existsSync(p)) return;
    const disk = jsonObjectSchema.safeParse(parseJson(readFileSync(p, "utf8")));
    if (!disk.success) return;
    const features = jsonObjectSchema.safeParse(disk.data.features);
    if (!features.success || !Object.hasOwn(features.data, "skillRecorder")) return;
    const next: JsonObject = { ...features.data };
    if (!Object.hasOwn(next, "skillAuthoring")) next.skillAuthoring = next.skillRecorder === true;
    delete next.skillRecorder;
    writeFileAtomic(p, JSON.stringify({ ...disk.data, features: next }, null, 2), { mode: 0o600 });
    console.log(`[config] features.skillRecorder renamed to features.skillAuthoring (${String(next.skillAuthoring)})`);
  } catch (error) {
    // A readable but unwritable config would otherwise lose the opt-in on
    // every boot with no trace: parseStoredConfig drops the legacy key.
    console.error(`[config] could not rename features.skillRecorder: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Same fold as parseStoredConfig, written once so a later saveConfig does
 * not merge the retired `newBots` key back from the raw file. */
function migrateLegacyNewBotEffort(): void {
  const p = join(DATA_DIR, "config.json");
  try {
    if (!existsSync(p)) return;
    const raw = parseJson(readFileSync(p, "utf8"));
    if (!isJsonRecord(raw) || !Object.hasOwn(raw, "newBots")) return;
    writeFileAtomic(p, JSON.stringify(foldLegacyNewBotEffort(raw), null, 2), { mode: 0o600 });
  } catch (error) {
    console.error(`[config] could not fold newBots.effort: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The last "config.json is being ignored" warning, so a file that stays
 * broken is reported once rather than on every loadConfig() call. */
let lastIgnoredConfigWarning = "";

export function loadConfig(): AppConfig {
  let cfg: AppConfig = {};
  try {
    cfg = parseStoredConfig(parseJson(readFileSync(join(DATA_DIR, "config.json"), "utf8")));
    lastIgnoredConfigWarning = "";
  } catch (error) {
    // No file yet is a normal first run: env fallbacks below. Any other failure
    // (unreadable file, invalid JSON, a schema error in one field) means the
    // whole file is being ignored for this process — every instance, account
    // and setting in it — so say why instead of silently running on defaults.
    // saveConfig() still merges into the raw file, so nothing on disk is lost;
    // the user just needs to know which field to fix.
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      // JSON.parse includes a fragment of the input in some error messages.
      // A malformed credential must never be copied into the server log.
      const reason = error instanceof SyntaxError ? "invalid JSON"
        : error instanceof Error ? error.message : "unable to read configuration";
      const warning = `config: ignoring ${join(DATA_DIR, "config.json")} and using defaults: ${reason}`;
      if (warning !== lastIgnoredConfigWarning) console.warn(warning);
      lastIgnoredConfigWarning = warning;
    } else {
      lastIgnoredConfigWarning = "";
    }
  }
  // Env wins over the file for every credential. The desktop shell keeps
  // these secrets OS-encrypted and hands them to this process as env at
  // spawn, leaving config.json without the plaintext field — so the file
  // value is the dev-mode (no desktop shell) fallback, not the primary.
  // Anything that saves a credential mid-session must keep process.env in
  // step (syncCredentialEnv below), or the value injected at boot would
  // shadow the save until the next launch.
  cfg.mistral = { ...cfg.mistral };
  if (process.env.MISTRAL_API_KEY !== undefined) cfg.mistral.key = process.env.MISTRAL_API_KEY;
  cfg.cerebras = { ...cfg.cerebras };
  if (process.env.CEREBRAS_API_KEY !== undefined) cfg.cerebras.key = process.env.CEREBRAS_API_KEY;
  cfg.groq = { ...cfg.groq };
  // Keep the workspace key separate from an operator's OpenCode Groq key.
  if (process.env.SAGAX_GROQ_API_KEY !== undefined) cfg.groq.key = process.env.SAGAX_GROQ_API_KEY;
  cfg.xai = { ...cfg.xai };
  if (process.env.XAI_API_KEY !== undefined) cfg.xai.key = process.env.XAI_API_KEY;
  // Deliberately not ANTHROPIC_API_KEY: a key in the server's own env is
  // never the workspace key, so an operator's stray variable cannot flip
  // every Claude bot onto pay-as-you-go billing.
  cfg.anthropic = { ...cfg.anthropic };
  if (process.env.SAGAX_ANTHROPIC_API_KEY !== undefined) cfg.anthropic.key = process.env.SAGAX_ANTHROPIC_API_KEY;
  if (process.env.SAGAX_ANTHROPIC_API_URL !== undefined) cfg.anthropic.url = process.env.SAGAX_ANTHROPIC_API_URL;
  cfg.openai = { ...cfg.openai };
  if (process.env.SAGAX_OPENAI_API_KEY !== undefined) cfg.openai.key = process.env.SAGAX_OPENAI_API_KEY;
  cfg.openrouter = { ...cfg.openrouter };
  if (process.env.SAGAX_OPENROUTER_API_KEY !== undefined) cfg.openrouter.key = process.env.SAGAX_OPENROUTER_API_KEY;
  cfg.openaiCompat = { ...cfg.openaiCompat };
  if (process.env.OPENAI_COMPAT_API_KEY !== undefined) cfg.openaiCompat.key = process.env.OPENAI_COMPAT_API_KEY;
  if (process.env.OPENAI_COMPAT_URL !== undefined) cfg.openaiCompat.url = process.env.OPENAI_COMPAT_URL;
  if (process.env.OPENAI_COMPAT_MODEL !== undefined) cfg.openaiCompat.model = process.env.OPENAI_COMPAT_MODEL;
  if (process.env.OPENAI_COMPAT_PROVIDER !== undefined) cfg.openaiCompat.provider = process.env.OPENAI_COMPAT_PROVIDER;
  // BOX_TOKEN keeps its historical name; the provider is Boat.
  cfg.box = { ...cfg.box };
  if (process.env.BOX_TOKEN !== undefined) cfg.box.token = process.env.BOX_TOKEN;
  cfg.opencodeGo = { ...cfg.opencodeGo };
  if (process.env.OPENCODE_API_KEY !== undefined) cfg.opencodeGo.apiKey = process.env.OPENCODE_API_KEY;
  cfg.tts = { ...cfg.tts };
  if (process.env.SAGAX_TTS_KEY !== undefined) cfg.tts.key = process.env.SAGAX_TTS_KEY;
  // A preset ElevenLabs voice (Cloud Pro sets one) is only a default: a voice or
  // another speech provider the person picked in Settings always wins.
  const presetVoice = process.env.SAGAX_TTS_DEFAULT_VOICE?.trim();
  if (presetVoice && !cfg.tts.voice?.trim() && (cfg.tts.provider ?? "elevenlabs") === "elevenlabs") cfg.tts.voice = presetVoice;
  if (process.env.SAGAX_FISH_AUDIO_API_KEY !== undefined) cfg.tts.fishKey = process.env.SAGAX_FISH_AUDIO_API_KEY;
  // Grok voice runs on the xAI key (2026-10-14). A Grok voice key of an
  // older build (the file, or the env a desktop shell of that build
  // injects) fills the xAI key while none is saved, and is otherwise unused.
  const legacyVoiceKey = (process.env.SAGAX_XAI_VOICE_KEY !== undefined ? process.env.SAGAX_XAI_VOICE_KEY : cfg.tts.xaiKey)?.trim();
  if (legacyVoiceKey && !cfg.xai.key?.trim()) cfg.xai.key = legacyVoiceKey;
  delete cfg.tts.xaiKey;
  cfg.decider = { ...cfg.decider };
  if (process.env.SAGAX_JEV_API_KEY !== undefined) cfg.decider.key = process.env.SAGAX_JEV_API_KEY;
  cfg.live = { ...cfg.live };
  cfg.imageGen = { ...cfg.imageGen };
  if (process.env.SAGAX_OPENAI_IMAGE_KEY !== undefined) cfg.imageGen.key = process.env.SAGAX_OPENAI_IMAGE_KEY;
  if (process.env.SAGAX_CUSTOM_IMAGE_KEY !== undefined) cfg.imageGen.customApiKey = process.env.SAGAX_CUSTOM_IMAGE_KEY;
  // The sign-in allow-list: env is how a headless box or a container is
  // bootstrapped before anyone can reach Settings.
  const splitEmails = (value: string) => value.split(/[,\s]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (process.env.SAGAX_SIGNIN_EMAILS !== undefined || process.env.SAGAX_SIGNIN_MEMBER_EMAILS !== undefined) {
    cfg.signIn = { ...cfg.signIn };
    if (process.env.SAGAX_SIGNIN_EMAILS !== undefined) cfg.signIn.admins = splitEmails(process.env.SAGAX_SIGNIN_EMAILS);
    if (process.env.SAGAX_SIGNIN_MEMBER_EMAILS !== undefined) cfg.signIn.members = splitEmails(process.env.SAGAX_SIGNIN_MEMBER_EMAILS);
  }
  return cfg;
}

/** `derive(loadConfig())`, worked out again only when config.json changes:
 * a new file (every save renames one into place), a new size, a new
 * modification time, or new permissions or owner. Mode, uid and gid are in
 * the stamp themselves: ctime is not a reliable stand-in, some filesystems
 * leave it unchanged on chmod. For values read on every request or stream
 * frame, where parsing the file each time costs more than the work itself.
 * A file that is missing, saved in the last two seconds, or that
 * loadConfig() could not use (unreadable, a failed read, invalid JSON) is
 * read on every call: a second write inside one clock tick is never missed,
 * and a file that is fixed is used again on the next call. */
export function cacheUntilConfigChanges<T>(derive: (config: AppConfig) => T): () => T {
  let cached: { stamp: string; value: T } | null = null;
  return () => {
    let stamp: string | null = null;
    try {
      const file = statSync(join(DATA_DIR, "config.json"), { bigint: true });
      // mode/uid/gid, not ctime: a chmod that leaves ctime alone must still miss.
      if (Date.now() - Number(file.mtimeMs) >= 2_000) stamp = `${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}:${file.mode}:${file.uid}:${file.gid}`;
    } catch {
      // Missing or out of reach: read it the way loadConfig() always has.
    }
    if (stamp !== null && cached?.stamp === stamp) return cached.value;
    const value = derive(loadConfig());
    // A warning means loadConfig() ignored the file and ran on defaults.
    cached = stamp === null || lastIgnoredConfigWarning !== "" ? null : { stamp, value };
    return value;
  };
}

/** After saveConfig() writes a credential, the running process's env must
 * follow the newest value — loadConfig() prefers env, so the secret injected
 * at boot would otherwise shadow the save until relaunch: the UI would show
 * "saved" while every turn still used the old key. An empty string means the
 * user cleared the credential, so the var is dropped and the (now empty)
 * file value is authoritative again. Fields absent from the patch are
 * untouched. */
export function syncCredentialEnv(patch: Partial<Omit<AppConfig, "threads">>): void {
  const secrets: Array<[value: string | undefined, name: string]> = [
    [patch.xai?.key, "XAI_API_KEY"],
    [patch.mistral?.key, "MISTRAL_API_KEY"],
    [patch.cerebras?.key, "CEREBRAS_API_KEY"],
    [patch.groq?.key, "SAGAX_GROQ_API_KEY"],
    [patch.anthropic?.key, "SAGAX_ANTHROPIC_API_KEY"],
    [patch.openaiCompat?.key, "OPENAI_COMPAT_API_KEY"],
    [patch.openai?.key, "SAGAX_OPENAI_API_KEY"],
    [patch.openrouter?.key, "SAGAX_OPENROUTER_API_KEY"],
    [patch.box?.token, "BOX_TOKEN"],
    [patch.opencodeGo?.apiKey, "OPENCODE_API_KEY"],
    [patch.tts?.key, "SAGAX_TTS_KEY"],
    [patch.tts?.fishKey, "SAGAX_FISH_AUDIO_API_KEY"],
    [patch.decider?.key, "SAGAX_JEV_API_KEY"],
    [patch.imageGen?.key, "SAGAX_OPENAI_IMAGE_KEY"],
    [patch.imageGen?.customApiKey, "SAGAX_CUSTOM_IMAGE_KEY"],
  ];
  for (const [value, name] of secrets) {
    if (value === undefined) continue;
    if (value) process.env[name] = value;
    else delete process.env[name];
  }
  // loadConfig() also prefers env for url/model/provider, so a saved value
  // must follow the same set-when-truthy / delete-when-cleared rule as keys.
  const settings: Array<[value: string | undefined, name: string]> = [
    [patch.openaiCompat?.url, "OPENAI_COMPAT_URL"],
    [patch.anthropic?.url, "SAGAX_ANTHROPIC_API_URL"],
    [patch.openaiCompat?.model, "OPENAI_COMPAT_MODEL"],
    [patch.openaiCompat?.provider, "OPENAI_COMPAT_PROVIDER"],
  ];
  for (const [value, name] of settings) {
    if (value === undefined) continue;
    if (value) process.env[name] = value;
    else delete process.env[name];
  }
}

/** Env names of every workspace credential this process may be holding —
 * injected at boot by the desktop shell or exported by a developer. Spawned
 * engine CLIs must never inherit them: the one driver that consumes a given
 * secret receives it through instanceConfigs() narrowing, and to every other
 * child these are someone else's keys riding along in `...process.env`. */
export const WORKSPACE_CREDENTIAL_ENV = [
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY",
  "SAGAX_GROQ_API_KEY",
  "SAGAX_ANTHROPIC_API_KEY",
  "SAGAX_ANTHROPIC_API_URL",
  "SAGAX_HOSTED_MODEL_TOKEN",
  "SAGAX_HOSTED_MODELS",
  "OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPAT_URL",
  "SAGAX_OPENAI_API_KEY",
  "SAGAX_PERSONAL_PROVIDER_KEY",
  // Retired credential: never consumed or forwarded to child processes.
  "SAGAX_OPENAI_LIVE_KEY",
  "SAGAX_OPENROUTER_API_KEY",
  // 2026-10-30: a named OpenAI-compatible server's key (openai-compat-servers.ts)
  "SAGAX_COMPAT_SERVER_API_KEY",
  "BOX_TOKEN",
  "OPENCODE_API_KEY",
  "SAGAX_TTS_KEY",
  "SAGAX_FISH_AUDIO_API_KEY",
  "SAGAX_XAI_VOICE_KEY",
  "SAGAX_JEV_API_KEY",
  "SAGAX_OPENAI_IMAGE_KEY",
  "SAGAX_CUSTOM_IMAGE_KEY",
  // The key of the encrypted MCP sign-in vault (server/mcp-oauth.ts).
  "SAGAX_MCP_OAUTH_KEY",
  // The client secret that signs in to Azure Key Vault for content
  // encryption (server/content-key-azure.ts).
  "SAGAX_CONTENT_KEY_AZURE_CLIENT_SECRET",
  // Cloud Pro's included Boat, voice and decision relay tokens
  // (included-services.ts), used only in-process by the Boat, voice and
  // decider modules.
  "SAGAX_CLOUD_BOAT_TOKEN",
  "SAGAX_CLOUD_VOICE_TOKEN",
  "SAGAX_CLOUD_DECIDER_TOKEN",
  // Harness-private filesystem hints are not credentials themselves, but
  // exposing them to a shell-capable agent points straight at app-owned
  // state. The built-in browser master is delivered privately in memory.
  "SAGAX_BROWSER_CONNECTION",
  "SAGAX_USER_DATA",
] as const;

/** Secrets of whoever operates this server, not of the workspace: the license
 * key, a fleet container's installation credential, and everything a hosting
 * control plane injects under `SAGAX_CLOUD_` (the readiness token, the bootstrap
 * document and its gateway token). Only this process reads them. The prefix
 * ends in an underscore on purpose: `SAGAX_CLOUDFLARED_PATH` is not one of them.
 * What an engine is meant to receive arrives under another name through its
 * instance environment (the hosted model token as ANTHROPIC_API_KEY or
 * SAGAX_COMPANY_API_KEY), so nothing here is ever an engine's input.
 * The Perspicax link settings belong here too: the link file holds the
 * server's link token, and an engine that learnt its path (or the issuer to
 * use it with) could read it as the same user. The webhook that starts the
 * sandboxes' Kubernetes cluster carries its token in its URL
 * (server/sandbox-k8s-wake.ts). */
export const CONTROL_PLANE_ENV = [
  "SAGAX_LICENSE_KEY", "SAGAX_INSTALLATION_CREDENTIAL",
  "SAGAX_PERSPICAX_LINK_FILE", "SAGAX_PERSPICAX_ISSUER", "SAGAX_PERSPICAX_INTERNAL_URL",
  "SAGAX_SANDBOX_K8S_WAKE_URL",
] as const;
export const CONTROL_PLANE_ENV_PREFIX = "SAGAX_CLOUD_";

/** Drop every control-plane secret from a child-process env (in place). No
 * driver allowlist re-admits these. Names compare case-insensitively because
 * Windows environments do. */
export function stripControlPlaneEnv(env: Record<string, string | undefined>): void {
  for (const key of Object.keys(env)) {
    // an old name (OMB_CLOUD_*) still in a child env is the same secret
    const name = currentEnvName(key.toUpperCase());
    if (name.startsWith(CONTROL_PLANE_ENV_PREFIX) || (CONTROL_PLANE_ENV as readonly string[]).includes(name)) delete env[key];
  }
}

/** Drop every workspace credential, and every control-plane secret, from a
 * child-process env (in place). */
export function stripWorkspaceCredentialEnv(env: Record<string, string | undefined>): void {
  for (const key of WORKSPACE_CREDENTIAL_ENV) delete env[key];
  // and the same credentials under their old names (OMB_ANTHROPIC_API_KEY)
  for (const key of Object.keys(env)) {
    if ((WORKSPACE_CREDENTIAL_ENV as readonly string[]).includes(currentEnvName(key))) delete env[key];
  }
  stripControlPlaneEnv(env);
}

/** Env names a provider CLI might read as its own billing identity. A spawned
 * engine keeps only what its driver explicitly allows: a foreign key riding
 * along in `...process.env` must not flip a subscription CLI onto
 * pay-as-you-go billing the user never granted. */
export const PROVIDER_CREDENTIAL_ENV = [
  "CLINE_API_KEY",
  "ANTHROPIC_API_KEY",
  "FACTORY_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "MINIMAX_API_KEY",
  "OPENAI_API_KEY",
  "OPENCODE_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY",
  "GROQ_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_AUTH_TOKEN",
] as const;

/** Provider keys OpenCode reads from its environment, as it does in a
 * terminal: with ANTHROPIC_API_KEY set, `opencode` lists Anthropic's models.
 * Keys Sagax saves for another engine (xAI, Mistral, the workspace
 * Anthropic key) are workspace credentials under other names and never
 * ride along. */
export const OPENCODE_PROVIDER_ENV = [
  "CLINE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "MINIMAX_API_KEY",
  "GROQ_API_KEY",
] as const;

/** Keys the owner saves in Settings for OpenCode's other providers (Venice,
 * Groq, DeepSeek…), each under the environment name OpenCode reads. A Cloud
 * has no terminal to export them in. They go to OpenCode's process only,
 * never to this server's own environment. */
export const OPENCODE_PROVIDER_KEY_LIMIT = 20;
const OPENCODE_PROVIDER_KEY_NAME = /^[A-Z][A-Z0-9_]{0,59}_(?:API_KEY|KEY|TOKEN)$/;
/** Printable, no spaces: no provider key has any, and a pasted sentence is not a key. */
const OPENCODE_PROVIDER_KEY_VALUE = /^[\x21-\x7e]{1,4096}$/;

/** Why OpenCode can't be given a key under this name, or undefined. A name
 * Sagax keeps for itself or another engine would never reach OpenCode:
 * every engine keeps only the credential names it reads (credentialEnv). */
function openCodeProviderKeyNameRefusal(name: string): string | undefined {
  if (!OPENCODE_PROVIDER_KEY_NAME.test(name)) {
    return "Use the name the provider reads its key from: capitals, ending in _API_KEY, _KEY or _TOKEN, such as VENICE_API_KEY.";
  }
  if (name === "OPENCODE_API_KEY") return "Save the OpenCode key in the OpenCode API key box instead.";
  const reserved = name.startsWith("OPENCODE_") || name.startsWith("SAGAX_")
    || (WORKSPACE_CREDENTIAL_ENV as readonly string[]).includes(name)
    || ((PROVIDER_CREDENTIAL_ENV as readonly string[]).includes(name) && !(OPENCODE_PROVIDER_ENV as readonly string[]).includes(name));
  return reserved ? `Sagax keeps ${name} for itself, so OpenCode can't be given it here. Put this key in opencode.json instead.` : undefined;
}

/** The saved OpenCode provider keys that can be used, by name. A hand-edited
 * entry OpenCode could not be given, or whose value is not a key, is
 * skipped; so is anything past the limit. */
export function openCodeProviderKeys(cfg: Pick<AppConfig, "opencodeGo">): Record<string, string> {
  const saved = cfg.opencodeGo?.providerKeys ?? {};
  const usable = Object.keys(saved).sort()
    .filter((name) => !openCodeProviderKeyNameRefusal(name) && OPENCODE_PROVIDER_KEY_VALUE.test(saved[name] ?? ""))
    .slice(0, OPENCODE_PROVIDER_KEY_LIMIT);
  return Object.fromEntries(usable.map((name) => [name, saved[name]!]));
}

/** A Settings change to the saved OpenCode provider keys: a key saves or
 * replaces its name, "" removes it, and every other saved key stays. Returns
 * the whole new set to store, or why it was refused. */
export function mergeOpenCodeProviderKeys(
  cfg: Pick<AppConfig, "opencodeGo">,
  change: Record<string, string>,
): { ok: true; keys: Record<string, string> } | { ok: false; error: string } {
  const keys = new Map(Object.entries(openCodeProviderKeys(cfg)));
  for (const [name, raw] of Object.entries(change)) {
    const value = raw.trim();
    if (!value) {
      keys.delete(name);
      continue;
    }
    const refusal = openCodeProviderKeyNameRefusal(name);
    if (refusal) return { ok: false, error: refusal };
    if (!OPENCODE_PROVIDER_KEY_VALUE.test(value)) return { ok: false, error: "That doesn't look like a key. Paste only the key, with no spaces." };
    keys.set(name, value);
  }
  if (keys.size > OPENCODE_PROVIDER_KEY_LIMIT) {
    return { ok: false, error: `OpenCode can hold up to ${OPENCODE_PROVIDER_KEY_LIMIT} provider keys. Remove one you no longer use, then add this one.` };
  }
  return { ok: true, keys: Object.fromEntries([...keys].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

const configSaveListeners = new Set<(before: JsonObject, after: JsonObject) => void>();

/** Told, synchronously, what each saveConfig wrote: the file before and
 * after. The admin activity log (server/admin-activity.ts) records the
 * change for whoever's request made it. A listener must not throw. */
export function onConfigSaved(listener: (before: JsonObject, after: JsonObject) => void): () => void {
  configSaveListeners.add(listener);
  return () => { configSaveListeners.delete(listener); };
}

/** Merge a partial config into ~/.sagax/config.json (secrets never
 * echoed back — callers report configured-or-not booleans only). */
/** Remove the organization keys retired on 2026-10-01 (memberBotsUseOrgKey)
 * from config.json, once, at start. True when the file changed. */
export function dropRetiredOrganizationKeys(): boolean {
  let raw: unknown;
  try {
    raw = parseJson(readFileSync(join(DATA_DIR, "config.json"), "utf8"));
  } catch {
    return false;
  }
  const organization = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).organization : undefined;
  if (!organization || typeof organization !== "object" || Array.isArray(organization) || !("memberBotsUseOrgKey" in organization)) return false;
  const { memberBotsUseOrgKey: _retired, ...rest } = organization as Record<string, unknown>;
  saveConfig({ organization: appConfigSchema.shape.organization.unwrap().parse(rest) });
  return true;
}

export function saveConfig(
  patch: Partial<Omit<AppConfig, "threads">> & {
    threads?: z.output<typeof threadsPatchSchema>;
  },
  options: { replaceInstances?: boolean } = {},
): void {
  const p = join(DATA_DIR, "config.json");
  let disk: JsonObject = {};
  try {
    const parsed = jsonObjectSchema.safeParse(parseJson(readFileSync(p, "utf8")));
    if (parsed.success) disk = foldLegacyLiveKey(parsed.data) as JsonObject;
  } catch {
    /* first write */
  }
  const checkedPatch = appConfigSchema.partial().extend({ threads: threadsPatchSchema.optional() }).parse(patch);
  const before = configSaveListeners.size ? structuredClone(disk) : disk;
  // A write is the durable migration point. Preserve every other raw key in
  // config.json, but never write #567's mixed-case or duplicate profile ids
  // back after we have successfully recognized the legacy list.
  const storedProfiles = storedBrowserProfilesSchema.safeParse(disk.browserProfiles);
  if (storedProfiles.success) disk.browserProfiles = storedProfiles.data;
  for (const key of ["xai", "anthropic", "mistral", "cerebras", "groq", "openai", "openrouter", "openaiCompat", "box", "opencodeGo", "tts", "decider", "imageGen", "live", "profile", "rooms", "mcp", "threads", "context", "memory", "routines", "localVm", "features", "budgets", "billing", "decisions", "onboarding", "browserEngine"] as const) {
    const section = checkedPatch[key];
    if (!section) continue;
    const current = jsonObjectSchema.safeParse(disk[key]);
    const merged: JsonObject = current.success ? { ...current.data } : {};
    // parseStoredConfig requires threads.maxConcurrentPerBot, so creating
    // the section with only an event-log knob must still persist a valid
    // concurrency default.
    if (key === "threads" && !current.success) merged.maxConcurrentPerBot = DEFAULT_MAX_CONCURRENT_BOT_THREADS;
    Object.assign(merged, section);
    // New provider-key writes never opt existing subscription bots into an
    // API bill. Only stored pre-retirement configs need the boot migration.
    if (key === "anthropic" && Object.hasOwn(section, "key")) merged.everyClaudeBot = false;
    // null is the patch's explicit "remove this key" marker (the threads
    // event-log knobs use it); a key the patch omits keeps its value.
    for (const [sectionKey, sectionValue] of Object.entries(section as Record<string, unknown>)) {
      if (sectionValue === null) delete merged[sectionKey];
    }
    disk[key] = merged;
  }
  if (checkedPatch.vps !== undefined) disk.vps = normalizeVpsConfig(checkedPatch.vps);
  // scalar, not a section: the merge loop above only walks objects
  if (checkedPatch.language !== undefined) disk.language = checkedPatch.language;
  if (checkedPatch.customDomain !== undefined) disk.customDomain = checkedPatch.customDomain;
  if (checkedPatch.signIn !== undefined) disk.signIn = checkedPatch.signIn;
  if (checkedPatch.organization !== undefined) disk.organization = checkedPatch.organization;
  // Replaced whole: removing a named server removes its key.
  if (checkedPatch.openaiCompatServers !== undefined) disk.openaiCompatServers = checkedPatch.openaiCompatServers;
  if (checkedPatch.disabledModels !== undefined) disk.disabledModels = checkedPatch.disabledModels;
  if (checkedPatch.identityMigratedAt !== undefined) disk.identityMigratedAt = checkedPatch.identityMigratedAt;
  if (checkedPatch.privateThreadsMigratedAt !== undefined) disk.privateThreadsMigratedAt = checkedPatch.privateThreadsMigratedAt;
  if (checkedPatch.invites !== undefined) disk.invites = checkedPatch.invites;
  // Replaced whole: the mail route merges, and a field it removed (back to
  // the server's value) must not survive through a section merge.
  if (checkedPatch.mail !== undefined) disk.mail = checkedPatch.mail;
  // Replace the section so clearing a backup cannot revive the old selection.
  if (checkedPatch.automaticRecovery !== undefined) disk.automaticRecovery = checkedPatch.automaticRecovery;
  // A selection is replaced as one value, so changing engines also clears
  // an effort level omitted from the new selection.
  if (checkedPatch.defaultModelSelection !== undefined) {
    disk.defaultModelSelection = checkedPatch.defaultModelSelection;
    if (disk.newBotDefaults) {
      const previousDefaults = newBotDefaultsSchema.parse(disk.newBotDefaults);
      disk.newBotDefaults = newBotDefaultsSchema.parse({
        ...previousDefaults,
        profile: { ...previousDefaults.profile, modelSelection: checkedPatch.defaultModelSelection },
      });
    }
  }
  // Replace the complete template so clearing a field, file or routine
  // cannot revive an old value through the general section merge above.
  if (checkedPatch.newBotDefaults !== undefined) {
    disk.newBotDefaults = checkedPatch.newBotDefaults;
    if (checkedPatch.newBotDefaults.profile.modelSelection) {
      disk.defaultModelSelection = checkedPatch.newBotDefaults.profile.modelSelection;
    } else {
      delete disk.defaultModelSelection;
    }
  }
  if (checkedPatch.cliStartup !== undefined) disk.cliStartup = checkedPatch.cliStartup;
  // Custom MCP mutations go through their own dedicated local API, but
  // saveConfig remains the single atomic persistence boundary.
  if (checkedPatch.mcpServers !== undefined) {
    disk.mcpServers = jsonObjectSchema.parse(checkedPatch.mcpServers);
  }
  // the whole list is the unit of change: an add or a delete arrives as the
  // new list, never as a per-item merge
  if (checkedPatch.browserProfiles !== undefined) {
    // `partitionId` is read-only migration metadata. A rename/list replace
    // from the renderer omits it, so carry it forward only for an unchanged
    // canonical id. A genuinely new id always gets its own fresh partition.
    const existingProfiles = new Map(
      (storedProfiles.success ? storedProfiles.data : []).map((profile) => [profile.id, profile]),
    );
    const nextProfiles: BrowserProfile[] = checkedPatch.browserProfiles.map((profile) => {
      const partitionId = existingProfiles.get(profile.id)?.partitionId;
      return partitionId ? { ...profile, partitionId } : profile;
    });
    const routingConflict = browserProfileReplacementConflict(
      storedProfiles.success ? storedProfiles.data : [],
      nextProfiles,
    );
    if (routingConflict) throw Object.assign(new Error(routingConflict), { status: 409 });
    disk.browserProfiles = nextProfiles;
    if (disk.newBotDefaults) {
      const defaults = newBotDefaultsSchema.parse(disk.newBotDefaults);
      const profileId = defaults.profile.browserProfile;
      if (profileId && profileId !== "guest" && !nextProfiles.some(profile => profile.id === profileId)) {
        delete defaults.profile.browserProfile;
        disk.newBotDefaults = defaults;
      }
    }
  }
  if (checkedPatch.instances) {
    const currentInstances = jsonObjectSchema.safeParse(disk.instances);
    const storedInstances: JsonObject = currentInstances.success ? currentInstances.data : {};
    const diskInstances: JsonObject = options.replaceInstances ? {} : storedInstances;
    for (const [instanceId, entry] of Object.entries(checkedPatch.instances)) {
      const current = jsonObjectSchema.safeParse(storedInstances[instanceId]);
      const merged: JsonObject = current.success ? { ...current.data } : {};
      // Replacement clears omitted known settings, but retained shadow
      // entries keep fields understood only by a newer app or driver.
      if (options.replaceInstances) {
        for (const key of Object.keys(instanceConfigSchema.shape)) delete merged[key];
      }
      Object.assign(merged, entry);
      diskInstances[instanceId] = merged;
    }
    disk.instances = diskInstances;
  }
  // Settings edits the workspace connection. Older fleet saves could freeze
  // its inherited URL in the default instance, sending a replacement key to
  // the previous endpoint. An explicit URL save reconnects that shared-key
  // instance; custom connections and explicit instance patches stay intact.
  if (checkedPatch.openaiCompat?.url !== undefined && checkedPatch.instances?.openaiCompat === undefined) {
    const instances = jsonObjectSchema.safeParse(disk.instances);
    const entry = jsonObjectSchema.safeParse(instances.success ? instances.data.openaiCompat : undefined);
    const config = jsonObjectSchema.safeParse(entry.success ? entry.data.config : undefined);
    const environment = jsonObjectSchema.safeParse(entry.success ? entry.data.environment : undefined);
    if (entry.success && entry.data.driver === "openai-compat" && config.success
      && !config.data.key
      && (!config.data.apiKeyEnv || config.data.apiKeyEnv === "OPENAI_COMPAT_API_KEY")
      && !(environment.success && Object.hasOwn(environment.data, "OPENAI_COMPAT_API_KEY"))) {
      const nextConfig = { ...config.data };
      delete nextConfig.url;
      // Preserve raw extension fields elsewhere in this saved instance.
      (disk.instances as JsonObject).openaiCompat = { ...entry.data, config: nextConfig };
    }
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(p, JSON.stringify(disk, null, 2), { mode: 0o600 });
  for (const listener of configSaveListeners) {
    try {
      listener(before, disk);
    } catch (error) {
      console.warn(`config: a save listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Set one instance's `config.cli` ("" clears the override back to the
 * driver default). Creating the instance entry is fine — a config-less
 * entry rides driver.defaultConfig(). Returns false for unknown instances
 * when the fleet is explicitly configured. The returned map must stay
 * PERSISTABLE: instanceConfigs() injects credential env into consuming
 * drivers' entries for the live fleet, so only their originally configured
 * environment is retained — otherwise saving an override would
 * copy xai/box/opencodeGo secrets into the instances section of
 * config.json. */
export function withInstanceCli(
  cfg: AppConfig,
  instanceId: string,
  cli: string,
): InstanceCliUpdate {
  const next: AppConfig = structuredClone(cfg);
  const map = persistableInstanceConfigs(next);
  // hasOwn, not truthiness: map is a plain object literal, so
  // map["__proto__"] resolves to Object.prototype — truthy — and the
  // assignment below would poison EVERY object in the process (instanceId
  // comes off the URL, where `__proto__` passes the route's [\w.-]+ regex)
  if (!Object.hasOwn(map, instanceId)) return { ok: false, config: cfg };
  const entry = map[instanceId];
  const cliKey = cli.trim();
  const currentConfig = jsonObjectSchema.safeParse(entry.config);
  if (cliKey) {
    const nextConfig: JsonObject = currentConfig.success ? { ...currentConfig.data } : {};
    nextConfig.cli = cliKey;
    entry.config = nextConfig;
  } else if (currentConfig.success && Object.hasOwn(currentConfig.data, "cli")) {
    const rest = { ...currentConfig.data };
    delete rest.cli;
    entry.config = Object.keys(rest).length ? rest : undefined;
  }
  next.instances = map;
  return { ok: true, config: next };
}

/** Materialize defaults without freezing injected workspace settings or secrets. */
export function persistableInstanceConfigs(cfg: AppConfig): InstanceConfigMap {
  const map = instanceConfigs(cfg);
  for (const [id, entry] of Object.entries(map)) {
    const environment = cfg.instances?.[id]?.environment;
    if (environment) entry.environment = { ...environment };
    else delete entry.environment;
    const config = cfg.instances?.[id]?.config;
    if (config !== undefined) entry.config = structuredClone(config);
    else delete entry.config;
  }
  return map;
}

interface InstanceCliUpdate {
  ok: boolean;
  config: AppConfig;
}

/** Claude Code variables that choose where a turn goes and how it signs in.
 * An instance that sets any of them (a router, a gateway, a cloud platform)
 * owns that routing and credential pair outright. */
const CLAUDE_ROUTING_ENV = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

/** Whether a Claude instance brings its own endpoint or credential. The
 * workspace Anthropic key must never reach it: the key would be sent as
 * x-api-key to that instance's host (a third-party router), or would
 * silently re-route its turns to the workspace URL. */
export function claudeInstanceOwnsRouting(environment: Record<string, string> | undefined): boolean {
  return CLAUDE_ROUTING_ENV.some((key) => typeof environment?.[key] === "string" && environment[key] !== "");
}

const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/u, "") === b.trim().replace(/\/+$/u, "");

/** Whether an instance brings its own endpoint or credential, so the
 * workspace key for its driver must never reach it: that key would be sent
 * to the instance's own host (a third-party router or proxy). The same rule
 * as a Claude router instance, for the API-key engines. An instance on the
 * workspace's own endpoint with nothing of its own still gets the key. */
export function instanceOwnsRouting(
  cfg: AppConfig,
  entry: { driver: string; config?: unknown; environment?: Record<string, string> },
  routingDefaults?: { url?: string; apiKeyEnv?: string },
): boolean {
  const config = typeof entry.config === "object" && entry.config !== null && !Array.isArray(entry.config)
    ? entry.config as Record<string, unknown>
    : {};
  const own = (value: unknown) => typeof value === "string" && value.trim() !== "";
  const ownUrl = (...workspace: Array<string | undefined>) => own(config.url)
    && !workspace.some((url) => url !== undefined && sameUrl(config.url as string, url));
  const compatKeyEnv = routingDefaults?.apiKeyEnv ?? "OPENAI_COMPAT_API_KEY";
  switch (entry.driver) {
    case "claudeAgent":
      return claudeInstanceOwnsRouting(entry.environment);
    case "openai-compat":
      return own(config.key) || own(entry.environment?.OPENAI_COMPAT_API_KEY)
        || own(entry.environment?.[compatKeyEnv])
        || (own(config.apiKeyEnv) && config.apiKeyEnv !== compatKeyEnv)
        || ownUrl(routingDefaults?.url || cfg.openaiCompat?.url || process.env.OPENAI_COMPAT_URL || "https://openrouter.ai/api/v1");
    case "mistral":
      return own(entry.environment?.MISTRAL_API_KEY) || ownUrl("https://api.mistral.ai/v1");
    case "cerebras":
      return own(entry.environment?.CEREBRAS_API_KEY) || ownUrl("https://api.cerebras.ai/v1");
    case "groq":
      return own(entry.environment?.GROQ_API_KEY) || ownUrl("https://api.groq.com/openai/v1", cfg.groq?.url);
    case "grok":
      return own(entry.environment?.XAI_API_KEY) || (own(config.apiKeyEnv) && config.apiKeyEnv !== "XAI_API_KEY")
        || ownUrl("https://api.x.ai/v1", cfg.xai?.url);
    default:
      return false;
  }
}

/** The credential env instanceConfigs() injects for one driver at runtime.
 * Each secret goes only to the driver that actually reads it: the API-key
 * Grok driver reads XAI_API_KEY and OpenCode reads OPENCODE_API_KEY. Every
 * other engine brings its own login, so handing it a key it never uses would
 * only put that key in the environment of an unrelated child process. The
 * Boat token reaches no engine at all: the harness alone talks to Boat. */
function injectedEnvironment(cfg: AppConfig, instanceId: string, driver: string): Map<string, string> {
  const environment = new Map<string, string>();
  if (driver === "mistral" && cfg.mistral?.key) environment.set("MISTRAL_API_KEY", cfg.mistral.key);
  if (driver === "cerebras" && cfg.cerebras?.key) environment.set("CEREBRAS_API_KEY", cfg.cerebras.key);
  if (driver === "groq" && cfg.groq?.key) environment.set("GROQ_API_KEY", cfg.groq.key);
  if (driver === "grok" && cfg.xai?.key) environment.set("XAI_API_KEY", cfg.xai.key);
  // Grok Build never runs on it in solo mode (acp/grok.ts strips it); on an
  // organization server it is the organization's key for Grok Build, after
  // each person's own sign-in and key (server/engine-credentials.ts).
  if (driver === "grokAgent" && cfg.xai?.key && process.env.SAGAX_IDENTITY?.trim().toLowerCase() === "perspicax") environment.set("XAI_API_KEY", cfg.xai.key);
  // A provider key belongs only to its API instance. The retired global
  // switch is read once by the saved-selection migration, never at dispatch.
  const explicitApi = cfg.instances?.[instanceId];
  const requiresAnthropic = explicitApi?.access === "api" && explicitApi.config && typeof explicitApi.config === "object"
    && !Array.isArray(explicitApi.config) && (explicitApi.config as Record<string, unknown>).requireApiKey === true;
  const anthropicHere = driver === "claudeAgent" && Boolean(cfg.anthropic?.key)
    && (instanceId === CLAUDE_API_INSTANCE || requiresAnthropic);
  if (anthropicHere) environment.set("ANTHROPIC_API_KEY", cfg.anthropic!.key!);
  if (anthropicHere && cfg.anthropic!.url) environment.set("ANTHROPIC_BASE_URL", cfg.anthropic!.url);
  // OpenAI and OpenRouter have their own instances and keys; the workspace
  // OpenAI-compatible key and URL belong to every other openai-compat
  // instance ("Other" in Settings), except a named server added from the app
  // (2026-10-30), which runs on its own key only.
  if (driver === "openai-compat" && isCompatServerId(instanceId)) {
    const key = cfg.openaiCompatServers?.[instanceId]?.key;
    if (key) environment.set(COMPAT_SERVER_KEY_ENV, key);
  } else if (driver === "openai-compat" && instanceId === OPENAI_API_INSTANCE) {
    if (cfg.openai?.key) environment.set("SAGAX_OPENAI_API_KEY", cfg.openai.key);
  } else if (driver === "openai-compat" && instanceId === OPENROUTER_API_INSTANCE) {
    if (cfg.openrouter?.key) environment.set("SAGAX_OPENROUTER_API_KEY", cfg.openrouter.key);
  } else {
    if (driver === "openai-compat" && cfg.openaiCompat?.key)
      environment.set("OPENAI_COMPAT_API_KEY", cfg.openaiCompat.key);
    if (driver === "openai-compat" && cfg.openaiCompat?.url)
      environment.set("OPENAI_COMPAT_URL", cfg.openaiCompat.url);
  }
  if (driver === "opencodeGo") {
    // Keys for OpenCode's other providers, under the names OpenCode reads.
    for (const [name, key] of Object.entries(openCodeProviderKeys(cfg))) environment.set(name, key);
    if (cfg.opencodeGo?.apiKey) environment.set("OPENCODE_API_KEY", cfg.opencodeGo.apiKey);
  }
  return environment;
}

/** 2026-10-30: a named OpenAI-compatible server added from the app
 * (server/openai-compat-servers.ts): its instance id starts with this, and
 * its key reaches it, and only it, as COMPAT_SERVER_KEY_ENV. */
export const COMPAT_SERVER_PREFIX = "compat-";
export const COMPAT_SERVER_KEY_ENV = "SAGAX_COMPAT_SERVER_API_KEY";
export function isCompatServerId(instanceId: string): boolean {
  return instanceId.startsWith(COMPAT_SERVER_PREFIX) && instanceId.length > COMPAT_SERVER_PREFIX.length;
}

/** The credential variables each key-backed driver reads. */
const DRIVER_CREDENTIAL_VARIABLES: Record<string, readonly string[]> = {
  claudeAgent: ["ANTHROPIC_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  grok: ["XAI_API_KEY"],
  grokAgent: ["XAI_API_KEY"],
  "openai-compat": ["OPENAI_COMPAT_API_KEY", "SAGAX_OPENAI_API_KEY", "SAGAX_OPENROUTER_API_KEY", "SAGAX_COMPAT_SERVER_API_KEY"],
  opencodeGo: ["OPENCODE_API_KEY"],
};

/** Whether this driver's turns run on a key the workspace configured
 * (Settings > Connections): a credential variable injectedEnvironment
 * hands it, for this instance when one is named. Login-backed engines
 * (Codex, ACP agents) never are, nor grokAgent outside an organization
 * server. On an organization server such a
 * key is the organization's key, the fallback after the speaker's own
 * subscription and key (server/engine-credentials.ts). */
export function driverKeyBacked(cfg: AppConfig, driver: string, instanceId = ""): boolean {
  const variables = DRIVER_CREDENTIAL_VARIABLES[driver];
  if (!variables) return false;
  const environment = injectedEnvironment(cfg, instanceId, driver);
  return variables.some((variable) => Boolean(environment.get(variable)));
}

/** One instance per pasted provider key, each running only on its own key.
 * They sit in the picker's "API keys" group and stay hidden until their key
 * is saved (unavailable without one). */
export const OPENAI_API_INSTANCE = "openai";
export const OPENROUTER_API_INSTANCE = "openrouter";
export const XAI_API_INSTANCE = "xaiApi";
export const CLAUDE_API_INSTANCE = "claudeApi";
const API_KEY_FLEET: InstanceConfigMap = {
  [OPENAI_API_INSTANCE]: {
    driver: "openai-compat", displayName: "OpenAI", access: "api", icon: { kind: "preset", preset: "openai" },
    config: { url: "https://api.openai.com/v1", apiKeyEnv: "SAGAX_OPENAI_API_KEY", catalog: "openai" },
  },
  [CLAUDE_API_INSTANCE]: {
    driver: "claudeAgent", displayName: "Claude (API key)", access: "api", icon: { kind: "preset", preset: "anthropic" },
    config: { requireApiKey: true },
  },
  [XAI_API_INSTANCE]: { driver: "grok", displayName: "xAI", access: "api", icon: { kind: "preset", preset: "xai" } },
  [OPENROUTER_API_INSTANCE]: {
    driver: "openai-compat", displayName: "OpenRouter", access: "api", icon: { kind: "preset", preset: "openrouter" },
    config: { url: "https://openrouter.ai/api/v1", apiKeyEnv: "SAGAX_OPENROUTER_API_KEY" },
  },
};

// Default fleet: one instance per built-in driver (upstream
// defaultInstanceIdForDriver — instanceId defaults to the driver kind).
// Config-file keys are injected as per-instance environment so drivers
// see them without needing real process env vars — but only into the
// driver that consumes each key (injectedEnvironment above).
export function instanceConfigs(cfg: AppConfig): InstanceConfigMap {
  // The default `grok` instance rides the `grokAgent` driver, not the API-key
  // one: like claude and codex it needs no credential from us, just the CLI
  // installed and logged in (it shows up unavailable otherwise). The API-key
  // `grok` driver stays registered but out of the default fleet — that key is
  // a credential Milind doesn't want to manage; an `instances` entry brings
  // it back anytime.
  //
  // Google rides `antigravityAgent` (the official Google ACP server), not
  // `geminiAgent`:
  // Google retired Gemini CLI for the free/Pro/Ultra tiers on 2026-06-18
  // (developers.googleblog.com, "transitioning Gemini CLI to Antigravity
  // CLI"), so a default `gemini` instance could only ever show unavailable.
  // The driver stays registered for enterprise licences, which keep Gemini
  // CLI — `{"instances": {"gemini": {"driver": "geminiAgent"}}}` restores it.
  const DEFAULT_FLEET: InstanceConfigMap = {
    grok: { driver: "grokAgent" },
    kimi: { driver: "kimiAgent" },
    droid: { driver: "droidAgent" },
    cursor: { driver: "cursorAgent" },
    claude: { driver: "claudeAgent" },
    codex: { driver: "codex" },
    chatgpt: { driver: "codex", displayName: "ChatGPT plan", config: { authMode: "chatgpt-plan" } },
    antigravity: { driver: "antigravityAgent" },
    opencodeGo: { driver: "opencodeGo" },
    openaiCompat: { driver: "openai-compat" },
    mistral: { driver: "mistral" },
    cerebras: { driver: "cerebras" },
    groq: { driver: "groq" },
    ...API_KEY_FLEET,
    qwen: { driver: "qwenAgent" },
    hermes: { driver: "hermesAgent" },
    cline: { driver: "clineAgent" },
    pi: { driver: "piAgent" },
  };
  const CUSTOM_ONLY = {
    qwen: { driver: "qwenAgent" },
    hermes: { driver: "hermesAgent" },
    cline: { driver: "clineAgent" },
    pi: { driver: "piAgent" },
  } as const;
  // New default-fleet engines that existing product configs would otherwise
  // never see. Custom-only engines stay in CUSTOM_ONLY so a one-off test map
  // is not expanded, matching the claude/grok/codex product-fleet probe.
  const PRODUCT_FLEET_ADDITIONS = {
    chatgpt: { driver: "codex", displayName: "ChatGPT plan", config: { authMode: "chatgpt-plan" } },
    cursor: { driver: "cursorAgent" },
    openaiCompat: { driver: "openai-compat" },
    mistral: { driver: "mistral" },
    cerebras: { driver: "cerebras" },
    groq: { driver: "groq" },
    ...API_KEY_FLEET,
    ...CUSTOM_ONLY,
  } as const;
  const configured = cfg.instances && Object.keys(cfg.instances).length ? cfg.instances : null;
  // A fleet saved before the Computer engine was removed may still name it.
  const map: InstanceConfigMap = withoutComputerEngine(configured ? { ...configured } : { ...DEFAULT_FLEET });
  // An organization server serves Gemini CLI on each person's own Google key
  // (Perspicax provider `google`, server/engine-credentials.ts): the retired
  // consumer login above is not what pays there, so the engine is listed.
  if (process.env.SAGAX_IDENTITY?.trim().toLowerCase() === "perspicax" && (!configured || Object.hasOwn(configured, "claude") || Object.hasOwn(configured, "grok") || Object.hasOwn(configured, "codex"))) {
    if (!Object.hasOwn(map, "gemini")) map.gemini = { driver: "geminiAgent" };
  }
  // Product fleets pick up newly shipped engines. A one-off test/shadow map
  // (no claude/grok/codex) is left exactly as written.
  if (
    configured &&
    (Object.hasOwn(configured, "claude") || Object.hasOwn(configured, "grok") || Object.hasOwn(configured, "codex"))
  ) {
    for (const [id, entry] of Object.entries(PRODUCT_FLEET_ADDITIONS)) {
      if (!Object.hasOwn(map, id)) map[id] = { ...entry };
    }
  }
  // A saved `instances` map (any engine edit persists the whole fleet) keeps
  // these entries without their built-in routing. Re-apply it on every load
  // so the OpenAI and OpenRouter instances can never fall back to the shared
  // OpenAI-compatible key and URL; saved fields still win.
  for (const [id, builtIn] of Object.entries(API_KEY_FLEET)) {
    const saved = map[id];
    if (!saved || saved.driver !== builtIn.driver) continue;
    const savedConfig = typeof saved.config === "object" && saved.config !== null && !Array.isArray(saved.config) ? saved.config : {};
    map[id] = { ...builtIn, ...saved, config: { ...(builtIn.config as object | undefined), ...savedConfig } };
  }
  if (map.chatgpt?.driver === "codex" && !(map.chatgpt.config as { cli?: unknown } | undefined)?.cli) {
    const cli = (map.codex?.config as { cli?: unknown } | undefined)?.cli;
    if (typeof cli === "string" && cli) map.chatgpt = { ...map.chatgpt, config: { ...map.chatgpt.config as object, cli } };
  }
  for (const [id, sourceEntry] of Object.entries(map)) {
    // instanceConfigs() builds a transient runtime map. Never mutate the
    // caller's persisted entries while injecting workspace defaults: doing so
    // would turn the first workspace URL into a stale per-instance override.
    const entry = { ...sourceEntry };
    map[id] = entry;
    const environment = { ...entry.environment };
    // Main's rule: an instance that brought its own key or host gets no
    // workspace credential. Built-in per-provider routing is a default,
    // not an override, but saved custom routing on those IDs still owns its
    // credential rather than receiving the workspace's provider key.
    const builtIn = API_KEY_FLEET[id];
    const routingDefaults = builtIn?.driver === entry.driver
      ? builtIn.config as { url?: string; apiKeyEnv?: string } | undefined
      : undefined;
    const ownsRouting = instanceOwnsRouting(cfg, entry, routingDefaults);
    // A named OpenAI-compatible server owns its address, and its own key
    // still comes from here (injectedEnvironment gives it nothing else).
    if (!ownsRouting || (entry.driver === "openai-compat" && isCompatServerId(id))) {
      for (const [key, value] of injectedEnvironment(cfg, id, entry.driver)) environment[key] = value;
    }
    entry.environment = environment;
    // Solo file keys ride the instance. An organization server has no person
    // here, so this injects nothing: a turn reads that person's own file.
    applyStoredEngineEnv(
      environment,
      entry.driver,
      DATA_DIR,
      process.env.SAGAX_IDENTITY?.trim().toLowerCase() === "perspicax"
        ? { organization: true, principalId: null }
        : { organization: false },
    );
    if (entry.driver === "groq" && cfg.groq?.url && !ownsRouting) {
      entry.config = { ...entry.config as object, url: cfg.groq.url };
    }
    // The driver URL is configuration, not a credential. Environment is
    // intentionally not consulted by ProviderRegistry when it decodes a
    // driver's config, so carry the workspace default into the transient
    // instance map while preserving a per-instance override.
    if (entry.driver === "openai-compat" && cfg.openaiCompat && id !== OPENAI_API_INSTANCE && id !== OPENROUTER_API_INSTANCE) {
      const defaults: Record<string, string> = {};
      if (cfg.openaiCompat.url) defaults.url = cfg.openaiCompat.url;
      if (cfg.openaiCompat.model) defaults.model = cfg.openaiCompat.model;
      if (cfg.openaiCompat.provider) defaults.provider = cfg.openaiCompat.provider;
      if (Object.keys(defaults).length) {
        const raw = entry.config;
        const current =
          typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
        const merged = { ...current };
        // A per-instance value always wins over the workspace default.
        for (const [k, v] of Object.entries(defaults)) {
          // Empty routing explicitly means "no upstream pin" for isolated
          // API connections. Do not replace it with a workspace provider.
          if (k === "provider" && typeof merged[k] === "string") continue;
          if (typeof merged[k] !== "string" || !(merged[k] as string).trim()) merged[k] = v;
        }
        entry.config = merged;
      }
    }
    // A CLI onboarding key lives sealed in the encrypted engine-key store, no
    // longer in clear in config.json. Put it back on this transient instance
    // config so the driver resolves the key exactly as before. An inline key
    // (not yet migrated) still wins; built-in provider instances carry no
    // inline key; an organization server keeps its shared-key semantics.
    if (
      entry.driver === "openai-compat" &&
      id !== OPENAI_API_INSTANCE &&
      id !== OPENROUTER_API_INSTANCE &&
      process.env.SAGAX_IDENTITY?.trim().toLowerCase() !== "perspicax"
    ) {
      const current =
        typeof entry.config === "object" && entry.config !== null && !Array.isArray(entry.config)
          ? (entry.config as Record<string, unknown>)
          : {};
      if (typeof current.key !== "string" || !current.key) {
        const stored = readOnboardingEngineKey(DATA_DIR, id);
        if (stored) entry.config = { ...current, key: stored };
      }
    }
  }
  return map;
}

// ── user-configured MCP servers ─────────────────────────────────────────
// config.json: { "mcpServers": { "notes": { "command": "npx", "args":
// ["-y", "@x/notes-mcp"], "env": { "NOTES_TOKEN": "…" } },
//                                "docs": { "type": "http", "url": "https://…/mcp",
// "headers": { "Authorization": "Bearer …" } } } }
// Validate-with-skip so one bad entry never takes the fleet down, and each
// skip is logged once with a sentence that teaches.

export type CustomMcpServer = McpServerSpec;

const reportedMcpSkips = new Set<string>();
function skipMcpEntry(name: string, why: string): void {
  const key = `${name}: ${why}`;
  if (reportedMcpSkips.has(key)) return;
  reportedMcpSkips.add(key);
  console.error(`mcpServers.${JSON.stringify(name)} skipped — ${why}`);
}

/** 2026-10-17 (#695 follow-up): a stored server whose name Sagax now
 * reserves is never mounted; say so once, clearly, rather than skip it
 * silently. Called at start and on every mount. */
export function warnReservedMcpServers(cfg: AppConfig): string[] {
  const names = Object.keys(cfg.mcpServers ?? {}).filter(reservedMcpServerName);
  for (const name of names) {
    const key = `${name}: reserved`;
    if (reportedMcpSkips.has(key)) continue;
    reportedMcpSkips.add(key);
    console.warn(reservedMcpServerLog(name));
  }
  return names;
}

/** The validated, normalized custom servers from config — or {}. */
/** Per server, the tools switched off on the Plugins detail page. Only
 * enabled, valid entries with at least one disabled tool are listed. */
export function mcpDisabledTools(cfg: AppConfig): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, raw] of Object.entries(cfg.mcpServers ?? {})) {
    const parsed = parseStoredMcpServer(name, raw);
    if (parsed.ok && parsed.server.enabled && parsed.server.disabledTools?.length) out[name] = parsed.server.disabledTools;
  }
  return out;
}

export function customMcpServers(cfg: AppConfig, only?: string[]): Record<string, CustomMcpServer> {
  const out: Record<string, CustomMcpServer> = {};
  for (const [name, raw] of Object.entries(cfg.mcpServers ?? {})) {
    // a bot with its own list gets exactly those names; a bot without one
    // keeps getting every enabled server, as before this field existed
    if (only && !only.includes(name)) continue;
    if (reservedMcpServerName(name)) {
      warnReservedMcpServers(cfg);
      continue;
    }
    const parsed = parseStoredMcpServer(name, raw);
    if (!parsed.ok) {
      skipMcpEntry(name, `${parsed.error} Expected { "command": "npx", "args": [...], "env": { ... } } or { "type": "http", "url": "https://…", "headers": { ... } }`);
      continue;
    }
    if (!parsed.server.enabled) continue;
    out[name] = isRemoteMcpServer(parsed.server)
      ? { type: parsed.server.type, url: parsed.server.url, headers: parsed.server.headers }
      : { command: parsed.server.command, args: parsed.server.args, env: parsed.server.env };
  }
  return out;
}
