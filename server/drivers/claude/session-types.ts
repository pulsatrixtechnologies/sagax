/** Mutable Claude CLI session bag shared across turn phases (#1383 wave 5). */
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { SendTurnInput } from "../../contracts.ts";
import type { RenewalStep } from "../../context-renewal.ts";
import type { ClaudeLimit } from "./limits.ts";

export type ClaudeChild = ChildProcessByStdio<Writable, Readable, Readable>;

/** One native `result` frame's verdict and figures. A logical turn can span
 * more than one: a user message steered in after the turn's last model call
 * runs as the CLI's next native turn (see STEERED_CONTINUATION_GRACE_MS). */
export interface NativeTurnResult {
  ok: boolean;
  stopReason: string | null;
  cost: number | null;
  usage?: { input: number; output: number; cachedInput?: number };
}

/** Minimal broker surface the session bag needs (createPermissionBroker). */
export type ClaudePermissionBroker = {
  socketPath: string;
  close: () => void;
  pause: () => void;
  answer: (id: string, behavior: "allow" | "deny" | "answer", message?: string, always?: boolean) => boolean;
};

/** How long after a native `result` the CLI gets to announce, with `init`,
 * the turn it starts for a user message steered in after this turn's last
 * model call. The message is already buffered on its stdin, so this takes
 * milliseconds (about 60 ms on 2.1.282). If nothing comes, the message was
 * folded into one of this turn's model calls after all, and the held result
 * is the turn's: every result with a steer outstanding waits this long. */
export const STEERED_CONTINUATION_GRACE_MS = 2_000;

/** How long a steered continuation may stay silent after its `init` before
 * the driver stops waiting and closes the turn on the held result. 2.1.282
 * follows `init` with a `status` frame within milliseconds and every CLI
 * streams once the model answers; a continuation that never speaks would
 * otherwise keep the turn — and its internal tool pass — open until the
 * stall watchdog. */
export const STEERED_CONTINUATION_SILENCE_MS = 30_000;

/** Tests scale each steer timer on its own, the way FAKE_CLAUDE_RETRY_SCALE
 * scales the retry backoff — a test that shortens the silence bound must not
 * also shorten the grace `init` has to arrive in. Production runs at 1. */
const fakeTimerScale = (name: string) => Number(process.env[name] ?? "1") || 1;
export const steerGraceScale = () => fakeTimerScale("FAKE_CLAUDE_STEER_GRACE_SCALE");
export const steerSilenceScale = () => fakeTimerScale("FAKE_CLAUDE_STEER_SILENCE_SCALE");

