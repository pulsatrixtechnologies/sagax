// Lot L2 of docs/design/connectors-across-engines.md: one connector plan per
// turn, with today's rules unchanged. Each case pins the flags the readers
// used to compute on their own (the dispatch, the prompt, the reach line, the
// Connectors record, the capabilities page, the setup card).
import { describe, expect, it } from "vitest";

import type { TurnSpeaker } from "../engines/engine-access.ts";
import type { AccessVia } from "../engines/engine-credentials.ts";
import type { ClaudeAiTurnInput } from "../harness-connectors.ts";
import { connectorPlanAt, connectorPlanFrom, createConnectorPlanForTurn } from "./turn-plan.ts";
import type { ConnectorAccount } from "./types.ts";

const A = "pr_00000000-0000-4000-8000-00000000000a";
const B = "pr_00000000-0000-4000-8000-00000000000b";
const LOCAL = "pr_00000000-0000-4000-8000-000000000001";

function org(driver: string, speaker: TurnSpeaker, more: Partial<ClaudeAiTurnInput> = {}): ClaudeAiTurnInput {
  return {
    identity: "perspicax", restrictedByPolicy: false, driver, instanceId: driver === "claudeAgent" ? "claude" : "grok",
    via: "subscription", payerPrincipalId: A, speaker, ownerPrincipalId: A, localPrincipalId: "", ...more,
  };
}
function solo(driver: string, speaker: TurnSpeaker, more: Partial<ClaudeAiTurnInput> = {}): ClaudeAiTurnInput {
  return { identity: "solo", restrictedByPolicy: false, driver, instanceId: "claude", speaker, ownerPrincipalId: LOCAL, localPrincipalId: LOCAL, ...more };
}
const person = (principalId: string): TurnSpeaker => ({ origin: "person", principalId });
const flags = (plan: ReturnType<typeof connectorPlanFrom>) => ({
  principal: plan.principal, account: plan.account, claudeAi: plan.claudeAi, claudeAiMounted: plan.claudeAiMounted,
  grokCloud: plan.grokCloud, grokCloudOnTurn: plan.grokCloudOnTurn,
});

