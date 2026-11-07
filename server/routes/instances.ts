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
}

/** Selections of engines that currently have a turn in flight. */
function busyProviderSelections(deps: InstancesRouteDeps): ModelSelection[] {
  return deps.bots().flatMap((bot) => {
    const busyTasks = deps.tasks(bot.id).filter((task) => deps.threadBusy(bot.id, task.threadId));
    const selections = busyTasks.map((task) => deps.botForThread(bot.id, task.threadId)!.modelSelection);
    // Rooms still run from the profile default; a direct thread does not.
    if (deps.activeGroupTurnForBot(bot.id) || (bot.busy && busyTasks.length === 0)) selections.push(bot.modelSelection);
    return selections;
  });
}

function viewerOf(auth: RequestAuth): string | null {
  return auth.kind === "session" ? auth.session.principalId?.trim().toLowerCase() || null : null;
}

function sessionOwner(auth: RequestAuth): string {
  return auth.kind === "session" ? auth.session.id : "loopback";
}

function isJsonContentType(req: IncomingMessage): boolean {
  return String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
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
      deps.resetPathCache();
      const viewer = viewerOf(auth);
      const instances = await deps.instancesForViewer(viewer);
      if (auth.scopes.includes("admin")) return json(res, 200, { instances });
      // 2026-10-09: a person whose profile manages the engines reads them
      // as an admin does (they install, sign in and update them).
      if (deps.identityKind() === "perspicax" && deps.callerCan(auth, "engines.manage")) return json(res, 200, { instances });
      // An organization member's copy (memberInstanceView); elsewhere a client
      // session (a paired phone or tablet) reads the catalogue its model
      // picker needs, not how the host is set up (clientInstanceView).
      const organization = deps.identityKind() === "perspicax";
      return json(res, 200, {
        instances: instances.map((instance) =>
          organization ? deps.memberInstanceView(instance, viewer) : deps.clientInstanceView(instance)),
      });
    }

    const companyMutation = /^\/api\/instances\/(company\.[\w.-]+)(?:\/|$)/.exec(path);
    if (deps.hostedModels && path.startsWith("/api/instances/") && method !== "GET") {
      return json(res, 403, { error: HOSTED_PROVIDER_SETTINGS_ERROR });
    }
    if (companyMutation && method !== "GET") {
      return json(res, 403, { error: "Company accounts are read-only here. Manage this connection in desktop Settings." });
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
          deps.saveConfig(configKeyPatch(target, key));
          Object.assign(deps.cfg, deps.loadConfig());
          deps.broadcast({ kind: "config", ...deps.configStatus() });
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
        instances[instanceId] = { driver: "codex", displayName: parsed.data.displayName,
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
      if (deps.getProviderConfigBusy()) return json(res, 409, { error: "provider settings are already being updated" });
      deps.setProviderConfigBusy(true);
      try {
        const { instanceId, instances } = newClaudeAccount(deps.cfg, parsed.data);
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
          await deps.providerAuthSessions.signOut(instance, owner);
          deps.registry.forgetSnapshots();
          return json(res, 200, { instances: await deps.instancesForViewer(viewerOf(auth)) });
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
        if ((body.displayName !== undefined || body.configDir !== undefined) && entry.driver !== "claudeAgent") {
          return json(res, 400, { error: "Account settings are currently available for Claude only." });
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

    if (method === "DELETE" && instancePatch) {
      const instanceId = instancePatch[1];
      if (deps.getProviderConfigBusy()) return json(res, 409, { error: "provider settings are already being updated" });
      const instances = persistableInstanceConfigs(deps.cfg);
      if (!Object.hasOwn(instances, instanceId)) return json(res, 404, { error: "unknown instance" });
      if (instances[instanceId].driver !== "claudeAgent" || instanceId === "claude") {
        return json(res, 400, { error: "Only added Claude accounts can be removed here." });
      }
      if (deps.cfg.defaultModelSelection?.instanceId === instanceId || deps.bots().some((bot) =>
        bot.modelSelection.instanceId === instanceId || bot.fallback?.some((candidate) => candidate.instanceId === instanceId) || deps.tasks(bot.id).some((task) => task.modelSelection?.instanceId === instanceId)) ||
        busyProviderSelections(deps).some((selection) => selection.instanceId === instanceId)) {
        return json(res, 409, { error: "Choose another account for the bots and default model using this account before removing it." });
      }
      deps.setProviderConfigBusy(true);
      deps.providerInstancesChanging.add(instanceId);
      try {
        delete instances[instanceId];
        await deps.persistProviderInstance(instanceId, instances);
        return json(res, 200, { instances: await deps.instancesForViewer(viewerOf(auth)) });
      } finally {
        deps.providerInstancesChanging.delete(instanceId);
        deps.setProviderConfigBusy(false);
      }
    }

    return PASS;
  };
}
