import { describe, expect, it } from "vitest";

import {
  CLAUDE_AI_CONNECTORS_URL,
  chooseConnectorSetupRoute,
  claudeInventoryShowsConnected,
  connectorProofMatches,
  connectorReauthFailure,
  connectorReauthProblem,
  connectorReauthText,
  connectorSetupText,
  isConnectorSetupUrl,
  MAC_FULL_DISK_ACCESS_URL,
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
    }
  });

  it("knows the Grok catalog", () => {
    expect(resolveConnectorSetupTarget("Outlook")?.grok).toBe("outlook");
    expect(resolveConnectorSetupTarget("Exchange")?.id).toBe("outlook");
    expect(resolveConnectorSetupTarget("Gmail")?.grok).toBe("gmail");
    expect(resolveConnectorSetupTarget("Google Drive")?.grok).toBe("google-drive");
    expect(resolveConnectorSetupTarget("OneDrive")?.grok).toBe("onedrive");
    expect(resolveConnectorSetupTarget("SharePoint")?.grok).toBe("sharepoint");
    expect(resolveConnectorSetupTarget("Salesforce")?.grok).toBe("salesforce");
    expect(resolveConnectorSetupTarget("X")?.id).toBe("x");
    expect(resolveConnectorSetupTarget("twitter")?.id).toBe("x");
    // Google Calendar is not in Grok's catalog: the name is kept, with no Grok id.
    const calendar = resolveConnectorSetupTarget("Google Calendar");
    expect(calendar?.grok).toBeUndefined();
    expect(calendar?.id).toBe("google-calendar");
  });

  it("keeps another app by its cleaned name, never an empty or a control-laden one", () => {
    expect(resolveConnectorSetupTarget("Notion")).toMatchObject({ id: "notion", label: "Notion" });
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

  it("a Grok-engine bot on the person's own xAI account: grok.com/connectors", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "own" })).toEqual({ route: "grok", url: GROK_CONNECTORS_URL });
  });

  it("a Claude bot on the person's own subscription: claude.ai connectors", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "claude", account: "own" })).toEqual({ route: "claude", url: CLAUDE_AI_CONNECTORS_URL });
  });

  it("an engine account that is someone else's is refused: no sign-in for another person's account", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "foreign" })).toEqual({ refusal: "foreign" });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "claude", account: "foreign" })).toEqual({ refusal: "foreign" });
  });

  it("an engine with no connectors of its own, or no account of the person's, has nowhere to send them", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "other", account: "none" })).toEqual({ refusal: "no_route" });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "none" })).toEqual({ refusal: "no_route" });
  });

  it("a connector outside Grok's catalog on the person's own Grok account is refused", () => {
    const calendar = resolveConnectorSetupTarget("Google Calendar")!;
    expect(chooseConnectorSetupRoute({ target: calendar, engine: "grok", account: "own" })).toEqual({ refusal: "not_on_engine" });
    expect(chooseConnectorSetupRoute({ target: calendar, engine: "claude", account: "own" })).toEqual({ route: "claude", url: CLAUDE_AI_CONNECTORS_URL });
  });

  it("the engine's own page wins over a preference", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "own", prefer: "claude" })).toEqual({ route: "grok", url: GROK_CONNECTORS_URL });
  });
});

