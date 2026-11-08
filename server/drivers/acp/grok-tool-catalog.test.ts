import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  GROK_CATALOG_CHARS_MAX,
  grokAccountReach,
  grokCatalogFor,
  grokGatewayConnectors,
  grokReachConnectorNames,
  noteGrokAccountReach,
  grokCatalogSection,
  readGrokCatalog,
  rememberGrokCatalog,
  resetGrokCatalogs,
  sagaxAgentToolBareName,
} from "./grok-tool-catalog.ts";
import { GROK_KNOWN_TOOLS_SECTION } from "./grok-tool-usage.ts";
import { grokTurnCatalogSection } from "./grok.ts";
import { resetTurnActiveProfileResolver, setTurnActiveProfileResolver } from "../../turns/turn-active-profile.ts";

afterEach(() => {
  resetGrokCatalogs();
  resetTurnActiveProfileResolver();
});

// the shape grok 1.0.62 answers `_x.ai/mcp/list` with (measured 2026-10-22)
const LIST = {
  sessionMcpResolved: true,
  servers: [
    { name: "remote", source: "local", type: "stdio", session: { enabled: true, status: "ready", tools: [
      { name: "status", description: "Status", enabled: true }, { name: "diagnostics", description: "Health", enabled: true },
      { name: "shell", description: "Run", enabled: false },
    ] } },
    { name: "perspicax", source: "local", type: "stdio", session: { enabled: true, status: "ready", tools: [
      { name: "cw_psa_get_ticket", enabled: true }, { name: "api_list", enabled: true },
    ] } },
    { name: "vercel", source: "local", session: { enabled: true, status: "unavailable", authRequired: true } },
    { name: "off", session: { enabled: false, status: "ready", tools: [{ name: "x" }] } },
  ],
};

describe("readGrokCatalog", () => {
  it("keeps enabled servers and tools, by name, sorted", () => {
    expect(readGrokCatalog(LIST)).toEqual([
      { name: "perspicax", status: "ready", tools: ["api_list", "cw_psa_get_ticket"] },
      { name: "remote", status: "ready", tools: ["diagnostics", "status"] },
      { name: "vercel", status: "needs sign-in", tools: [] },
    ]);
    expect(readGrokCatalog(null)).toBeUndefined();
    expect(readGrokCatalog({ servers: "x" })).toBeUndefined();
  });

  it("remembers the last catalog per session", () => {
    rememberGrokCatalog("s1", LIST);
    expect(grokCatalogFor("s1")?.map((server) => server.name)).toEqual(["perspicax", "remote", "vercel"]);
    expect(grokCatalogFor("s2")).toBeUndefined();
    rememberGrokCatalog("s1", { garbage: true });
    expect(grokCatalogFor("s1")).toHaveLength(3);
  });
});

