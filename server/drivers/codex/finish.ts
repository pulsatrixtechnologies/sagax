/** Handshake, thread start/resume and turn/start for a Codex launch attempt. */
import { homedir } from "node:os";
import { serverVersion } from "../../environment.ts";
import { cleanCommandVariables } from "../../credential-command-env.ts";
import { decodeCodexSelection } from "../codex-catalog.ts";
import { codexDeveloperInstructions, syncCodexInstructions } from "../codex-instructions.ts";
import { sectionFingerprints, volatileContextNote, volatileSectionsUpdate, withContextNote } from "../prompt-split.ts";
import { classifyError, RETRY_MAX_ATTEMPTS } from "../retry.ts";
import { classifyResumeFailure, mayReplay, rebuiltSessionNotice, recoveryPromptFor } from "../../resume-recovery.ts";
import { contextRenewedNotice } from "../../context-renewal.ts";
import { codexSignInExpired, codexSignInRefused, codexUserError } from "../codex-errors.ts";
import { sagaxReviewsAuto } from "../sagax-reviewer.ts";
import {
  codexNamedApprovalParams,
  customApprovalParams,
  permissionProfileUnsupported,
  withResolvedSandbox,
  type CodexApprovalParams,
} from "./approvals.ts";
import { CODEX_SHELL_SET, extendShellExclusions } from "./shell-policy.ts";
import { plainRecord } from "./plain.ts";
import { CodexRpcError, archivedNativeCodexThread, missingNativeCodexThread } from "./rpc.ts";
import { codexShellDisabled } from "./launch-args.ts";
import type { CodexSession } from "./session-types.ts";
import { redactSecretsInText } from "../../redact.ts";
import { CODEX_WITHHELD_APPROVAL, CODEX_WITHHELD_FULL_APPROVAL } from "../host-tools.ts";

