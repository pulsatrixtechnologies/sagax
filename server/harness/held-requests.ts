// #3346 (connectors across engines, L3): a permission request the server
// holds itself, outside any engine. A connector call that Sagax runs for a
// turn (not the engine) still needs the person's approval settings to decide
// it, the same way on every engine: so the server opens a request.opened of
// its own, and the existing pipeline (server/runtime-events/request-opened.ts)
// decides it exactly as it decides an engine's ask: owner rules, org Refuse
// and Ask-first rules, the bot's level, connector reads, cards with Always
// allow. The answer comes back through the engine instance's
// respondToRequest, which EventBus.attach wraps so a held id lands here.
//
// The request is the turn's: when the turn ends, every request still open is
// declined (source "timeout", so its card reads Expired), and a held id this
// process does not know (an answer after a restart) is "unavailable".
import { newId, type RequestOutcome, type RuntimeEvent } from "../contracts.ts";

/** Every held request id starts with this, so the respond wrapper can tell
 * a held id from an engine's own without a lookup. */
export const HELD_REQUEST_PREFIX = "held-";

export function isHeldRequestId(requestId: string): boolean {
  return requestId.startsWith(HELD_REQUEST_PREFIX);
}

export const HELD_REQUEST_EXPIRED = "Nobody answered this approval before the turn ended, so it was declined.";

export interface HeldRequestInput {
  threadId: string;
  /** The turn the call belongs to: its end retires the request. */
  turnId?: string;
  /** The engine instance running that turn. Its respondToRequest is where
   * answers arrive (answerRequest, auto mode, the org rules). */
  providerInstanceId: string;
  /** That instance's driver kind (the event's provider). */
  provider: string;
  /** The connector tool, as the person's rules name it (server__tool). */
  mcpTool: string;
  /** One line for the card. Defaults to the tool name. */
  summary?: string;
  /** The call's arguments as redacted JSON, for the card's details. */
  input?: string;
  /** The call reaches outside (a send, a write): never passes as a read. */
  outbound?: boolean;
  /** #4081 (the sandbox bridge): decided exactly as the engine's own ask of
   * this tool, never as a connector call: the event names the tool as the
   * engine does and carries no connector facts and no `outbound`, so the
   * pipeline reads it with the rules of that tool (a Perspicax call: the
   * reviewed reads, never at Ask). A request identical to one still open on
   * the same turn (tool and input) waits on that one's card: a burst of the
   * same call raises one card. */
  asEngine?: boolean;
}

export interface HeldDecision {
  behavior: "allow" | "deny";
  message?: string;
}

interface Pending {
  threadId: string;
  turnId?: string;
  provider: string;
  providerInstanceId: string;
  resolve: (decision: HeldDecision) => void;
  decision: Promise<HeldDecision>;
  /** An `asEngine` request's identity, for the burst of identical calls. */
  sameKey?: string;
}

