import { describe, expect, it } from "vitest";

import {
  CLAUDE_AI_CONNECTORS_URL,
  chooseConnectorSetupRoute,
  claudeInventoryShowsConnected,
  connectorProofMatches,
  connectorSetupText,
  isConnectorSetupUrl,
  resolveConnectorSetupTarget,
  type ConnectorSetupProof,
  type ConnectorSetupView,
} from "./connector-setup.ts";
import { GROK_CONNECTORS_URL } from "./grok-cloud-connectors.ts";

describe("which connector the person named", () => {
  it("reads Teams in every usual spelling", () => {
    for (const name of ["Microsoft Teams", "teams", "MS Teams", "microsoft-teams", "  Teams  "]) {
      const target = resolveConnectorSetupTarget(name);
      expect(target?.id).toBe("microsoft-teams");
      expect(target?.label).toBe("Microsoft Teams");
      expect(target?.grok).toBe("microsoft-teams");
      expect(target?.composio).toBe("microsoft_teams");
    }
  });

  it("knows the Grok catalog and the usual Composio apps", () => {
    expect(resolveConnectorSetupTarget("Outlook")?.grok).toBe("outlook");
    expect(resolveConnectorSetupTarget("Exchange")?.id).toBe("outlook");
    expect(resolveConnectorSetupTarget("Gmail")?.composio).toBe("gmail");
    expect(resolveConnectorSetupTarget("Google Drive")?.grok).toBe("google-drive");
    expect(resolveConnectorSetupTarget("OneDrive")?.grok).toBe("onedrive");
    expect(resolveConnectorSetupTarget("SharePoint")?.grok).toBe("sharepoint");
    expect(resolveConnectorSetupTarget("Salesforce")?.grok).toBe("salesforce");
    expect(resolveConnectorSetupTarget("X")?.composio).toBe("twitter");
    expect(resolveConnectorSetupTarget("twitter")?.id).toBe("x");
    // not in Grok's catalog: Claude or Composio only
    const calendar = resolveConnectorSetupTarget("Google Calendar");
    expect(calendar?.grok).toBeUndefined();
    expect(calendar?.composio).toBe("googlecalendar");
  });

  it("keeps another app by its cleaned name, never an empty or a control-laden one", () => {
    expect(resolveConnectorSetupTarget("Notion")).toMatchObject({ id: "notion", label: "Notion", composio: "notion" });
    expect(resolveConnectorSetupTarget("")).toBeNull();
    expect(resolveConnectorSetupTarget("   ")).toBeNull();
    expect(resolveConnectorSetupTarget("5752d21c-e77c-4a83-84f0-66048216a5df")).toBeNull();
    expect(resolveConnectorSetupTarget("Teams 5752d21c-e77c-4a83-84f0-66048216a5df")).toBeNull();
    expect(resolveConnectorSetupTarget("a\u0000b")?.label).toBe("ab");
    expect(resolveConnectorSetupTarget("x".repeat(300))?.label.length).toBeLessThanOrEqual(60);
  });
});

describe("where the person signs in", () => {
  const teams = resolveConnectorSetupTarget("Teams")!;

  it("a Grok bot on the person's own xAI account: grok.com/connectors", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "own", composio: true })).toEqual({ route: "grok", url: GROK_CONNECTORS_URL });
  });

  it("a Claude bot on the person's own subscription: claude.ai connectors", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "claude", account: "own", composio: true })).toEqual({ route: "claude", url: CLAUDE_AI_CONNECTORS_URL });
  });

  it("an engine account that is someone else's is refused: no sign-in for another person's account", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "foreign", composio: true })).toEqual({ refusal: "foreign" });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "claude", account: "foreign", composio: false })).toEqual({ refusal: "foreign" });
  });

  it("an engine with no connectors of its own falls back to Sagax's Connect apps when it knows the app", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "other", account: "none", composio: true })).toEqual({ route: "composio", slug: "microsoft_teams" });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "none", composio: true })).toEqual({ route: "composio", slug: "microsoft_teams" });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "other", account: "none", composio: false })).toEqual({ refusal: "no_route" });
  });

  it("a connector outside Grok's catalog on a Grok bot goes to Connect apps, or is refused", () => {
    const calendar = resolveConnectorSetupTarget("Google Calendar")!;
    expect(chooseConnectorSetupRoute({ target: calendar, engine: "grok", account: "own", composio: true })).toEqual({ route: "composio", slug: "googlecalendar" });
    expect(chooseConnectorSetupRoute({ target: calendar, engine: "grok", account: "own", composio: false })).toEqual({ refusal: "not_on_engine" });
  });

  it("a preferred route is honoured when it is possible", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "own", composio: true, prefer: "composio" })).toEqual({ route: "composio", slug: "microsoft_teams" });
    // a preference that cannot be met falls back to the engine's own
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "own", composio: false, prefer: "composio" })).toEqual({ route: "grok", url: GROK_CONNECTORS_URL });
  });
});

