/** Canonical runtime-event shapes, as they ride the live wire and the
 * inspector log. Single home in shared/ so the server contracts, the client
 * store, and the inspector panel cannot drift; server/contracts.ts and
 * server/thread-events.ts re-export these under their historical names. */
import type { AskQuestion } from "./ask-question.ts";

export type DriverKind = string;
export type InstanceId = string;
export type ThreadId = string;
export type TurnId = string;

export interface ModelVariantOption {
  id: string;
  label: string;
}

export interface ModelVariantState {
  options: ModelVariantOption[];
  currentValue?: string;
}

// Subset of upstream's 49-member ProviderRuntimeEvent union — the ~12 types
// the recipe says to start with, sharing one base. `raw` carries the
// native protocol message when a consumer needs to see behind the
// normalization.
export interface RuntimeEventBase {
  eventId: string;
  provider: DriverKind;
  providerInstanceId?: InstanceId;
  threadId: ThreadId;
  createdAt: string;
  turnId?: TurnId;
  itemId?: string;
  requestId?: string;
  raw?: { source: string; payload: unknown };
  /** Text the provider's own client produced instead of the model (an API
   * error it reports as a reply). Rendered like any other item, but not a
   * sign that the model received or acted on the prompt. */
  synthetic?: boolean;
}

