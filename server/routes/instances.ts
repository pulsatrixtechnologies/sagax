// Provider instances (model picker / Engines settings).
//
//   GET    /api/instances
//   GET|POST /api/instances/:id/api-key
//   PATCH  /api/instances/:id/icon
//   POST   /api/instances/chatgpt-accounts
//   POST   /api/instances/claude-accounts
//   GET    /api/instances/:id/auth/status
//   POST   /api/instances/:id/(refresh-models|install|auth/*)
//   POST   /api/instances/:id/claude-update
//   PATCH  /api/instances/:id
//   DELETE /api/instances/:id
//
// Hosted workspaces refuse non-GET under /api/instances/. Company.* accounts
// are read-only here. /api/cli-candidates and /api/cli-test stay elsewhere.
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  assertSeparateClaudeAccount,
  configuredAccountDirectory,
  createClaudeAccountSchema,
  instanceSettingsSchema,
  newClaudeAccount,
} from "../engines/claude-accounts.ts";
import { pinnedClaudeUpdateRefusal, updateClaudeCli } from "../engines/claude-update.ts";
import type { AccountMovesHost } from "../engines/account-moves.ts";
import { ONLY_ACCOUNT_ERROR, addedAccount, removableAccount, separateAccountInstance } from "../../shared/added-account.ts";
import {
  engineLaunches,
  persistableInstanceConfigs,
  withInstanceCli,
  type AppConfig,
} from "../config.ts";
import type { InstanceConfigMap, ModelSelection, ProviderInstance } from "../contracts.ts";
import {
  configKeyPatch,
  engineKeyScope,
  engineKeyTarget,
  EngineKeyError,
  fileKeyConfigured,
  hermesProviderEnv,
  normalizeEngineKey,
  writeFileEngineKey,
} from "../engines/engine-api-keys.ts";
import { providersOfInstance } from "../engines/engine-credentials.ts";
import { HOSTED_PROVIDER_SETTINGS_ERROR } from "../models/hosted-models.ts";
import { cliCommandRefusal } from "../procs.ts";
import type { ProviderAccountOwner } from "../engines/provider-accounts.ts";
import { providerIconPatchSchema, withInstanceIcon } from "../engines/provider-icon.ts";
import { isLoopbackHost, isProxied, type RequestAuth } from "../auth/request-auth.ts";
import { permissionRefusal, type PermissionKey } from "../../shared/permissions.ts";
import { providerIconError } from "../../shared/provider-icon.ts";
import { PASS, type RouteHandler } from "./table.ts";

type BusyBot = {
  id: string;
  name?: string;
  busy?: boolean;
  modelSelection: ModelSelection;
  fallback?: ModelSelection[];
};

type BusyTask = {
  threadId: string;
  modelSelection?: ModelSelection | null;
  resumeCursors: Record<string, unknown>;
  lastInstanceId?: string | null;
};

export interface InstancesRouteDeps {
  /** Live app config; mutated in place after saves (same object index.ts holds). */
  cfg: AppConfig;
  dataDir: string;
  hostedModels: boolean;
  identityKind: () => string;
  callerCan: (auth: RequestAuth, key: PermissionKey) => boolean;
  adminOrDelegate: (auth: RequestAuth, key: PermissionKey) => boolean;
  resetPathCache: () => void;
  instancesForViewer: (viewer: string | null) => Promise<unknown[]>;
  memberInstanceView: (instance: unknown, viewer?: string | null) => unknown;
  clientInstanceView: (instance: unknown) => unknown;
  registry: {
    get(instanceId: string): ProviderInstance | null;
    knowsDriver(driverKind: string): boolean;
    refreshModels(instanceId: string): Promise<boolean>;
    installRuntime(instanceId: string): Promise<boolean>;
    forgetSnapshots(): void;
    cliTarget(instanceId: string): { driverKind: string; cli: string | null } | null;
  };
  providerAccounts: {
    list(owner: ProviderAccountOwner): Promise<{ keys: Array<{ provider: string }> }>;
    setKey(owner: ProviderAccountOwner, provider: string, key: string | null): Promise<unknown>;
  };
  providerAccountOwner: (principalId: string | null) => ProviderAccountOwner | null | undefined;
  /** #4435: the person an added account belongs to (organization server), else undefined. */
  accountOwner?: (instanceId: string) => string | undefined;
  providerAuthSessions: {
    status(instanceId: string, owner: string, flowId: string): Promise<{ phase: string }>;
    start(instance: ProviderInstance, owner: string): Promise<{ phase: string }>;
    signOut(instance: ProviderInstance, owner: string): Promise<void>;
    complete(instanceId: string, owner: string, flowId: string, callbackUrl: string): Promise<void>;
    cancel(instanceId: string, owner: string, flowId: string): Promise<void>;
    revokeOwner(owner: string): void;
  };
  sessionsIsLive: (sessionId: string) => boolean;
  saveConfig: (patch: Record<string, unknown>, options?: { replaceInstances?: boolean }) => void;
  loadConfig: () => AppConfig;
  broadcast: (payload: Record<string, unknown>) => void;
  configStatus: () => Record<string, unknown>;
  providerConfigs: () => InstanceConfigMap;
  getProviderConfigBusy: () => boolean;
  setProviderConfigBusy: (busy: boolean) => void;
  providerInstancesChanging: { add(id: string): void; delete(id: string): void };
  claudeUpdatesInFlight: { has(cli: string): boolean; add(cli: string): void; delete(cli: string): void };
  persistProviderInstance: (instanceId: string, instances: InstanceConfigMap) => Promise<void>;
  reloadProviders: (before: Record<string, unknown>) => Promise<void>;
  selfCheckedEngine: (instanceId: string) => unknown | null;
  cliProbeEnvironment: () => NodeJS.ProcessEnv;
  updateClaudeCli?: (cli: string, env: NodeJS.ProcessEnv) => Promise<{ version: string }>;
  bots: () => BusyBot[];
  tasks: (botId: string) => BusyTask[];
  threadBusy: (botId: string, threadId: string) => boolean;
  botForThread: (botId: string, threadId: string) => { modelSelection: ModelSelection } | null | undefined;
  activeGroupTurnForBot: (botId: string) => boolean;
  isProxied?: (req: IncomingMessage) => boolean;
  isLoopbackHost?: (host: string | undefined) => boolean;
  /** 2026-11-18: where an account's bots go when it is removed or signed
   * out of (server/engines/account-moves.ts); never a refusal. */
  accountMoves?: AccountMovesHost;
}

