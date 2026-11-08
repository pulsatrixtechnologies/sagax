import { describe, expect, it, vi } from "vitest";

import { resolveEngineAccess } from "./engines/engine-credentials.ts";

import {
  ClaudeAiConnectorInventory,
  claudeAiConnectorsForTurn,
  claudeAiConnectorsPrompt,
  connectorPrincipalFor,
  createHarnessConnectorRoutes,
  engineConnectorsPrompt,
  relayHint,
  accountConnectorsForTurn,
  grokCloudConnectorsForTurn,
  parseClaudeAuthStatus,
  parseClaudeMcpList,
  type ClaudeAiTurnInput,
  type HarnessConnectorRouteDeps,
} from "./harness-connectors.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import type { SessionRecord } from "./auth/sessions.ts";

const LOCAL = "pr_00000000-0000-4000-8000-000000000001";
const ADA = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";

describe("connectorPrincipalFor (whose connections a turn uses)", () => {
  const base = { ownerPrincipalId: ADA, localPrincipalId: LOCAL };
  it("a conversation uses its speaker's connections", () => {
    expect(connectorPrincipalFor({ ...base, identity: "perspicax", speaker: { origin: "person", principalId: BOB } })).toBe(BOB);
  });
  it("a routine uses its bot owner's connections", () => {
    expect(connectorPrincipalFor({ ...base, identity: "perspicax", speaker: { origin: "owner-routine", principalId: BOB } })).toBe(ADA);
  });
  it("an unknown person on an organization server is nobody, never the owner", () => {
    expect(connectorPrincipalFor({ ...base, identity: "perspicax", speaker: { origin: "person" } })).toBe("");
    expect(connectorPrincipalFor({ ...base, identity: "perspicax", speaker: { origin: "peer", fromBotId: "b1" } })).toBe("");
  });
  it("on a solo server an unnamed person and the operator are the operator", () => {
    expect(connectorPrincipalFor({ ...base, identity: "solo", speaker: { origin: "person" } })).toBe(LOCAL);
    expect(connectorPrincipalFor({ ...base, identity: "solo", speaker: { origin: "operator" } })).toBe(LOCAL);
  });
});

describe("claudeAiConnectorsForTurn", () => {
  const turn = (patch: Partial<ClaudeAiTurnInput>): ClaudeAiTurnInput => ({
    identity: "perspicax", restrictedByPolicy: false, driver: "claudeAgent",
    speaker: { origin: "person", principalId: ADA }, ownerPrincipalId: ADA, localPrincipalId: LOCAL, ...patch,
  });
  it("organization: only on the speaker's own subscription", () => {
    expect(claudeAiConnectorsForTurn(turn({ via: "subscription" }))).toBe(true);
    for (const via of ["owner-key", "server", "org-key"] as const) expect(claudeAiConnectorsForTurn(turn({ via }))).toBe(false);
    expect(claudeAiConnectorsForTurn(turn({}))).toBe(false);
  });
  it("solo: the operator and the operator's routines, nobody else", () => {
    expect(claudeAiConnectorsForTurn(turn({ identity: "solo", speaker: { origin: "operator" } }))).toBe(true);
    expect(claudeAiConnectorsForTurn(turn({ identity: "solo", ownerPrincipalId: LOCAL, speaker: { origin: "owner-routine" } }))).toBe(true);
    expect(claudeAiConnectorsForTurn(turn({ identity: "solo", speaker: { origin: "person", principalId: BOB } }))).toBe(false);
  });
  it("never when turned off, restricted by policy, or on another engine", () => {
    expect(claudeAiConnectorsForTurn(turn({ via: "subscription", restrictedByPolicy: true }))).toBe(false);
    expect(claudeAiConnectorsForTurn(turn({ via: "subscription", driver: "codex" }))).toBe(false);
  });
  it("tells the bot whose connectors they are only when they are mounted", () => {
    expect(claudeAiConnectorsPrompt(false)).toBe("");
    expect(claudeAiConnectorsPrompt(true)).toContain("mcp__claude_ai_");
    expect(claudeAiConnectorsPrompt(true)).not.toMatch(/[–—]/);
  });
  it("#1943 tells the bot to keep the owner's mail on /me without another userId", () => {
    const prompt = claudeAiConnectorsPrompt(true);
    expect(prompt).toContain("omit userId and user_id");
    expect(prompt).toContain("/me");
    expect(prompt).toContain("bot inbound address");
    expect(engineConnectorsPrompt({
      driver: "grokAgent", claudeAi: false, grokCloud: true,
    })).toContain("omit userId and user_id");
  });
});

