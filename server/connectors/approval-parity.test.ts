// #3349 (connectors across engines L6): the same connector act gets the
// same decision whichever way it reaches Sagax. A person's read and send of
// their own connector, entered as a native Claude ask (`mcp__claude_ai_*`), a
// native Grok ask (use_tool to the account's gateway) and a hub call
// (call_connector), run through the bus and the layers that decide a
// permission: the Ask / Auto / Full verdict (autoVerdict, with the
// connector-read facts request-opened.ts reads) and the person's own rules
// (ownerDecision), with an Always allow rule and with a Refuse rule saved on
// that act's card. Each entry must give one verdict and one rule key.
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EVENTS_DIR, ensureDirs } from "../config.ts";
import type { RuntimeEvent } from "../contracts.ts";
import { autoVerdict } from "../approvals/auto-approve.ts";
import { ownerModeForLevel } from "../approvals/owner-autonomy.ts";
import { destructiveKindOf, normalizeRuleTool, ownerDecision, type OwnerRule, type RuleCall } from "../approvals/owner-approval.ts";
import { connectorAsk } from "../drivers/acp/connector-ask.ts";
import { EventBus } from "../harness/bus.ts";
import { HeldRequests } from "../harness/held-requests.ts";
import { askInputDetail } from "../tools/tool-summary.ts";
import { makeFakeDriver } from "../testing/fake-driver.ts";
import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { createConnectorHub } from "./hub.ts";
import { claudeAiConnectorsOwn, dispatchedConnectorPlan, type ConnectorTurnPlan } from "./turn-plan.ts";
import type { ConnectorEntry, ConnectorProvider } from "./types.ts";

type Opened = Extract<RuntimeEvent, { type: "request.opened" }>;

const THREAD = "thread-parity";
const ARGS = { query: "invoice", to: "client@example.com", subject: "Invoice" };

/** One act: what each provider names it. */
interface Act {
  label: string;
  claudeTool: string;
  grokTool: string;
}
const ACTS: Act[] = [
  { label: "read", claudeTool: "outlook_email_search", grokTool: "outlook__search_messages" },
  { label: "send", claudeTool: "outlook_send_mail", grokTool: "outlook__send_message" },
];

const CLAUDE_ENTRY: ConnectorEntry = { name: "Microsoft 365", state: "connected", tools: [] };
const GROK_ENTRY = (tool: string): ConnectorEntry => ({ id: "outlook", name: "Outlook", state: "connected", tools: [{ id: tool }] as ConnectorEntry["tools"] });

async function instanceOf(kind: string) {
  const fake = makeFakeDriver({ kind });
  await fake.driver.create({ instanceId: `${kind}-1`, displayName: undefined, environment: {}, enabled: true, config: {} });
  return fake.created.get(`${kind}-1`)!;
}

function base(provider: string, requestId: string) {
  return { eventId: `ev-${requestId}`, provider, threadId: THREAD, turnId: "turn-1", createdAt: new Date().toISOString(), type: "request.opened" as const, requestId, requestType: "permission" as const };
}

/** The three entries of one act, as the bus publishes them. */
async function entries(act: Act): Promise<Record<string, { event: Opened; provider: ConnectorProvider }>> {
  const bus = new EventBus();
  bus.setConnectorPlanLookup(claudeAiConnectorsOwn);
  const claude = await instanceOf("claudeAgent");
  const grok = await instanceOf("grok");
  bus.attach([claude.instance, grok.instance]);
  const seen: Opened[] = [];
  bus.subscribe((event) => { if (event.type === "request.opened") seen.push(event); });
  const hub = createConnectorHub([]);
  const held = new HeldRequests((event) => bus.publish(event));

  // Claude Code's permission ask (drivers/claude/turn-spawn.ts): the tool's
  // own name and its arguments, nothing else
  claude.emit({ ...base("claudeAgent", "claude-native"), tool: `mcp__claude_ai_Microsoft_365__${act.claudeTool}`, summary: act.claudeTool, input: askInputDetail(ARGS) } as RuntimeEvent);
  // Grok's use_tool ask (drivers/acp/session-permission.ts)
  const ask = connectorAsk({ kind: "other", title: "use_tool", rawInput: { variant: "UseTool", tool_name: act.grokTool, tool_input: ARGS } }, new Set());
  grok.emit({
    ...base("grok", "grok-native"), tool: "other", mcpTool: ask.target, summary: "use_tool", input: ask.input,
    engineConnector: ask.engineConnector, accountConnector: true, ...(ask.outward ? { outbound: true } : {}),
  } as RuntimeEvent);
  // call_connector through the hub (routes/internal-connectors.ts)
  const hubHold = (provider: ConnectorProvider, entry: ConnectorEntry, tool: string, kind: string) => {
    const mcpTool = hub.ruleTool(provider, entry, tool);
    held.open({ threadId: THREAD, turnId: "turn-1", provider: kind, providerInstanceId: `${kind}-1`, mcpTool, summary: `${entry.name}: ${tool} (Account)`, input: JSON.stringify(ARGS), outbound: hub.outbound(mcpTool) });
  };
  hubHold("claude-ai", CLAUDE_ENTRY, act.claudeTool, "claudeAgent");
  hubHold("grok-com", GROK_ENTRY(act.grokTool), act.grokTool, "grok");
  await bus.flush();
  const at = (i: number) => seen[i]!;
  return {
    "native Claude": { event: at(0), provider: "claude-ai" },
    "native Grok": { event: at(1), provider: "grok-com" },
    "hub call (Claude account)": { event: at(2), provider: "claude-ai" },
    "hub call (Grok account)": { event: at(3), provider: "grok-com" },
  };
}