/** The other accounts of `instanceId`'s provider its bots may move to: same
 * tool, not a key. 2026-11-19: every person's, since the plan (accountMoves,
 * ownerReachable) moves each bot only within its own person's accounts or the
 * organization's shared ones, never onto the remover's own account. */
function sameProviderAccounts(cfg: AppConfig, instanceId: string): string[] {
  const instances = persistableInstanceConfigs(cfg);
  const entry = instances[instanceId];
  if (!entry) return [];
  return Object.keys(instances).filter((id) => id !== instanceId && instances[id]?.driver === entry.driver && instances[id]?.access !== "api");
}

/** Selections of engines that currently have a turn in flight. */
function busyProviderSelections(deps: Pick<InstancesRouteDeps, "bots" | "tasks" | "threadBusy" | "botForThread" | "activeGroupTurnForBot">): ModelSelection[] {
  return deps.bots().flatMap((bot) => {
    const busyTasks = deps.tasks(bot.id).filter((task) => deps.threadBusy(bot.id, task.threadId));
    const selections = busyTasks.map((task) => deps.botForThread(bot.id, task.threadId)!.modelSelection);
    // Rooms still run from the profile default; a direct thread does not.
    if (deps.activeGroupTurnForBot(bot.id) || (bot.busy && busyTasks.length === 0)) selections.push(bot.modelSelection);
    return selections;
  });
}

/** What removing an added account needs (the instance routes and a
 * person's own list, server/routes/me-engines.ts, share it). */
export type AddedAccountRemovalDeps = Pick<InstancesRouteDeps,
  "cfg" | "saveConfig" | "getProviderConfigBusy" | "setProviderConfigBusy" | "providerInstancesChanging" | "persistProviderInstance" |
  "bots" | "tasks" | "threadBusy" | "botForThread" | "activeGroupTurnForBot">;

export type AddedAccountRemoval =
  | { ok: true }
  | { ok: false; status: number; body: { error: string; code?: string; [key: string]: unknown } };

/** Removes one account of a provider, the first one too while another
 * remains (#4415, #4426, #4435). Neither a bot on it nor a turn in flight
 * holds the removal back. `beforeRemove` runs while the entry is still there
 * (the bots move, a sign-out reads it). */