describe("grokCatalogSection", () => {
  it("names every ready tool by its use_tool name, with the no-call rule for capability questions", () => {
    const section = grokCatalogSection({ catalog: readGrokCatalog(LIST) })!;
    expect(section.id).toBe(GROK_KNOWN_TOOLS_SECTION);
    expect(section.text).toContain("- perspicax: api_list, cw_psa_get_ticket");
    expect(section.text).toContain("- remote: diagnostics, status");
    expect(section.text).toContain("without calling a tool");
    // no direct-call rule for tools the model never saw (bench: +4 to 6 s of argument deliberation)
    expect(section.text).not.toContain("search_tool first");
    expect(section.text).toContain("Not connected now: vercel (needs sign-in)");
    expect(section.text).not.toContain("shell");
  });

  it("is the same text for the same catalog (sent once per session)", () => {
    const a = grokCatalogSection({ catalog: readGrokCatalog(LIST), known: ["perspicax__api_list"] });
    const b = grokCatalogSection({ catalog: readGrokCatalog({ ...LIST, servers: [...LIST.servers].reverse() }), known: ["perspicax__api_list"] });
    expect(a).toEqual(b);
  });

  it("shows only the bot's own tools of a very large server, with a count", () => {
    const tools = Array.from({ length: 70 }, (_, i) => ({ name: `tool_${String(i).padStart(2, "0")}`, enabled: true }));
    const catalog = readGrokCatalog({ servers: [{ name: "agents", session: { enabled: true, status: "ready", tools } }] });
    const section = grokCatalogSection({ catalog, known: ["agents__tool_07"], pinned: ["agents__tool_42"] })!;
    expect(section.text).toContain("- agents (70 tools; search_tool for the others): tool_07, tool_42");
    expect(section.text).not.toContain("tool_08");
    expect(section.text).toContain("Already used, call directly with use_tool without search_tool first: agents__tool_07.");
    // a truncated server: the list is not complete, so it must not say so
    expect(section.text).not.toContain("This list is complete");
    expect(section.text).toContain("without calling a tool");
  });

  it("offers pinned tools and their lines even before the catalog is read", () => {
    const section = grokCatalogSection({ catalog: undefined, pinned: ["agents__remote_session_snapshot"], lines: ["Remote session open on MAC-DEMO-01."] })!;
    expect(section.text).toContain("Open for this conversation, call directly with use_tool: agents__remote_session_snapshot.");
    expect(section.text).toContain("Remote session open on MAC-DEMO-01.");
    expect(grokCatalogSection({ catalog: [] })).toBeNull();
  });

  it("names connectable-but-not-connected xAI cloud connectors and offers the connect card instead of a dead end", () => {
    // Outlook/Teams are on the Connect-apps card (static catalog) but the
    // person never connected them on grok.com, so they are absent from the
    // live _x.ai/mcp/list. The summary must say so and point at the card,
    // and must NOT claim the live list is complete.
    const section = grokCatalogSection({
      catalog: readGrokCatalog(LIST),
      connectable: [{ id: "outlook", label: "Outlook (Exchange)" }, { id: "microsoft-teams", label: "Microsoft Teams" }],
    })!;
    expect(section.text).toContain("- perspicax: api_list, cw_psa_get_ticket");
    expect(section.text).toContain("Connectable but not connected yet");
    expect(section.text).toContain("Outlook (Exchange)");
    expect(section.text).toContain("Microsoft Teams");
    expect(section.text).toContain("agents__open_connector_setup");
    // the live list is NOT complete when the person can still connect more
    expect(section.text).not.toContain("This list is complete");
    // still answered from context, no blind search for a connector
    expect(section.text).toContain("without calling a tool");
  });

  it("drops a connectable connector that is already present in the live catalog", () => {
    const catalog = readGrokCatalog({
      servers: [{ name: "outlook", session: { enabled: true, status: "ready", tools: [{ name: "read_mail", enabled: true }] } }],
    });
    const section = grokCatalogSection({
      catalog,
      connectable: [{ id: "outlook", label: "Outlook (Exchange)" }, { id: "microsoft-teams", label: "Microsoft Teams" }],
    })!;
    // outlook is live/ready, so it is not re-offered as connectable
    expect(section.text).toContain("- outlook: read_mail");
    expect(section.text).toContain("Connectable but not connected yet");
    expect(section.text).toContain("Microsoft Teams");
    expect(section.text).not.toMatch(/Connectable but not connected yet[^\n]*Outlook/);
  });

  it("drops a connectable connector that is in the catalog but still needs sign-in", () => {
    const catalog = readGrokCatalog({
      servers: [{ name: "microsoft-teams", session: { enabled: true, status: "unavailable", authRequired: true } }],
    });
    const section = grokCatalogSection({
      catalog,
      connectable: [{ id: "microsoft-teams", label: "Microsoft Teams" }, { id: "gmail", label: "Gmail" }],
    })!;
    // teams is already added (needs sign-in) -> it is not in the connectable line
    expect(section.text).toContain("Not connected now: microsoft-teams (needs sign-in)");
    expect(section.text).toContain("Connectable but not connected yet");
    expect(section.text).toContain("Gmail");
    expect(section.text).not.toMatch(/Connectable but not connected yet[^\n]*Microsoft Teams/);
  });

  it("keeps the complete-list claim when nothing is connectable (back-compat)", () => {
    const section = grokCatalogSection({ catalog: readGrokCatalog(LIST), connectable: [] })!;
    expect(section.text).toContain("This list is complete");
    expect(section.text).not.toContain("Connectable but not connected yet");
  });

  it("stays under its budget with many servers", () => {
    const servers = Array.from({ length: 40 }, (_, s) => ({ name: `server_${s}`, session: { enabled: true, status: "ready",
      tools: Array.from({ length: 30 }, (_, i) => ({ name: `a_rather_long_tool_name_${i}`, enabled: true })) } }));
    // enough servers that even the names-only fallback must be cut
    for (let s = 40; s < 400; s += 1) servers.push({ name: `server_${s}`, session: { enabled: true, status: "ready", tools: [{ name: "t", enabled: true }] } } as never);
    const section = grokCatalogSection({ catalog: readGrokCatalog({ servers }), known: ["server_3__a_rather_long_tool_name_1"] })!;
    expect(section.text.length).toBeLessThanOrEqual(GROK_CATALOG_CHARS_MAX);
    expect(section.text).toContain("server_0 (30)");
    // cut at a whole entry, never mid-name, and the bot's own tools survive
    expect(section.text).toMatch(/(\(30\)[,.]|tools\.|first: [^\n]*\.)$/);
    expect(section.text).toContain("Already used, call directly with use_tool without search_tool first: server_3__a_rather_long_tool_name_1.");
  });
});