describe("connectorPlanFrom (today's rules, one place)", () => {
  it("own: a Claude turn on the speaker's own subscription keeps the claude.ai connectors", () => {
    expect(flags(connectorPlanFrom(org("claudeAgent", person(A)), { withholdsHostTools: true }))).toEqual({
      principal: A, account: "own", claudeAi: true, claudeAiMounted: true, grokCloud: false, grokCloudOnTurn: false,
    });
  });

  it("foreign: a turn on someone else's sign-in keeps none, and says whose", () => {
    const plan = connectorPlanFrom(org("claudeAgent", person(A), { payerPrincipalId: B }), { withholdsHostTools: true });
    expect(flags(plan)).toMatchObject({ principal: A, account: "foreign", claudeAi: false, claudeAiMounted: false });
    const grok = connectorPlanFrom(org("grokAgent", person(A), { payerPrincipalId: B, grokAccountConnectors: true }), { withholdsHostTools: true });
    expect(flags(grok)).toMatchObject({ account: "foreign", grokCloud: false, grokCloudOnTurn: false });
  });

  it("key: a turn on a key brings none", () => {
    for (const via of ["owner-key", "speaker-key", "org-key", "server"] satisfies AccessVia[]) {
      expect(flags(connectorPlanFrom(org("claudeAgent", person(A), { via }), { withholdsHostTools: true })), via).toMatchObject({ account: "none", claudeAi: false });
    }
  });

  it("routine: the bot owner's connectors", () => {
    const plan = connectorPlanFrom(org("claudeAgent", { origin: "owner-routine" }), { withholdsHostTools: true });
    expect(flags(plan)).toMatchObject({ principal: A, account: "own", claudeAi: true });
  });

  it("peer: the same person one hop away", () => {
    const plan = connectorPlanFrom(org("claudeAgent", { origin: "peer", fromBotId: "bot-1", principalId: A }), { withholdsHostTools: true });
    expect(flags(plan)).toMatchObject({ principal: A, account: "own", claudeAi: true });
  });

  it("guest: a confined turn still reads the rule, but the driver mounts nothing", () => {
    const plan = connectorPlanFrom(org("claudeAgent", person(A)), { withholdsHostTools: true, guestConfined: true });
    expect(flags(plan)).toMatchObject({ claudeAi: true, claudeAiMounted: false });
    expect(plan.guestConfined).toBe(true);
  });

  it("tool selection: nothing mounted, the driver's flags unchanged", () => {
    const claude = connectorPlanFrom(org("claudeAgent", person(A)), { withholdsHostTools: true, toolSelection: true });
    expect(flags(claude)).toMatchObject({ claudeAi: true, claudeAiMounted: false });
    const grok = connectorPlanFrom(org("grokAgent", person(A), { grokAccountConnectors: true }), { withholdsHostTools: true, toolSelection: true });
    expect(flags(grok)).toMatchObject({ grokCloud: true, grokCloudOnTurn: false });
  });

  it("policy: a managed policy that restricts MCP gives none", () => {
    const plan = connectorPlanFrom(org("claudeAgent", person(A), { restrictedByPolicy: true }), { withholdsHostTools: true });
    expect(flags(plan)).toMatchObject({ account: "none", claudeAi: false, claudeAiMounted: false });
    const grok = connectorPlanFrom(org("grokAgent", person(A), { restrictedByPolicy: true, grokAccountConnectors: true }), { withholdsHostTools: true });
    expect(flags(grok)).toMatchObject({ account: "none", grokCloud: false });
  });

  it("solo: the operator's own sign-in, and nobody else's", () => {
    expect(flags(connectorPlanFrom(solo("claudeAgent", { origin: "operator" })))).toMatchObject({ principal: LOCAL, account: "own", claudeAi: true });
    expect(flags(connectorPlanFrom(solo("claudeAgent", person(B))))).toMatchObject({ principal: B, account: "foreign", claudeAi: false });
    // an unnamed person on a solo server is the operator
    expect(flags(connectorPlanFrom(solo("claudeAgent", { origin: "person" })))).toMatchObject({ principal: LOCAL, account: "own" });
    // solo Grok: the gateway loads without an engine that withholds host tools
    expect(flags(connectorPlanFrom(solo("grokAgent", { origin: "operator" }, { grokAccountConnectors: true })))).toMatchObject({ grokCloud: true, grokCloudOnTurn: true });
  });

  it("organization Grok: the gateway needs the opt-in and an engine that withholds host tools", () => {
    const plain = org("grokAgent", person(A));
    // default settings: nothing on the turn (the hub serves the connectors)
    expect(flags(connectorPlanFrom(plain, { withholdsHostTools: true }))).toMatchObject({ grokCloud: false, grokCloudOnTurn: false });
    // the bot opted in
    const optedIn = connectorPlanFrom({ ...plain, grokAccountConnectors: true }, { withholdsHostTools: true });
    expect(flags(optedIn)).toMatchObject({ grokCloud: true, grokCloudOnTurn: true });
    expect(flags(connectorPlanFrom({ ...plain, grokAccountConnectors: true }, { withholdsHostTools: false }))).toMatchObject({ grokCloud: true, grokCloudOnTurn: false });
    // #3356: the relay exception of #3174 is retired. A run_with_engine
    // part, marked the old way, is a turn like any other: no gateway
    // without the opt-in.
    const part = connectorPlanFrom({ ...plain, engineRelay: true } as ClaudeAiTurnInput, { withholdsHostTools: true, relayPart: true } as never);
    expect(flags(part)).toMatchObject({ grokCloud: false, grokCloudOnTurn: false });
    // the xAI API engine never loads them
    expect(flags(connectorPlanFrom(org("grok", person(A), { grokAccountConnectors: true }), { withholdsHostTools: true }))).toMatchObject({ account: "own", grokCloud: false });
  });

  it("nobody: an unknown person on an organization server has no connectors and no accounts", () => {
    let asked = 0;
    const plan = connectorPlanFrom(org("claudeAgent", { origin: "person" }), { accounts: () => { asked += 1; return []; } });
    expect(flags(plan)).toMatchObject({ principal: "", account: "foreign", claudeAi: false });
    expect(plan.accounts()).toEqual([]);
    expect(asked).toBe(0);
  });
});