export async function removeAddedAccount(
  deps: AddedAccountRemovalDeps,
  instanceId: string,
  options: { beforeRemove?: () => Promise<void> } = {},
): Promise<AddedAccountRemoval> {
  if (deps.getProviderConfigBusy()) return { ok: false, status: 409, body: { error: "provider settings are already being updated" } };
  const instances = persistableInstanceConfigs(deps.cfg);
  if (!Object.hasOwn(instances, instanceId)) return { ok: false, status: 404, body: { error: "unknown instance" } };
  // #4415, #4426: any account of any provider (Claude, the ChatGPT plan,
  // Antigravity), the first one too, while the provider keeps another.
  // A key engine of the same tool is a key, not an account.
  const entry = instances[instanceId];
  // Another person's own added account (ownerPrincipalId, an organization
  // server) is not the provider's account for everyone: leaving only it would
  // take the provider away from the rest of the organization.
  const accounts = Object.keys(instances).filter((id) => instances[id]?.driver === entry.driver && instances[id]?.access !== "api" && !instances[id]?.ownerPrincipalId);
  if (entry.access === "api" || !(addedAccount(instanceId, entry.driver) || removableAccount(instanceId, accounts))) {
    return { ok: false, status: 400, body: { error: ONLY_ACCOUNT_ERROR } };
  }
  // 2026-11-19 (owner rule: removing an account never waits): a turn in
  // flight on it finishes on its live engine (persistProviderInstance stops
  // that engine once the turn is over); its bots already moved for the next.
  deps.setProviderConfigBusy(true);
  deps.providerInstancesChanging.add(instanceId);
  try {
    await options.beforeRemove?.();
    delete instances[instanceId];
    // #4426: a built-in engine (the ChatGPT plan) is added back to a fleet
    // on every load; one the person removed stays removed.
    if (!separateAccountInstance(instanceId) && !deps.cfg.removedInstances?.includes(instanceId)) {
      const removedInstances = [...(deps.cfg.removedInstances ?? []), instanceId];
      deps.saveConfig({ removedInstances });
      deps.cfg.removedInstances = removedInstances;
    }
    await deps.persistProviderInstance(instanceId, instances);
    return { ok: true };
  } finally {
    deps.providerInstancesChanging.delete(instanceId);
    deps.setProviderConfigBusy(false);
  }
}

/** Removes an account as DELETE /api/instances/:id does, its bots moved
 * first as the confirmation showed (2026-11-18). Shared with the console's
 * POST engines/{id}/remove (server/org/org-admin-engines.ts, #5351). */
export async function removeAccountMovingBots(
  deps: AddedAccountRemovalDeps & Pick<InstancesRouteDeps, "accountMoves">,
  instanceId: string,
): Promise<{ removed: AddedAccountRemoval; plan: Awaited<ReturnType<AccountMovesHost["plan"]>> | null }> {
  const plan = deps.accountMoves && Object.hasOwn(persistableInstanceConfigs(deps.cfg), instanceId)
    ? await deps.accountMoves.plan({ person: null, leaving: [instanceId], sameProvider: sameProviderAccounts(deps.cfg, instanceId), moveDefault: true })
    : null;
  const removed = await removeAddedAccount(deps, instanceId, {
    beforeRemove: async () => { if (plan) deps.accountMoves!.apply(plan, [instanceId], { forget: true, moveDefault: true }); },
  });
  return { removed, plan };
}

export type ConfigEngineKeyDeps = Pick<InstancesRouteDeps,
  "cfg" | "saveConfig" | "loadConfig" | "broadcast" | "configStatus" | "providerConfigs" | "reloadProviders" | "getProviderConfigBusy" | "setProviderConfigBusy">;

/** Writes a key engine's key in the server's configuration, as the provider
 * card does. Empty clears it. */
function applyConfigEngineKey(deps: Pick<ConfigEngineKeyDeps, "cfg" | "saveConfig" | "loadConfig" | "broadcast" | "configStatus">, target: Extract<NonNullable<ReturnType<typeof engineKeyTarget>>, { kind: "config" }>, key: string): void {
  deps.saveConfig(configKeyPatch(target, key));
  Object.assign(deps.cfg, deps.loadConfig());
  deps.broadcast({ kind: "config", ...deps.configStatus() });
}

/** The organization's key of a key engine, set from the console (POST
 * engines/{id}/key, #5351): the same checks, the same store and the same
 * reload as a key pasted on the provider card. Never answers the key. */
export async function saveOrgEngineKey(deps: ConfigEngineKeyDeps, instanceId: string, driver: string, raw: string): Promise<{ ok: true; configured: boolean } | { ok: false; status: number; error: string; code?: string }> {
  const target = engineKeyTarget(instanceId, driver);
  if (!target || target.kind !== "config") return { ok: false, status: 400, error: "This engine takes no organization key.", code: "engine_takes_no_key" };
  let key: string;
  try {
    key = normalizeEngineKey(raw);
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof EngineKeyError ? error.message : "Enter the access key as a single line, between 8 and 400 characters.", code: "bad_request" };
  }
  if (deps.getProviderConfigBusy()) return { ok: false, status: 409, error: "provider settings are already being updated" };
  deps.setProviderConfigBusy(true);
  const enginesBefore = engineLaunches(deps.providerConfigs());
  try {
    applyConfigEngineKey(deps, target, key);
    await deps.reloadProviders(enginesBefore);
    return { ok: true, configured: key.length > 0 };
  } catch {
    return { ok: false, status: 500, error: "The access key could not be saved. Try again." };
  } finally {
    deps.setProviderConfigBusy(false);
  }
}

function viewerOf(auth: RequestAuth): string | null {
  return auth.kind === "session" ? auth.session.principalId?.trim().toLowerCase() || null : null;
}

/** #4435: on an organization server, an account a person adds is theirs
 * (the person signed in, never the server's loopback operator). */
