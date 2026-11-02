// Codex driver — upstream CodexDriver skeleton over agentcal's
// drivers/codex.js runtime: the official `codex` CLI headless over its
// app-server JSON-RPC protocol (newline-delimited JSON on stdio).
// Completion is a real `turn/completed` notification; approval requests
// arrive as in-process server→client JSON-RPC requests and surface as
// canonical request.opened events (answered via respondToRequest — no MCP
// proxy or unix socket needed, unlike claude). Verified against
// codex-cli 0.144.4 by agentcal.
//
// resumeCursor is the codex thread id; a later turn tries thread/resume
// and preserves that history or reports a failed resume.
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { DATA_DIR, stripWorkspaceCredentialEnv } from "../config.ts";
import { laterStartup, openStartupModelCatalog, writeStartupModelCache } from "../startup-model-catalog.ts";
import { hostedWorkspaceConfigured } from "../enterprise.ts";
import { ChatGptPlanAuthController } from "./chatgpt-plan-auth.ts";
import { codexLaunchesStarting, codexLaunchSlot } from "./codex-process.ts";
import { isReservedMcpEnvEntry } from "../mcp-registry.ts";

import type {
  DriverCreateInput,
  ProviderDriver,
  ProviderInstance,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
  SteerOutcome,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { decodeCodexSelection, OFFICIAL_CODEX_PROVIDER, readCodexModelCatalog, STATIC_CODEX_MODELS } from "./codex-catalog.ts";
import { augmentedPath } from "../env-path.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { CodexDeviceAuthController } from "./codex-device-auth.ts";
import { codexHome } from "./codex-identity.ts";
import { codexNotSignedIn, type CodexRoute } from "./codex-errors.ts";
import { codexLoginCheck, storedCodexLogin } from "./codex-login.ts";
import { keyRejected, noteKeyAccepted, noteKeyRejected } from "../key-rejections.ts";
import { type RenewalStep } from "../context-renewal.ts";
import { assertToolScopeSupported } from "../../shared/tool-scope-support.ts";

import { isSagaxPerspicaxBridge, isSagaxWorkplaceProxy } from "./codex/mcp-mount.ts";
import { codexNativeIncomingLogMessage } from "./codex/native-log.ts";
export { codexNativeIncomingLogMessage };
import { runLaunchAttempt as runCodexLaunchAttempt } from "./codex/launch-attempt.ts";
import { buildCodexInstanceApi } from "./codex/instance-api.ts";

export { codexNamedApprovalParams } from "./codex/approvals.ts";

import { DRIVER_KIND, decodeConfig, type CodexConfig } from "./codex/config.ts";
import { codexAccessLaunch } from "./codex/launch-args.ts";

export type { CodexConfig } from "./codex/config.ts";
export {
  GUEST_CONFINED_CODEX_ARGS,
  chatgptPlanCodexArgs,
  codexAccessLaunch,
  codexShellDisabled,
  codexUpdateCommand,
  managedCodexArgs,
  ownerKeyCodexArgs,
} from "./codex/launch-args.ts";

export { decodeCodexSelection, readCodexModelCatalog, STATIC_CODEX_MODELS } from "./codex-catalog.ts";

export const CodexDriver: ProviderDriver<CodexConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Codex", supportsMultipleInstances: true },
  install: {
    command: {
      darwin: "npm install -g @openai/codex",
      linux: "npm install -g @openai/codex",
      win32: "npm install -g @openai/codex",
    },
    needsNode: true,
    docsUrl: "https://github.com/openai/codex",
    signInCommand: "codex login",
  },
  models: STATIC_CODEX_MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input: DriverCreateInput<CodexConfig>): Promise<ProviderInstance> {
    const { instanceId, config } = input;
    const plan = config.authMode === "chatgpt-plan";
    const planUnavailable = plan && hostedWorkspaceConfigured()
      ? "ChatGPT plan sign-in for hosted Pro requires OpenAI's hosted-app approval. Use a Company model or API key until that integration is approved; the local desktop flow cannot be used here."
      : undefined;
    // Provider homes are excluded from portable backups and Move to Cloud.
    const planDirectory = join(DATA_DIR, "providers", "chatgpt-plan", createHash("sha256").update(instanceId).digest("hex"));
    const childEnv = (): Record<string, string | undefined> => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        ...input.environment,
        PATH: augmentedPath(),
        NPM_CONFIG_LOGLEVEL: "error",
      };
      // The CLI owns its own ChatGPT login; a leaked API key silently flips
      // billing to pay-as-you-go (agentcal).
      delete env.OPENAI_API_KEY;
      // The harness process may hold workspace credentials (xai/box/voice
      // keys, env-injected at boot); none of them are this CLI's to see.
      stripWorkspaceCredentialEnv(env);
      delete env.SAGAX_CHATGPT_TOKEN;
      if (plan) env.CODEX_HOME = join(planDirectory, "codex");
      return env;
    };
    const catalogEnv = childEnv();
    const planAuth = plan ? new ChatGptPlanAuthController({ directory: planDirectory }) : null;
    let planGeneration = 0;
    let planSigningOut = false;
    let disposed = false;
    let planWarning: string | undefined;
    let models = plan ? { default: "", options: [] } : config.managed ? { default: config.managed.models[0], options: config.managed.models.map(id => ({ id, label: id })) } : STATIC_CODEX_MODELS;
    const refreshModels = async (preserveExisting = false) => {
      if (config.managed) return;
      if (planAuth) {
        const generation = planGeneration;
        const kept = preserveExisting && models.options.length > 0 ? models : null;
        if (!kept) models = { default: "", options: [] };
        try {
          if (!planUnavailable && !planSigningOut && !disposed) {
            const catalog = await planAuth.models();
            if (generation === planGeneration && !planSigningOut && !disposed && (!kept || catalog.options.length)) models = catalog;
          }
        } catch (error) {
          // A deferred refresh keeps the list already being served. An
          // explicit refresh still clears first and reports the error.
          if (!kept) throw error;
        }
      } else {
        try {
          const resolved = await readCodexModelCatalog(catalogEnv, fetch, config.cli);
          if (resolved.options.length) models = resolved;
        } catch {
          // Keep the last usable catalog when a local provider is down.
        }
      }
      try { writeStartupModelCache(instanceId, models); } catch { /* derived cache */ }
    };
    // A revoked grant or a temporary catalog outage must leave the account
    // reachable in Settings for reconnect; it must not become a shadow.
    // A later start serves the saved list and refreshes behind listen.
    // Codex's model list ships with the CLI: updating it in place adds the models of the new release.
    let modelsCliVersion: string | null = null;
    let startupModelRefresh: Promise<void> | null = null;
    if (config.managed) {
      await refreshModels();
    } else {
      startupModelRefresh = (await openStartupModelCatalog({
        instanceId,
        use: (catalog) => { models = catalog; },
        current: () => models,
        refresh: async () => {
          if (planAuth) {
            try { await refreshModels(laterStartup()); } catch { /* Explicit refresh reports the error. */ }
          } else await refreshModels();
        },
      }))?.pending ?? null;
    }
    // Codex's own ChatGPT login (not ChatGPT plan, whose tokens Sagax
    // holds, nor Company routing) can be refused by OpenAI while `codex login
    // status` still reports it. A refusal marks it the way a rejected API key
    // is marked (key-rejections.ts): its credential home, plus the stored
    // auth file, so a sign-in made anywhere else starts over. A later turn
    // that succeeds, a new sign-in and sign-out clear it. Only a stored
    // ChatGPT login is marked: an API-key login (`codex login --with-api-key`)
    // cannot be fixed by the ChatGPT sign-in Settings offers.
    const ownLogin = !plan && !config.managed;
    const loginCheck = codexLoginCheck(config.cli);
    const loginMark = (): [string, string] | null => {
      const env = childEnv();
      const home = ownLogin ? codexHome(env) : null;
      const stored = home ? storedCodexLogin(env) : null;
      if (!home || stored === null) return null;
      try {
        const auth = JSON.parse(stored) as { auth_mode?: unknown; tokens?: unknown };
        const chatgpt = typeof auth.auth_mode === "string" ? /chatgpt/i.test(auth.auth_mode) : Boolean(auth.tokens);
        if (!chatgpt) return null;
      } catch { return null; }
      return [`codex-login:${home}`, stored];
    };
    const loginRefused = () => { const mark = loginMark(); if (mark) noteKeyRejected(...mark); };
    const loginAccepted = (mark = loginMark()) => { if (mark) noteKeyAccepted(...mark); };
    const loginRejected = () => { const mark = loginMark(); return mark !== null && keyRejected(...mark); };
    const authentication = new CodexDeviceAuthController({
      cli: config.cli,
      environment: childEnv,
      signInRejected: loginRejected,
      onAuthenticated: async () => { loginAccepted(); await refreshModels(); },
    });
    const listeners = new Set<RuntimeEventListener>();
    interface Turn {
      stop: () => Promise<boolean>;
      /** Fold new user input into the running native turn (turn/steer).
       * "refused" when this attempt has nothing steerable; the caller
       * queues. "indeterminate" when delivery happened but the answer did
       * not come back — the caller must not re-queue those words. */
      steer?: (text: string, steerId?: string) => Promise<SteerOutcome>;
      turnId: string;
      asks: Map<string, (behavior: "allow" | "deny" | "answer", message?: string, source?: "user" | "timeout" | "system") => void>;
    }
    const active = new Map<string, Turn>();
    /** #1373: who answers the running turn's escalations, by thread. Ask,
     * Edits and Auto launch the same sandbox and policy; only Approve for me
     * with Codex's own reviewer (auto_review) answers without Sagax. */
    const turnReviewers = new Map<string, { mode: ApprovalMode; sagaxAnswers: boolean }>();
    /** Threads whose Codex thread ran out of context room: the next turn
     * (Retry, or any new message) starts a new Codex thread from the chat's
     * rebuild instead of resuming the full one (server/context-renewal.ts). */
    const freshNextTurn = new Set<string>();
    /** Logical turns that already used their one in-turn context renewal. A
     * second overflow fails in plain words and marks freshNextTurn. */
    const renewedTurns = new Set<string>();

    const emit = (event: RuntimeEvent) => {
      for (const l of Array.from(listeners)) l(event);
    };
    const base = (threadId: string, turnId: string) => ({
      eventId: newEventId(),
      provider: DRIVER_KIND,
      threadId,
      turnId,
      createdAt: new Date().toISOString(),
    });

    const sendTurn = async (turn: SendTurnInput) => {
      if (startupModelRefresh) await startupModelRefresh;
      turn = { ...turn, toolScope: assertToolScopeSupported(DRIVER_KIND, turn.toolScope) };
      const generation = planGeneration;
      const assertPlanCurrent = () => {
        if (disposed) throw new Error("This provider was removed. Select a connected account and send again.");
        if (planAuth && (planSigningOut || generation !== planGeneration)) throw new Error("The ChatGPT account changed while this message was preparing. Select a connected account and send again.");
      };
      assertPlanCurrent();
      if (planUnavailable) throw new Error(planUnavailable);
      const planToken = planAuth ? await planAuth.accessToken() : undefined;
      assertPlanCurrent();
      if (planAuth) {
        if (!turn.model || !models.options.some(model => model.id === turn.model)) {
          await refreshModels();
          assertPlanCurrent();
          if (!turn.model || !models.options.some(model => model.id === turn.model)) throw new Error("This model is not available to the selected ChatGPT plan. Refresh models and choose a listed model; API billing will not be used.");
        }
        mkdirSync(join(planDirectory, "codex"), { recursive: true, mode: 0o700 });
      }
      if (config.managed) {
        // One blanket refusal hides which prerequisite broke; name it so the
        // person can fix the actual gap instead of reconnecting blind.
        if (!turn.model) {
          throw new Error("Company model access is unavailable: no model is selected. Reconnect your organization; personal billing will not be used.");
        }
        if (!config.managed.models.includes(turn.model)) {
          throw new Error("Company model access is unavailable: " + turn.model + " is not approved for your organization. Reconnect your organization; personal billing will not be used.");
        }
        if (!input.environment.SAGAX_COMPANY_API_KEY) {
          throw new Error("Company model access is unavailable: SAGAX_COMPANY_API_KEY is missing. Reconnect your organization; personal billing will not be used.");
        }
        if (!input.environment.CODEX_HOME) {
          throw new Error("Company model access is unavailable: CODEX_HOME is missing. Reconnect your organization; personal billing will not be used.");
        }
      }
      // One driver instance serves many threads. Interrupt state belongs to
      // this turn so activity elsewhere cannot cancel or revive its retry.
      let stopRequested = false;
      let promptSubmitted = false;
      let recoveredMissingSession = false;
      // Wakes a retry backoff the moment Stop arrives, so the turn settles
      // now rather than after the full wait.
      let loginRaceRetried = false;
      const stopSignal = new AbortController();
      const { threadId } = turn;
      // Direct adapter callers predating the per-bot selector retain the
      // instance's legacy fullAuto setting. Harness turns always send an
      // explicit mode, which takes precedence.
      const approvalMode: ApprovalMode = turn.approvalMode ?? (config.fullAuto ? "full" : "ask");
      for (const [name, server] of Object.entries(turn.integrations?.custom ?? {})) {
        if ("url" in server || isSagaxWorkplaceProxy(name, server) || isSagaxPerspicaxBridge(server)) continue;
        const reserved = Object.entries(server.env).find(([key, value]) => isReservedMcpEnvEntry(key, value))?.[0];
        if (reserved) {
          throw new Error(`Custom MCP server “${name}” cannot set reserved environment variable “${reserved}”`);
        }
      }
      const withholdHostTools = turn.withholdHostTools === true;
      let autoAcceptPermissions = approvalMode === "full" && !withholdHostTools;
      // Only a turn on the official provider says anything about Codex's
      // ChatGPT login: a custom provider's 401 is its own key's, and its
      // success proves nothing about ChatGPT. No model means the catalog's
      // default, which is provider-qualified when config.toml picks another.
      // An organization owner key runs on its own provider: no Codex sign-in is involved.
      const accessEnv = childEnv();
      const ownerKeyTurn = codexAccessLaunch(accessEnv, turn.access).ownerKey;
      const chatgptTurn = ownLogin && !ownerKeyTurn &&
        decodeCodexSelection(turn.model || models.default).modelProvider === OFFICIAL_CODEX_PROVIDER;
      const route: CodexRoute = plan ? "plan" : chatgptTurn ? "own" : "other";
      // Without a sign-in Codex runs a turn and fails only after a minute of reconnects. A per-turn
      // Codex home (a person's subscription) is checked where it lives.
      const signedOut = chatgptTurn && await loginCheck(accessEnv) === "missing";
      assertPlanCurrent();
      if (active.has(threadId)) throw new Error("a turn is already running on this thread");
      const turnId = newId();
      if (signedOut) {
        emit({ ...base(threadId, turnId), type: "turn.started" });
        emit({ ...base(threadId, turnId), type: "runtime.error", message: codexNotSignedIn(), setup: true });
        emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "auth_required", cost: null });
        return { turnId };
      }
      // a retry relaunches the whole app-server; the backoff is scaled down in
      // tests so a fake's transient failures don't stall real seconds
      const retryScale = Number(process.env.FAKE_CODEX_RETRY_SCALE ?? "1");
      let announced = false;
      // Steps and text kept across an in-turn context renewal (each launchAttempt
      // has its own process state; these outlive it for renewalPrompt).
      const renewalSteps: RenewalStep[] = [];
      let renewalLastText = "";
      /** Prompt for the fresh Codex thread when this turn renews mid-flight. */
      let inTurnRenewal: string | null = null;
      const waitForLaunchSlot = async (attempt: number) => {
        const waiting: Turn = { stop: async () => { stopRequested = true; stopSignal.abort(); return true; }, turnId, asks: new Map() };
        active.set(threadId, waiting);
        if (attempt === 0) emit({ ...base(threadId, turnId), type: "turn.started" });
        announced = true;
        emit({ ...base(threadId, turnId), type: "runtime.notice", message: `Waiting for a free Codex slot: ${codexLaunchesStarting()} Codex runs are starting on this computer. This one starts on its own.` });
        const slot = await codexLaunchSlot(stopSignal.signal);
        if (slot && !stopRequested) return slot;
        slot?.();
        if (active.get(threadId) === waiting) {
          active.delete(threadId);
          emit({ ...base(threadId, turnId), type: "turn.completed", ok: false, stopReason: "interrupted", cost: null });
        }
        return null;
      };
      const launchAttempt = async (attempt: number): Promise<void> => {
        await runCodexLaunchAttempt({
          childEnv,
          chatgptTurn,
          planToken,
          turn,
          plan,
          config,
          withholdHostTools,
          waitForLaunchSlot,
          input: turn,
          threadId,
          turnId,
          emit,
          base,
          stopSignal,
          active,
          approvalMode,
          route,
          retryScale,
          renewalSteps,
          freshNextTurn,
          renewedTurns,
          turnReviewers,
          loginMark,
          loginRefused,
          loginAccepted,
          ownLogin,
          get stopRequested() { return stopRequested; },
          set stopRequested(v: boolean) { stopRequested = v; },
          get promptSubmitted() { return promptSubmitted; },
          set promptSubmitted(v: boolean) { promptSubmitted = v; },
          get recoveredMissingSession() { return recoveredMissingSession; },
          set recoveredMissingSession(v: boolean) { recoveredMissingSession = v; },
          get loginRaceRetried() { return loginRaceRetried; },
          set loginRaceRetried(v: boolean) { loginRaceRetried = v; },
          get announced() { return announced; },
          set announced(v: boolean) { announced = v; },
          get autoAcceptPermissions() { return autoAcceptPermissions; },
          set autoAcceptPermissions(v: boolean) { autoAcceptPermissions = v; },
          get renewalLastText() { return renewalLastText; },
          set renewalLastText(v: string) { renewalLastText = v; },
          get inTurnRenewal() { return inTurnRenewal; },
          set inTurnRenewal(v: string | null) { inTurnRenewal = v; },
          runLaunchAttempt: (next: number) => launchAttempt(next),
        } as any, attempt);
      };

    void launchAttempt(0).catch(() => {});
    return { turnId };
  };

    return buildCodexInstanceApi({
      instanceId,
      input,
      config,
      plan,
      planUnavailable,
      planAuth,
      get planWarning() { return planWarning; },
      set planWarning(v) { planWarning = v; },
      planDirectory,
      childEnv,
      get models() { return models; },
      set models(v) { models = v; },
      refreshModels,
      get modelsCliVersion() { return modelsCliVersion; },
      set modelsCliVersion(v) { modelsCliVersion = v; },
      startupModelRefresh,
      authentication,
      loginMark,
      loginAccepted,
      loginRejected,
      get planSigningOut() { return planSigningOut; },
      set planSigningOut(v) { planSigningOut = v; },
      get disposed() { return disposed; },
      set disposed(v) { disposed = v; },
      get planGeneration() { return planGeneration; },
      set planGeneration(v) { planGeneration = v; },
      active,
      listeners,
      sendTurn,
      freshNextTurn,
      renewedTurns,
      turnReviewers,
    });
},
};