describe("connectorPlanForTurn (computed once per turn)", () => {
  type Bot = { id: string; toolScope?: unknown };
  type Instance = { instanceId: string; driverKind: string };
  const claude: Instance = { instanceId: "claude", driverKind: "claudeAgent" };
  const grok: Instance = { instanceId: "grok", driverKind: "grokAgent" };

  function deps(more: { payer?: string; relayThreads?: string[]; accounts?: Record<string, ConnectorAccount[]> } = {}) {
    // the old relay hook (#3174), passed as the server used to: the plan
    // must not read it any more (#3356)
    const oldRelayHook = { isRelayPart: (threadId: string) => (more.relayThreads ?? []).includes(threadId) } as Record<string, unknown>;
    const calls: Array<{ instance: string; via?: AccessVia; slot?: string }> = [];
    const read: string[] = [];
    const planFor = createConnectorPlanForTurn<Bot, Instance>({
      accountConnectorInput: (_bot, instance, speaker, via, slot) => {
        calls.push({ instance: instance.instanceId, ...(via ? { via } : {}), ...(slot ? { slot } : {}) });
        return org(instance.driverKind, speaker, { instanceId: instance.instanceId, via: via ?? "subscription", payerPrincipalId: more.payer ?? A });
      },
      ...oldRelayHook,
      withholdHostToolsFor: () => true,
      accounts: (principal) => { read.push(principal); return more.accounts?.[principal] ?? []; },
    });
    return { planFor, calls, read };
  }

  it("a run_with_engine part gets the same plan as any turn of the bot (#3356)", () => {
    const { planFor } = deps({ relayThreads: ["part-1"] });
    expect(planFor({ id: "b" }, grok, person(A), "thread-1").grokCloud).toBe(false);
    expect(flags(planFor({ id: "b" }, grok, person(A), "part-1"))).toEqual(flags(planFor({ id: "b" }, grok, person(A), "thread-1")));
  });

  it("a room turn: the person the turn answers, in that room", () => {
    const { planFor } = deps();
    const plan = planFor({ id: "b" }, claude, { origin: "person", principalId: A, groupId: "room-1" }, "room-thread");
    expect(flags(plan)).toMatchObject({ principal: A, account: "own", claudeAi: true, claudeAiMounted: true });
  });

  it("the bot's tool selection is the plan's, unless the turn gives its own", () => {
    const { planFor } = deps();
    expect(planFor({ id: "b", toolScope: { servers: [] } }, claude, person(A)).claudeAiMounted).toBe(false);
    expect(planFor({ id: "b" }, claude, person(A), undefined, undefined, { guestConfined: true }).claudeAiMounted).toBe(false);
    expect(planFor({ id: "b" }, claude, person(A)).claudeAiMounted).toBe(true);
  });

  it("second account: the slot reaches the account facts", () => {
    const { planFor, calls } = deps();
    planFor({ id: "b" }, grok, person(A), undefined, undefined, { slot: "second" });
    expect(calls.at(-1)).toEqual({ instance: "grok", slot: "second" });
  });

  it("dispatch: the setup plan itself for the same access, the rule again for another", () => {
    const { planFor, calls } = deps();
    const plan = planFor({ id: "b" }, claude, person(A), "thread-1");
    expect(calls).toHaveLength(1);
    expect(connectorPlanAt(plan, undefined)).toBe(plan);
    expect(connectorPlanAt(plan, "subscription")).toBe(plan);
    expect(calls).toHaveLength(1);
    const onKey = connectorPlanAt(plan, "owner-key");
    expect(calls).toHaveLength(2);
    expect(flags(onKey)).toMatchObject({ account: "none", claudeAi: false });
  });

  it("the person's own sign-ins, read once and only when asked, never another person's", () => {
    const own: ConnectorAccount = { key: "grok-com:grok:primary", provider: "grok-com", driver: "grokAgent", instanceId: "grok", slot: "primary", label: "Grok", auth: "subscription", connectors: [{ name: "Outlook", state: "connected", tools: [] }], at: 1 };
    const other: ConnectorAccount = { ...own, label: "Grok (other)" };
    const { planFor, read } = deps({ accounts: { [A]: [own], [B]: [other] } });
    const plan = planFor({ id: "b" }, grok, person(A), "thread-1");
    expect(read).toEqual([]);
    expect(plan.accounts()).toEqual([own]);
    expect(plan.accounts()).toEqual([own]);
    expect(read).toEqual([A]);
    // a turn paid by someone else still lists only the speaker's own
    const paidByB = deps({ payer: B, accounts: { [A]: [own], [B]: [other] } }).planFor({ id: "b" }, grok, person(A));
    expect(paidByB.account).toBe("foreign");
    expect(paidByB.accounts()).toEqual([own]);
  });
});