describe("whose account connectors a turn reaches (review of #943, point 5)", () => {
  const base = { identity: "perspicax" as const, restrictedByPolicy: false, ownerPrincipalId: ADA, localPrincipalId: LOCAL };
  it("the person's own sign-in: own, on Claude and on Grok", () => {
    for (const driver of ["claudeAgent", "grokAgent"]) {
      const input = { ...base, driver, via: "subscription" as const, payerPrincipalId: BOB, speaker: { origin: "person" as const, principalId: BOB } };
      expect(accountConnectorsForTurn(input), driver).toBe("own");
    }
    // #2747 (QA of #2816): own, the managed gateway still waits for the bot's opt-in
    const own = { ...base, driver: "grokAgent", via: "subscription" as const, payerPrincipalId: BOB, speaker: { origin: "person" as const, principalId: BOB } };
    expect(grokCloudConnectorsForTurn(own)).toBe(false);
    expect(grokCloudConnectorsForTurn({ ...own, grokAccountConnectors: true })).toBe(true);
    // a Claude bot's opt-in never turns grok.com connectors on
    expect(grokCloudConnectorsForTurn({ ...own, driver: "claudeAgent", grokAccountConnectors: true })).toBe(false);
  });
  it("someone else's sign-in pays: foreign, nothing offered", () => {
    for (const driver of ["claudeAgent", "grokAgent"]) {
      const input = { ...base, driver, via: "subscription" as const, payerPrincipalId: ADA, speaker: { origin: "person" as const, principalId: BOB } };
      expect(accountConnectorsForTurn(input), driver).toBe("foreign");
      expect(claudeAiConnectorsForTurn(input)).toBe(false);
      expect(grokCloudConnectorsForTurn(input)).toBe(false);
      // opted in or not: someone else's connectors never reach the bot
      expect(grokCloudConnectorsForTurn({ ...input, grokAccountConnectors: true })).toBe(false);
    }
  });
  it("#1137: the owner pays with their subscription for someone else: foreign, the owner's connectors never mount", () => {
    const plan = resolveEngineAccess({
      identity: "perspicax", speaker: { origin: "person", principalId: BOB }, owner: { principalId: ADA }, payerMode: "owner",
      instance: { instanceId: "claude", driver: "claudeAgent", installed: true },
      subscriptionSignedIn: (pid) => pid === ADA, hasKey: () => false, keyBacked: false,
    });
    expect(plan).toMatchObject({ ok: true, via: "subscription", payerPrincipalId: ADA, ownerPays: true });
    const input = { ...base, driver: "claudeAgent", via: "subscription" as const, payerPrincipalId: plan.ok ? plan.payerPrincipalId! : "", speaker: { origin: "person" as const, principalId: BOB } };
    expect(accountConnectorsForTurn(input)).toBe("foreign");
    expect(claudeAiConnectorsForTurn(input)).toBe(false);
  });
  it("a key or another engine: none", () => {
    expect(accountConnectorsForTurn({ ...base, driver: "grokAgent", via: "org-key", speaker: { origin: "person", principalId: BOB } })).toBe("none");
    expect(accountConnectorsForTurn({ ...base, driver: "codex", via: "subscription", speaker: { origin: "person", principalId: BOB } })).toBe("none");
  });
  it("solo Claude and Grok (2026-10-30): the operator owns the machine's login, anyone else is foreign", () => {
    for (const driver of ["claudeAgent", "grokAgent", "grok"]) {
      expect(accountConnectorsForTurn({ ...base, identity: "solo", driver, speaker: { origin: "operator" } }), driver).toBe("own");
      expect(accountConnectorsForTurn({ ...base, identity: "solo", driver, speaker: { origin: "person", principalId: BOB } }), driver).toBe("foreign");
    }
    // #2747 (QA of #2816): the operator's solo bot sees the account's
    // connectors only when that bot opted in
    expect(grokCloudConnectorsForTurn({ ...base, identity: "solo", driver: "grokAgent", speaker: { origin: "operator" } })).toBe(false);
    expect(grokCloudConnectorsForTurn({ ...base, identity: "solo", driver: "grok", speaker: { origin: "operator" } })).toBe(false);
    expect(grokCloudConnectorsForTurn({ ...base, identity: "solo", driver: "grokAgent", speaker: { origin: "operator" }, grokAccountConnectors: true })).toBe(true);
    expect(grokCloudConnectorsForTurn({ ...base, identity: "solo", driver: "grok", speaker: { origin: "operator" }, grokAccountConnectors: true })).toBe(true);
    expect(grokCloudConnectorsForTurn({ ...base, identity: "solo", driver: "grokAgent", speaker: { origin: "person", principalId: BOB }, grokAccountConnectors: true })).toBe(false);
  });
  it("tells a foreign turn the connectors belong to someone else and offers nothing", () => {
    const text = engineConnectorsPrompt({ driver: "grokAgent", claudeAi: false, grokCloud: false, foreign: true });
    expect(text).toContain("belong to someone else");
    expect(text).not.toContain("use_tool");
    expect(text).not.toContain("ask_bot");
  });
});

