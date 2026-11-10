// #3351 (connectors across engines L8): the one connector list in the prompt.
// The same text for the same person on every engine and turn kind, read from
// the turn's plan and the registry through the prompt leaf every turn uses
// (server/index-leaves/engineConnectorsPromptFor.ts).
import { describe, expect, it } from "vitest";

import type { TurnSpeaker } from "../engines/engine-access.ts";
import type { ClaudeAiTurnInput } from "../harness-connectors.ts";
import { createEngineConnectorsPromptFor } from "../index-leaves/engineConnectorsPromptFor.ts";
import { connectorListPrompt, nativeConnectorMounts } from "./list-prompt.ts";
import { connectorPlanFrom, dispatchedConnectorPlan, grokGatewayOnTurn } from "./turn-plan.ts";
import { connectorAccountKey, type ConnectorAccount, type ConnectorAccountRef, type ConnectorProvider } from "./types.ts";

const A = "pr_00000000-0000-4000-8000-00000000000a";
const B = "pr_00000000-0000-4000-8000-00000000000b";
const DEFAULT_ACCOUNT = "default";

function account(ref: ConnectorAccountRef, label: string, connectors: ConnectorAccount["connectors"]): ConnectorAccount {
  return { ...ref, key: connectorAccountKey(ref), label, auth: "subscription", connectors, at: 1 };
}

/** Person A's own sign-ins: a Grok account (callable through the hub) and a
 * Claude account (no host yet: L9). Person B has a connector of their own. */
const REGISTRY: Record<string, ConnectorAccount[]> = {
  [A]: [
    account({ provider: "grok-com", driver: "grokAgent", instanceId: DEFAULT_ACCOUNT, slot: "primary" }, "Grok", [
      { id: "outlook", name: "Outlook (Exchange)", state: "connected", tools: [{ id: "outlook__send_mail" }] },
      { id: "microsoft-teams", name: "Microsoft Teams", state: "needs-sign-in", tools: [] },
    ]),
    account({ provider: "claude-ai", driver: "claudeAgent", instanceId: DEFAULT_ACCOUNT, slot: "primary" }, "Claude", [
      { name: "Example Docs", state: "connected", tools: [] },
    ]),
  ],
  [B]: [
    account({ provider: "grok-com", driver: "grokAgent", instanceId: DEFAULT_ACCOUNT, slot: "primary" }, "Grok", [
      { name: "Other Person Drive", state: "connected", tools: [] },
    ]),
  ],
};

const CALLABLE = new Set<ConnectorProvider>(["grok-com"]);

function input(driver: string, speaker: TurnSpeaker, more: Partial<ClaudeAiTurnInput> = {}): ClaudeAiTurnInput {
  return {
    identity: "perspicax", restrictedByPolicy: false, driver, instanceId: driver,
    // a turn on a key: no engine mounts an account connector natively
    via: "org-key", speaker, ownerPrincipalId: B, localPrincipalId: "", ...more,
  };
}

function leaf(registry: Record<string, ConnectorAccount[]> = REGISTRY) {
  const host = {
    connectorRegistry: { accountInstanceOf: () => DEFAULT_ACCOUNT },
    connectorHub: { callable: (provider: ConnectorProvider) => CALLABLE.has(provider) },
    turnSlotFor: () => "primary",
    claudeAiConnectorRows: () => [],
  };
  const promptFor = createEngineConnectorsPromptFor(() => host);
  return (driver: string, speaker: TurnSpeaker, turn: { relay?: boolean; level?: string; toolScope?: unknown; agents?: boolean; more?: Partial<ClaudeAiTurnInput>; toolSelection?: boolean; guestConfined?: boolean } = {}): string => {
    const plan = connectorPlanFrom(input(driver, speaker, turn.more), {
      withholdsHostTools: true,
      toolSelection: turn.toolSelection ?? turn.toolScope !== undefined,
      guestConfined: turn.guestConfined === true,
      accounts: (principal) => registry[principal] ?? [],
    });
    return promptFor({ id: "bot-1" }, { instanceId: driver, driverKind: driver }, speaker, {
      plan,
      ...(turn.relay ? { relay: true } : {}),
      ...(turn.level ? { level: turn.level } : {}),
      ...(turn.toolScope !== undefined ? { toolScope: turn.toolScope } : {}),
      ...(turn.agents !== undefined ? { agents: turn.agents } : {}),
    });
  };
}

const ENGINES = ["claudeAgent", "grokAgent", "codex", "pi", "openai-chat"];
const direct: TurnSpeaker = { origin: "person", principalId: A };
const room: TurnSpeaker = { origin: "person", principalId: A, groupId: "group-1" } as TurnSpeaker;
const peer: TurnSpeaker = { origin: "peer", fromBotId: "bot-2", principalId: A };