export async function finishCodexLaunch(s: CodexSession): Promise<void> {
  const turn = s.input;
s.active.set(s.threadId, { stop: s.stop, turnId: s.turnId, asks: s.asks, steer: s.steerActiveTurn });
// Relaunching the app-server is still the same logical turn. Keep the
// active process current on every attempt, but announce the turn once.
if (s.attempt === 0 && !s.announced) s.emit({ ...s.base(s.threadId, s.turnId), type: "turn.started" });

// handshake + kickoff; a transient failure (5xx/overloaded/reset) gets
// one relaunch of the whole app-server after backoff — but only when
// nothing streamed yet, and never for auth/shape errors or interrupts
try {
  await s.request("initialize", {
    clientInfo: { name: "openmausbot", title: "Sagax", version: serverVersion() },
    // Named permission profiles are an experimental app-server field in
    // Codex 0.151. Negotiate them explicitly; older servers ignore this
    // capability and remain on the legacy Custom fallback below.
    capabilities: { experimentalApi: true },
  });
  s.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  // developerInstructions replaces, rather than appends to, native
  // config. Read it for every approval mode so existing rules survive.
  // request() already redacts config/read responses from native logs.
  let effectiveConfig: unknown;
  try {
    const configured = await s.request("config/read", {
      cwd: turn.cwd ?? homedir(),
      includeLayers: false,
    });
    effectiveConfig = configured?.config;
  } catch (error) {
    // Do not expose a possibly secret-bearing native config error or
    // overwrite unknown instructions with an empty fallback. A config
    // codex itself rejected is the one case worth naming: the person
    // can act on it, and the message carries no credential.
    const invalid = error instanceof CodexRpcError && /^invalid configuration\b/i.test(error.message);
    throw new Error(
      invalid
        ? "Codex rejected its configuration as invalid. Check ~/.codex/config.toml (or CODEX_HOME) for a broken entry, then retry."
        : "Could not read Codex configuration; cannot safely update bot instructions. Retry after checking Codex.",
    );
  }
  if (s.privateEnv.length) {
    const snapshot = (effectiveConfig as { features?: { shell_snapshot?: unknown } } | null)?.features?.shell_snapshot;
    if (s.provenPrivateEnv ? snapshot !== false : snapshot === true) {
      throw new Error("Codex could not disable inherited shell snapshots. No prompt was sent.");
    }
  }
  if (s.privateEnv.length || s.plan) {
    // Extend the effective policy, never replace it, for both new and
    // resumed threads, so local, Company and ChatGPT turns keep the
    // person's own exclusions, and a plan turn adds its token's to
    // them on every turn, mounts or none.
    const rawPolicy = (effectiveConfig as { shell_environment_policy?: unknown } | null)?.shell_environment_policy;
    if (rawPolicy !== undefined && (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy))) {
      throw new Error("Codex could not confirm its shell environment policy. No prompt was sent.");
    }
    s.selectionConfig.config = { ...s.selectionConfig.config,
      ...extendShellExclusions((rawPolicy ?? {}) as Record<string, unknown>, [...(s.plan ? ["SAGAX_CHATGPT_TOKEN"] : []), ...s.privateEnv]) };
  }
  // Command variables the person exposed to this bot
  // (server/credential-command-env.ts): added to the shell policy's
  // `set` table on the thread, over stdin, so Codex's shell gets them
  // after its exclusions and the app-server's own environment never
  // does (no billing switch, nothing on argv). The person's own `set`
  // entries stay. Codex starts for every turn, so a change or a revoke
  // holds at the next one.
  const commandVariables = cleanCommandVariables(turn.commandEnvironment);
  if (commandVariables.length) {
    const rawSet = plainRecord((effectiveConfig as { shell_environment_policy?: { set?: unknown } } | null)?.shell_environment_policy?.set) ?? {};
    s.selectionConfig.config = { ...s.selectionConfig.config,
      [CODEX_SHELL_SET]: { ...rawSet, ...Object.fromEntries(commandVariables) } };
  }
  if (turn.toolScope !== undefined) {
    const catalog = (effectiveConfig as { mcp_servers?: unknown } | null)?.mcp_servers;
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) throw new Error("Codex could not confirm its selected MCP configuration. No prompt was sent.");
    for (const [name, entry] of Object.entries(catalog)) {
      if (entry && typeof entry === "object" && (entry as { enabled?: unknown }).enabled === false) continue;
      const expected = s.selectedMcp.get(name);
      const actual = entry as { command?: unknown; args?: unknown; env_vars?: unknown; env?: unknown; default_tools_approval_mode?: unknown; tools?: unknown } | null;
      if (!expected || actual?.command !== expected.command
        || JSON.stringify(actual?.args ?? []) !== JSON.stringify(expected.args ?? [])
        || !Array.isArray(actual?.env_vars) || JSON.stringify([...actual.env_vars].sort()) !== JSON.stringify(Object.keys(expected.env).sort())
        || actual.default_tools_approval_mode !== (s.selectedApprovals.get(name) ?? "prompt")
        || (actual.env != null && (typeof actual.env !== "object" || Array.isArray(actual.env) || Object.keys(actual.env).length > 0))
        || (actual.tools != null && (typeof actual.tools !== "object" || Array.isArray(actual.tools) || Object.keys(actual.tools).length > 0))) {
        throw new Error("Codex has an MCP server outside the selected configuration. Disable native MCP entries for this account before using tool selection. No prompt was sent.");
      }
    }
  }
  // Proven before the turn starts: a Codex that did not take the
  // overrides runs nothing for a guest.
  if (turn.guestConfined && !codexShellDisabled(effectiveConfig)) {
    throw new Error(`This Codex could not turn its shell off, so it can't run this turn. Update Codex, or switch this bot to Claude.${turn.confinedWhy ? ` ${turn.confinedWhy}` : ""}`);
  }
  // Only the stable half of the prompt belongs in the developer slot:
  // it is the part that must survive compaction unchanged, and any
  // change to it invalidates the provider's cached prefix. The volatile
  // half (the sections in VOLATILE_SECTIONS, system-prompt.ts) is
  // delivered inside the turn that changed it, after the cached
  // prefix, the same contract SendTurnInput.systemStable documents.
  // Without the split the driver keeps the previous single-block
  // behaviour.
  const stableInstructions = typeof turn.systemStable === "string" && typeof turn.systemVolatile === "string"
    ? turn.systemStable
    : null;
  const promptSplit = stableInstructions !== null;
  const developerInstructions = codexDeveloperInstructions(
    effectiveConfig,
    stableInstructions ?? turn.system ?? "",
  );
  let approvalParams: CodexApprovalParams;
  if (s.approvalMode === "custom") {
    // config/read returns the effective global + project config for this
    // cwd. Reasserting those values is essential: simply omitting them
    // on a resumed thread would keep the previous named mode sticky.
    approvalParams = customApprovalParams(effectiveConfig);
  } else {
    approvalParams = codexNamedApprovalParams(s.approvalMode, s.approvalMode === "auto" && sagaxReviewsAuto(turn.botId));
  }
  // Organization server: read-only and asking, every command or write
  // is then a request the handler below declines.
  // Full access there: never ask, still read-only on the server.
  if (s.withholdHostTools) {
    approvalParams = structuredClone(s.approvalMode === "full" ? CODEX_WITHHELD_FULL_APPROVAL : CODEX_WITHHELD_APPROVAL) as unknown as CodexApprovalParams;
  }
  // Codex's `never` means "do not ask to escalate", not "grant every
  // requested permission". Only the user's explicit Sagax Full
  // mode may synthesize approvals; Custom must preserve the sandbox
  // boundary from config.toml (for example never + read-only).
  s.autoAcceptPermissions = s.approvalMode === "full";
  s.turnReviewers.set(s.threadId, {
    mode: s.approvalMode,
    sagaxAnswers: s.approvalMode !== "custom" && approvalParams.turn.approvalsReviewer === "user",
  });
  // Each turn launches a new app-server. Reassert current bot instructions
  // on start AND resume so Codex owns their lifetime through compaction.
  // Removed bot rules are cleared without dropping native configured rules.
  const selection = s.config.managed
    ? { model: turn.model, modelProvider: "openmaus_company" }
    : s.config.authMode === "chatgpt-plan"
      ? { model: turn.model, modelProvider: "openai_chatgpt_plan" }
      : decodeCodexSelection(turn.model);
  // The last Codex thread filled up: resuming it would fill up again.
  // A new thread starts from the chat's rebuild (its turn text alone
  // when there is nothing to replay). An in-turn renewal (inTurnRenewal)
  // is the same idea mid-turn: no resume, prompt already carries the
  // rebuild and the steps taken.
  const renewFull = !s.inTurnRenewal && s.freshNextTurn.has(s.threadId) && typeof turn.resumeCursor === "string";
  s.freshNextTurn.delete(s.threadId);
  const renewingNow = Boolean(s.inTurnRenewal);
  const cursor = renewingNow || renewFull ? null
    : (typeof turn.resumeCursor === "string" ? turn.resumeCursor : null);
  let startedModel: string | null = null;
  let resumedNativeThread = false;
  let rebuiltFromReplay = false;
  // A skill the person picked as a slash command: Codex reads it as
  // `$name` with the skill's file (shared/harness-commands.ts).
  const skill = turn.harnessCommand?.path ? turn.harnessCommand : undefined;
  let promptText = skill ? `$${skill.name}${skill.args ? ` ${skill.args}` : ""}` : turn.text;
  if (renewingNow && s.inTurnRenewal) {
    promptText = s.inTurnRenewal;
    s.inTurnRenewal = null;
    rebuiltFromReplay = Boolean(turn.recoveryText?.trim());
  } else if (renewFull && !skill && turn.recoveryText?.trim() && turn.recoveryText.trim() !== turn.text.trim()) {
    promptText = turn.recoveryText;
    rebuiltFromReplay = true;
  }
  if (cursor) {
    const resumeThread = () => s.request("thread/resume", {
      ...s.selectionConfig, threadId: cursor,
      developerInstructions,
      model: selection.model,
      ...(selection.modelProvider ? { modelProvider: selection.modelProvider } : {}),
      ...approvalParams.thread,
    });
    // An archived session is unarchived and resumed; if that fails it is rebuilt like a missing one.
    const resumeUnarchived = () => resumeThread().catch((error) => !archivedNativeCodexThread(error, cursor) ? Promise.reject(error)
      : s.request("thread/unarchive", { threadId: cursor }).then(resumeThread, () => Promise.reject(error)));
    try {
      let resumed;
      try {
        resumed = await resumeUnarchived();
      } catch (error) {
        if (!approvalParams.fallback || !permissionProfileUnsupported(error)) throw error;
        // Older servers may require the legacy permission selector, but
        // still resume the same native thread before any user submission.
        approvalParams = approvalParams.fallback;
        resumed = await resumeUnarchived();
      }
      approvalParams = withResolvedSandbox(approvalParams, resumed);
      s.codexThreadId = resumed?.thread?.id ?? cursor;
      resumedNativeThread = true;
    } catch (error) {
      const failure = classifyResumeFailure({
        attempted: true,
        rejected: error instanceof CodexRpcError, promptSubmitted: s.promptSubmitted,
        producedOutput: s.state.sawStreamDelta,
      });
      if (s.recoveredMissingSession || s.stopRequested || s.state.settled ||
          !turn.recoveryText?.trim() || !(missingNativeCodexThread(error, cursor) || archivedNativeCodexThread(error, cursor)) || !mayReplay(failure)) throw error;
      // The prompt has never been submitted and Codex no longer has the
      // thread: without a rebuild every later turn resumes the same
      // missing rollout and fails the same way. Rebuild it from the
      // chat, Company or personal, as Claude does for a refused resume;
      // once, through the same approved model/provider below. The
      // person is told (runtime.notice beside session.started).
      s.recoveredMissingSession = true;
      const rebuild = recoveryPromptFor({ recoveryText: turn.recoveryText, currentText: turn.text, failure });
      // Announced as rebuilt only when the replacement really carries the
      // replay; otherwise it holds no more than the turn text.
      rebuiltFromReplay = rebuild.replayed;
      promptText = rebuild.text;
    }
  }
  if (!s.codexThreadId) {
    const startThread = () => s.request("thread/start", {
        ...s.selectionConfig,
        developerInstructions,
        cwd: turn.cwd ?? homedir(),
        model: selection.model,
        ...(selection.modelProvider ? { modelProvider: selection.modelProvider } : {}),
        ...approvalParams.thread,
        ...(turn.guestConfined ? { environments: [] } : {}),
        ephemeral: false,
      });
    let started;
    try {
      started = await startThread();
    } catch (error) {
      if (!approvalParams.fallback || !permissionProfileUnsupported(error)) throw error;
      approvalParams = approvalParams.fallback;
      started = await startThread();
    }
    approvalParams = withResolvedSandbox(approvalParams, started);
    s.codexThreadId = started?.thread?.id ?? null;
    startedModel = started?.model ?? null;
  }
  if (!s.codexThreadId) throw new Error("Codex did not return a native thread id");
  const volatileSections = promptSplit ? turn.systemVolatileSections : undefined;
  const { deliverVolatile, hadVolatile, previousSections, commitVolatile } = await syncCodexInstructions(
    s.threadId,
    s.codexThreadId,
    developerInstructions,
    promptSplit ? turn.systemVolatile ?? "" : "",
    resumedNativeThread,
    s.request,
    Boolean(turn.mentionTurn),
    volatileSections ? sectionFingerprints(volatileSections) : undefined,
  );
  // A changed volatile half rides the next user input as a labelled
  // context block. It never touches the developer slot, so an
  // ordinary memory write or roster change neither appends a second
  // copy of the prompt to history nor re-uploads the conversation.
  // Only the sections that changed ride when the thread's copy is
  // known (2026-10-19 perf parity, point 4).
  if (deliverVolatile) {
    promptText = withContextNote(
      volatileSectionsUpdate(volatileSections, previousSections, Boolean(turn.mentionTurn))
        ?? volatileContextNote(promptSplit ? turn.systemVolatile ?? "" : "", hadVolatile),
      promptText,
    );
  }
  s.emit({ ...s.base(s.threadId, s.turnId), type: "session.started", sessionId: s.codexThreadId, model: startedModel ?? turn.model ?? null, ...(rebuiltFromReplay ? { rebuilt: true } : {}) });
  if (renewingNow || renewFull) s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.notice", message: contextRenewedNotice("Codex") });
  else if (rebuiltFromReplay) s.emit({ ...s.base(s.threadId, s.turnId), type: "runtime.notice", message: rebuiltSessionNotice("Codex") });
  const turnInput = [
    ...(skill?.path ? [{ type: "skill" as const, name: skill.name, path: skill.path }] : []),
    ...(promptText ? [{ type: "text" as const, text: promptText }] : []),
    ...(turn.images ?? []).map((image) => ({ type: "localImage" as const, path: image.path })),
  ];
  const startTurn = () => {
    s.promptSubmitted = true;
    s.startingNativeTurn = true;
    return s.request("turn/start", { threadId: s.codexThreadId,
      input: turnInput,
      ...approvalParams.turn,
      // No environment: no exec_command, apply_patch or view_image, and
      // any call to them is refused (probed against codex-cli 0.159.0).
      // Without the experimental API the field is rejected, not ignored.
      ...(turn.guestConfined ? { environments: [] } : {}),
      // Spread, not `effort: turn.effort ?? null`. Probed against
      // codex-cli 0.146.0: null is indistinguishable from an absent key
      // — both leave the thread's current effort alone, emitting no
      // thread/settings/updated, and thread/resume reads the old value
      // back. The app-server offers no way to clear a level either:
      // "" is rejected outright and thread/start takes no effort at
      // all. So a thread keeps the last level it was sent until it is
      // sent another; back on Default, the harness gives a thread that
      // holds a level a new thread instead of resuming it (server/index.ts).
      ...(turn.effort ? { effort: turn.effort } : {}),
    });
  };
  try {
    await startTurn();
  } catch (error) {
    if (!approvalParams.fallback || !permissionProfileUnsupported(error)) throw error;
    approvalParams = approvalParams.fallback;
    await startTurn();
  }
  // turn/start accepted the input: only now may the receipt claim the
  // volatile half was delivered, so a rejected turn redelivers on retry.
  if (commitVolatile) commitVolatile();
  s.releaseSlot();
} catch (e) {
  const failure = e instanceof Error ? e : { text: String(e) };
  const raw = e instanceof Error ? e.message : String(e);
  const refused = s.chatgptTurn && s.loginMark() !== null && codexSignInRefused({ message: raw });
  const message = refused ? codexSignInExpired(raw) : codexUserError(raw, s.route);
  const needsAuth = refused || /(?:\b401\b|unauthorized|missing bearer|authentication required)/i.test(raw);
  const verdict = classifyError(failure);
  // Three guards hold here: main's abandoned attempt never retries,
  // neither does a Company session already recovered once from canonical
  // history, and a Stop already asked for must not be undone by a relaunch.
  if (!s.state.settled && !s.abandoned && !s.recoveredMissingSession && !s.stopRequested && !needsAuth && verdict.transient && s.attempt < RETRY_MAX_ATTEMPTS - 1 && s.state.sawStreamDelta === false) {
    return s.relaunch(verdict.reason, message, "rpc_error");
  }
  // abandoned marks an attempt retired by a retry; its late rpc
  // timeouts must neither report a spurious error nor relaunch again
  if (!s.state.settled && !s.abandoned) {
    // Keep the cause in the server log: the run only records a code.
    console.error(`[codex] turn failed: ${needsAuth ? "auth_required" : verdict.reason}: ${redactSecretsInText(message).slice(0, 400)}`);
    if (refused) s.loginRefused();
    s.emit({
      ...s.base(s.threadId, s.turnId),
      type: "runtime.error",
      message,
      ...(needsAuth ? { setup: true } : {}),
    });
    await s.settle(false, needsAuth ? "auth_required" : verdict.reason === "provider_safety" ? "provider_safety" : "rpc_error");
  }
}

}