describe("what a turn is told about mail, Teams, calendar and SharePoint (parité R9 + R11)", () => {
  it("a Claude turn with the speaker's connectors: whose they are, and every send or write waits for its card", () => {
    const text = engineConnectorsPrompt({ driver: "claudeAgent", claudeAi: true, grokCloud: false });
    expect(text).toContain(claudeAiConnectorsPrompt(true).trim());
    expect(text).toMatch(/approval card/);
    expect(text).toMatch(/SharePoint/);
  });
  it("a Grok organization turn: the xAI account's cloud connectors through use_tool, managed on grok.com", () => {
    const text = engineConnectorsPrompt({ driver: "grokAgent", claudeAi: false, grokCloud: true });
    expect(text).toContain("use_tool");
    expect(text).toContain("https://grok.com/connectors");
    expect(text).toContain("Microsoft Teams");
    expect(text).toMatch(/approval card/);
  });
  it("an engine with none: says which engine has them and offers a teammate, never claims a send", () => {
    for (const input of [
      { driver: "codex", claudeAi: false, grokCloud: false },
      { driver: "claudeAgent", claudeAi: false, grokCloud: false },
      // a solo Grok turn: the cloud connectors stay off (#918)
      { driver: "grokAgent", claudeAi: false, grokCloud: false },
    ]) {
      const text = engineConnectorsPrompt(input);
      // a person's chat coordinates (no ask_bot there): no tool is named
      expect(text).toContain("ask a teammate bot on that engine with your teammate tools");
      expect(text).not.toContain("ask_bot");
      expect(text).not.toContain("use_tool");
      expect(text).not.toContain("mcp__claude_ai_");
    }
  });
  it("to connect a connector: open_connector_setup, one call, never a tour of the settings (Owner 2026-10-22)", () => {
    for (const input of [
      { driver: "claudeAgent", claudeAi: true, grokCloud: false },
      { driver: "grokAgent", claudeAi: false, grokCloud: true },
      { driver: "codex", claudeAi: false, grokCloud: false },
      { driver: "grokAgent", claudeAi: false, grokCloud: false },
    ]) {
      const text = engineConnectorsPrompt(input);
      expect(text).toContain("open_connector_setup");
      expect(text).not.toMatch(/tell the person to connect it at/);
    }
    // Grok calls it straight away, no search_tool round first
    expect(engineConnectorsPrompt({ driver: "grokAgent", claudeAi: false, grokCloud: true })).toContain("use_tool with tool_name agents__open_connector_setup");
    expect(engineConnectorsPrompt({ driver: "grokAgent", claudeAi: false, grokCloud: true, foreign: true })).not.toContain("open_connector_setup");
  });
  it("never a dash a person would read as an em dash", () => {
    for (const grokCloud of [true, false]) {
      for (const claudeAi of [true, false]) expect(engineConnectorsPrompt({ driver: grokCloud ? "grokAgent" : "claudeAgent", claudeAi, grokCloud })).not.toMatch(/[–—]/);
    }
  });
});