function addedBy(deps: Pick<InstancesRouteDeps, "identityKind">, auth: RequestAuth): { ownerPrincipalId: string } | Record<string, never> {
  const viewer = deps.identityKind() === "perspicax" ? viewerOf(auth) : null;
  return viewer ? { ownerPrincipalId: viewer } : {};
}

/** #4435: a member adding an account picks no folder of the server's own:
 * that stays host.shell, as on PATCH /api/instances/:id. */
function hostFolderRefused(deps: Pick<InstancesRouteDeps, "adminOrDelegate">, auth: RequestAuth): boolean {
  return !auth.scopes.includes("admin") && !deps.adminOrDelegate(auth, "host.shell");
}

function sessionOwner(auth: RequestAuth): string {
  return auth.kind === "session" ? auth.session.id : "loopback";
}

function isJsonContentType(req: IncomingMessage): boolean {
  return String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
}

/** The engines this caller sees, as GET /api/instances lists them (also
 * read by GET /api/me/providers/catalog, so both say the same). */
export async function instancesInView(
  deps: Pick<InstancesRouteDeps, "resetPathCache" | "instancesForViewer" | "identityKind" | "callerCan" | "memberInstanceView" | "clientInstanceView">,
  auth: RequestAuth,
): Promise<unknown[]> {
  deps.resetPathCache();
  const viewer = viewerOf(auth);
  const instances = await deps.instancesForViewer(viewer);
  if (auth.scopes.includes("admin")) return instances;
  // 2026-10-09: a person whose profile manages the engines reads them
  // as an admin does (they install, sign in and update them).
  if (deps.identityKind() === "perspicax" && deps.callerCan(auth, "engines.manage")) return instances;
  // An organization member's copy (memberInstanceView); elsewhere a client
  // session (a paired phone or tablet) reads the catalogue its model
  // picker needs, not how the host is set up (clientInstanceView).
  const organization = deps.identityKind() === "perspicax";
  return instances.map((instance) =>
    organization ? deps.memberInstanceView(instance, viewer) : deps.clientInstanceView(instance));
}

