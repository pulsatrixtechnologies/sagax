import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { readStep, stepArgs, stepDuration, stepJson, stepLabel, stepPhase, stepResult, stepToolName, stuckNoticeKey } from "./step-label";

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

  it("reads product tools through the product the server declared", () => {
    expect(stepLabel({ name: "mcp__claude_ai_Example_Gateway__acme_desk__find_tickets", ok: true, product: "Acme Desk" })).toBe("Viewed tickets in Acme Desk");
    expect(stepLabel({ name: "mcp__claude_ai_Example_Gateway__acme_guard__query", ok: true, input: JSON.stringify({ resource: "threats" }), product: "AcmeGuard" })).toBe("Viewed alerts in AcmeGuard");
    // nothing declared: the product prefix's words, titled
    expect(stepLabel({ name: "mcp__claude_ai_Example_Gateway__acme_guard__query", ok: true, input: JSON.stringify({ resource: "threats" }) })).toBe("Viewed alerts in Acme Guard");
    expect(readStep({ name: "mcp__example__acme_desk__get_ticket", ok: true, input: JSON.stringify({ ticketId: 297048 }), product: "Acme Desk" }).target).toBe("#297048");
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

  it("shortens a runCommand target: no UUID, path to last segment, full command in title", () => {
    const bot = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const full = `ls /data/.sagax/bots/${bot}/sagax-plugins`;
    const reading = readStep({ name: "Bash", ok: true, input: JSON.stringify({ command: full }) });
    expect(reading.target).toBe("ls sagax-plugins");
    expect(reading.title).toBe(full);
    expect(reading.target).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(reading.target).not.toContain("/data/");
    const script = readStep({
      name: "run_command",
      ok: true,
      input: JSON.stringify({ command: `python /data/.sagax/bots/${bot}/workspace/scripts/check_health.py --bot ${bot}` }),
    });
    expect(script.target).toBe("python check_health.py");
    expect(script.title).toContain(bot);
    expect(script.target).not.toContain(bot);
  });

  it("reads the server's coordination sentences again in the person's language", () => {
    expect(stepLabel({ name: "Resumed with Wren, Olive results, reviewing", ok: true })).toBe("Got results from Wren and Olive, reviewing");
    setLocale("fr");
    expect(stepLabel({ name: "Resumed with Wren, Olive results, reviewing", ok: true })).toBe("A reçu les résultats de Wren et Olive, révision en cours");
    expect(stepLabel({ name: "Sent to Wren · Standup", ok: true })).toBe("Envoyé à Wren dans Standup");
    expect(stepLabel({ name: "agents_coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["b1", "b2"] }) }, names)).toBe("A coordonné Wren et Olive");
    expect(stepLabel({ name: "mcp__x__acme_desk__find_tickets", ok: true, product: "Acme Desk" })).toBe("A consulté les billets dans Acme Desk");
    expect(stepLabel({ name: "WebSearch", ok: true })).toBe("A cherché sur le web");
    expect(stepLabel({ name: "frobnicate", ok: true })).toBe("A utilisé frobnicate");
  });

  it("reads the loop guard's notice in the person's language, without a dash, the call after it", () => {
    const notice = { name: "Same call repeated 5× - tool: git status - it may be stuck", ok: false };
    expect(readStep(notice)).toEqual({ label: "Same call repeated 5 times. It may be stuck", target: "git status", title: "git status" });
    // the same notice as rows written before 2026-11-02 carry it, with long dashes
    const dash = "\u2014";
    expect(readStep({ name: `Same call repeated 5× ${dash} tool: git status ${dash} it may be stuck`, ok: false })).toEqual(readStep(notice));
    // an ACP agent's kind is no word for a person; a tool's own name stays
    expect(readStep({ name: "Same call repeated 10× - other: sagax-environment__run_command - it may be stuck", ok: false }))
      .toMatchObject({ label: "Same call repeated 10 times. It may be stuck", target: "sagax-environment__run_command" });
    expect(readStep({ name: "Same call repeated 20× - Bash: npm test - it may be stuck", ok: false }).target).toBe("Bash: npm test");
    // a call quoted on several lines, as the guard wrote an ACP or Codex
    // title up to 0.8.28: read on one line, and the same notice with long
    // dashes is the same notice
    const lines = "tool: cd /work/app\npnpm lint\npnpm test";
    const multi = `Same call repeated 5× - ${lines} - it may be stuck`;
    expect(readStep({ name: multi, ok: false }))
      .toEqual({ label: "Same call repeated 5 times. It may be stuck", target: "cd /work/app pnpm lint pnpm test", title: "cd /work/app\npnpm lint\npnpm test" });
    expect(stuckNoticeKey(`Same call repeated 5× ${dash} ${lines} ${dash} it may be stuck`)).toBe(stuckNoticeKey(multi));
    expect(stuckNoticeKey(multi)).toBe("5 tool: cd /work/app pnpm lint pnpm test");
    expect(stuckNoticeKey("Same call repeated 10× - tool: git status - it may be stuck")).not.toBe(stuckNoticeKey(notice.name));
    setLocale("fr");
    const french = readStep(notice);
    expect(french).toEqual({ label: "Même appel répété 5 fois. Il est peut-être bloqué", target: "git status", title: "git status" });
    expect(french.label).not.toMatch(/[\u2013\u2014]/);
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

  it("shows an opaque id as \"…\", the value kept for the tooltip and the JSON record (2026-11-02)", () => {
    const messageId = "AAMkAGI2NGVhZTVlLTI1OGMtNDI4My1iZmE5LTA5OGJiZGEzMzQ0NwBGAAAAAAA-xfvW_8d3SL=";
    const guid = "1bb85ab1-a916-4d5d-bb99-16d471e92409";
    const pairs = stepArgs(JSON.stringify({ message_id: messageId, run: guid, subject: "Invoice 4012" }));
    expect(pairs).toEqual([
      { key: "message_id", value: "…", full: messageId },
      { key: "run", value: "…", full: guid },
      { key: "subject", value: "Invoice 4012" },
    ]);
    expect(stepJson({ name: "mcp__outlook__get_message", ok: false, input: JSON.stringify({ message_id: messageId }) })).toContain(messageId);
  });

  // 2026-11-02 (production): a server path named after the bot's id
  it("shows a path with a bot's id as the bot's name, else as the folder it is, the path in the tooltip", () => {
    const botId = "5a1d0c3e-7b42-4c8e-9f10-2d3e4f5a6b7c";
    const path = `/data/.openmausbot/workspaces/${botId}/docs`;
    const nameOf = (id: string) => (id === botId ? "Nova" : undefined);
    expect(stepArgs(JSON.stringify({ path }), nameOf)).toEqual([{ key: "path", value: "/data/.openmausbot/workspaces/Nova/docs", full: path }]);
    expect(stepArgs(JSON.stringify({ path }))).toEqual([{ key: "path", value: "The bot's own folder/docs", full: path }]);
    expect(stepArgs(JSON.stringify({ path: "/workspace/bots/nova" }))).toEqual([{ key: "path", value: "/workspace/bots/nova" }]);
  });

  it("names a tool in words in its detail, never its raw id (2026-11-02)", () => {
    expect(stepToolName({ name: "mcp__sagax-environment__list_files" })).toBe("List files");
    expect(stepToolName({ name: "mcp__sagax-environment__run_command" })).toBe("Run a command");
    expect(stepToolName({ name: "mcp__desk__view_tickets" })).toBe("View tickets");
    expect(stepToolName({ name: "mcp__gw__acme_desk__query", product: "Acme Desk" })).toBe("Query · Acme Desk");
    for (const name of ["mcp__sagax-environment__list_files", "mcp__desk__view_tickets", "mcp__agents__coordinate_bots"]) {
      expect(stepToolName({ name })).not.toMatch(/__|_/);
    }
    setLocale("fr");
    expect(stepToolName({ name: "mcp__sagax-environment__list_files" })).toBe("Lister les fichiers");
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
  const gateway = (args: Record<string, unknown>, ok?: boolean, product?: string) => ({ name: "mcp", ok, input: JSON.stringify(args), ...(product ? { product } : {}) });
  const tickets = { server: "example-gw", tool: "acme_desk__query", args: { resource: "service.tickets", id: "296221" } };

  it("reads a gateway call as the product tool it ran, never 'Used mcp'", () => {
    expect(stepLabel(gateway(tickets, true, "Acme Desk"))).toBe("Viewed tickets in Acme Desk");
    expect(stepLabel(gateway(tickets, undefined, "Acme Desk"))).toBe("Viewing tickets in Acme Desk");
    expect(stepLabel(gateway({ tool: "example-gw_acme_desk__query", args: "{\"resource\": \"schedule.entries\"}" }, true, "Acme Desk"))).toContain("Acme Desk");
    expect(stepLabel(gateway(tickets, true, "Acme Desk"))).not.toMatch(/\bmcp\b/);
  });

  it("names the product when a call failed, never the raw tool id", () => {
    expect(stepLabel(gateway(tickets, false, "Acme Desk"))).toBe("Could not use Acme Desk");
    expect(stepLabel({ name: "mcp__example-gw__acme_desk__query", ok: false, input: JSON.stringify(tickets.args), product: "Acme Desk" })).toBe("Could not use Acme Desk");
    // no product known: the server, titled, stands in
    expect(stepLabel({ name: "mcp__acme-crm__lookup_widget", ok: false })).toBe("Could not use Acme Crm");
  });

  it("keeps the tool id out of the folded row in every phase, and in the detail", () => {
    const accounts = JSON.stringify({ resource: "Accounts" });
    const voice = (ok?: boolean) => ({ name: "mcp__claude_ai_Example_Gateway__acme_voice__query", ok, input: accounts, product: "Acme Voice" });
    const raw = /acme_voice|__|mcp__|_query/;
    expect(readStep(voice(false))).toEqual({ label: "Could not use Acme Voice", target: "Accounts" });
    for (const ok of [true, undefined, false]) {
      expect(stepLabel(voice(ok))).not.toMatch(raw);
      expect(stepLabel(voice(ok))).toContain("Acme Voice");
    }
    // the server alone, no product known: its words, titled
    expect(stepLabel({ name: "mcp__acme_api__query", ok: false })).toBe("Could not use Acme API");
    // a tool named for itself reads as its product
    expect(stepLabel({ name: "mcp__perspicax__flow", ok: true })).toBe("Used Pulsatrix");
    expect(stepLabel({ name: "mcp__acme-crm__frobnicate_widget", ok: undefined })).toBe("Using Acme Crm");
    // the id stays one click away, in the detail's record
    expect(JSON.parse(stepJson(voice(false))).tool).toBe("mcp__claude_ai_Example_Gateway__acme_voice__query");
    setLocale("fr");
    expect(readStep(voice(false))).toEqual({ label: "N'a pas pu utiliser Acme Voice", target: "Accounts" });
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
    const use = (ok?: boolean) => ({ name: "use_tool", ok, input: JSON.stringify({ tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }), product: "Acme Desk" });
    expect(stepLabel(use(true))).toBe("Viewed tickets in Acme Desk");
    expect(stepLabel(use())).toBe("Viewing tickets in Acme Desk");
    expect(stepLabel({ name: "Use Tool", ok: true, input: JSON.stringify({ tool_name: "remote__status", tool_input: {} }) })).not.toMatch(/use tool/i);
    expect(readStep({ name: "search_tool", ok: true, input: JSON.stringify({ query: "remote session health", limit: 20 }) })).toEqual({ label: "Looked for a tool", target: "remote session health" });
    expect(stepLabel({ name: "Search Tool", ok: undefined })).toBe("Looking for a tool");
    // a use_tool whose target is unreadable still reads as a tool, not "use tool"
    expect(stepLabel({ name: "use_tool", ok: true })).toBe("Used a tool");
  });

  it("speaks French when the interface is in French", () => {
    setLocale("fr");
    expect(stepLabel(gateway(tickets, true, "Acme Desk"))).toBe("A consulté les billets dans Acme Desk");
    expect(stepLabel(gateway(tickets, false, "Acme Desk"))).toBe("N'a pas pu utiliser Acme Desk");
    expect(stepLabel({ name: "mcp", ok: false })).toBe("N'a pas pu joindre les serveurs MCP");
    expect(stepLabel({ name: "Read", ok: true })).toBe("A lu un fichier");
    expect(stepDuration(173_000)).toBe("2 min 53 s");
    expect(stepDuration(4_000)).toBe("4 s");
  });
});

// 2026-11-03: Grok's gateway names a connector's tool with `_5f` escapes and
// the server's number; a card read "Could not use User Outlook Get 5fmail
// 5fmessage" and its Tool row a bare "12".
describe("a gateway tool name reads as its connector and tool", () => {
  const titles = ["user-Outlook-get_5fmail_5fmessage___12", "cursor__user-Outlook-get_5fmail_5fmessage___12", "mcp__cursor__user-Outlook-get_5fmail_5fmessage___12"];

  it("decodes the escape and never shows a bare number as the tool", () => {
    for (const name of titles) {
      const label = readStep({ name, ok: false }).label;
      expect(label).not.toMatch(/5f|User Outlook|12/);
      expect(label).toContain("Outlook");
      expect(stepToolName({ name })).toMatch(/^Get mail message · Outlook/);
    }
    expect(readStep({ name: "user-Outlook-list_5fmail_5fmessages___12", ok: true }).label).not.toMatch(/5f|User Outlook/);
    expect(stepToolName({ name: "user-Outlook-list_5fmail_5fmessages___12" })).toMatch(/^List mail messages · Outlook/);
  });

  it("never names a tool by a number alone", () => {
    expect(stepToolName({ name: "osprey___12" })).toBe("Osprey");
    expect(stepToolName({ name: "mcp__wren__lookup___7" })).toBe("Lookup");
    // an ordinary name keeps its digits and its underscores' words
    expect(stepToolName({ name: "mcp__wren__step_12" })).toBe("Step 12");
  });
});
