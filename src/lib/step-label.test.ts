import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { readStep, stepArgs, stepDuration, stepJson, stepLabel, stepPhase, stepResult } from "./step-label";

afterEach(() => {
  setLocale("en");
});

const names = (id: string) => ({ b1: "Wren", b2: "Olive" } as Record<string, string>)[id];

describe("step labels in plain words", () => {
  it("never shows the raw id of a known tool", () => {
    const coordinated = stepLabel({ name: "agents_coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["b1", "b2"], message: "go" }) }, names);
    expect(coordinated).toBe("Coordinated Wren and Olive");
    expect(coordinated).not.toContain("coordinate_bots");
    expect(stepLabel({ name: "mcp__agents__coordinate_bots", ok: undefined, input: JSON.stringify({ bot_ids: ["b1"] }) }, names)).toBe("Coordinating Wren");
    expect(stepLabel({ name: "Bash", ok: true })).toBe("Ran a command");
    expect(stepLabel({ name: "WebSearch", ok: true })).toBe("Searched the web");
    expect(stepLabel({ name: "Read", ok: true })).toBe("Read a file");
  });

  it("says a phone tool waits on the person's phone, and which tool (row 81)", () => {
    const running = readStep({ name: "mcp__agents__phone_tool", ok: undefined, input: JSON.stringify({ tool: "location" }) });
    expect(running).toEqual({ label: "Waiting for your phone. Approve it there", target: "Location" });
    expect(readStep({ name: "mcp__agents__phone_tool", ok: true, input: JSON.stringify({ tool: "contacts", query: "Marie" }) }).label).toBe("Used a tool on your phone");
    setLocale("fr");
    expect(readStep({ name: "mcp__agents__phone_tool", ok: undefined, input: JSON.stringify({ tool: "reminders" }) })).toEqual({ label: "L'autorisation doit être donnée sur votre téléphone", target: "Rappels" });
    expect(readStep({ name: "mcp__agents__phone_tool", ok: false, input: JSON.stringify({ tool: "teleport" }) })).toEqual({ label: "N'a pas pu utiliser un outil de votre téléphone" });
  });

  it("speaks in the tense of the state: running, done, failed", () => {
    expect(stepPhase({ ok: undefined })).toBe("running");
    expect(stepPhase({ ok: true })).toBe("done");
    expect(stepPhase({ ok: false })).toBe("failed");
    expect(stepLabel({ name: "Read" })).toBe("Reading a file");
    expect(stepLabel({ name: "Read", ok: false })).toBe("Could not read a file");
  });

  it("reads ConnectWise, SentinelOne and other product tools through their product", () => {
    expect(stepLabel({ name: "mcp__claude_ai_Pulsatrix_Perspicax__cw_psa__find_tickets", ok: true })).toBe("Viewed tickets in ConnectWise PSA");
    expect(stepLabel({ name: "mcp__claude_ai_Pulsatrix_Perspicax__sentinelone__query", ok: true, input: JSON.stringify({ resource: "threats" }) })).toBe("Viewed alerts in SentinelOne");
    expect(readStep({ name: "mcp__pulsatrix__cw_psa__get_ticket", ok: true, input: JSON.stringify({ ticketId: 297048 }) }).target).toBe("#297048");
  });

  it("labels the simplified memory tools like the ones they replace", () => {
    expect(stepLabel({ name: "mcp__perspicax__memory_find", ok: true })).toBe(stepLabel({ name: "mcp__perspicax__memory_search", ok: true }));
    expect(stepLabel({ name: "mcp__perspicax__memory_save", ok: true })).toBe(stepLabel({ name: "mcp__perspicax__memory_write", ok: true }));
  });

  it("falls back to 'Used <tool>' for an unknown tool", () => {
    expect(stepLabel({ name: "frobnicate_widgets", ok: true })).toBe("Used frobnicate widgets");
    expect(stepLabel({ name: "frobnicate", ok: false })).toBe("Could not use frobnicate");
  });

  it("keeps what the step acted on as a quiet target, never JSON", () => {
    expect(readStep({ name: "Read", ok: true, input: JSON.stringify({ file_path: "/repo/src/ChatView.tsx" }) }).target).toBe("ChatView.tsx");
    expect(readStep({ name: "Bash", ok: true, input: JSON.stringify({ command: "pnpm test\n--run" }) }).target).toBe("pnpm test");
    expect(readStep({ name: "WebFetch", ok: true, input: JSON.stringify({ url: "https://example.com/a/b" }) }).target).toBe("example.com");
    expect(readStep({ name: "weird_tool", ok: true, summary: "{\"a\":1}" }).target).toBeUndefined();
  });

  it("reads the server's coordination sentences again in the person's language", () => {
    expect(stepLabel({ name: "Resumed with Wren, Olive results, reviewing", ok: true })).toBe("Got results from Wren and Olive, reviewing");
    setLocale("fr");
    expect(stepLabel({ name: "Resumed with Wren, Olive results, reviewing", ok: true })).toBe("A reçu les résultats de Wren et Olive, révision en cours");
    expect(stepLabel({ name: "Sent to Wren · Standup", ok: true })).toBe("Envoyé à Wren dans Standup");
    expect(stepLabel({ name: "agents_coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["b1", "b2"] }) }, names)).toBe("A coordonné Wren et Olive");
    expect(stepLabel({ name: "mcp__x__cw_psa__find_tickets", ok: true })).toBe("A consulté les billets dans ConnectWise PSA");
    expect(stepLabel({ name: "WebSearch", ok: true })).toBe("A cherché sur le web");
    expect(stepLabel({ name: "frobnicate", ok: true })).toBe("A utilisé frobnicate");
  });

  it("does not show opaque teammate ids as names", () => {
    expect(stepLabel({ name: "coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["0f9a8b7c-6d5e-4f3a-2b1c-0d9e8f7a6b5c"] }) })).toBe("Coordinated teammates");
  });
});

describe("step detail helpers", () => {
  it("formats a quiet duration", () => {
    expect(stepDuration(undefined)).toBeUndefined();
    expect(stepDuration(400)).toBe("<1s");
    expect(stepDuration(2_200)).toBe("2s");
    expect(stepDuration(65_000)).toBe("1m 05s");
  });

  it("summarizes arguments as readable pairs, not raw JSON", () => {
    const pairs = stepArgs(JSON.stringify({ query: "open tickets", ids: [1, 2], conditions: { a: 1, b: 2 }, empty: "" }));
    expect(pairs).toEqual([
      { key: "query", value: "open tickets" },
      { key: "ids", value: "1, 2" },
      { key: "conditions", value: "2 fields" },
    ]);
    expect(stepArgs("not json")).toEqual([]);
  });

  it("cuts a long result and says so", () => {
    expect(stepResult(undefined)).toBeUndefined();
    const result = stepResult(Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"));
    expect(result?.text.split("\n")).toHaveLength(4);
    expect(result?.cut).toBe(true);
  });

  it("keeps the full technical record in the JSON", () => {
    const json = JSON.parse(stepJson({ name: "mcp__agents__coordinate_bots", ok: true, input: "{\"bot_ids\":[\"b1\"]}", output: "{\"ok\":true}" }));
    expect(json).toEqual({ tool: "mcp__agents__coordinate_bots", ok: true, input: { bot_ids: ["b1"] }, output: { ok: true } });
  });

});

describe("an MCP call names its server and tool", () => {
  // pi-mcp-adapter's `mcp` gateway, as rows stored before the driver named the tool
  const gateway = (args: Record<string, unknown>, ok?: boolean) => ({ name: "mcp", ok, input: JSON.stringify(args) });
  const tickets = { server: "pulsatrix-psa", tool: "cw_psa__query", args: { resource: "service.tickets", id: "296221" } };

  it("reads a gateway call as the product tool it ran, never 'Used mcp'", () => {
    expect(stepLabel(gateway(tickets, true))).toBe("Viewed tickets in ConnectWise PSA");
    expect(stepLabel(gateway(tickets))).toBe("Viewing tickets in ConnectWise PSA");
    expect(stepLabel(gateway({ tool: "pulsatrix-psa_cw_psa__query", args: "{\"resource\": \"schedule.entries\"}" }, true))).toContain("ConnectWise PSA");
    expect(stepLabel(gateway(tickets, true))).not.toMatch(/\bmcp\b/);
  });

  it("names the product when a call failed, never the raw tool id", () => {
    expect(stepLabel(gateway(tickets, false))).toBe("Could not use ConnectWise PSA");
    expect(stepLabel({ name: "mcp__pulsatrix-psa__cw_psa__query", ok: false, input: JSON.stringify(tickets.args) })).toBe("Could not use ConnectWise PSA");
    // no product known: the server, titled, stands in
    expect(stepLabel({ name: "mcp__acme-crm__lookup_widget", ok: false })).toBe("Could not use Acme Crm");
  });

  it("keeps the tool id out of the folded row in every phase, and in the detail", () => {
    const accounts = JSON.stringify({ resource: "Accounts" });
    const twilio = (ok?: boolean) => ({ name: "mcp__claude_ai_Pulsatrix_Perspicax__twilio_api__query", ok, input: accounts });
    const raw = /twilio_api|__|mcp__|_query/;
    expect(readStep(twilio(false))).toEqual({ label: "Could not use Twilio", target: "Accounts" });
    for (const ok of [true, undefined, false]) {
      expect(stepLabel(twilio(ok))).not.toMatch(raw);
      expect(stepLabel(twilio(ok))).toContain("Twilio");
    }
    // the server alone, no product known: its words, titled
    expect(stepLabel({ name: "mcp__twilio_api__query", ok: false })).toBe("Could not use Twilio API");
    // a tool named for itself reads as its product
    expect(stepLabel({ name: "mcp__perspicax__flow", ok: true })).toBe("Used Pulsatrix");
    expect(stepLabel({ name: "mcp__acme-crm__frobnicate_widget", ok: undefined })).toBe("Using Acme Crm");
    // the id stays one click away, in the detail's record
    expect(JSON.parse(stepJson(twilio(false))).tool).toBe("mcp__claude_ai_Pulsatrix_Perspicax__twilio_api__query");
    setLocale("fr");
    expect(readStep(twilio(false))).toEqual({ label: "N'a pas pu utiliser Twilio", target: "Accounts" });
  });

  it("reads the gateway's housekeeping in words, with a readable fallback", () => {
    expect(stepLabel(gateway({ server: "pulsatrix-psa" }, true))).toBe("Checked Pulsatrix");
    expect(stepLabel(gateway({ action: "auth-start", server: "pulsatrix-psa" }, false))).toBe("Could not connect to Pulsatrix");
    expect(stepLabel(gateway({ server: "acme_crm" }, true))).toBe("Checked Acme Crm");
    expect(readStep(gateway({ search: "schedule today" }, true))).toEqual({ label: "Searched for MCP tools", target: "schedule today" });
    expect(stepLabel({ name: "mcp", ok: false })).toBe("Could not reach the MCP servers");
  });

  it("reads Grok's search_tool and use_tool rows as what they did, never 'Used use tool'", () => {
    // rows stored before the driver named the tool (grok 1.0.62 titles them use_tool, search_tool)
    const use = (ok?: boolean) => ({ name: "use_tool", ok, input: JSON.stringify({ tool_name: "perspicax__cw_psa__query", tool_input: { resource: "service.tickets" } }) });
    expect(stepLabel(use(true))).toBe("Viewed tickets in ConnectWise PSA");
    expect(stepLabel(use())).toBe("Viewing tickets in ConnectWise PSA");
    expect(stepLabel({ name: "Use Tool", ok: true, input: JSON.stringify({ tool_name: "remote__status", tool_input: {} }) })).not.toMatch(/use tool/i);
    expect(readStep({ name: "search_tool", ok: true, input: JSON.stringify({ query: "remote session health", limit: 20 }) })).toEqual({ label: "Looked for a tool", target: "remote session health" });
    expect(stepLabel({ name: "Search Tool", ok: undefined })).toBe("Looking for a tool");
    // a use_tool whose target is unreadable still reads as a tool, not "use tool"
    expect(stepLabel({ name: "use_tool", ok: true })).toBe("Used a tool");
  });

  it("speaks French when the interface is in French", () => {
    setLocale("fr");
    expect(stepLabel(gateway(tickets, true))).toBe("A consulté les billets dans ConnectWise PSA");
    expect(stepLabel(gateway(tickets, false))).toBe("N'a pas pu utiliser ConnectWise PSA");
    expect(stepLabel({ name: "mcp", ok: false })).toBe("N'a pas pu joindre les serveurs MCP");
    expect(stepLabel({ name: "Read", ok: true })).toBe("A lu un fichier");
    expect(stepDuration(173_000)).toBe("2 min 53 s");
    expect(stepDuration(4_000)).toBe("4 s");
  });
});