describe("outbound links", () => {
  it("allows only grok.com and claude.ai over https", () => {
    expect(isConnectorSetupUrl(GROK_CONNECTORS_URL)).toBe(true);
    expect(isConnectorSetupUrl(CLAUDE_AI_CONNECTORS_URL)).toBe(true);
    expect(isConnectorSetupUrl("http://grok.com/connectors")).toBe(false);
    expect(isConnectorSetupUrl("https://grok.com.evil.example/connectors")).toBe(false);
    expect(isConnectorSetupUrl("https://user:pw@grok.com/connectors")).toBe(false);
    expect(isConnectorSetupUrl("javascript:alert(1)")).toBe(false);
    expect(isConnectorSetupUrl("not a url")).toBe(false);
  });
});

const view = (over: Partial<ConnectorSetupView> = {}): ConnectorSetupView => ({
  id: "cs_0123456789abcdef01",
  connector: "microsoft-teams",
  label: "Microsoft Teams",
  provider: "grok",
  url: GROK_CONNECTORS_URL,
  status: "waiting",
  owner: "0123456789abcdef",
  createdAt: 1_000,
  ...over,
});

describe("evidence that the connector works (review of #966)", () => {
  const proof = (over: Partial<ConnectorSetupProof> = {}): ConnectorSetupProof => ({
    name: "mcp__microsoft_teams__list_chats", ok: true, at: 2_000, owner: "0123456789abcdef", botId: "b1", ...over,
  });

  it("a successful Grok call to that connector, in a turn of the card's person and bot, after the card", () => {
    expect(connectorProofMatches(view(), proof(), "b1")).toBe(true);
    // the meta tool: its tool_name is read, only for exactly use_tool
    expect(connectorProofMatches(view(), proof({ name: "use_tool", input: JSON.stringify({ tool_name: "microsoft_teams__list_chats" }) }), "b1")).toBe(true);
  });

  it("anyone else's turn, another bot, a failed or older call, or another connector is not", () => {
    expect(connectorProofMatches(view(), proof({ owner: "ffffffffffffffff" }), "b1")).toBe(false);
    expect(connectorProofMatches(view(), proof({ owner: "" }), "b1")).toBe(false);
    expect(connectorProofMatches(view(), proof({ botId: "b2" }), "b1")).toBe(false);
    expect(connectorProofMatches(view(), proof({ ok: false }), "b1")).toBe(false);
    expect(connectorProofMatches(view(), proof({ at: 500 }), "b1")).toBe(false);
    expect(connectorProofMatches(view(), proof({ name: "mcp__outlook__list_mail" }), "b1")).toBe(false);
  });

  it("an input's tool_name counts only for the meta tool itself, never for another name", () => {
    const input = JSON.stringify({ tool_name: "microsoft_teams__list_chats" });
    expect(connectorProofMatches(view(), proof({ name: "agents__sagax_help", input }), "b1")).toBe(false);
    expect(connectorProofMatches(view(), proof({ name: "use_tool_x", input }), "b1")).toBe(false);
    expect(connectorProofMatches(view(), proof({ name: "use_tool", input: "not json" }), "b1")).toBe(false);
  });

  it("a sign-in tool is no proof the connector works", () => {
    for (const name of ["mcp__microsoft_teams__authenticate", "mcp__microsoft_teams__complete_authentication", "mcp__microsoft_teams__oauth_start", "mcp__microsoft_teams__get_auth_url"]) {
      expect(connectorProofMatches(view(), proof({ name }), "b1")).toBe(false);
    }
    expect(connectorProofMatches(view(), proof({ name: "use_tool", input: JSON.stringify({ tool_name: "microsoft_teams__authenticate" }) }), "b1")).toBe(false);
  });

  it("a Claude card never takes a call as proof: only the owner's claude.ai inventory", () => {
    const claude = view({ provider: "claude", url: CLAUDE_AI_CONNECTORS_URL });
    expect(connectorProofMatches(claude, proof({ name: "mcp__claude_ai_Microsoft_365__teams_list_chats" }), "b1")).toBe(false);
  });

  it("reads the claude.ai inventory: connected only, by the service it reaches", () => {
    const teams = resolveConnectorSetupTarget("Teams")!;
    expect(claudeInventoryShowsConnected([{ name: "Microsoft 365", status: "connected" }], teams)).toBe(true);
    expect(claudeInventoryShowsConnected([{ name: "Microsoft 365", status: "needs_auth" }], teams)).toBe(false);
    expect(claudeInventoryShowsConnected([{ name: "Gmail", status: "connected" }], teams)).toBe(false);
    expect(claudeInventoryShowsConnected([{ name: "Notion", status: "connected" }], resolveConnectorSetupTarget("notion")!)).toBe(true);
  });
});

describe("the card's own text", () => {
  it("says where to sign in, in the person's language, with the link for clients without the card", () => {
    expect(connectorSetupText(view(), "fr")).toBe("Connectez Microsoft Teams sur [grok.com](https://grok.com/connectors).");
    expect(connectorSetupText(view({ provider: "claude", url: CLAUDE_AI_CONNECTORS_URL }), "en")).toBe("Connect Microsoft Teams on [claude.ai](https://claude.ai/customize/connectors).");
  });

});
