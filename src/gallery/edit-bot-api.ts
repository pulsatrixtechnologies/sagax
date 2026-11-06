/** The stand-in /api and the fictional bots of the bot editor gallery
 * (src/gallery/edit-bot.tsx), also rendered by the one-card-level guard
 * (#2175, src/components/BotSettingsDialog.oneCardLevel.dom.test.ts) so the
 * panel and the profile page are checked on the data they are shot with.
 * Fictional data only, neutral names. */
import type { Bot } from "../state/store";
import type { Routine } from "../../shared/routines";
import type { BotOverview } from "../lib/bot-overview-types";

export function editBotFixture(org: boolean, color?: string | null) {
  const bot = {
    id: "scout", threadId: "t-scout", name: "Scout", title: "Recherche", description: "Trouve des sources et les résume.",
    notifications: true, color: color ?? "green", unread: false, messages: [], tasks: [{ id: "task-1", threadId: "t-scout", title: "Tri" }],
    soul: "Sois bref et cite tes sources.", modelSelection: { instanceId: "claude", model: "sonnet" }, approvalMode: "ask",
    computer: org ? "cloud" : "local", mcpServers: null,
    toolScope: { deny: ["mcp:mail:send"] },
    alwaysAllow: ["mcp:mail:read_notes"],
    ...(org ? { workFolder: "/workspace/bots/scout" } : {}),
  } as unknown as Bot;

  // Two more fictional bots, so the sidebar beside the page looks lived in.
  const neighbours = [
    { ...bot, id: "atlas", threadId: "t-atlas", name: "Atlas", title: "Planification", color: "blue", soul: "" },
    { ...bot, id: "nova", threadId: "t-nova", name: "Nova", title: "Courriels", color: "purple", soul: "" },
  ] as Bot[];

  // Activity > Upcoming (#2125): six routines so the card shows "Show more"
  const NOW = Date.now();
  const routines = [
    ["r1", "Résumé du matin des courriels importants", true],
    ["r2", "Veille des sources sur la cybersécurité", true],
    ["r3", "Tri de la boîte de réception", false],
    ["r4", "Rapport hebdomadaire des projets", true],
    ["r5", "Rappel des factures à suivre", true],
    ["r6", "Revue des notes de réunion", true],
  ].map(([id, title, enabled], index) => ({
    id, botId: "scout", name: title, prompt: title, enabled, target: "bot",
    schedule: { type: "cron", expression: `${3 + index} 4 * * *`, timeZone: "America/Toronto" },
    nextRunAt: NOW + (index + 1) * 3_600_000, createdAt: 1, updatedAt: 1,
  }) as unknown as Routine);

  const overview: BotOverview = {
    who: { name: bot.name, title: bot.title, blurb: bot.description, soulLead: bot.soul ?? "" },
    does: ["Daily at 4:03 AM: Résumé du matin des courriels importants."],
    reaches: ["Works in its private workspace.", "Has the built-in browser."],
    wont: ["Won't run commands without asking you first."],
    recent: [{ at: NOW - 3_600_000, summary: "Title changed" }],
    setup: [],
  };

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  /** The stand-in answer for an /api path, or null when the gallery has none. */
  const answer = (path: string): Response | null => {
    if (path === "/api/config") return json({ profile: { name: "Alex Example" }, features: {}, onboarding: { completedAt: 1, launchMode: "solo" }, vps: { configured: false }, box: { configured: false }, tts: { configured: false }, imageGen: { configured: false } });
    if (path === "/api/org") return org
      ? json({ org: { name: "Exemple inc.", identity: { kind: "perspicax", issuer: "https://perspicax.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} })
      : json({ org: null });
    if (path === "/api/mcp/servers") return json({ servers: [
      { name: "mail", enabled: true, auth: "connected" },
      { name: "calendar", enabled: true, auth: "connected" },
      { name: "github", enabled: true, auth: "none" },
    ] });
    if (/\/api\/bots\/[^/]+\/background-brief/.test(path)) return json({ apps: 2, settings: { enabled: false, at: "08:00" }, suggestions: [] });
    if (/\/api\/bots\/[^/]+\/overview/.test(path)) return json(overview);
    // The profile page's General tab (#2126): accounts, email, reach me, Messages.
    if (/\/api\/bots\/[^/]+\/capabilities/.test(path)) {
      const item = (key: string, form: string, name: string, label: string) => ({ key, form, name, source: { kind: "account", label }, scope: "bot", state: "on", enabled: true, canToggle: true, engine: { mcp: "mounted", nothing: false } });
      return json({ botId: bot.id, engine: { kind: "claude", label: "Claude" }, items: [item("github", "connector", "GitHub", "Example account"), item("calendar", "mcp", "Calendar", "Example account")] });
    }
    if (/\/api\/bots\/[^/]+\/inbound-mail/.test(path)) return json({ available: true, address: "pepper@example.com", enabled: true });
    if (/\/api\/bots\/[^/]+\/reach-me/.test(path)) return json({ saved: true, settings: { channels: ["push"], hours: { always: true } }, channels: { push: { ready: true, devices: 1 } } });
    // Knowledge tab: a couple of fictional skills so the list is not empty.
    if (/\/api\/bots\/[^/]+\/skills$/.test(path)) return json({
      skills: [
        { name: "weekly-report", description: "Writes the weekly status report from the open tasks.", enabled: true, source: "taught", warnings: [] },
        { name: "source-check", description: "Checks every claim against two sources before answering.", enabled: true, source: "imported", warnings: [] },
      ],
      staged: [], library: [], assignedSkills: [],
    });
    if (path === "/api/messages") return json({ available: true, onThisMac: true, useMessages: false, permissions: { fullDiskAccess: "notAsked", automation: "notAsked" } });
    if (/\/api\/bots\/[^/]+\/(activity)/.test(path)) return json({ items: [], subagents: [], launchedAgents: [] });
    if (/\/api\/bots\/[^/]+\/task-list/.test(path)) return json({ tasks: [] });
    if (/\/api\/bots\/[^/]+\/webhooks/.test(path)) return json({ webhooks: [] });
    if (/\/api\/bots\/[^/]+\/history/.test(path)) return json({ entries: [] });
    if (/\/api\/bots\/[^/]+\/workspace$/.test(path)) {
      const entry = (p: string, bytes: number) => ({ path: p, kind: "file", bytes, load: "always", editable: true, markdown: true, forgotten: false });
      return json({
        workspacePath: "/workspace/bots/scout", now: Date.now(), forgottenAfterDays: 30,
        budgets: { rules: { maxLines: 200, maxBytes: 20000 }, memory: { maxLines: 200, maxBytes: 20000 }, soul: { maxBytes: 8000 } },
        rulesTemplate: "", soul: { ...entry("SOUL.md", 40), virtual: "soul" },
        entries: [entry("MEMORY.md", 320), entry("RULES.md", 120)], truncated: false,
      });
    }
    if (/\/api\/threads\/[^/]+\/files/.test(path)) return json({ files: [] });
    if (path.startsWith("/api/remote-sessions")) return json({ sessions: [] });
    if (path.includes("/api/artifacts")) return json({ artifacts: [] });
    if (path.includes("/api/pages")) return json({ pages: [] });
    if (path.includes("/api/routines")) return json({ routines, runs: [] });
    return null;
  };

  return { bot, neighbours, routines, overview, answer };
}
