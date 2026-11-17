// #4410: a person's own Claude account runs Claude models under pi (their
// short access token, one turn). The vendor can REFUSE that account for pi
// (not only an expired sign-in): the owner's decision of 2026-11-15 is that
// the person is then served in the other engine, the Claude engine on the
// very same sign-in, with no notice. This is the driver half: it holds a
// turn's first events, and when pi's first and only word is the vendor's
// refusal of the account it drops them and rejects the turn as not started
// (a TurnNotStartedError, so nothing ran, nothing was paid), naming the
// engine to land on in the harness (server/turns/claude-landing.ts).
// Anything else, a refusal after the model answered included, passes
// through untouched.
import { TurnNotStartedError, type RuntimeEvent, type SendTurnInput } from "../contracts.ts";
import { PI_CLAUDE_SIGN_IN_ENV } from "../engines/engine-credentials.ts";

/** pi could not run the person's Claude account: the vendor refused it. */
export class PiClaudeAccountRefusedError extends TurnNotStartedError {
  override readonly name = "PiClaudeAccountRefusedError";
}

/** The vendor's refusals of a Claude account used outside its own tool, as
 * they reach pi: the account is not allowed for this client, or the token
 * is not accepted for this call. A rate limit, a quota, an overload or a
 * network failure is not one: those are the engine's own words. */
const REFUSAL = /\b(?:oauth authentication is currently not supported|(?:credential|token|account)[^.\n]{0,60}(?:only (?:authori[sz]ed|valid|allowed)[^.\n]{0,30}claude code|not (?:authori[sz]ed|allowed|permitted)[^.\n]{0,40}(?:this|third[- ]party) (?:client|application|app))|third[- ]party (?:applications?|apps?|clients?)[^.\n]{0,60}(?:not (?:allowed|permitted|supported)|extra usage)|invalid (?:bearer token|x-api-key)|authentication_error|(?:401|403)[^.\n]{0,40}(?:permission_error|authentication_error|forbidden|unauthori[sz]ed))/i;

export function isClaudeAccountRefusal(text: string | undefined): boolean {
  return typeof text === "string" && REFUSAL.test(text);
}

/** Whether this turn runs on the person's Claude account under pi. */
export function turnUsesClaudeAccount(turn: Pick<SendTurnInput, "access">): boolean {
  return Boolean(turn.access?.environment?.[PI_CLAUDE_SIGN_IN_ENV]);
}

// events that are not the model speaking or a tool running
const PASSIVE = new Set(["turn.started", "session.started", "runtime.notice", "thread.token-usage.updated", "turn.retrying"]);

/** Wraps a turn's emit. `outcome` settles when the turn's first word is
 * known: it resolves when the turn went on, and rejects with
 * PiClaudeAccountRefusedError when the vendor refused the account (what was
 * held is dropped: nothing of it shows in the chat). */
export function holdClaudeAccountRefusal(emit: (event: RuntimeEvent) => void, waitMs = 120_000): {
  emit: (event: RuntimeEvent) => void;
  outcome: Promise<void>;
} {
  let state: "holding" | "refused" | "open" = "holding";
  let held: RuntimeEvent[] = [];
  let refusal = "";
  let settle!: (error?: Error) => void;
  const outcome = new Promise<void>((resolve, reject) => { settle = (error) => (error ? reject(error) : resolve()); });
  // a turn that stays silent this long is not waited on any more
  const timer = setTimeout(() => { if (state === "holding") open(); }, waitMs);
  timer.unref?.();
  const open = () => {
    if (state === "open") return;
    clearTimeout(timer);
    state = "open";
    for (const event of held) emit(event);
    held = [];
    settle();
  };
  return {
    outcome,
    emit(event) {
      if (state === "open") return emit(event);
      if (state === "refused") {
        if (event.type === "turn.completed" && !event.ok) {
          const turnId = typeof event.turnId === "string" ? event.turnId : "";
          held = [];
          clearTimeout(timer);
          settle(new PiClaudeAccountRefusedError(turnId, refusal));
          return;
        }
        return;
      }
      if (event.type === "runtime.error" && isClaudeAccountRefusal(event.message)) {
        state = "refused";
        refusal = String(event.message).slice(0, 500);
        held = [];
        return;
      }
      if (event.type === "turn.completed") {
        // finished with no refusal: let everything through
        held.push(event);
        return open();
      }
      if (PASSIVE.has(event.type)) {
        held.push(event);
        return;
      }
      held.push(event);
      open();
    },
  };
}
