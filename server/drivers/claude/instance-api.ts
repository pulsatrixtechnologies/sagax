/** Snapshot, auth, steer, generateText and ProviderInstance surface (#1383). */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LOGIN_MARKER } from "../../principal-engine-logins.ts";
import { DATA_DIR } from "../../config.ts";
import { writeFileAtomic } from "../../atomic.ts";
import { killCliTree, spawnCli } from "../../procs.ts";
import type {
  ProviderInstance,
  ProviderSnapshot,
  SteerOutcome,
  TextGenerationOptions,
} from "../../contracts.ts";
import { runKeepWarmPing } from "../claude-keepwarm.ts";
import { DRIVER_KIND, NO_ANTHROPIC_KEY, resolveClaudeConfigDir } from "./config.ts";

export function buildClaudeInstanceApi(bag: Record<string, any>): ProviderInstance {
  const {
    instanceId, input, config, environment, refreshModels, startupModelRefresh,
    getModels, getCliVersion, setCliVersion, getCliVersionChecked, setCliVersionChecked,
    getCliHelpVersion, readCliVersion, readCliHelp,
    listeners, listCommands, active, sessions, warmContracts, warmHolds, heldVolatile,
    sessionFileBytes, closeSession, armIdle, writeUser,
    applyApprovalMode, authRecovery, stopRenewWatch, sendTurn, supportModule,
  } = bag;
  const {
    claudeUserMessage,
    parseClaudeCliVersion, claudeCliUpdate, claudeInheritWarning, claudeAuthStatus,
    oneShotIsolationArgs, readClaudeAuthSettings, inheritsUserConfig,
    claudeCliSupports,
  } = supportModule;
  const LoginController = supportModule.ClaudeLoginController;


  /** A user message into the running turn: the CLI delivers it before its
   * next model call, or — when no call is left in this turn — as its next
   * native turn, which this driver keeps inside the same logical turn.
   * "refused" when nothing is running here to steer or the stdin write
   * provably failed; the caller queues those words. */
  const steer = async (threadId: string, text: string, options?: { steerId?: string }): Promise<SteerOutcome> => {
    const s = sessions.get(threadId);
    if (!s || !s.turn || s.turn.settled || s.closing || s.child.exitCode !== null) return "refused";
    const turn = s.turn;
    // Counted before the write: a `result` read while the words are still
    // on their way must hold for them too. A failed write takes it back.
    // The uuid is what the CLI's echo names when a model call takes it in.
    const id = options?.steerId && /^[\w-]{8,80}$/.test(options.steerId) ? options.steerId : randomUUID();
    turn.pendingSteers.add(id);
    if (!(await writeUser(s, threadId, { ...claudeUserMessage(text, undefined), uuid: id }))) {
      turn.pendingSteers.delete(id);
      return "refused";
    }
    // Written while a held result waits for a continuation's `init`: these
    // words get the whole grace to be announced too.
    if (!turn.settled && turn.continuationGrace) turn.armGrace?.();
    return "steered";
  };

  // Sign in from Settings: the unmodified CLI's own login, driven over pipes
  // (server/drivers/claude-login-auth.ts). Same environment as every turn.
  const login = new LoginController({
    cli: config.cli,
    environment,
    onAuthenticated: async () => {
      await refreshModels();
      const dir = resolveClaudeConfigDir(config.configDir, environment());
      writeFileAtomic(join(dir, LOGIN_MARKER), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
      supportModule.onSoloClaudeLinked?.();
    },
  });

  const snapshot = async (): Promise<ProviderSnapshot> => {
    const env = environment();
    const probe = await readCliVersion(env);
    if (!("version" in probe)) return { state: "unavailable", reason: probe.reason };
    const { version } = probe;
    setCliVersion(parseClaudeCliVersion(version));
    setCliVersionChecked(true);
    if (version !== getCliHelpVersion()) await readCliHelp(version, env);
    const update = claudeCliUpdate(version, config.cli);
    const warning = claudeInheritWarning(env);
    if (config.requireApiKey) {
      // Never falls back to a login: without the key it is not set up.
      if (!input.environment.ANTHROPIC_API_KEY) return { state: "unavailable", version, reason: NO_ANTHROPIC_KEY };
      return { state: "available", version, authenticated: true, account: { method: "api-key" }, ...(update ? { update } : {}), ...(warning ? { warning } : {}), billing: "metered" };
    }
    const auth = await claudeAuthStatus(config.cli, env);
    // claudeEnvironment strips ANTHROPIC_API_KEY, so turns run on the
    // CLI's own login (Pro/Max): the cost it reports is what the call
    // WOULD bill, not a charge
    return { state: "available", version, ...auth, ...(update ? { update } : {}), ...(warning ? { warning } : {}), billing: "subscription" };
  };

  /** One-shot Claude call with the prompt on stdin, never argv. Approval
   * summaries can contain paths, commands, or secrets, so the generic
   * `claude -p "prompt"` shape is not safe for review. No tools or MCP
   * servers are mounted in this isolated process. */
  const generateReview = (prompt: string, signal?: AbortSignal, onUsage?: TextGenerationOptions["onUsage"], noThinking = false): Promise<string> =>
    new Promise((resolve, reject) => {
      if (config.requireApiKey && !input.environment.ANTHROPIC_API_KEY) {
        reject(new Error(NO_ANTHROPIC_KEY));
        return;
      }
      const model = config.managedModels?.[0] ?? "claude-haiku-4-5";
      const env = environment(model);
      if (noThinking) env.MAX_THINKING_TOKENS = "0";
      // Isolated unless this machine's own setup must come along: the
      // inherit escape hatch, or a login kept in settings.json (an
      // apiKeyHelper, Bedrock or Vertex variables) that --setting-sources ""
      // would drop.
      const authInSettings = Object.keys(readClaudeAuthSettings(env, input.environment)).length > 0;
      const isolation = inheritsUserConfig(env) || authInSettings ? [] : oneShotIsolationArgs(getCliVersion());
      let cwd: string | undefined;
      if (isolation.length) {
        env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
        // One fixed empty private folder: no project CLAUDE.md or .mcp.json
        // above it, and one projects/ entry for every one-shot call.
        cwd = join(DATA_DIR, "claude-one-shot");
        try { mkdirSync(cwd, { recursive: true, mode: 0o700 }); } catch { cwd = undefined; }
      }
      const child = spawnCli(
        config.cli,
        ["-p", "--model", model, "--output-format", onUsage ? "json" : "text", ...isolation],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env,
          ...(cwd ? { cwd } : {}),
        },
      );
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve(stdout.trim());
      };
      const onAbort = () => {
        killCliTree(child);
        finish(new Error("Claude review aborted"));
      };
      const timer = setTimeout(() => {
        killCliTree(child);
        finish(new Error("Claude review timed out"));
      }, 60_000);
      timer.unref?.();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 1_000_000) {
          killCliTree(child);
          finish(new Error("Claude review output exceeded 1 MB"));
        }
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-8_192);
      });
      child.on("error", (error) => finish(error));
      child.on("close", (code) => {
        if (settled) return;
        if (onUsage) {
          try {
            const result = JSON.parse(stdout);
            if (!result || result.type !== "result") throw new Error("Claude text generation returned no result");
            const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
            const cachedInput = count(result.usage?.cache_read_input_tokens);
            const inputs = [count(result.usage?.input_tokens), cachedInput, count(result.usage?.cache_creation_input_tokens)]
              .filter((value): value is number => value !== undefined);
            const models = result.modelUsage && typeof result.modelUsage === "object" && !Array.isArray(result.modelUsage)
              ? Object.keys(result.modelUsage) : [];
            onUsage({
              model: models.length === 1 ? models[0]! : models.find(candidate => candidate === model || candidate.startsWith(`${model}-`)) ?? model,
              input: inputs.length ? inputs.reduce((sum, value) => sum + value, 0) : undefined,
              output: count(result.usage?.output_tokens),
              cachedInput,
              costUsd: count(result.total_cost_usd),
            });
            if (result.is_error === true) throw new Error(typeof result.result === "string" && result.result.trim() ? result.result : stderr.trim() || "Claude text generation failed");
            if (typeof result.result !== "string") throw new Error("Claude text generation returned no text");
            stdout = result.result;
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
            return;
          }
        }
        if (code === 0) finish();
        else finish(new Error(stderr.trim() || `Claude review exited ${code}`));
      });
      if (signal?.aborted) onAbort();
      else {
        signal?.addEventListener("abort", onAbort, { once: true });
        child.stdin.end(prompt);
      }
    });

  return {
    instanceId,
    driverKind: DRIVER_KIND,
    displayName: input.displayName,
    enabled: input.enabled,
    get models() {
      return getModels();
    },
    refreshModels,
    ...(startupModelRefresh ? { startupModelRefresh } : {}),
    snapshot,
    startAuthentication: () => login.start(),
    getAuthentication: (flowId) => login.get(flowId),
    completeAuthentication: (flowId, code) => login.complete(flowId, code),
    cancelAuthentication: () => login.cancel(),
    signOut: () => login.signOut(),
    adapter: {
      provider: DRIVER_KIND,
      capabilities: {
        sessionModelSwitch: "in-session",
        withholdsHostTools: true,
        // A guest's turn runs with no command-running tool and no read
        // outside its folder (guestConfined, GUEST_CLAUDE_TOOLS).
        guestTurns: "confined",
        agentsMcp: true,
      customMcp: true,
        computerMcp: true,
        phoneMcp: true,
        browserMcp: true,
        dataMcp: true,
        images: true,
        nativeImageInput: true,
        effortLevels: ["low", "medium", "high", "xhigh", "max"],
        queueing: true,
        // Only while this CLI can be told to refresh a resumed session's
        // recorded system prompt (--system-prompt-snapshot). Keeping a
        // session across an update from outside it means the harness keeps
        // its prompt too; an older CLI would answer a delegated return with
        // the instructions of the turn that started the session, where a
        // fresh session rebuilt them. Unknown version: not yet.
        get strictResume() {
          const version = getCliVersion();
          return getCliVersionChecked() && version !== null && claudeCliSupports(version, "--system-prompt-snapshot");
        },
        // Harness turns reassert a per-bot mode and restore the broker even
        // when an old instance was configured with bypassPermissions.
        localComputerMcp: true,
        hooks: true,
        // A call can start this process before the first utterance, with
        // stdin open and no prompt, so the first spoken turn reuses it.
        warmSession: true,
      },
      sendTurn: (turn) => authRecovery.send(turn, sendTurn),
      steer,
      interruptTurn: async (threadId) => active.get(threadId)?.stop(),
      applyApprovalMode,
      respondToRequest: async (threadId, requestId, decision) => {
        // fail-closed by construction: no broker, or an ask that already
        // timed out / settled, is `unavailable` — the caller denies
        const broker = sessions.get(threadId)?.broker ?? active.get(threadId)?.broker;
        if (!broker) return "unavailable";
        const behavior = decision.behavior === "answer" ? "answer" : decision.behavior;
        if (!broker.answer(requestId, behavior, decision.message, decision.always)) return "unavailable";
        return behavior === "allow" ? "allowed-once" : behavior === "answer" ? "answered" : "rejected";
      },
      hasSession: (threadId) => active.has(threadId),
      releaseWarmSession: (threadId) => {
        const live = sessions.get(threadId);
        // A running turn owns the process. Hangup closes only an idle one,
        // including the process kept warm between call turns.
        if (!live || live.turn || live.closing) return;
        closeSession(threadId, "call ended");
      },
      sessionBytes: (threadId, resumeCursor) => {
        if (typeof resumeCursor !== "string") return undefined;
        // A live process already holds this session: a turn writes to it,
        // nothing is loaded from disk.
        const live = sessions.get(threadId);
        if (live && !live.closing && live.child.exitCode === null && live.sessionId === resumeCursor) return undefined;
        return sessionFileBytes(resumeCursor);
      },
      cacheKeepWarm: {
        ping: async (threadId, options) => {
          const live = sessions.get(threadId);
          const contract = warmContracts.get(threadId);
          if (!live || live.closing || live.child.exitCode !== null || !contract || !live.sessionId) {
            return { ok: false, reason: "the conversation's Claude session has closed" };
          }
          if (live.turn || active.has(threadId)) return { ok: false, reason: "a turn is running", busy: true };
          const cliVersion = getCliVersion();
          if (cliVersion !== null && !(claudeCliSupports(cliVersion, "--fork-session") && claudeCliSupports(cliVersion, "--no-session-persistence"))) {
            return { ok: false, reason: "this Claude Code is too old to fork a session; update Claude Code" };
          }
          return runKeepWarmPing({ cli: config.cli, contract, sessionId: live.sessionId, signal: options?.signal });
        },
        hold: (threadId, until) => {
          if (until === null) warmHolds.delete(threadId);
          else warmHolds.set(threadId, until);
          const live = sessions.get(threadId);
          if (!live || live.closing || live.child.exitCode !== null) return false;
          // re-time an idle process's close; a busy one re-arms at settle
          if (!live.turn) armIdle(threadId);
          return true;
        },
      },
      stopAll: async () => {
        for (const { stop } of active.values()) stop();
        for (const threadId of Array.from(sessions.keys())) closeSession(threadId, "stopAll");
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    generateText: (prompt, options) => generateReview(prompt, options?.signal, options?.onUsage, options?.noThinking === true),
    reviewPermission: generateReview,
    listCommands,
    dispose: async () => {
      stopRenewWatch();
      try {
        await login.dispose();
      } finally {
        for (const { stop } of active.values()) stop();
        for (const threadId of Array.from(sessions.keys())) closeSession(threadId, "dispose");
        heldVolatile.clear();
        listeners.clear();
      }
    },
  };

}