describe("parsing the CLI", () => {
  it("keeps only claude.ai connectors from `claude mcp list`, without URLs", () => {
    const listed = parseClaudeMcpList([
      "Checking MCP server health…",
      "",
      "claude.ai Microsoft 365: https://microsoft365.mcp.claude.com/mcp - ! Needs authentication",
      "claude.ai GitHub: https://api.githubcopilot.com/mcp/ - ✔ Connected",
      "claude.ai Broken: https://x.example/mcp - ✘ Failed to connect",
      "pulsatrix_dispatch: https://host.example/mcp (HTTP) - ✔ Connected",
    ].join("\n"));
    expect(listed).toEqual([
      { name: "Microsoft 365", status: "needs_auth" },
      { name: "GitHub", status: "connected" },
      { name: "Broken", status: "failed" },
    ]);
    expect(JSON.stringify(listed)).not.toContain("https://");
  });
  it("keeps a connector whose own name holds a colon whole", () => {
    expect(parseClaudeMcpList([
      "claude.ai Keyword Tool: Free SEO Research: https://kw.example/mcp - ✔ Connected",
      "claude.ai Notes: https://notes.example/mcp - ! Needs authentication",
    ].join("\n"))).toEqual([
      { name: "Keyword Tool: Free SEO Research", status: "connected" },
      { name: "Notes", status: "needs_auth" },
    ]);
  });
  it("reads the login method only", () => {
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "x@y.z" }))).toBe("subscription");
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "api_key" }))).toBe("key");
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: false }))).toBe("none");
    expect(parseClaudeAuthStatus("not json")).toBe("unknown");
  });
});

describe("ClaudeAiConnectorInventory", () => {
  it("lists connectors only for a subscription, cached per account", async () => {
    let clock = 0;
    const run = vi.fn(async ({ args, env }: { args: string[]; env: NodeJS.ProcessEnv }) => {
      if (args[0] === "auth") return JSON.stringify({ loggedIn: true, authMethod: env.CLAUDE_CONFIG_DIR === "/ada" ? "claude.ai" : "api_key" });
      return "claude.ai GitHub: https://g.example - ✔ Connected\n";
    });
    const inventory = new ClaudeAiConnectorInventory({ run, now: () => clock });
    const ada = await inventory.read("person:ada", { cli: "claude", env: { CLAUDE_CONFIG_DIR: "/ada" } });
    const bob = await inventory.read("person:bob", { cli: "claude", env: { CLAUDE_CONFIG_DIR: "/bob" } });
    expect(ada.connectors).toEqual([{ name: "GitHub", status: "connected" }]);
    expect(bob).toMatchObject({ auth: "key", connectors: [] });
    // bob's key never ran `mcp list`
    expect(run.mock.calls.filter(([input]) => input.args[0] === "mcp")).toHaveLength(1);
    await inventory.read("person:ada", { cli: "claude", env: { CLAUDE_CONFIG_DIR: "/ada" } });
    expect(run).toHaveBeenCalledTimes(3);
    clock += 10 * 60_000;
    await inventory.read("person:ada", { cli: "claude", env: { CLAUDE_CONFIG_DIR: "/ada" } });
    expect(run).toHaveBeenCalledTimes(5);
  });
});