// 2026-10-28 (Sagax 0.8.13 on ACME): grok.com's connectors reach the CLI as
// ONE managed gateway server whose tool names carry the connector. Sagax
// looked for `microsoft_teams`/`outlook` servers, so a turn that had Teams
// and Outlook was told "Connectable but not connected yet ... you have NO
// tool". The fixture is the real answer's shape (grok 1.0.46), trimmed.
const GATEWAY = JSON.parse(readFileSync(new URL("../../testing/grok-gateway-mcp-list.json", import.meta.url), "utf8"));
const CONNECTABLE = [
  { id: "outlook", label: "Outlook (Exchange)" }, { id: "microsoft-teams", label: "Microsoft Teams" }, { id: "gmail", label: "Gmail" },
];

describe("grok's managed gateway (grok.com connectors)", () => {
  it("reads the gateway server with every tool, long names included", () => {
    const gateway = readGrokCatalog(GATEWAY)!.find((server) => server.name === "managed_gateway:cursor")!;
    expect(gateway.gateway).toBe(true);
    expect(gateway.status).toBe("ready");
    // 66 characters: over the 64 a function name may have, a valid catalog key
    expect(gateway.tools).toContain("cursor__user-Outlook-calendar-respond_5fto_5fcalendar_5fevent___21");
    expect(gateway.tools).toHaveLength(10);
  });

  it("reads a team account's one-server-per-connector gateway (grok 1.0.46, 2026-10-30)", () => {
    const team = JSON.parse(readFileSync(new URL("../../testing/grok-gateway-team-mcp-list.json", import.meta.url), "utf8"));
    const groups = grokGatewayConnectors(readGrokCatalog(team)!);
    // Outlook mail and Outlook Calendar are the Outlook connector of the card
    expect(groups.map((group) => [group.id, group.label, group.tools.length])).toEqual([
      ["microsoft-teams", "Microsoft Teams", 10],
      ["outlook", "Outlook (Exchange)", 17],
      [undefined, "Automations", 2],
    ]);
    noteGrokAccountReach("/home/team", team, 7);
    expect(grokAccountReach("/home/team")).toMatchObject({ gateway: true, connectors: ["microsoft-teams", "outlook"] });
    const text = grokCatalogSection({ catalog: readGrokCatalog(team), connectable: CONNECTABLE })!.text;
    expect(text).toMatch(/Microsoft Teams \(10 tools, e\.g\. microsoft_teams__(list|get|search)_/);
    expect(text).not.toMatch(/Connectable but not connected yet[^\n]*(Teams|Outlook)/);
  });

  it("groups the gateway's tools by connector, known ones first", () => {
    const groups = grokGatewayConnectors(readGrokCatalog(GATEWAY)!);
    expect(groups.map((group) => [group.id, group.label, group.tools.length])).toEqual([
      ["microsoft-teams", "Microsoft Teams", 4],
      ["outlook", "Outlook (Exchange)", 5],
      [undefined, "Automations", 2],
      [undefined, "Docs Hub", 1],
    ]);
  });

  it("says Teams and Outlook are connected, with an exact tool to call, and offers only what is missing", () => {
    const text = grokCatalogSection({ catalog: readGrokCatalog(GATEWAY), connectable: CONNECTABLE })!.text;
    expect(text).toContain("Connected on this xAI account through grok.com");
    expect(text).toContain("Microsoft Teams (4 tools, e.g. cursor__user-Teams-get_5fme___10)");
    expect(text).toMatch(/Outlook \(Exchange\) \(5 tools, e.g. cursor__user-Outlook-[^)]*(list|get)_5f/);
    expect(text).toMatch(/Connectable but not connected yet[^\n]*: Gmail\./);
    expect(text).not.toMatch(/Connectable but not connected yet[^\n]*(Teams|Outlook)/);
    // never `<server>__<tool>` with the gateway's own name
    expect(text).not.toContain("managed_gateway:cursor");
    expect(text).not.toContain("returned no grok.com connector");
  });

  it("says plainly when Grok returned no gateway at all for this sign-in", () => {
    const text = grokCatalogSection({ catalog: readGrokCatalog({ servers: [], sessionMcpResolved: true }), connectable: CONNECTABLE })!.text;
    expect(text).toContain("Connectable but not connected yet");
    expect(text).toContain("Grok returned no grok.com connector at all for this sign-in");
  });

  it("keeps what an account's sign-in brought, by its folder", () => {
    noteGrokAccountReach("/data/principals/p1/grok", GATEWAY, 1_000);
    noteGrokAccountReach("/data/principals/p2/grok", { servers: [], sessionMcpResolved: true }, 2_000);
    noteGrokAccountReach(undefined, GATEWAY);
    expect(grokAccountReach("/data/principals/p1/grok")).toMatchObject({ gateway: true, connectors: ["microsoft-teams", "outlook"], at: 1_000 });
    expect(grokAccountReach("/data/principals/p2/grok")).toEqual({ gateway: false, connectors: [], groups: [], at: 2_000 });
    expect(grokAccountReach("/data/principals/p3/grok")).toBeUndefined();
  });

  it("2026-10-29: a sign-in's reach keeps every connector with its tool count, named as the switch and the prompts name them", () => {
    noteGrokAccountReach("/data/principals/p1/grok-2", GATEWAY, 1_000);
    const reach = grokAccountReach("/data/principals/p1/grok-2")!;
    expect(reach.groups.map((group) => group.id ?? group.label)).toEqual(["microsoft-teams", "outlook", "Automations", "Docs Hub"]);
    expect(reach.groups.every((group) => group.tools > 0)).toBe(true);
    expect(grokReachConnectorNames(reach)).toEqual(["Microsoft Teams", "Outlook (Exchange)", "Automations", "Docs Hub"]);
    expect(grokReachConnectorNames(undefined)).toEqual([]);
  });
});

// Perspicax #1050: several Perspicax accounts on the same xAI gateway each
// serve send_prompt / await_turn / list_agents. The catalog keeps them once.
const DUPLICATE_SAGAX_AGENT = {
  sessionMcpResolved: true,
  servers: [
    {
      name: "managed_gateway:cursor",
      displayName: "Cursor",
      source: "managed",
      type: "managedGateway",
      session: {
        enabled: true,
        status: "ready",
        tools: [
          { name: "cursor__user-dispatch-send_5fprompt___10", enabled: true },
          { name: "cursor__user-dispatch-await_5fturn___10", enabled: true },
          { name: "cursor__user-dispatch-list_5fagents___10", enabled: true },
          { name: "cursor__user-dispatch-api_5flist___10", enabled: true },
          { name: "cursor__user-personal-bot-send_5fprompt___11", enabled: true },
          { name: "cursor__user-personal-bot-await_5fturn___11", enabled: true },
          { name: "cursor__user-personal-bot-list_5fagents___11", enabled: true },
          { name: "cursor__user-personal-bot-cw_5fpsa_5fget_5fticket___11", enabled: true },
          { name: "cursor__user-default-send_5fprompt___12", enabled: true },
          { name: "cursor__user-default-await_5fturn___12", enabled: true },
          { name: "cursor__user-default-sagax_5fhelp___12", enabled: true },
        ],
      },
    },
  ],
};

describe("duplicate Sagax agent tools across Perspicax gateway connectors (#1050)", () => {
  it("reads the bare Sagax agent name from a gateway use_tool id", () => {
    expect(sagaxAgentToolBareName("cursor__user-dispatch-send_5fprompt___10")).toBe("send_prompt");
    expect(sagaxAgentToolBareName("cursor__user-default-sagax_5fhelp___12")).toBe("sagax_help");
    expect(sagaxAgentToolBareName("cursor__user-dispatch-api_5flist___10")).toBeUndefined();
    expect(sagaxAgentToolBareName("dispatch__await_turn")).toBe("await_turn");
  });

  it("keeps each Sagax agent tool once on the first connector when no active profile is known", () => {
    const groups = grokGatewayConnectors(readGrokCatalog(DUPLICATE_SAGAX_AGENT)!);
    expect(groups.map((group) => group.label)).toEqual(["default", "dispatch", "personal-bot"]);
    const byLabel = Object.fromEntries(groups.map((group) => [group.label, group]));
    // first sorted connector ("default") keeps the agent tools it shares
    expect(byLabel.default!.tools).toEqual([
      "cursor__user-default-await_5fturn___12",
      "cursor__user-default-sagax_5fhelp___12",
      "cursor__user-default-send_5fprompt___12",
    ]);
    expect(byLabel.default!.sagaxAgentToolsNote).toMatch(/Sagax agent tools \(await_turn, send_prompt\) kept once/);
    expect(byLabel.default!.sagaxAgentToolsNote).toMatch(/folded/);
    // list_agents was only on dispatch and personal-bot: first of those keeps it
    expect(byLabel.dispatch!.tools).toEqual([
      "cursor__user-dispatch-api_5flist___10",
      "cursor__user-dispatch-list_5fagents___10",
    ]);
    expect(byLabel.dispatch!.sagaxAgentToolsNote).toMatch(/list_agents/);
    expect(byLabel["personal-bot"]!.tools).toEqual(["cursor__user-personal-bot-cw_5fpsa_5fget_5fticket___11"]);
    expect(byLabel["personal-bot"]!.sagaxAgentToolsNote).toBeUndefined();
  });

  it("keeps them on the active profile's connector when one is known", () => {
    const groups = grokGatewayConnectors(readGrokCatalog(DUPLICATE_SAGAX_AGENT)!, { activeProfile: "personal-bot" });
    const byLabel = Object.fromEntries(groups.map((group) => [group.label, group]));
    expect(byLabel["personal-bot"]!.tools.map((tool) => sagaxAgentToolBareName(tool) ?? tool)).toEqual([
      "await_turn",
      "cursor__user-personal-bot-cw_5fpsa_5fget_5fticket___11",
      "list_agents",
      "send_prompt",
    ]);
    expect(byLabel["personal-bot"]!.sagaxAgentToolsNote).toMatch(/kept once on this connector/);
    expect(byLabel.dispatch!.tools).toEqual(["cursor__user-dispatch-api_5flist___10"]);
    // default keeps sagax_help (never duplicated) after losing send_prompt / await_turn
    expect(byLabel.default!.tools).toEqual(["cursor__user-default-sagax_5fhelp___12"]);
  });

  it("says the fold in the catalog section text", () => {
    const text = grokCatalogSection({
      catalog: readGrokCatalog(DUPLICATE_SAGAX_AGENT),
      activeProfile: "dispatch",
    })!.text;
    expect(text).toMatch(/dispatch \(4 tools, e\.g\. cursor__user-dispatch-/);
    expect(text).toMatch(/Sagax agent tools \(await_turn, list_agents, send_prompt\) kept once on this connector/);
    expect(text).not.toContain("cursor__user-personal-bot-send_5fprompt___11");
    expect(text).not.toContain("cursor__user-default-send_5fprompt___12");
  });

  // #2258: volatileSection reads the turn's active Perspicax profile and
  // keeps Sagax agent tools on that connector (not the alphabetically first).
  it("grokTurnCatalogSection keeps agent tools on the turn's active profile connector", () => {
    setTurnActiveProfileResolver((threadId, botId) => {
      expect(threadId).toBe("thread-active");
      expect(botId).toBe("bot-1");
      return "personal-bot";
    });
    rememberGrokCatalog("session-active", DUPLICATE_SAGAX_AGENT);
    const text = grokTurnCatalogSection({
      botId: "bot-1",
      serverNames: [],
      sessionId: "session-active",
      threadId: "thread-active",
    })!.text;
    expect(text).toMatch(/personal-bot \(4 tools, e\.g\. cursor__user-personal-bot-/);
    expect(text).toMatch(/Sagax agent tools \(await_turn, list_agents, send_prompt\) kept once on this connector/);
    expect(text).not.toContain("cursor__user-default-send_5fprompt___12");
    expect(text).not.toContain("cursor__user-dispatch-send_5fprompt___10");
    // without the turn profile, "default" would keep the shared agent tools
    expect(text).toMatch(/default \(1 tool/);
  });

  it("grokTurnCatalogSection keeps the first connector when the turn has no active profile", () => {
    setTurnActiveProfileResolver(() => undefined);
    rememberGrokCatalog("session-none", DUPLICATE_SAGAX_AGENT);
    const text = grokTurnCatalogSection({
      botId: "bot-1",
      serverNames: [],
      sessionId: "session-none",
      threadId: "thread-none",
    })!.text;
    // alphabetically first ("default") keeps the shared agent tools
    expect(text).toMatch(/default \(3 tools, e\.g\. cursor__user-default-/);
    expect(text).toMatch(/Sagax agent tools \(await_turn, send_prompt\) kept once on this connector/);
    expect(text).not.toContain("cursor__user-personal-bot-send_5fprompt___11");
  });
});