type Rule = "none" | "allow" | "deny";

/** A rule as the card saves it: the call's tool, and its destructive kind
 * when the card was one (a send to someone else). */
function rule(call: RuleCall, behavior: "allow" | "deny"): OwnerRule {
  const destructive = destructiveKindOf(call);
  return { id: `rule-${behavior}`, ownerId: "owner-1", botId: null, tool: normalizeRuleTool(call.tool), scope: {}, ...(destructive ? { destructive } : {}), behavior, description: "saved from the card", createdAt: 0, updatedAt: 0 } as OwnerRule;
}

/** What request-opened.ts decides for this event, on the person's own turn. */
function decide(event: Opened, mode: ApprovalMode, saved: Rule) {
  const ruleKey = event.mcpTool ?? event.tool;
  const connectorRead = event.accountConnector === true && event.engineConnector === true && event.outbound !== true;
  const verdict = autoVerdict(mode, event.tool, {
    connectorRead,
    ...(event.outbound === true ? { outbound: true } : {}),
    ...(event.mcpTool ? { toolName: event.mcpTool } : {}),
    ownerTurn: true,
    personAskedMail: true,
  });
  const call: RuleCall = { ownerId: "owner-1", botId: "bot-1", tool: ruleKey, ...(typeof event.input === "string" ? { input: event.input } : {}) };
  const owner = ownerDecision({ mode: ownerModeForLevel(mode), rules: saved === "none" ? [] : [rule(call, saved)], call });
  return { auto: verdict.approve === null ? "card" : verdict.source, owner: owner.kind === "card" ? `card:${owner.reason}` : owner.kind };
}

const OWN_PLAN = { principal: "owner-1", claudeAi: true } as unknown as ConnectorTurnPlan;

describe("one connector act, one decision on every engine (#3349)", () => {
  beforeEach(() => {
    rmSync(EVENTS_DIR, { recursive: true, force: true });
    ensureDirs();
    dispatchedConnectorPlan(THREAD, OWN_PLAN, "subscription");
  });
  afterEach(() => {
    dispatchedConnectorPlan(THREAD, { ...OWN_PLAN, claudeAi: false } as unknown as ConnectorTurnPlan, "subscription");
  });

  describe.each(ACTS)("the person's own $label", (act) => {
    it("gives a native call and a hub call of one provider the same rule key", async () => {
      const all = await entries(act);
      const key = (name: string) => normalizeRuleTool(all[name]!.event.mcpTool ?? all[name]!.event.tool);
      expect(key("native Claude")).toBe(key("hub call (Claude account)"));
      expect(key("native Claude")).toBe(`claude_ai_microsoft_365__${act.claudeTool}`);
      expect(key("native Grok")).toBe(key("hub call (Grok account)"));
    });

    it.each([
      ["ask", "none"], ["auto", "none"], ["full", "none"],
      ["ask", "allow"], ["auto", "allow"], ["full", "allow"],
      ["ask", "deny"], ["auto", "deny"], ["full", "deny"],
    ] as Array<[ApprovalMode, Rule]>)("at %s with rule %s, every entry gets the same verdict", async (mode, saved) => {
      const all = await entries(act);
      const decisions = Object.fromEntries(Object.entries(all).map(([name, { event }]) => {
        const { auto, owner } = decide(event, mode, saved);
        return [name, { auto, owner }];
      }));
      const first = decisions["hub call (Claude account)"];
      for (const decision of Object.values(decisions)) expect(decision).toEqual(first);
      // a read passes at every level; a send keeps its card unless a rule says otherwise
      if (act.label === "read") expect(first!.auto).not.toBe("card");
      if (saved === "deny") expect(first!.owner).toBe("deny");
      if (saved === "allow") expect(first!.owner).toBe("allow");
    });
  });

  it("leaves a native claude.ai ask as it came on a turn whose plan did not mount the person's own connectors", async () => {
    dispatchedConnectorPlan(THREAD, { ...OWN_PLAN, claudeAi: false } as unknown as ConnectorTurnPlan, "subscription");
    const all = await entries(ACTS[0]!);
    const native = all["native Claude"]!.event;
    expect(native.mcpTool).toBeUndefined();
    expect(native.engineConnector).toBeUndefined();
    expect(native.accountConnector).toBeUndefined();
  });
});