export function createInstancesRoutes(deps: InstancesRouteDeps): RouteHandler {
  const proxied = deps.isProxied ?? isProxied;
  const loopbackHost = deps.isLoopbackHost ?? isLoopbackHost;
  const runClaudeUpdate = deps.updateClaudeCli ?? updateClaudeCli;

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== "/api/instances" && !path.startsWith("/api/instances/")) return PASS;

    // ── provider instances (model picker) ──
    if (method === "GET" && path === "/api/instances") {
      // Rescan PATH first: this endpoint is how the app answers "what can I
      // run?", and the interesting case is a CLI installed since launch.
      // Windows never pushes PATH changes into a live process, so without
      // this the answer is frozen at boot and "check again" is a no-op.
      return json(res, 200, { instances: await instancesInView(deps, auth) });
    }

    const companyMutation = /^\/api\/instances\/(company\.[\w.-]+)(?:\/|$)/.exec(path);
    if (deps.hostedModels && path.startsWith("/api/instances/") && method !== "GET") {
      return json(res, 403, { error: HOSTED_PROVIDER_SETTINGS_ERROR });
    }
    if (companyMutation && method !== "GET") {
      return json(res, 403, { error: "Company accounts are read-only here. Manage this connection in desktop Settings." });
    }

    // #4435: another person's account is not there for this caller: nobody
    // else reads, signs in to, renames, updates or removes it.
    const scoped = /^\/api\/instances\/([\w.-]+)(?:\/|$)/.exec(path)?.[1];
    if (scoped && deps.identityKind() === "perspicax") {
      const owner = deps.accountOwner?.(scoped);
      if (owner !== undefined && owner !== viewerOf(auth)) return json(res, 404, { error: "unknown instance" });
    }

    // A masked access key pasted on a provider card. The answer is only
    // whether one is saved. The value is never logged and never returned.
    const engineKey = /^\/api\/instances\/([\w.-]+)\/api-key$/.exec(path);
    if (engineKey && (method === "GET" || method === "POST")) {
      res.setHeader("cache-control", "no-store");
      const instanceId = engineKey[1]!;
      const driver = deps.registry.get(instanceId)?.driverKind ?? deps.cfg.instances?.[instanceId]?.driver;
      if (!driver) return json(res, 404, { error: "unknown instance" });
      const target = engineKeyTarget(instanceId, driver);
      if (!target) return json(res, 404, { error: "This provider does not take an access key here." });
      const organization = deps.identityKind() === "perspicax";
      const principalId = viewerOf(auth);
      if (organization) {
        const owner = deps.providerAccountOwner(principalId);
        if (!owner) return json(res, 403, { error: "Sign in to manage your provider accounts." });
        try {
          const providers = providersOfInstance(instanceId, driver);
          if (!providers.length) return json(res, 404, { error: "This provider does not take an access key here." });
          if (method === "GET") {
            const view = await deps.providerAccounts.list(owner);
            return json(res, 200, { configured: view.keys.some((key) => providers.includes(key.provider as typeof providers[number])) });
          }
          const body = await readBody(req, 8192);
          if (!body || typeof body !== "object" || typeof (body as { key?: unknown }).key !== "string") return json(res, 400, { error: "Send { key }." });
          const picked = typeof (body as { provider?: unknown }).provider === "string" ? (body as { provider: string }).provider : providers[0]!;
          if (!providers.includes(picked as typeof providers[number])) return json(res, 400, { error: "Unknown provider." });
          const key = normalizeEngineKey((body as { key: string }).key);
          await deps.providerAccounts.setKey(owner, picked, key || null);
          return json(res, 200, { configured: Boolean(key) });
        } catch (error) {
          if (error instanceof EngineKeyError) return json(res, error.status, { error: error.message });
          return json(res, 503, { error: "Your provider accounts are unavailable. Try again." });
        }
      }
      let scope: ReturnType<typeof engineKeyScope>;
      try {
        scope = engineKeyScope(organization, principalId, target);
      } catch (error) {
        if (error instanceof EngineKeyError) return json(res, error.status, { error: error.message, code: error.code });
        return json(res, 500, { error: "The access key could not be saved. Try again." });
      }
      const configuredNow = (): boolean => {
        if (target.kind === "file") return fileKeyConfigured(deps.dataDir, scope, driver);
        const section = deps.cfg[target.section] as { key?: string; apiKey?: string } | undefined;
        return Boolean(section?.[target.field]);
      };
      if (method === "GET") return json(res, 200, { configured: configuredNow() });
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req, 8192);
      if (!body || typeof body !== "object" || typeof (body as { key?: unknown }).key !== "string") {
        return json(res, 400, { error: "Send the access key as { key }." });
      }
      let key: string;
      try {
        key = normalizeEngineKey((body as { key: string }).key);
      } catch (error) {
        const message = error instanceof EngineKeyError ? error.message : "Enter the access key as a single line, between 8 and 400 characters.";
        return json(res, 400, { error: message, code: "engine_key_shape" });
      }
      const provider = typeof (body as { provider?: unknown }).provider === "string" ? (body as { provider: string }).provider : undefined;
      if (deps.getProviderConfigBusy()) return json(res, 409, { error: "provider settings are already being updated" });
      deps.setProviderConfigBusy(true);
      const enginesBefore = engineLaunches(deps.providerConfigs());
      try {
        if (target.kind === "config") {
          applyConfigEngineKey(deps, target, key);
        } else if ("hermes" in target) {
          const envName = hermesProviderEnv(provider);
          if (!envName) return json(res, 400, { error: "Unknown provider.", code: "engine_key_provider" });
          writeFileEngineKey(deps.dataDir, scope, driver, envName, key);
        } else {
          writeFileEngineKey(deps.dataDir, scope, driver, target.env, key);
        }
        await deps.reloadProviders(enginesBefore);
        return json(res, 200, { configured: key.length > 0 });
      } catch (error) {
        if (error instanceof EngineKeyError) return json(res, error.status, { error: error.message, code: error.code });
        return json(res, 500, { error: "The access key could not be saved. Try again." });
      } finally {
        deps.setProviderConfigBusy(false);
      }
    }

    const instanceIconPatch = /^\/api\/instances\/([\w.-]+)\/icon$/.exec(path);
    if (method === "PATCH" && instanceIconPatch) {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const parsed = providerIconPatchSchema.safeParse(await readBody(req, 192 * 1024));
      if (!parsed.success) {
        const detail = parsed.error.issues[0]?.message;
        return json(res, 400, { error: detail && detail !== "Invalid input" ? detail : "Choose a built-in icon or upload a PNG, JPEG, or WebP image up to 128 KB." });
      }
      if (parsed.data.icon) {
        const invalid = providerIconError(parsed.data.icon);
        if (invalid) return json(res, 400, { error: invalid });
      }
      if (deps.getProviderConfigBusy()) return json(res, 409, { error: "provider settings are already being updated" });
      deps.setProviderConfigBusy(true);
      try {
        const changed = withInstanceIcon(deps.cfg, instanceIconPatch[1], parsed.data.icon);
        if (!changed.ok) return json(res, 404, { error: `unknown instance "${instanceIconPatch[1]}"` });
        deps.saveConfig({ instances: changed.instances }, { replaceInstances: true });
        deps.cfg.instances = changed.instances;
        deps.broadcast({ kind: "config", ...deps.configStatus() });
        return json(res, 200, { instances: await deps.instancesForViewer(viewerOf(auth)) });
      } finally { deps.setProviderConfigBusy(false); }
    }

    if (method === "POST" && path === "/api/instances/chatgpt-accounts") {
      if (!isJsonContentType(req)) return json(res, 415, { error: "content-type must be application/json" });
      const parsed = createClaudeAccountSchema.pick({ displayName: true }).safeParse(await readBody(req, 8192));
      if (!parsed.success) return json(res, 400, { error: "Enter an account name (up to 80 characters)." });
      if (deps.getProviderConfigBusy()) return json(res, 409, { error: "provider settings are already being updated" });
      deps.setProviderConfigBusy(true);
      try {
        const instances = persistableInstanceConfigs(deps.cfg);
        const instanceId = `chatgpt-${randomUUID()}`;
        // Reuse the selected executable, never another account's environment.
        const cli = (instances.chatgpt?.config as { cli?: unknown } | undefined)?.cli
          ?? (instances.codex?.config as { cli?: unknown } | undefined)?.cli;
        instances[instanceId] = { driver: "codex", displayName: parsed.data.displayName, ...addedBy(deps, auth),
          config: { authMode: "chatgpt-plan", ...(typeof cli === "string" && cli ? { cli } : {}) } };
        await deps.persistProviderInstance(instanceId, instances);
        return json(res, 201, { instanceId, instances: await deps.instancesForViewer(viewerOf(auth)) });
      } finally { deps.setProviderConfigBusy(false); }
    }

    if (method === "POST" && path === "/api/instances/claude-accounts") {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const parsed = createClaudeAccountSchema.safeParse(await readBody(req, 8192));
      if (!parsed.success) return json(res, 400, { error: "Enter an account name (up to 80 characters) and an optional configuration directory." });
      if (parsed.data.configDir?.trim() && hostFolderRefused(deps, auth)) return json(res, 403, { ...permissionRefusal("host.shell"), field: "configDir" });
      if (deps.getProviderConfigBusy()) return json(res, 409, { error: "provider settings are already being updated" });
      deps.setProviderConfigBusy(true);
      try {
        const { instanceId, instances } = newClaudeAccount(deps.cfg, parsed.data);
        Object.assign(instances[instanceId]!, addedBy(deps, auth));
        await deps.persistProviderInstance(instanceId, instances);
        return json(res, 201, { instanceId, instances: await deps.instancesForViewer(viewerOf(auth)) });
      } finally { deps.setProviderConfigBusy(false); }
    }

    const authStatus = /^\/api\/instances\/([\w.-]+)\/auth\/status$/.exec(path);
    if (method === "GET" && authStatus) {
      res.setHeader("cache-control", "no-store");
      const state = await deps.providerAuthSessions.status(authStatus[1], sessionOwner(auth), url.searchParams.get("flowId") ?? "");
      // A finished device sign-in changed what the engine reports; the page reads the engines next.
      if (state.phase !== "waiting") deps.registry.forgetSnapshots();
      return json(res, 200, { auth: state });
    }

    const instanceAction = /^\/api\/instances\/([\w.-]+)\/(refresh-models|install|auth\/start|auth\/complete|auth\/cancel|auth\/sign-out)$/.exec(path);
    if (method === "POST" && instanceAction) {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const instanceId = instanceAction[1];
      const action = instanceAction[2];
      const owner = sessionOwner(auth);
      if (action.startsWith("auth/")) res.setHeader("cache-control", "no-store");
      try {
        if (action === "refresh-models") {
          if (!(await deps.registry.refreshModels(instanceId))) return json(res, 404, { error: "unknown instance" });
          return json(res, 200, { instances: await deps.instancesForViewer(viewerOf(auth)) });
        }
        if (action === "install") {
          if (!(await deps.registry.installRuntime(instanceId))) return json(res, 404, { error: "Installing this engine from Settings is not available on this server. Use the install command on the machine running Sagax." });
          return json(res, 200, { instances: await deps.instancesForViewer(viewerOf(auth)) });
        }
        if (action === "auth/start") {
          const instance = deps.registry.get(instanceId);
          if (!instance) return json(res, 404, { error: "unknown instance" });
          // The official local OAuth callback terminates on this machine,
          // not a phone or the browser visiting a remotely hosted workspace.
          if (instance.authenticationMethod === "browser-pkce" && (proxied(req) || !loopbackHost(req.socket.remoteAddress))) {
            return json(res, 403, { error: "Continue with ChatGPT on the computer running Sagax. Hosted Pro sign-in requires OpenAI's hosted-app approval." });
          }
          const started = await deps.providerAuthSessions.start(instance, owner);
          if (started.phase === "succeeded") deps.registry.forgetSnapshots();
          // Revocation can arrive while the CLI is obtaining a device code.
          if (auth.kind === "session" && !deps.sessionsIsLive(auth.session.id)) {
            deps.providerAuthSessions.revokeOwner(owner);
            return json(res, 401, { error: "Your session ended. Start a new sign-in." });
          }
          return json(res, 200, { auth: started });
        }
        if (action === "auth/sign-out") {
          const instance = deps.registry.get(instanceId);
          if (!instance) return json(res, 404, { error: "unknown instance" });
          // 2026-11-18, 2026-11-19: a sign-out always moves the bots on the
          // account first, from every app (no flag); GET .../moves shows the
          // same plan beforehand and the answer says what moved
          await readBody(req, 4096).catch(() => null);
          const viewer = viewerOf(auth);
          const plan = deps.accountMoves
            ? await deps.accountMoves.plan({ person: null, leaving: [instanceId], sameProvider: sameProviderAccounts(deps.cfg, instanceId), moveDefault: true })
            : null;
          if (plan) deps.accountMoves!.apply(plan, [instanceId], { forget: false, moveDefault: true });
          await deps.providerAuthSessions.signOut(instance, owner);
          deps.registry.forgetSnapshots();
          return json(res, 200, { instances: await deps.instancesForViewer(viewer), ...(plan ? { moved: plan.moves, noEngine: plan.noEngine } : {}) });
        }
        if (action === "auth/complete") {
          const body = await readBody(req);
          const flowId = typeof body?.flowId === "string" ? body.flowId : "";
          // `code` for a pasted sign-in code (Claude), `callbackUrl` for a browser callback
          const callbackUrl = typeof body?.callbackUrl === "string" ? body.callbackUrl : typeof body?.code === "string" ? body.code : "";
          if (!flowId || !callbackUrl) return json(res, 400, { error: "flowId and a code or callbackUrl are required" });
          await deps.providerAuthSessions.complete(instanceId, owner, flowId, callbackUrl);
          deps.registry.forgetSnapshots();
          return json(res, 200, { ok: true });
        }
        const body = await readBody(req, 4096);
        await deps.providerAuthSessions.cancel(instanceId, owner, typeof body?.flowId === "string" ? body.flowId : "");
        return json(res, 200, { ok: true });
      } catch (error) {
        const requestedStatus = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
        const status = typeof requestedStatus === "number" && [400, 401, 404, 409, 413, 415].includes(requestedStatus) ? requestedStatus : 500;
        return json(res, status, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    // ── instance-scoped Claude Code update ──
    // No command or path comes from the request: the registry supplies the
    // executable already configured for this Claude instance. The JSON gate
    // keeps a hostile page from triggering a local process with a simple
    // cross-origin form request.
    const claudeUpdate = /^\/api\/instances\/([\w.-]+)\/claude-update$/.exec(path);
    if (method === "POST" && claudeUpdate) {
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      await readBody(req);
      const target = deps.registry.cliTarget(claudeUpdate[1]);
      if (!target) return json(res, 404, { error: "no such provider instance" });
      if (target.driverKind !== "claudeAgent") {
        return json(res, 400, { error: "only Claude Code instances can be updated here" });
      }
      // Image pin (engines.lock.json): an in-place update would drift until redeploy.
      const pinnedRefusal = pinnedClaudeUpdateRefusal(deps.selfCheckedEngine(claudeUpdate[1]) !== null);
      if (pinnedRefusal) return json(res, pinnedRefusal.status, { error: pinnedRefusal.error, code: pinnedRefusal.code });
      if (!target.cli) return json(res, 409, { error: "this Claude instance has no configured executable" });
      if (deps.claudeUpdatesInFlight.has(target.cli)) {
        return json(res, 409, { error: "this Claude installation is already updating" });
      }
      const active = busyProviderSelections(deps).some((selection) => deps.registry.cliTarget(selection.instanceId)?.cli === target.cli);
      if (active) {
        return json(res, 409, { error: "wait for running Claude tasks to finish before updating" });
      }

      deps.claudeUpdatesInFlight.add(target.cli);
      try {
        const result = await runClaudeUpdate(target.cli, deps.cliProbeEnvironment());
        deps.resetPathCache();
        return json(res, 200, { ok: true, version: result.version });
      } catch (error) {
        return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      } finally {
        deps.claudeUpdatesInFlight.delete(target.cli);
        // Even a failed update may have replaced the executable.
        deps.registry.forgetSnapshots();
      }
    }

    // ── per-instance settings (CLI/account or API tool support) ──
    // PATCH /api/instances/:id {cli: "/path/to/cli" | ""} — "" reverts to the
    // driver default. Only this idle instance is replaced; siblings keep running.
    const instancePatch = /^\/api\/instances\/([\w.-]+)$/.exec(path);
    if (method === "PATCH" && instancePatch) {
      // same non-simple-request gate as the local-VM lifecycle routes
      if (!isJsonContentType(req)) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const parsed = instanceSettingsSchema.safeParse(await readBody(req, 16384));
      if (!parsed.success) return json(res, 400, { error: "Supply a valid CLI path, account name, configuration directory or boolean tools setting." });
      const body = parsed.data;
      // 2026-10-09: engines.manage opens this route to a person; an
      // engine's program and its configuration folder stay host.shell.
      if (!auth.scopes.includes("admin") && !deps.adminOrDelegate(auth, "host.shell") && (body.cli !== undefined || body.configDir !== undefined)) {
        return json(res, 403, { ...permissionRefusal("host.shell"), field: body.cli !== undefined ? "cli" : "configDir" });
      }
      const cliRefusal = body.cli?.trim() ? cliCommandRefusal(body.cli) : null;
      if (cliRefusal) return json(res, 400, { error: cliRefusal });
      const instanceId = instancePatch[1];
      if (deps.getProviderConfigBusy()) return json(res, 409, { error: "provider settings are already being updated" });
      if (busyProviderSelections(deps).some((selection) => selection.instanceId === instanceId)) {
        return json(res, 409, { error: "Wait for bots using this account to finish before changing its settings." });
      }
      deps.setProviderConfigBusy(true);
      deps.providerInstancesChanging.add(instanceId);
      try {
        const result = body.cli === undefined ? { ok: true as const, config: deps.cfg } : withInstanceCli(deps.cfg, instanceId, body.cli);
        const instances = persistableInstanceConfigs(result.config);
        if (!result.ok || !Object.hasOwn(instances, instanceId)) return json(res, 404, { error: `unknown instance "${instanceId}"` });
        const entry = instances[instanceId];
        // #4391: an entry whose driver this server does not have is not an
        // account a person sees; it is kept as configured, never renamed.
        if (body.displayName !== undefined && !deps.registry.knowsDriver(entry.driver)) {
          return json(res, 400, { error: `This server has no "${entry.driver}" provider; the entry is kept as configured.` });
        }
        // #4376: every account can be renamed (Providers > a provider >
        // Accounts); its configuration folder stays a Claude setting.
        if (body.configDir !== undefined && entry.driver !== "claudeAgent") {
          return json(res, 400, { error: "The configuration folder is a setting of Claude accounts only." });
        }
        if (body.tools !== undefined) {
          if (!["openai-compat", "grok", "minimax", "mistral", "cerebras", "groq", "meta"].includes(entry.driver)) {
            return json(res, 400, { error: "The tools setting is available for OpenAI-compatible, Grok API, MiniMax API, Mistral API, Cerebras API, Groq API and Meta API instances only." });
          }
          entry.config = { ...entry.config as Record<string, unknown>, tools: body.tools };
        }
        if (body.displayName !== undefined) entry.displayName = body.displayName;
        if (body.configDir !== undefined) {
          let previousDir: string | undefined;
          try { previousDir = configuredAccountDirectory(entry); } catch { /* Allow repairing an unused malformed account. */ }
          entry.config = { ...entry.config as Record<string, unknown>, configDir: body.configDir };
          if (previousDir !== configuredAccountDirectory(entry)) {
            const used = deps.bots().some((bot) => bot.modelSelection.instanceId === instanceId || bot.fallback?.some((candidate) => candidate.instanceId === instanceId) || deps.tasks(bot.id).some((task) =>
              task.modelSelection?.instanceId === instanceId || task.resumeCursors[instanceId] || task.lastInstanceId === instanceId));
            if (used) return json(res, 409, { error: "This account is used by bots or conversation history. Add another account and select it for the bot instead." });
            assertSeparateClaudeAccount(instances, instanceId, entry);
          }
        }
        await deps.persistProviderInstance(instanceId, instances);
        return json(res, 200, { instances: await deps.instancesForViewer(viewerOf(auth)) });
      } finally {
        deps.providerInstancesChanging.delete(instanceId);
        deps.setProviderConfigBusy(false);
      }
    }

    // 2026-11-18: GET /api/instances/:id/moves, where each bot on the
    // account goes if it is removed or signed out of (the one confirmation)
    const movesOf = method === "GET" ? /^\/api\/instances\/([\w.-]+)\/moves$/.exec(path) : null;
    if (movesOf) {
      const instanceId = movesOf[1];
      if (!Object.hasOwn(persistableInstanceConfigs(deps.cfg), instanceId)) return json(res, 404, { error: "unknown instance" });
      const plan = deps.accountMoves
        ? await deps.accountMoves.plan({ person: null, leaving: [instanceId], sameProvider: sameProviderAccounts(deps.cfg, instanceId), moveDefault: true })
        : { moves: [], noEngine: false };
      return json(res, 200, plan);
    }

    if (method === "DELETE" && instancePatch) {
      const instanceId = instancePatch[1];
      // #4415 refused while a bot used it; 2026-11-18 (owner rule): its bots
      // move as the confirmation showed, then it goes, in one gesture
      const viewer = viewerOf(auth);
      const { removed, plan } = await removeAccountMovingBots(deps, instanceId);
      if (!removed.ok) return json(res, removed.status, removed.body);
      return json(res, 200, { instances: await deps.instancesForViewer(viewer), ...(plan ? { moved: plan.moves, noEngine: plan.noEngine } : {}) });
    }

    return PASS;
  };
}
