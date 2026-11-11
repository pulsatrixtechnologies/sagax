// #3508: the request the server holds for a connector call (#3376) is a card
// the person may have to answer, so it sits under the one Full access
// decision (server/approvals/full-access-gate.ts, surface "connector-held").
// The request travels as a request.opened, and request.opened decides it with
// the facts it carries (a read passes, a send asks) through autoVerdict, which
// reads fullAccessDecision first. At Full nothing is asked; below Full a send
// keeps its card; the holds the gate names still stand at Full.
import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { autoVerdict } from "../approvals/auto-approve.ts";
import { fullAccessDecision, FULL_ACCESS_SURFACES } from "../approvals/full-access-gate.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { HeldRequests } from "./held-requests.ts";

type Opened = Extract<RuntimeEvent, { type: "request.opened" }>;

function heldEvent(outbound: boolean): Opened {
  const seen: RuntimeEvent[] = [];
  const held = new HeldRequests((event) => seen.push(event));
  held.open({
    threadId: "thread-held", turnId: "turn-1", provider: "claudeAgent", providerInstanceId: "claude-1",
    mcpTool: outbound ? "crm__send_email" : "crm__list_messages",
    summary: outbound ? "crm: send_email" : "crm: list_messages",
    input: JSON.stringify({ to: "someone@example.com" }),
    outbound,
  });
  const opened = seen.find((event): event is Opened => event.type === "request.opened");
  if (!opened) throw new Error("no request.opened published");
  return opened;
}

/** What request.opened (server/runtime-events/request-opened.ts) decides for
 * this event at a level, with the facts it reads off the event. */
function decide(event: Opened, level: ApprovalMode, extra: { customRule?: { behavior: "ask"; id: string } } = {}) {
  const connectorRead = event.accountConnector === true && event.engineConnector === true && event.outbound !== true;
  return autoVerdict(level, event.tool, {
    connectorRead,
    ...(event.outbound === true ? { outbound: true } : {}),
    ...(event.mcpTool ? { toolName: event.mcpTool } : {}),
    // the person's own turn, as approval-parity.test.ts reads it
    ownerTurn: true,
    personAskedMail: true,
    ...extra,
  });
}

describe("#3508: a connector request the server holds is answered by the person's level", () => {
  it("is a registered Full access surface", () => {
    expect(FULL_ACCESS_SURFACES["connector-held"]).toMatch(/held-requests\.ts/);
  });

  it("at Full access a held send is approved by the level, with no card", () => {
    const event = heldEvent(true);
    expect(event.requestType).toBe("permission");
    expect(event.outbound).toBe(true);
    const verdict = decide(event, "full");
    expect(verdict.approve).not.toBeNull();
    expect(verdict.source).toBe("full-access");
  });

  it.each(["ask", "auto"] as ApprovalMode[])("below Full (%s) the same held send keeps its card", (level) => {
    const verdict = decide(heldEvent(true), level);
    // no grant answers it: the card comes, with its Always allow
    expect(verdict.approve).toBeNull();
    expect(verdict.source).not.toBe("full-access");
  });

  it.each(["ask", "auto", "full"] as ApprovalMode[])("a held read passes at %s, as the connector facts say", (level) => {
    expect(decide(heldEvent(false), level).approve).not.toBeNull();
  });

  it("the gate's holds still stand at Full: an Ask first rule keeps the card", () => {
    expect(fullAccessDecision("full", { orgRule: "ask" })).toMatchObject({ acts: false, hold: "org-rule" });
    expect(fullAccessDecision("full", { personRule: "deny" })).toMatchObject({ acts: false, hold: "person-rule" });
    expect(decide(heldEvent(true), "full", { customRule: { behavior: "ask", id: "rule-ask" } }).approve).toBeNull();
  });
});