function session(principalId: string, scopes: Array<"admin" | "client">): RequestAuth {
  return { kind: "session", via: "cookie", scopes, session: { id: `s-${principalId}`, label: "web", scopes, createdAt: 1, lastSeenAt: 1, principalId } as SessionRecord };
}

function harness(overrides: Partial<HarnessConnectorRouteDeps> = {}) {
  const accounts: string[] = [];
  const deps: HarnessConnectorRouteDeps = {
    organization: true,
    restrictedByPolicy: () => false,
    principalFor: (auth) => (auth.kind === "session" ? auth.session.principalId ?? "" : LOCAL),
    localPrincipalId: () => LOCAL,
    isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === ADA,
    claudeAccountFor: (principalId) => {
      accounts.push(principalId);
      return principalId === BOB ? { unavailable: "not_signed_in" } : { cli: "claude", env: { CLAUDE_CONFIG_DIR: `/logins/${principalId}` }, key: `person:${principalId}` };
    },
    inventory: { read: async (key) => ({ auth: "subscription", connectors: [{ name: `M365 of ${key}`, status: "connected" }], at: 1 }) },
    ...overrides,
  };
  const route = createHarnessConnectorRoutes(deps);
  const call = async (input: { method: string; path: string; auth: RequestAuth; body?: unknown }) => {
    const out: { status?: number; body?: any } = {};
    const ctx = {
      req: { headers: { "content-type": "application/json" } },
      res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL(`http://localhost${input.path}`), path: input.path, method: input.method, auth: input.auth,
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
      readBody: async () => input.body ?? {},
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  return { call, accounts };
}

describe("GET /api/me/harness-connectors", () => {
  it("answers each person with their own account only", async () => {
    const h = harness();
    const ada = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) });
    expect(ada.status).toBe(200);
    expect(ada.body.claude).toEqual({ available: true, connectors: [{ name: `M365 of person:${ADA}`, status: "connected" }] });
    const bob = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(BOB, ["client"]) });
    expect(bob.body.claude).toEqual({ available: false, reason: "not_signed_in", connectors: [] });
    expect(h.accounts).toEqual([ADA, BOB]);
    expect(ada.body.manageUrl).toBe("https://claude.ai/customize/connectors");
    expect(ada.body.codex.available).toBe(false);
  });
  it("says why when the turns cannot get them", async () => {
    const key = harness({ inventory: { read: async () => ({ auth: "key", connectors: [], at: 1 }) } });
    expect((await key.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) })).body.claude.reason).toBe("key");
    const policy = harness({ restrictedByPolicy: () => true });
    expect((await policy.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) })).body.claude.reason).toBe("managed_policy");
    const solo = harness({ organization: false });
    expect((await solo.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(BOB, ["client"]) })).body.claude.reason).toBe("not_operator");
  });
  it("#1533: a saved sign-in that Claude says is signed out is noted as expired (organization only)", async () => {
    const signedOut: string[] = [];
    const none = { read: async () => ({ auth: "none" as const, connectors: [], at: 1 }) };
    const h = harness({ inventory: none, onSignedOut: (id) => signedOut.push(id) });
    const answer = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) });
    expect(answer.body.claude.reason).toBe("not_signed_in");
    expect(signedOut).toEqual([ADA]);
    // no sign-in of their own: nothing to note
    await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(BOB, ["client"]) });
    expect(signedOut).toEqual([ADA]);
  });
  it("refuses a caller who is not a person", async () => {
    const h = harness({ principalFor: () => "" });
    expect((await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) })).status).toBe(403);
  });
  it("passes other paths", async () => {
    expect((await harness().call({ method: "GET", path: "/api/me/engines", auth: session(ADA, ["client"]) })).passed).toBe(true);
  });
});