export class HeldRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly same = new Map<string, string>();

  /** `publish` is the bus's publish (the same path an engine's events take
   * after EventBus.attach), read at call time. */
  private readonly publish: (event: RuntimeEvent) => void;

  constructor(publish: (event: RuntimeEvent) => void) {
    this.publish = publish;
  }

  /** Open a held request. Resolves once it is decided: by the pipeline (a
   * rule, the level, a connector read), by a person on the card, or by the
   * turn's end (deny). */
  open(input: HeldRequestInput): { requestId: string; decision: Promise<HeldDecision> } {
    const sameKey = input.asEngine
      ? [input.threadId, input.turnId ?? "", input.providerInstanceId, input.mcpTool, input.input ?? ""].join("\u0000")
      : undefined;
    const open = sameKey ? this.same.get(sameKey) : undefined;
    const waiting = open ? this.pending.get(open) : undefined;
    if (open && waiting) return { requestId: open, decision: waiting.decision };
    const requestId = `${HELD_REQUEST_PREFIX}${newId()}`;
    let resolve!: (decision: HeldDecision) => void;
    const decision = new Promise<HeldDecision>((r) => { resolve = r; });
    this.pending.set(requestId, {
      threadId: input.threadId,
      turnId: input.turnId,
      provider: input.provider,
      providerInstanceId: input.providerInstanceId,
      resolve,
      decision,
      ...(sameKey ? { sameKey } : {}),
    });
    if (sameKey) this.same.set(sameKey, requestId);
    this.publish({
      eventId: newId(),
      provider: input.provider,
      providerInstanceId: input.providerInstanceId,
      threadId: input.threadId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      createdAt: new Date().toISOString(),
      type: "request.opened",
      requestId,
      // full-access: connector-held
      requestType: "permission",
      tool: input.asEngine ? input.mcpTool : "other",
      mcpTool: input.mcpTool,
      summary: input.summary ?? input.mcpTool,
      ...(input.input !== undefined ? { input: input.input } : {}),
      // A connector the server reaches with the turn's own principal: the
      // facts the pipeline reads for a connector call (a read passes, a
      // send asks), and connectorHub, which only the server may set. An
      // engine's own tool carries none of them (asEngine).
      ...(input.asEngine ? {} : {
        engineConnector: true,
        accountConnector: true,
        connectorHub: true,
        ...(input.outbound ? { outbound: true } : {}),
      }),
    } as RuntimeEvent);
    return { requestId, decision };
  }

  /** The respond wrapper's answer for a held id: undefined when the id is
   * not held (the engine answers it), "unavailable" when it is held by
   * nobody here (a restart, or already settled). */
  respond(
    threadId: string,
    requestId: string,
    decision: { behavior: "allow" | "deny" | "answer"; message?: string },
  ): RequestOutcome | undefined {
    if (!isHeldRequestId(requestId)) return undefined;
    const held = this.pending.get(requestId);
    if (!held || held.threadId !== threadId) return "unavailable";
    const behavior = decision.behavior === "allow" ? "allow" : "deny";
    this.settle(requestId, held, { behavior, ...(decision.message ? { message: decision.message } : {}) }, "user");
    return behavior === "allow" ? "allowed-once" : "rejected";
  }

  /** The turn ended: every request it still holds is declined, and its card
   * reads Expired. A turnId limits it to that turn's requests. */
  retireTurn(threadId: string, turnId?: string): void {
    for (const [requestId, held] of Array.from(this.pending)) {
      if (held.threadId !== threadId) continue;
      if (turnId && held.turnId && held.turnId !== turnId) continue;
      this.settle(requestId, held, { behavior: "deny", message: HELD_REQUEST_EXPIRED }, "timeout");
    }
  }

  /** Nobody answered one request in time (call_connector waits nine
   * minutes, like a safety hold): it is declined and its card reads Expired.
   * False when it was already settled. */
  expire(requestId: string, message: string): boolean {
    const held = this.pending.get(requestId);
    if (!held) return false;
    this.settle(requestId, held, { behavior: "deny", message }, "timeout");
    return true;
  }

  /** Requests still open on a thread (for tests and diagnostics). */
  openCount(threadId?: string): number {
    if (!threadId) return this.pending.size;
    let n = 0;
    for (const held of this.pending.values()) if (held.threadId === threadId) n++;
    return n;
  }

  private settle(requestId: string, held: Pending, decision: HeldDecision, source: "user" | "timeout"): void {
    this.pending.delete(requestId);
    if (held.sameKey && this.same.get(held.sameKey) === requestId) this.same.delete(held.sameKey);
    held.resolve(decision);
    this.publish({
      eventId: newId(),
      provider: held.provider,
      providerInstanceId: held.providerInstanceId,
      threadId: held.threadId,
      ...(held.turnId ? { turnId: held.turnId } : {}),
      createdAt: new Date().toISOString(),
      type: "request.resolved",
      requestId,
      behavior: decision.behavior,
      source,
    } as RuntimeEvent);
  }
}