describe("the card never offers what the bot cannot do (2026-10-28)", () => {
  const teams = resolveConnectorSetupTarget("Teams")!;

  it("a bot whose engine brings no connector of the person's (a key, another engine) opens the person's own Grok account", () => {
    // "the setup card won't open from my side, because this engine can't attach connectors to your own account"
    for (const engine of ["claude", "other", "grok"] as const) {
      expect(chooseConnectorSetupRoute({ target: teams, engine, account: "none", ownAccounts: { grok: true } }), engine)
        .toEqual({ route: "grok", url: GROK_CONNECTORS_URL });
    }
  });

  it("a Claude bot on the person's own subscription goes to Grok when asked, if that Grok account is theirs", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "claude", account: "own", prefer: "grok", ownAccounts: { grok: true } }))
      .toEqual({ route: "grok", url: GROK_CONNECTORS_URL });
    // not theirs: their own Claude page, never someone else's Grok
    expect(chooseConnectorSetupRoute({ target: teams, engine: "claude", account: "own", prefer: "grok" }))
      .toEqual({ route: "claude", url: CLAUDE_AI_CONNECTORS_URL });
  });

  it("someone else's engine account: the person's own account when they have one, else a refusal", () => {
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "foreign", ownAccounts: { claude: true } }))
      .toEqual({ route: "claude", url: CLAUDE_AI_CONNECTORS_URL });
    expect(chooseConnectorSetupRoute({ target: teams, engine: "grok", account: "foreign", ownAccounts: {} })).toEqual({ refusal: "foreign" });
  });

  it("a connector outside Grok's catalog never opens grok.com", () => {
    const calendar = resolveConnectorSetupTarget("Google Calendar")!;
    expect(chooseConnectorSetupRoute({ target: calendar, engine: "other", account: "none", ownAccounts: { grok: true } })).toEqual({ refusal: "no_route" });
    expect(chooseConnectorSetupRoute({ target: calendar, engine: "other", account: "none", ownAccounts: { grok: true, claude: true } }))
      .toEqual({ route: "claude", url: CLAUDE_AI_CONNECTORS_URL });
  });

  it("every card it chooses opens an allowed page", () => {
    for (const ownAccounts of [{ grok: true }, { claude: true }, { grok: true, claude: true }]) {
      const route = chooseConnectorSetupRoute({ target: teams, engine: "other", account: "none", ownAccounts });
      expect("url" in route && isConnectorSetupUrl(route.url)).toBe(true);
    }
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

  it("a call through grok's managed gateway proves the connector it names (2026-10-28)", () => {
    const gateway = (tool: string) => proof({ name: "use_tool", input: JSON.stringify({ tool_name: tool }) });
    expect(connectorProofMatches(view(), gateway("cursor__user-Teams-list_5fchats___10"), "b1")).toBe(true);
    expect(connectorProofMatches(view(), proof({ name: "cursor__user-Teams-list_5fchats___10" }), "b1")).toBe(true);
    expect(connectorProofMatches(view(), gateway("cursor__user-Outlook-list_5fmail_5fmessages___12"), "b1")).toBe(false);
    expect(connectorProofMatches(view(), gateway("cursor__user-Teams-start_5foauth___10"), "b1")).toBe(false);
    expect(connectorProofMatches(view(), gateway("tasks__list"), "b1")).toBe(false);
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
    expect(connectorSetupText(view(), "fr")).toBe("Connecte Microsoft Teams sur [grok.com](https://grok.com/connectors).");
    expect(connectorSetupText(view({ provider: "claude", url: CLAUDE_AI_CONNECTORS_URL }), "en")).toBe("Connect Microsoft Teams on [claude.ai](https://claude.ai/customize/connectors).");
  });

});

describe("a connector whose sign-in expired (#2749)", () => {
  const refused = "Managed MCP gateway tool call failed: Cursor connector needs re-authentication in Cursor: X won't turn on API access for this X account from its current sign-in";

  it("names the connector and its sign-in link, by tool id or by title", () => {
    const byId = connectorReauthFailure("cursor__user-X-search_5fposts_5fall", refused);
    expect(byId).toMatchObject({ label: "X", provider: "grok", url: GROK_CONNECTORS_URL });
    expect(connectorReauthFailure("Search posts all · X", refused)).toMatchObject({ label: "X", provider: "grok" });
    expect(connectorReauthProblem(byId!)).toContain(GROK_CONNECTORS_URL);
    expect(connectorReauthText(byId!, "fr")).toContain("nouvelle connexion");
    expect(connectorReauthText(byId!, "en")).toContain(GROK_CONNECTORS_URL);
  });

  it("leaves other failures alone", () => {
    expect(connectorReauthFailure("cursor__user-X-search_5fposts_5fall", "Managed MCP gateway tool call failed: 404 Not Found")).toBeNull();
    expect(connectorReauthFailure("grep", "exit 1")).toBeNull();
    expect(connectorReauthFailure("grep", undefined)).toBeNull();
  });
});

describe("the other expired connections of the proactive report (#2690)", () => {
  it("X client-not-enrolled is one reconnect card for X", () => {
    const said = "Managed MCP gateway tool call failed: 403 Client Forbidden (client-not-enrolled)";
    expect(connectorReauthFailure("cursor__user-X-search_5fposts_5fall", said)).toMatchObject({ label: "X", provider: "grok" });
  });

  it("GitHub's bare HTTP 400 is one for GitHub, never for another connector", () => {
    expect(connectorReauthFailure("mcp__claude_ai_GitHub__create_issue", "GitHub API error: HTTP 400")).toMatchObject({ label: "GitHub", provider: "claude" });
    expect(connectorReauthFailure("Create issue · GitHub", "Managed MCP gateway tool call failed: 400 Bad Request")).toMatchObject({ label: "GitHub", provider: "grok" });
    expect(connectorReauthFailure("mcp__claude_ai_Linear__create_issue", "HTTP 400")).toBeNull();
    expect(connectorReauthFailure("cursor__user-X-search_5fposts_5fall", "Managed MCP gateway tool call failed: HTTP 400")).toBeNull();
  });

  it("Messages without Full Disk Access opens this Mac's settings pane", () => {
    const failure = connectorReauthFailure("mcp__messages__read_messages", "Messages could not be read. Sagax needs Full Disk Access on this Mac.");
    expect(failure).toMatchObject({ label: "Messages", provider: "mac", url: MAC_FULL_DISK_ACCESS_URL });
    expect(isConnectorSetupUrl(MAC_FULL_DISK_ACCESS_URL)).toBe(true);
    expect(isConnectorSetupUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera")).toBe(false);
    expect(connectorReauthText(failure!, "fr")).toContain("accès complet au disque");
    expect(connectorReauthProblem(failure!)).toContain("Full Disk Access");
    expect(connectorReauthFailure("mcp__messages__read_messages", "No chat matches")).toBeNull();
  });
});