describe("PUT /api/harness-connectors/settings (retired)", () => {
  it("is a no-op: Claude connectors stay allowed whatever an admin sends", async () => {
    const h = harness();
    const member = await h.call({ method: "PUT", path: "/api/harness-connectors/settings", auth: session(BOB, ["admin", "client"]), body: { claudeAi: false } });
    expect(member.status).toBe(403);
    const admin = await h.call({ method: "PUT", path: "/api/harness-connectors/settings", auth: session(ADA, ["admin", "client"]), body: { claudeAi: false } });
    expect(admin).toMatchObject({ status: 200, body: { claudeAi: true } });
    const seen = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(BOB, ["client"]) });
    expect(seen.body).toMatchObject({ enabled: true });
    expect(seen.body.claude.reason).not.toBe("disabled");
    const ada = await h.call({ method: "GET", path: "/api/me/harness-connectors", auth: session(ADA, ["client"]) });
    expect(ada.body.claude.available).toBe(true);
  });
  it("accepts only { claudeAi: boolean }", async () => {
    const h = harness();
    const bad = await h.call({ method: "PUT", path: "/api/harness-connectors/settings", auth: session(ADA, ["admin", "client"]), body: { claudeAi: "no", extra: 1 } });
    expect(bad.status).toBe(400);
  });
});

describe("a stored claudeAi: false", () => {
  it("is ignored: the config still loads and the turn keeps the connectors", async () => {
    const { parseStoredConfig } = await import("./config.ts");
    expect(() => parseStoredConfig({ harnessConnectors: { claudeAi: false } })).not.toThrow();
    expect(claudeAiConnectorsForTurn({
      identity: "perspicax", restrictedByPolicy: false, driver: "claudeAgent", via: "subscription",
      speaker: { origin: "person", principalId: ADA }, ownerPrincipalId: ADA, localPrincipalId: LOCAL,
    } as ClaudeAiTurnInput)).toBe(true);
  });
});

describe("2026-10-28: Grok's own connectors in the person's Grok turn", () => {
  it("tells the Grok turn they are the person's own and how to find Teams or Outlook", () => {
    const text = engineConnectorsPrompt({ driver: "grokAgent", claudeAi: false, grokCloud: true });
    expect(text).toContain("person's own xAI account");
    expect(text).toMatch(/search_tool \(for example "teams" or "outlook"\)/);
    expect(text).toContain("Microsoft Teams");
  });
});