export type ClaudeSession = {
  child: ClaudeChild;
  broker?: ClaudePermissionBroker;
  mcpConfigPath: string | null;
  systemPromptPath: string | null;
  /** the spawn contract — a different one means a fresh process */
  argsKey: string;
  /** the same contract as an object, to name what changed on a relaunch */
  contract?: unknown;
  /** the turn files its agents server reads (removed with the process) */
  turnFiles?: string[];
  /** the agents switches it was launched with (spawn-contract.ts TURN_SWITCH_ENV) */
  switches?: Record<string, boolean>;
  /** the MCP servers it was launched with (names), for the relaunch log */
  mcpNames?: string[];
  /** #1276: the servers whose catalog is searched (call_tool reads as its target) */
  searchedMounts: ReadonlySet<string>;
  /** the volatile half of the system prompt this process was launched
   * with (see SendTurnInput.systemVolatile). A later turn whose volatile
   * text differs delivers the difference in-turn rather than relaunching. */
  volatile: string;
  /** fingerprints of the volatile sections the process holds, by id
   * (prompt-split.ts sectionFingerprints), so a later turn sends only
   * the sections that changed. Undefined after a compaction or when the
   * harness sent no sections: the next change then sends the whole half. */
  volatileSections?: Record<string, string>;
  /** the CLI's session id from `init`, what --resume takes later */
  sessionId: string | null;
  /** the CLI emitted its `init` frame — it accepted the session and
   * began the turn. The acceptance boundary for --resume: before it,
   * nothing was submitted and the turn has caused nothing. */
  sawInit: boolean;
  /** The last turn ended in failure: the CLI may have refused its
   * message before keeping it, so what the conversation holds of the
   * volatile half is not known (heldVolatile). */
  lastTurnFailed?: boolean;
  /** Set while this process was started for a call warm and no user
   * turn owns it yet. Init is recorded; every other event is dropped
   * until a real turn attaches. */
  idleWarm?: boolean;
  /** The warm that owns this idle process. A replaced call's abort
   * closes the process only while this token still matches. */
  warmToken?: string;
  /** Model from init, so a real turn can publish session.started when
   * init arrived during the warm and the CLI does not re-announce it. */
  sessionModel?: string | null;
  /** the permission mode `init` says the session actually runs in. The
   * CLI takes `--permission-mode auto` for any model and starts in
   * "default" without a word when auto mode is unavailable (Haiku 4.5,
   * Sonnet 4.5, an org that disabled it), so the flag we passed is not
   * the truth — this is. null until init, or on a CLI that omits it. */
  nativePermissionMode: string | null;
  /** #1373: control requests sent on stdin (set_permission_mode), by
   * request_id, until the CLI's control_response settles them. */
  controlWaiters?: Map<string, (ok: boolean) => void>;
  /** launched with --replay-user-messages (see CLAUDE_REPLAY_FLOOR) */
  replaysUserMessages: boolean;
  /** tool_use id → name, so an Artifact result can become a page card */
  toolNames: Map<string, string>;
  /** the running turn, or null between turns */
  turn: {
    turnId: string;
    input: SendTurnInput;
    retryAbort: AbortController;
    settled: boolean;
    sawStreamDelta: boolean;
    /** written to a process kept warm from an earlier turn, which has
     * not announced this turn with its `init` yet. A process that ends
     * before that never took the prompt (see the close handler). */
    awaitingInit?: boolean;
    authFailed?: boolean;
    /** Words of a deferred authentication_failed (#1768), emitted only
     * when the shared-refresh race retry cannot restore the sign-in. */
    authFailureText?: string;
    authFailureDeferred?: boolean;
    updateRequired?: boolean;
    /** the window the latest `rate_limit_event` says refuses this
     * account (claudeLimitRefusal), null while requests go through */
    limit?: ClaudeLimit | null;
    /** the turn failed on its account's usage limit, and said so */
    limitReached?: boolean;
    /** what failed this turn is already in front of the person: a
     * sign-in, update or usage-limit error, or the CLI's own api-error
     * text. An error `result` says nothing more. */
    explained?: boolean;
    stopRequested?: boolean;
    /** Steered messages, by the uuid this driver sent them with, that no
     * model call has taken in yet as far as the driver can tell. With
     * --replay-user-messages the CLI echoes each one as a call takes it
     * in; without it, nothing the CLI prints says whether a steer was
     * folded in or runs next, so each one counts until a result holds on
     * it. A `result` with any left is held (see the `result` handling). */
    pendingSteers: Set<string>;
    /** Native results already produced by this logical turn, held while
     * a steered continuation is expected; summed into `turn.completed`. */
    deferred: NativeTurnResult | null;
    /** Armed after a held result: the CLI announces the continuation with
     * `init` within milliseconds, or never — then the held result stands. */
    continuationGrace: ReturnType<typeof setTimeout> | null;
    /** (Re)starts that grace; set with it. A steer that lands while it
     * runs restarts it, so each queued message gets the whole grace. */
    armGrace?: () => void;
    /** Armed by the continuation's `init`: a frame of any other kind must
     * follow within STEERED_CONTINUATION_SILENCE_MS, or the held result stands. */
    continuationSilence: ReturnType<typeof setTimeout> | null;
    /** The CLI stopped the turn because its context is full (compaction
     * thrashing, a prompt past the window): its close goes on in a fresh
     * session instead of failing (server/context-renewal.ts). */
    contextFull?: boolean;
    /** The CLI's running cost total on the result that said so. */
    contextFullTotal?: number;
    /** The tool calls this turn made, for that fresh session's note. */
    steps?: RenewalStep[];
    /** The turn's latest reply text, for the same note. */
    lastText?: string;
  } | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  stderr: string;
  /** The CLI's running total that the next turn's cost is measured from
   * (see turnCostFromRunningTotal): what --resume restored until the
   * first turn settles, then the last settled turn's total_cost_usd.
   * undefined until the first result; null when the start is unknown. */
  costTotal: number | null | undefined;
  /** Root close can precede a failed group stop; retry its finalization. */
  finishClose?: () => Promise<void>;
  /** resolves once the process's close has been handled: a turn it was
   * running has settled and left `active` (unless its tree could not be
   * confirmed stopped) */
  closed: Promise<void>;
};

export type ClaudeSessionTurn = NonNullable<ClaudeSession["turn"]>;

/** A logical turn made of several native turns: any failed half fails it,
 * the last stop reason stands, per-turn token usage adds up, and the cost is
 * the latest figure. The CLI reports total_cost_usd as the process's running
 * total, so adding would double-bill. A figure missing on one side leaves
 * the other side's alone. */
export function sumNativeTurnResults(earlier: NativeTurnResult | null, latest: NativeTurnResult): NativeTurnResult {
  if (!earlier) return latest;
  const usage = earlier.usage && latest.usage
    ? {
        input: earlier.usage.input + latest.usage.input,
        output: earlier.usage.output + latest.usage.output,
        ...(earlier.usage.cachedInput !== undefined || latest.usage.cachedInput !== undefined
          ? { cachedInput: (earlier.usage.cachedInput ?? 0) + (latest.usage.cachedInput ?? 0) }
          : {}),
      }
    : latest.usage ?? earlier.usage;
  return {
    ok: earlier.ok && latest.ok,
    stopReason: latest.stopReason ?? earlier.stopReason,
    cost: latest.cost ?? earlier.cost,
    ...(usage ? { usage } : {}),
  };
}