describe("the one connector list (#3351)", () => {
  it("the same text for the same person on Claude, Grok, Codex, pi and a chat engine, in a direct turn, a room and a peer hop", () => {
    const promptFor = leaf();
    const texts = new Set<string>();
    for (const driver of ENGINES) {
      for (const speaker of [direct, room, peer]) texts.add(promptFor(driver, speaker));
    }
    expect(texts.size).toBe(1);
    const [text] = [...texts];
    expect(text).toContain("- Outlook (Exchange) (Grok): connected. Use call_connector with connector \"Outlook (Exchange)\".");
    expect(text).toContain("call_connector (agents__call_connector) takes connector");
  });

  it("the person's own connectors only, never another person's", () => {
    const text = leaf()("codex", direct);
    expect(text).not.toContain("Other Person Drive");
    expect(leaf()("codex", { origin: "person", principalId: B })).not.toContain("Outlook (Exchange)");
  });

  it("a connector this turn also mounts natively names its direct tools", () => {
    // Claude on the person's own subscription: claude.ai connectors mounted
    const text = leaf()("claudeAgent", direct, { more: { via: "subscription", payerPrincipalId: A } });
    expect(text).toContain("- Example Docs (Claude): connected. Use its direct tools mcp__claude_ai_Example_Docs__*.");
    // Grok on the person's own sign-in with the gateway on: both ways
    const grok = leaf()("grokAgent", direct, { more: { via: "subscription", payerPrincipalId: A, grokAccountConnectors: true } });
    expect(grok).toContain("- Outlook (Exchange) (Grok): connected. Use its direct tools through use_tool (search_tool finds them), or call_connector with connector \"Outlook (Exchange)\".");
    // on any other engine the same connector is not direct
    expect(leaf()("codex", direct)).not.toContain("mcp__claude_ai_");
  });

  it("needs a sign-in: names open_connector_setup", () => {
    const text = leaf()("pi", direct);
    expect(text).toContain("- Microsoft Teams (Grok): needs a new sign-in. Call open_connector_setup (agents__open_connector_setup) for it.");
  });

  it("a provider with no host yet is not offered as callable; a direct turn with run_with_engine is pointed at its account", () => {
    expect(leaf()("codex", room)).toContain("- Example Docs (Claude): connected. Not callable from this turn yet.");
    expect(leaf()("codex", direct, { relay: true })).toContain("- Example Docs (Claude): connected. Not callable from this turn yet: call run_with_engine with engine \"Claude\" and the complete request.");
  });

  it("keeps the outward rule and the /me rule, at Ask and at Full", () => {
    const ask = leaf()("grokAgent", direct);
    expect(ask).toContain("wait for the person's approval card");
    expect(ask).toContain("never ask for a typed GO");
    expect(ask).toContain("omit userId and user_id");
    expect(ask).toContain("bot inbound address");
    const full = leaf()("grokAgent", direct, { level: "full" });
    expect(full).toContain("Full access");
    expect(full).toMatch(/no confirmation and no typed GO/);
    expect(full).not.toMatch(/wait for the person's approval card/);
  });

  it("a tool selection without call_connector: the list names no call it cannot make", () => {
    const text = leaf()("codex", direct, { toolScope: { deny: ["mcp:agents:call_connector"] } });
    expect(text).not.toContain("call_connector");
    expect(text).toContain("- Outlook (Exchange) (Grok): connected. Not callable from this turn yet.");
  });

  it("a turn on someone else's sign-in: their account's connectors are not used, the person's own are listed", () => {
    const text = leaf()("claudeAgent", direct, { more: { via: "subscription", payerPrincipalId: B } });
    expect(text).toContain("belong to someone else");
    expect(text).not.toContain("mcp__claude_ai_");
    expect(text).toContain("Outlook (Exchange) (Grok)");
  });

  it("a guest's confined turn and a turn for nobody list nothing", () => {
    for (const text of [leaf()("codex", direct, { guestConfined: true }), leaf()("codex", { origin: "person", principalId: "" })]) {
      expect(text).toContain("No person's connectors serve this turn");
      expect(text).not.toContain("Outlook");
    }
  });

  it("no connector yet: says so, and how to add one", () => {
    const text = leaf({ [A]: [] })("codex", direct);
    expect(text).toContain("no connector on any account of theirs");
    expect(text).toContain("open_connector_setup");
  });

  it("an account not read yet is never told as having no connector (cold registry, first turn after a sign-in)", () => {
    const cold = (provider: ConnectorProvider, driver: ConnectorAccount["driver"], label: string): ConnectorAccount => ({
      provider, driver, instanceId: DEFAULT_ACCOUNT, slot: "primary",
      key: connectorAccountKey({ provider, instanceId: DEFAULT_ACCOUNT, slot: "primary" }),
      label, auth: "unknown", connectors: [], at: 0,
    });
    const claude = cold("claude-ai", "claudeAgent", "Claude");
    const grok = cold("grok-com", "grokAgent", "Grok");
    // Claude on the person's own subscription mounts claude.ai natively
    const native = nativeConnectorMounts({ claudeAiMounted: true, grokCloudOnTurn: false, input: { instanceId: "claudeAgent" } }, { accountInstance: () => DEFAULT_ACCOUNT });
    const text = connectorListPrompt({ principal: A, accounts: [claude], native, callable: () => false, callTool: true });
    expect(text).not.toContain("no connector on any account");
    expect(text).toContain("- Claude: connectors not read yet. Use its direct tools mcp__claude_ai_*.");
    // the Grok gateway on the turn: use_tool, and call_connector through the hub
    const onGrok = connectorListPrompt({ principal: A, accounts: [grok], native: [{ provider: "grok-com", instanceId: DEFAULT_ACCOUNT }], callable: (provider) => CALLABLE.has(provider), callTool: true });
    expect(onGrok).not.toContain("no connector on any account");
    expect(onGrok).toContain("- Grok: connectors not read yet. Use its direct tools through use_tool (search_tool finds them), or call_connector with a connector name the connectors tool lists for it.");
    // not mounted, no host: pointed at its account
    expect(connectorListPrompt({ principal: A, accounts: [claude], callable: () => false, callTool: true, relay: true }))
      .toContain("- Claude: connectors not read yet. Not callable from this turn yet: call run_with_engine with engine \"Claude\" and the complete request.");
    // a native mount the registry has no account for yet
    expect(connectorListPrompt({ principal: A, accounts: [], native, callable: () => false, callTool: true }))
      .toContain("- Claude: connectors not read yet. Use its direct tools mcp__claude_ai_*.");
    // read with none, but mounted natively: its direct tools are still named
    const readEmpty = { ...claude, auth: "subscription" as const, at: 1 };
    expect(connectorListPrompt({ principal: A, accounts: [readEmpty], native, callable: () => false, callTool: true }))
      .toContain("- Claude: no connector listed when last read. Use its direct tools mcp__claude_ai_*.");
    // every account read and none has a connector: only then "no connector yet"
    expect(connectorListPrompt({ principal: A, accounts: [readEmpty], callable: () => false, callTool: true })).toContain("no connector on any account of theirs");
  });

  it("no dash, and the same bytes for an unchanged registry", () => {
    const promptFor = leaf();
    for (const driver of ENGINES) {
      for (const level of ["full", "ask"]) {
        const text = promptFor(driver, direct, { level, relay: true });
        expect(text).not.toMatch(/[–—]/);
        expect(promptFor(driver, direct, { level, relay: true })).toBe(text);
      }
    }
    // the order of the registry does not change the text
    const reversed = { [A]: [...REGISTRY[A]!].reverse().map((entry) => ({ ...entry, connectors: [...entry.connectors].reverse() })) };
    expect(leaf(reversed)("codex", direct)).toBe(promptFor("codex", direct));
  });

  it("a mount names only its own account: an added account's tools are not direct on the main one", () => {
    const main = account({ provider: "claude-ai", driver: "claudeAgent", instanceId: DEFAULT_ACCOUNT, slot: "primary" }, "Claude", [{ name: "Main Docs", state: "connected", tools: [] }]);
    const added = account({ provider: "claude-ai", driver: "claudeAgent", instanceId: "claude-added", slot: "primary" }, "Claude (added)", [{ name: "Added Docs", state: "connected", tools: [] }]);
    const native = nativeConnectorMounts({ claudeAiMounted: true, grokCloudOnTurn: false, input: { instanceId: "claudeAgent" } }, { accountInstance: () => DEFAULT_ACCOUNT });
    const text = connectorListPrompt({ principal: A, accounts: [main, added], native, callable: () => false, callTool: true });
    expect(text).toContain("- Main Docs (Claude): connected. Use its direct tools");
    expect(text).toContain("- Added Docs (Claude (added)): connected. Not callable from this turn yet.");
  });
});

describe("the Grok catalog section reads the same plan (#3351)", () => {
  it("remembers whether the dispatched turn loads the gateway", () => {
    const own = input("grokAgent", direct, { via: "subscription", payerPrincipalId: A, grokAccountConnectors: true });
    dispatchedConnectorPlan("thread-on", connectorPlanFrom(own, { withholdsHostTools: true }), undefined);
    dispatchedConnectorPlan("thread-scoped", connectorPlanFrom(own, { withholdsHostTools: true, toolSelection: true }), undefined);
    expect(grokGatewayOnTurn("thread-on")).toBe(true);
    // a tool selection: the driver drops the gateway, so the section offers no connectable connector
    expect(grokGatewayOnTurn("thread-scoped")).toBe(false);
    expect(grokGatewayOnTurn("thread-never")).toBeUndefined();
  });
});