describe("2026-10-28: Full access never asks for a typed GO", () => {
  it("Full access: a send asks for no card and no typed GO; only Refuse, Ask first and allowed recipients stop it", () => {
    for (const input of [
      { driver: "claudeAgent", claudeAi: true, grokCloud: false, full: true },
      { driver: "grokAgent", claudeAi: false, grokCloud: true, full: true },
    ]) {
      const text = engineConnectorsPrompt(input);
      expect(text).toContain("Full access");
      expect(text).not.toMatch(/wait for the person's approval card/);
      expect(text).toMatch(/no confirmation and no typed GO/);
      expect(text).toMatch(/Ask first/);
      expect(text).toMatch(/allowed recipients/);
    }
    // below Full the card stays, and the bot never asks for a typed word either
    const ask = engineConnectorsPrompt({ driver: "claudeAgent", claudeAi: true, grokCloud: false });
    expect(ask).toMatch(/approval card/);
    expect(ask).toMatch(/never ask for a typed GO/);
  });
});

describe("2026-10-29: the relay hint names the person's other engines and sign-ins", () => {
  it("nothing known elsewhere: the generic hint; known: each engine with its connectors, the personal account first for mail and Teams", () => {
    expect(relayHint(undefined)).toContain("call run_with_engine with that engine");
    expect(relayHint([{ engine: "Claude", connectors: [] }])).toContain("call run_with_engine with that engine");
    const named = relayHint([
      { engine: "Grok (personal account)", connectors: ["Microsoft Teams", "Outlook (Exchange)"], accountKind: "personal" },
      { engine: "Claude", connectors: ["Microsoft 365"] },
    ]);
    expect(named).toContain("Grok (personal account): Microsoft Teams, Outlook (Exchange); Claude: Microsoft 365");
    expect(named).toContain("prefer the personal account");
    expect(named).toContain("Never answer that you cannot switch engines or accounts");
    // the prompt of a turn with no connector of its own carries it
    const text = engineConnectorsPrompt({ driver: "codex", claudeAi: false, grokCloud: false, relay: true, elsewhere: [{ engine: "Claude", connectors: ["Microsoft 365"] }] });
    expect(text).toContain("Claude: Microsoft 365");
    // and so does a Grok turn on one account about the other
    const grok = engineConnectorsPrompt({ driver: "grokAgent", claudeAi: false, grokCloud: true, relay: true, elsewhere: [{ engine: "Grok (personal account)", connectors: ["Microsoft Teams"], accountKind: "personal" }] });
    expect(grok).toContain("Grok (personal account): Microsoft Teams");
  });
});

describe("2026-10-28: a part run on another engine (run_with_engine)", () => {
  const base = { identity: "perspicax" as const, restrictedByPolicy: false, ownerPrincipalId: BOB, localPrincipalId: LOCAL };
  // the sub-turn's speaker: the same bot, for the person of the source turn (index.ts peerSpeaker)
  const relaySpeaker = { origin: "peer" as const, fromBotId: "bot-self", principalId: BOB };

  it("a Grok part runs on the person's own Grok sign-in, but no bot turn loads its managed gateway (#2747)", () => {
    const plan = resolveEngineAccess({
      identity: "perspicax", speaker: relaySpeaker, owner: { principalId: BOB },
      instance: { instanceId: "grok", driver: "grokAgent", installed: true },
      subscriptionSignedIn: (pid, driver) => pid === BOB && driver === "grokAgent", hasKey: () => false, keyBacked: true,
    });
    // the person's own subscription, never the server's or the organization's key
    expect(plan).toMatchObject({ ok: true, via: "subscription", payerPrincipalId: BOB });
    const input = { ...base, driver: "grokAgent", via: "subscription" as const, payerPrincipalId: plan.ok ? plan.payerPrincipalId! : "", speaker: relaySpeaker };
    expect(accountConnectorsForTurn(input)).toBe("own");
    expect(grokCloudConnectorsForTurn(input)).toBe(false);
    expect(grokCloudConnectorsForTurn({ ...input, grokAccountConnectors: true })).toBe(true);
  });

  it("a part keeps a routine's lineage and payer: no sign-in of the person is borrowed by a routine", () => {
    const routineHop = { origin: "peer" as const, fromBotId: "bot-self", principalId: ADA, routine: true as const, routinePayer: BOB };
    const plan = resolveEngineAccess({
      identity: "perspicax", speaker: routineHop, owner: { principalId: BOB },
      instance: { instanceId: "grok", driver: "grokAgent", installed: true },
      subscriptionSignedIn: (pid) => pid === ADA, hasKey: () => false, keyBacked: false,
    });
    expect(plan).toMatchObject({ ok: false, routine: true });
  });

  it("someone else's Grok sign-in never serves the part: foreign, no connectors", () => {
    const input = { ...base, driver: "grokAgent", via: "subscription" as const, payerPrincipalId: ADA, speaker: relaySpeaker };
    expect(grokCloudConnectorsForTurn(input)).toBe(false);
  });

  it("a turn without the connector is pointed at run_with_engine, never at \"I can't switch engines\"", () => {
    const text = engineConnectorsPrompt({ driver: "claudeAgent", claudeAi: false, grokCloud: false, relay: true });
    expect(text).toContain("run_with_engine");
    expect(text).toContain("Microsoft Teams");
    expect(text).toContain("open_connector_setup");
    expect(engineConnectorsPrompt({ driver: "claudeAgent", claudeAi: true, grokCloud: false, relay: true })).toContain("run_with_engine");
    // a turn one hop away has no run_with_engine: not named
    expect(engineConnectorsPrompt({ driver: "claudeAgent", claudeAi: false, grokCloud: false })).not.toContain("run_with_engine");
    for (const full of [true, false]) {
      expect(engineConnectorsPrompt({ driver: "claudeAgent", claudeAi: false, grokCloud: false, relay: true, full })).not.toMatch(/[–—]/);
    }
  });
});