export type RuntimeEvent = RuntimeEventBase &
  (
    | {
        type: "session.started"; sessionId: string | null; model?: string | null;
        /** the provider refused the turn's resumeCursor and this new session
         * was started from the turn's recoveryText */
        rebuilt?: boolean;
      }
    | { type: "session.model-variants"; model: string; variants: ModelVariantState }
    | { type: "session.exited"; reason?: string }
    /** A model call took in input steered into the running turn (the
     * `steerId` the harness gave Adapter.steer). */
    | { type: "steer.received"; steerId: string }
    | { type: "turn.started" }
    | {
        type: "turn.retrying";
        /** 1-based: the retry about to be launched (1 = first relaunch). */
        attempt: number;
        delayMs: number;
        /** Why this failure was judged retry-worthy (classifyError's reason). */
        reason: string;
      }
    | {
        type: "turn.completed";
        ok: boolean;
        stopReason?: string | null;
        cost?: number | null;
        denials?: string[];
        /** THIS turn's token total, as the provider reports it at the end.
         * The one figure the harness accumulates — thread.token-usage.updated
         * is a live indicator whose meaning differs per driver (a per-call
         * delta, a thread total, a per-step figure) and must never be summed. */
        usage?: { input: number; output: number; cachedInput?: number };
      }
    | {
        /** A resumable terminal: the turn exhausted its model/tool budget,
         * and a structured handoff was persisted. The harness may start a
         * `Continue:` thread automatically; an assigned turn's requester gets
         * the handoff with the stop instead (server/turn-continuation.ts). */
        type: "cap.exhausted";
        /** Absolute path to the persisted handoff for the dead turn. */
        handoffPath: string;
        /** What stopped the turn without a final answer. */
        reason: "cap";
      }
    | {
        type: "turn.wait_started";
        /** The computer resource this turn queued behind (e.g. "computer:box:bx_…"). */
        resource: string;
        /** Where this turn sat in the resource's arrival-ordered waitlist when
         * the wait began (#1652). */
        position?: number;
        /** Who held the computer when the wait began, if the holder was known. */
        holder?: { name: string; task?: string };
      }
    | {
        type: "turn.wait_ended";
        resource: string;
        holder?: { name: string; task?: string };
        /** How long the turn actually waited. */
        waitedMs: number;
        /** acquired: the claim landed; stopped: the turn was stopped or
         * cancelled while waiting; parked: the wait ceiling settled the turn
         * for resume (#1651); gave_up: the pre-parking ceiling, kept so
         * recorded logs still replay. */
        outcome: "acquired" | "gave_up" | "parked" | "stopped";
      }
    | {
        type: "item.started";
        itemType: "tool" | "reasoning";
        title?: string;
        /** The shell command the call runs, on one redacted line of at most
         * 200 characters, for the chip and the Verify card. Absent for calls
         * that run no command (a Read, a fetch). */
        summary?: string;
        /** Bounded, redacted display preview; never raw tool arguments. */
        input?: string;
        /** Files this call writes (Write/Edit, a Codex file change, an ACP
         * edit), as the tool named them. Recorded on the activity message so
         * the conversation's Files tab can list them once the call succeeds. */
        files?: string[];
        /** A call a sub-agent made: the item id of the call that started
         * that sub-agent (Claude's Agent tool), so its steps nest under it. */
        parentItemId?: string;
      }
    | { type: "item.updated"; itemType: "tool" | "reasoning"; tokens?: number | null }
    | {
        type: "item.completed";
        itemType: "tool";
        ok: boolean;
        output?: string;
        /** A ConnectWise call's whole result (server/tool-summary.ts
         * cwToolResult), read once for its widget. Never broadcast, never
         * written to the event log. */
        resultText?: string;
      }
    | { type: "item.completed"; itemType: "assistant_text"; text: string }
    /** Provider-generated raster bytes. This event is folded into the
     * private attachment store and is never forwarded to renderer SSE: a
     * multi-megabyte base64 result belongs in one durable message URL, not
     * duplicated through every connected window. */
    | { type: "item.completed"; itemType: "assistant_image"; data: string; alt?: string }
    | { type: "content.delta"; streamKind: "assistant_text" | "reasoning_text"; delta: string }
    | {
        type: "request.opened";
        requestType: "permission" | "question";
        tool: string;
        summary: string;
        /** The MCP tool a permission ask is for, as the engine itself named
         * it, qualified with its server (`agents__list_bots`), when `tool`
         * does not already say so (an ACP agent reports a kind such as
         * "other", Codex the bare tool name). Never taken from the model's
         * arguments. The organization admin gate reads it
         * (server/member-tool-scope.ts). */
        mcpTool?: string;
        /** Complete native shell input and its effective working directory.
         * Used for exact-command grants; never reconstructed from a display
         * summary, tool title, or argv. Absent when either value is unknown. */
        command?: { command: string; cwd: string };
        /** 2026-10-21 (parité R10, ligne 80): the app of this Mac a screen
         * action acts on, as the SERVER read it (server/computer-app.ts),
         * set only by the bus's publish gate; the bus drops any value an
         * adapter put there. */
        screenApp?: { label: string; bundleId: string; team: string };
        /** Absolute paths a file tool's permission request touches (Claude's
         * Read, Write, Edit, ...: file_path, notebook_path, or path, which
         * defaults to the working folder), resolved against the turn's
         * working folder. Absent when the tool names no file. */
        paths?: string[];
        choices?: string[];
        /** A provider's structured ask (Claude's AskUserQuestion): the whole
         * set of questions, each with its own options, so the card can offer
         * them instead of an Allow/Deny a person cannot answer. */
        questions?: AskQuestion[];
        /** Where the ask came from: a harness tool call ("tool" — the
         * default, and what every event before this field implied), or a
         * block parsed out of model-authored final output ("output", only in
         * event logs the removed Computer engine wrote). Cards and logs can
         * badge the latter as agent-composed; untrusted-input rules apply
         * either way. */
        origin?: "tool" | "output";
        approvalScope?: "local-computer";
        /** Provider asks to widen its configured sandbox. Only explicit Full
         * access may answer this automatically; Auto/remembered grants may not. */
        requiresExplicitApproval?: boolean;
        /** Raised by Sagax's own MCP approval gate (grok-approval-gate). Only a
         * person's explicit allow runs the call, so no mode (not even Full)
         * may answer it for them: it always shows as a card. */
        sagaxGate?: boolean;
        /** Whether the provider's own automatic reviewer was running when it
         * raised this request. Only providers that can tell set it: Claude
         * reports the effective permission mode in its init frame, and starts
         * in Manual without a word when Auto is unavailable for the model.
         * "inactive" means this ask is not a reviewer's verdict, so the app's
         * own safe-Auto rules may answer it; unset means nobody knows. */
        nativeReview?: "active" | "inactive";
        /** The provider can keep an allow for the rest of its session
         * ("Always allow this session"): Claude through its own suggested
         * permission rules, ACP agents through `allow_always` or the
         * driver's per-session memory. Unset when answers are one-shot. */
        allowSession?: boolean;
        /** A permission ask's full arguments as redacted JSON, for the
         * card's collapsed technical details (summary stays one line). */
        input?: string;
        /** An engine's own connector call (Grok's use_tool to a server Sagax
         * did not mount, server/drivers/acp/connector-ask.ts). */
        engineConnector?: boolean;
        /** The driver read this ask as outward-facing (a send, an engine
         * connector call that is not plainly a read): the outbound guard
         * holds it and no session-wide allow is offered (review of #943). */
        outbound?: boolean;
      }
    | {
        type: "request.resolved";
        behavior: "allow" | "deny" | "answer";
        /** who decided: a person, auto mode, the ask's own timeout, the
         * harness (turn ended / settings changed), or nobody — the answerer
         * was already gone and the action never ran */
        source: "user" | "auto" | "timeout" | "system" | "unavailable" | "peer";
        approvalScope?: "local-computer";
      }
    | {
        type: "thread.token-usage.updated"; input: number; output: number; cachedInput?: number;
        /** What the model's window held on the most recent model call — the
         * whole prompt, cache reads included — and the window's size when the
         * driver knows it. The figure that predicts the next message's cost. */
        contextTokens?: number; contextWindow?: number;
      }
    // `setup: true` marks a failure the user fixes by installing or
    // configuring something, not by retrying — the UI offers setup instead.
    // `terminal: true` records failure of the complete turn, rather than a
    // transient error or a legacy provider's diagnostic during cancellation.
    // `claudeUpdate: true` narrows a setup failure to "this Claude Code is
    // too old for the model": the UI offers to run `claude update` for them.
    | { type: "runtime.error"; message: string; setup?: boolean; terminal?: boolean; claudeUpdate?: boolean;
      /** The engine went silent and the turn was stopped as stuck. */
      stalled?: boolean;
      /** A usage limit refused the turn: epoch ms when it resets, when the
       * engine said (server/limit-failover-host.ts). */
      limitResetsAt?: number }
    /** Something the person should know that did not fail the turn — for
     * example, a saved model the engine no longer offers was replaced. */
    | { type: "runtime.notice"; message: string }
  );

export type RuntimeEventListener = (event: RuntimeEvent) => void;
