// Generic ACP (Agent Client Protocol) driver core — one JSON-RPC-2.0-over-
// stdio session runtime that every ACP CLI harness (Grok Build, Gemini CLI,
// …) rides. Modeled on t3code's AcpSessionRuntime + per-agent AcpSupport
// split: the protocol mechanics live here, the per-harness quirks (spawn
// argv, auth method, model catalog, sign-in check) live in a small support
// object. Adding a harness = write server/drivers/acp/<name>.ts.
//
// One live agent process per (thread, spawn contract): the ACP handshake
// (initialize, authenticate) and the native session are established once,
// and later turns prompt the live session directly instead of paying the
// full handshake per message. The pool mirrors the Claude driver: a session
// closes after SAGAX_ACP_SESSION_IDLE_MS of quiet (default 10 minutes, floored
// by SAGAX_ACP_SESSION_IDLE_MIN_MS default 10s), when the spawn contract
// changes, when the child crashes, when an interrupt's cancel goes
// unanswered, and on stopAll/dispose. A resume cursor left by an earlier
// session resumes through session/load|resume when the process had to
// respawn.
//
// ACP has no `turn/completed` notification: the `session/prompt` RPC *result*
// is the completion signal (it carries stopReason + usage). Permission
// requests arrive as server→client `session/request_permission` and surface
// as canonical request.opened events, answered fail-closed (nothing approved
// unless the agent explicitly offered an `allow`-kind option — option ORDER
// is never a security contract). session/load REPLAYS history as ordinary
// session/update notifications, so updates are double-gated: nothing emits
// before the prompt is sent, and `_meta.isReplay` updates are dropped. Session
// configuration is the exception: its live updates apply before prompting too.
import type {
  DriverCreateInput,
  ProviderDriver,
  ProviderInstance,
} from "../../contracts.ts";

export {
  offeredModels,
  skipSubscriptionAuthForLocalInject,
  acpNativeIncomingLogMessage,
  versionFromProbe,
  parseVersionTriple,
  versionAtLeast,
} from "./helpers.ts";
export type { VersionTriple } from "./helpers.ts";
export { ACP_CANCEL_GRACE_MS, DEFAULT_ACP_PROMPT_IDLE_MS } from "./constants.ts";
import { createAcpInstance } from "./create-instance.ts";

import type {
  AcpConfig,
  AcpSupport,
} from "./types.ts";
export type {
  AcpConfig,
  AcpSupport,
  AccountErrorCode,
} from "./types.ts";



function decodeAcpConfig(defaultCli: string) {
  return (raw: unknown): AcpConfig => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      cli: typeof o.cli === "string" ? o.cli : defaultCli,
      fullAuto: o.fullAuto === true,
      workspace: typeof o.workspace === "string" ? o.workspace : undefined,
    };
  };
}

export function createAcpDriver(support: AcpSupport): ProviderDriver<AcpConfig> {
  // Without a per-turn configureSession nothing would ever apply the mode
  // that sessionScopedApproval keeps out of the spawn contract.
  if (support.sessionScopedApproval && !support.configureSession) {
    throw new Error(`${support.displayName}: sessionScopedApproval needs configureSession to apply each turn's mode`);
  }
  const DRIVER_KIND = support.driverKind;
  const SOURCE = support.nativeSource;
  const decodeConfig = decodeAcpConfig(support.defaultCli);
  const DENY_TIMEOUT_NOTE =
    "Sagax: nobody answered this permission request in time. Skip this action and finish what you can without it.";
  // shown to the person: no engine slug, and what to do next
  const QUESTION_NO_MATCH_NOTE =
    "That answer isn't one of the choices this engine can take, so the question was closed and the turn stopped. Ask again and pick one of the options.";

  return {
    driverKind: DRIVER_KIND,
    metadata: {
      displayName: support.displayName,
      supportsMultipleInstances: true,
      access: support.access ?? "subscription",
    },
    install: support.install,
    models: support.models,
    decodeConfig,
    defaultConfig: () => decodeConfig({}),

    async create(input: DriverCreateInput<AcpConfig>): Promise<ProviderInstance> {
      return createAcpInstance(support, input, {
        DRIVER_KIND, SOURCE, DENY_TIMEOUT_NOTE, QUESTION_NO_MATCH_NOTE,
      });
    },
  };
}
