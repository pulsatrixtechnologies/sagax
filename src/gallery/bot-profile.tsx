/** Gallery of the bot profile page (PersonaEditorModal > BotProfilePage), in
 * organization mode, with every /api path the page and its sections call
 * answered by a rich, fictional stand-in so each section shows content.
 * Query: ?section=<overview|...> (default overview), ?skin=<skin id>, ?lang=<en|fr>.
 * Self-contained on purpose (no import of the other gallery fixtures): other
 * edits to the page cannot break it. Fictional names only. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PersonaEditorModal } from "../components/persona/PersonaEditorModal";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type BotSettingsSection } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const BOT_ID = "scout";

const PEOPLE = [
  { principalId: "pr_alex", name: "Alex Example", login: "alex", email: "alex@northwind.example", role: "admin" as const, disabled: false },
  { principalId: "pr_sam", name: "Sam Rivera", login: "sam", email: "sam@northwind.example", role: "member" as const, disabled: false },
  { principalId: "pr_jordan", name: "Jordan Lee", login: "jordan", email: "jordan@northwind.example", role: "member" as const, disabled: false },
  { principalId: "pr_casey", name: "Casey Morgan", login: "casey", email: "casey@northwind.example", role: "member" as const, disabled: false },
];

const SOUL = [
  "# Scout",
  "",
  "You are Scout, a research assistant for Northwind Studio.",
  "You find sources, read them, and summarize them in plain language.",
  "",
  "## How you work",
  "- Be brief. Lead with the answer, then the evidence.",
  "- Cite every claim with a link and the date you read it.",
  "- Check each claim against two independent sources before you state it.",
  "- When sources disagree, say so and show both sides.",
  "- Never guess. Say what you could not find.",
  "",
  "## Tone",
  "Warm, direct, no filler. Use the language the person writes in.",
].join("\n");

const RULES = [
  "# Rules",
  "",
  "- Ask before sending anything to a person outside Northwind Studio.",
  "- Keep summaries under 200 words unless asked for more.",
  "- Save durable findings to memory with a one line source.",
  "- Never open a link from an unknown sender.",
].join("\n");

const MEMORY = [
  "# Memory",
  "",
  "- Alex prefers short answers with links.",
  "- The weekly report goes out on Friday at 4 PM.",
  "- Sam owns the vendor comparison; Jordan owns the market notes.",
].join("\n");

const bot = {
  id: BOT_ID, threadId: "t-scout", name: "Scout", title: "Research", description: "Finds sources and summarizes them.",
  notifications: true, speakReplies: false, color: "green", unread: false, messages: [], tasks: [
    { id: "task-1", threadId: "t-scout", title: "Vendor comparison", usage: { input: 1_240_000, output: 186_000, cachedInput: 910_000, costUsd: 4.82, turns: 64 } },
    { id: "task-2", threadId: "t-scout-2", title: "Market notes", usage: { input: 520_000, output: 74_000, cachedInput: 380_000, costUsd: 1.97, turns: 28 } },
    { id: "task-3", threadId: "t-scout-3", title: "Weekly digest", usage: { input: 210_000, output: 41_000, costUsd: 0.88, turns: 12 } },
  ],
  soul: SOUL, modelSelection: { instanceId: "claude", model: "sonnet" }, approvalMode: "ask",
  computer: "cloud", mcpServers: null,
  toolScope: { deny: ["mcp:mail:send"] },
  alwaysAllow: ["mcp:mail:read_notes"],
  workFolder: "/workspace/bots/scout", ownerUserId: "pr_alex", turnPayerDefault: "owner",
  grants: [{ target: "user:pr_sam", level: "use" }, { target: "user:pr_jordan", level: "edit" }, { target: "user:pr_casey", level: "run" }],
  // ?shape=sprout dresses Scout as that shape (header captures per mascot).
  ...(params.get("shape") ? { mascotLook: { character: "shape", shape: params.get("shape") } } : {}),
} as unknown as Bot;
const neighbours = [
  { ...bot, id: "atlas", threadId: "t-atlas", name: "Atlas", title: "Planning", color: "blue", soul: "" },
  { ...bot, id: "nova", threadId: "t-nova", name: "Nova", title: "Email", color: "purple", soul: "" },
] as Bot[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// History: 36 versions over 3 days, newest first. One run of 12 consecutive
// "soul" edits by the same person, then rules, model and name changes.
function historyRows() {
  const rows: Array<Record<string, unknown>> = [];
  let at = NOW - 4 * MIN;
  let n = 0;
  const push = (actor: string, via: string, field: string, summary: string, extra: Record<string, unknown> = {}) => {
    rows.push({ id: `h${++n}`, at, actor, via, field, summary, canRestore: field === "soul" || field === "name" || field === "title", ...extra });
  };
  const step = (min: number) => { at -= min * MIN; };
  push("user", "page", "soul", "Soul edited", { before: "Be brief and cite sources.", after: SOUL });
  step(41); push("user", "page", "model", "Model changed to Sonnet");
  step(95); push("user", "page", "rules", "Rules edited");
  for (let i = 0; i < 12; i += 1) { step(3 + (i % 4)); push("user", "page", "soul", `Soul edited (${i + 1} of 12)`, { before: `${SOUL.slice(0, 40 + i)}`, after: `${SOUL.slice(0, 44 + i)}` }); }
  step(210); push("bot", "chat", "description", "Description updated by Scout", { before: "Finds sources.", after: "Finds sources and summarizes them." });
  step(130); push("user", "page", "name", "Name changed to Scout", { before: "Scout Beta", after: "Scout" });
  step(300); push("user", "page", "rules", "Rules edited");
  step(60); push("file", "file", "soul", "SOUL.md changed on disk");
  step(520); push("user", "restore", "soul", "Restored an earlier version of the soul", { canRestore: false });
  for (let i = 0; i < 5; i += 1) { step(12 + i); push("user", "page", "soul", `Soul edited (${i + 1} of 5)`); }
  step(400); push("user", "page", "model", "Model changed to Opus");
  step(180); push("user", "page", "title", "Title changed to Research", { before: "Helper", after: "Research" });
  step(240); push("user", "page", "rules", "Rules edited");
  step(200); push("system", "system", "notifications", "Notifications turned on");
  step(1100); push("import", "import", "soul", "Imported a soul from a file");
  step(360); push("user", "page", "name", "Name changed to Scout Beta", { before: "Helper", after: "Scout Beta" });
  step(120); push("user", "page", "description", "Description set", { before: "", after: "Finds sources." });
  return rows;
}
const HISTORY = historyRows();

// Per-day figures that sum back to each row's total, with a weekly rhythm so
// the stacked bars differ day to day (the server sends the same shape).
function usageDays(answer: { byAccount: GroupRow[]; byModel: GroupRow[]; bySource: GroupRow[]; byPerson: GroupRow[] }, count: number, offset: number) {
  const first = NOW - (count * (offset + 1) - 1) * DAY;
  const keys = Array.from({ length: count }, (_, index) => new Date(first + index * DAY).toISOString().slice(0, 10));
  const weight = (seed: number, day: number) => 0.35 + ((Math.sin((seed + 1) * 12.9898 + (day + offset * 7) * 78.233) * 43758.5453) % 1 + 1) % 1;
  const spread = (rows: GroupRow[], group: number) => keys.map((_, day) => {
    const part: Record<string, { costUsd: number; tokens: number }> = {};
    rows.forEach((row, index) => {
      const sum = keys.reduce((total, __, d) => total + weight(group * 31 + index, d), 0);
      const share = weight(group * 31 + index, day) / sum;
      part[row.key] = { costUsd: Number(((row.costUsd ?? 0) * share).toFixed(4)), tokens: Math.round((row.inputTokens + row.outputTokens) * share) };
    });
    return part;
  });
  const accounts = spread(answer.byAccount, 1);
  const models = spread(answer.byModel, 2);
  const sources = spread(answer.bySource, 3);
  const people = spread(answer.byPerson, 4);
  return keys.map((day, index) => {
    const total = Object.values(models[index]!).reduce((sum, value) => ({ costUsd: sum.costUsd + value.costUsd, tokens: sum.tokens + value.tokens }), { costUsd: 0, tokens: 0 });
    return { day, total, byAccount: accounts[index]!, byModel: models[index]!, bySource: sources[index]!, byPerson: people[index]! };
  });
}

interface GroupRow { key: string; costUsd: number | null; inputTokens: number; outputTokens: number }

// The V6 usage breakdown (#2612): example figures in the shape the server sends.
function breakdown(period: string, offset = 0) {
  const scale = period === "7" ? 0.25 : period === "month" ? 0.3 : 1;
  const g = (key: string, label: string, turns: number, input: number, output: number, cached: number, cost: number | null, extra: Record<string, unknown> = {}) => ({
    key, label, turns: Math.round(turns * scale), inputTokens: Math.round(input * scale), outputTokens: Math.round(output * scale),
    cachedInputTokens: Math.round(cached * scale), costUsd: cost === null ? null : Number((cost * scale).toFixed(2)), ...extra,
  });
  const calls = (tool: number, mcp: number, subagent: number) => ({ toolCalls: Math.round(tool * scale), mcpCalls: Math.round(mcp * scale), subagentCalls: Math.round(subagent * scale) });
  const answer = {
    from: new Date(NOW - 30 * DAY).toISOString(), to: new Date(NOW).toISOString(), period: period === "month" ? "month" : Number(period), currency: null,
    totals: { ...g("", "", 151, 290_000, 66_000, 112_000, 9.59), ...calls(212, 64, 9), toolErrors: 3 },
    // A tenant-like spread (#2671): 16 models, accounts that share a name
    // (one per way of paying), the same person under two keys, rows at $0.
    byAccount: [
      g("claude:subscription", "claude", 44, 84_000, 19_000, 36_000, 3.1, { engine: "claude", access: "subscription", ...calls(61, 20, 4) }),
      g("grok:owner-key", "grok", 40, 80_000, 17_000, 30_000, 2.4, { engine: "grok", access: "owner-key", ...calls(55, 15, 2) }),
      g("claude:org-key", "claude", 29, 54_000, 13_000, 22_000, 1.85, { engine: "claude", access: "org-key", ...calls(46, 14, 2) }),
      g("grok:org-key", "grok", 18, 40_000, 9_000, 10_000, 1.2, { engine: "grok", access: "org-key", ...calls(25, 7, 1) }),
      g("openai:api", "openai", 14, 22_000, 6_000, 10_000, 1.04, { engine: "codex", access: "api", ...calls(19, 6, 0) }),
      g("xaiVoice:server", "xaiVoice", 4, 6_000, 1_000, 0, null, { engine: "xai-voice", access: "server" }),
      g("xaiVoice", "xaiVoice", 2, 3_000, 500, 0, null, { engine: "xai-voice" }),
      g("local", "local", 6, 10_000, 2_000, 4_000, 0, { engine: "local", ...calls(6, 2, 0) }),
    ],
    byModel: [
      g("claude-fable-5", "Fable", 30, 60_000, 14_000, 26_000, 2.95), g("grok-4.7", "grok-4.7", 24, 50_000, 11_000, 18_000, 1.7),
      g("claude-opus-5-5", "Opus", 22, 44_000, 10_000, 16_000, 1.42), g("grok-4.7-fast", "grok-4.7-fast", 18, 30_000, 7_000, 12_000, 0.9),
      g("claude-sonnet-5", "Sonnet", 16, 28_000, 6_000, 10_000, 0.75), g("gpt-6.1", "gpt-6.1", 12, 20_000, 5_000, 8_000, 0.62),
      g("grok-realtime", "grok-realtime", 6, 9_000, 1_500, 0, 0.21), g("claude-haiku-5", "Haiku", 8, 12_000, 2_000, 4_000, 0.04),
      g("ornith-122b", "ornith-122b", 5, 8_000, 1_500, 2_000, 0), g("ornith-35b", "ornith-35b", 4, 6_000, 1_000, 2_000, 0),
      g("gpt-6.1-mini", "gpt-6.1-mini", 2, 2_000, 400, 0, 0), g("grok-imagine", "grok-imagine", 1, 500, 0, 0, 0),
      g("whisper", "whisper", 1, 300, 0, 0, null), g("tts-1", "tts-1", 1, 200, 0, 0, null),
      g("embed-3", "embed-3", 1, 100, 0, 0, 0), g("rerank-2", "rerank-2", 1, 100, 0, 0, null),
    ],
    bySource: [
      g("user", "Person", 92, 170_000, 40_000, 70_000, 5.6, calls(130, 40, 6)), g("routine", "Routine", 41, 90_000, 18_000, 30_000, 2.9, calls(60, 18, 2)),
      g("owner", "Owner", 12, 20_000, 5_000, 8_000, 0.7, calls(16, 4, 1)), g("bot", "Bot", 6, 10_000, 3_000, 4_000, 0.39, calls(6, 2, 0)),
      g("helper", "Helper", 1, 500, 100, 0, 0),
    ],
    byPerson: [
      g("pr_alex", "alex@example.com", 50, 100_000, 22_000, 40_000, 3.3, calls(70, 22, 4)), g("owner", "Owner", 53, 110_000, 23_000, 38_000, 3.6, calls(76, 22, 3)),
      g("alex@example.com", "alex@example.com", 20, 30_000, 8_000, 10_000, 1.0, calls(28, 8, 1)), g("pr_sam", "Sam Rivera", 28, 50_000, 13_000, 24_000, 1.69, calls(38, 12, 1)),
      g("pr_kim", "Kim Lee", 1, 400, 0, 0, null),
    ],
    tools: [
      { tool: "search_tickets", kind: "mcp", mcpServer: "helpdesk", calls: 48, errors: 1, totalMs: 9_200 },
      { tool: "Read", kind: "builtin", calls: 41, errors: 0, totalMs: 1_100 },
      { tool: "send_mail", kind: "mcp", mcpServer: "mail", calls: 16, errors: 2, totalMs: 4_400 },
      { tool: "researcher", kind: "subagent", calls: 9, errors: 0, totalMs: 61_000 },
    ],
  };
  return { ...answer, offset, days: usageDays(answer, period === "7" ? 7 : period === "month" ? 7 : 30, offset) };
}

function analytics(days: number) {
  const rand = rng(days * 7919);
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(NOW - (days - 1 - i) * DAY);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const turns = weekend ? Math.floor(rand() * 6) : 8 + Math.floor(rand() * 26);
    return {
      day: d.toISOString().slice(0, 10), messages: turns, turns, tokens: turns * (1800 + Math.floor(rand() * 2600)),
      costUsd: Number((turns * (0.04 + rand() * 0.05)).toFixed(2)), conversations: Math.max(turns ? 1 : 0, Math.floor(turns / 3)),
      routinesRun: weekend ? 0 : 2 + Math.floor(rand() * 3), routinesFailed: rand() > 0.93 ? 1 : 0,
      hoursSaved: Number((turns * (0.05 + rand() * 0.05)).toFixed(2)),
    };
  });
  const sum = (k: "messages" | "turns" | "tokens" | "costUsd" | "conversations" | "routinesRun" | "routinesFailed" | "hoursSaved") => series.reduce((a, r) => a + (r[k] ?? 0), 0);
  const messages = sum("messages");
  const weights = [0.42, 0.27, 0.19, 0.12];
  return {
    from: series[0]!.day, to: series[series.length - 1]!.day, days, series,
    totals: { messages, turns: sum("turns"), tokens: sum("tokens"), costUsd: Number(sum("costUsd").toFixed(2)), conversations: sum("conversations"), routinesRun: sum("routinesRun"), routinesFailed: sum("routinesFailed"), hoursSaved: Number(sum("hoursSaved").toFixed(1)) },
    topUsers: PEOPLE.map((p, i) => ({ principalId: p.principalId, name: p.name, messages: Math.round(messages * weights[i]!), hoursSaved: Number((sum("hoursSaved") * weights[i]!).toFixed(1)) })),
    hoursSavedBasis: "turnDuration", currency: "USD",
  };
}

const routines = [
  ["r1", "Morning summary of important emails", true],
  ["r2", "Watch the sources on cybersecurity", true],
  ["r3", "Sort the inbox", false],
  ["r4", "Weekly report of the projects", true],
  ["r5", "Reminder of invoices to follow up", true],
  ["r6", "Review the meeting notes", true],
].map(([id, title, enabled], index) => ({
  id, botId: BOT_ID, name: title, prompt: title, enabled, target: "bot",
  schedule: { type: "cron", expression: `${3 + index} 4 * * *`, timeZone: "America/Toronto" },
  nextRunAt: NOW + (index + 1) * HOUR, createdAt: 1, updatedAt: 1,
}));
const runs = routines.slice(0, 4).flatMap((r, i) => [0, 1, 2].map((k) => ({
  id: `run-${i}-${k}`, routineId: r.id, botId: BOT_ID, status: i === 1 && k === 1 ? "failed" : "completed",
  scheduledFor: NOW - (k + 1) * DAY + i * HOUR, startedAt: NOW - (k + 1) * DAY + i * HOUR, finishedAt: NOW - (k + 1) * DAY + i * HOUR + 4 * MIN, threadId: `t-run-${i}-${k}`,
})));

const overview = {
  who: { name: "Scout", title: "Research", blurb: "Finds sources and summarizes them.", soulLead: "You are Scout, a research assistant for Northwind Studio." },
  does: ["Daily at 4:03 AM: Morning summary of important emails.", "Daily at 5:03 AM: Watch the sources on cybersecurity.", "Weekly: Weekly report of the projects."],
  reaches: ["Works in its private workspace.", "Has the built-in browser.", "Reads Calendar and GitHub through your accounts."],
  wont: ["Won't run commands without asking you first.", "Won't send email without your approval."],
  recent: [
    { at: NOW - 4 * MIN, summary: "Soul edited" },
    { at: NOW - 45 * MIN, summary: "Model changed to Sonnet" },
    { at: NOW - 3 * HOUR, summary: "Rules edited" },
    { at: NOW - 1 * DAY, summary: "Title changed to Research" },
  ],
  setup: [
    { id: "identity", label: "Name and title", done: true, section: "details" },
    { id: "soul", label: "Personality", done: true, section: "soul" },
    { id: "folder", label: "Work folder", done: true, section: "access" },
    { id: "apps", label: "Connect an app", done: false, section: "access" },
    { id: "schedule", label: "Schedule a routine", done: true, section: "routines" },
  ],
};

const skills = [
  { name: "weekly-report", description: "Writes the weekly status report from the open tasks.", enabled: true, source: "taught", warnings: [] },
  { name: "source-check", description: "Checks every claim against two sources before answering.", enabled: true, source: "imported", warnings: [] },
  { name: "meeting-notes", description: "Turns a transcript into decisions and next steps.", enabled: true, source: "org", origin: "Northwind Studio", warnings: [] },
  { name: "competitor-watch", description: "Follows a list of competitors and flags what changed.", enabled: false, source: "taught", warnings: ["Uses the browser on every run"] },
  { name: "citation-format", description: "Formats every citation in one house style.", enabled: true, source: "imported", warnings: [] },
];
const systemPrompt = {
  sections: [
    { id: "identity", label: "Identity", text: "You are Scout, Research. Finds sources and summarizes them.", bytes: 61 },
    { id: "soul", label: "Personality", text: SOUL, bytes: SOUL.length },
    { id: "rules", label: "Rules", text: RULES, bytes: RULES.length },
    { id: "memory", label: "Memory", text: MEMORY, bytes: MEMORY.length },
    { id: "skills", label: "Skills", text: skills.map((s) => `- ${s.name}: ${s.description}`).join("\n"), bytes: 380 },
  ],
  totalBytes: 2860, approxTokens: 715, note: "Sent at the start of every conversation.",
};

const grants = {
  grants: [
    { target: "user:pr_sam", level: "use", by: "Alex Example", at: NOW - 12 * DAY, label: "Sam Rivera", kind: "user" },
    { target: "user:pr_jordan", level: "edit", by: "Alex Example", at: NOW - 8 * DAY, label: "Jordan Lee", kind: "user" },
    { target: "user:pr_casey", level: "run", by: "Alex Example", at: NOW - 3 * DAY, label: "Casey Morgan", kind: "user" },
    { target: "team:tm_studio", level: "use", by: "Alex Example", at: NOW - 20 * DAY, label: "Studio team", kind: "team" },
  ],
  administer: { any: true, teamIds: ["tm_studio"], maxLevel: "manage", canAdd: true },
};

const capabilityItem = (key: string, form: string, name: string, label: string, state = "on") => ({
  key, form, name, source: { kind: "account", label }, scope: "bot", state, enabled: state === "on", canToggle: true, engine: { mcp: "ok" },
});

const rulesListing = {
  budgets: { set: { maxLines: 100, maxBytes: 12000 }, total: { maxLines: 250, maxBytes: 24000 } }, maxSets: 20, maxNameLength: 60,
  template: "- Ask before sending anything outside the team.",
  sets: [
    { id: "rules", name: null, enabled: true, file: "RULES.md", text: RULES, hash: "h1", exists: true, lines: RULES.split("\n").length, bytes: RULES.length, over: false, loads: true },
    { id: "sources", name: "Sources", enabled: true, file: "rules/sources.md", text: "- Prefer primary sources.\n- Date every link.", hash: "h2", exists: true, lines: 2, bytes: 44, over: false, loads: true },
    { id: "tone", name: "Tone", enabled: false, file: "rules/tone.md", text: "- Plain words, short sentences.", hash: "h3", exists: true, lines: 1, bytes: 31, over: false, loads: false },
  ],
  total: { lines: 8, bytes: 220, over: false },
};

const customRules = {
  rules: [
    { id: "cr1", ownerId: "pr_alex", botId: BOT_ID, when: "read a calendar event", behavior: "allow", riskScope: [], enabled: true, createdAt: NOW - 9 * DAY, updatedAt: NOW - 9 * DAY, compiled: { recognized: true } },
    { id: "cr2", ownerId: "pr_alex", botId: null, when: "send an email to someone outside Northwind Studio", behavior: "ask", riskScope: [], enabled: true, createdAt: NOW - 6 * DAY, updatedAt: NOW - 6 * DAY, compiled: { recognized: true } },
    { id: "cr3", ownerId: "pr_alex", botId: BOT_ID, when: "delete a file", behavior: "deny", riskScope: [], enabled: true, createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY, compiled: { recognized: true } },
    { id: "cr4", ownerId: "org", botId: null, when: "spend money", behavior: "ask", riskScope: [], enabled: true, org: true, createdAt: NOW - 30 * DAY, updatedAt: NOW - 30 * DAY, compiled: { recognized: true } },
  ],
  orgPolicy: { alwaysAllow: true }, products: [],
};

const memoryFile = (path: string, bytes: number, ago: number) => ({ path, name: path.split("/").pop(), bytes, modifiedAt: NOW - ago });
const memory = {
  botId: BOT_ID, workspacePath: "/workspace/bots/scout",
  index: { lines: 9, bytes: MEMORY.length, maxLines: 200, maxBytes: 20000, loadedLines: 9, loadedBytes: MEMORY.length, truncated: false, hash: "m1" },
  topics: [memoryFile("topics/vendors.md", 1840, 2 * DAY), memoryFile("topics/market-notes.md", 3120, 5 * DAY), memoryFile("topics/style.md", 640, 9 * DAY)],
  logs: [memoryFile("logs/2026-11-04.md", 920, 2 * DAY), memoryFile("logs/2026-11-05.md", 1210, 1 * DAY)],
};

const workspaceEntry = (path: string, bytes: number, extra: Record<string, unknown> = {}) => ({ path, kind: "file", bytes, load: "always", editable: true, markdown: true, forgotten: false, ...extra });

/** #2698: the Proactivity group of the Analytics tab. */
function proactiveMetrics(days: number) {
  const scale = days / 7;
  const totals = {
    wakes: Math.round(42 * scale), reported: Math.round(18 * scale), quiet: Math.round(22 * scale), failed: Math.round(2 * scale),
    proposed: Math.round(15 * scale), accepted: Math.round(9 * scale), declined: Math.round(3 * scale), expired: Math.round(2 * scale),
    writes: Math.round(27 * scale), cost: Math.round(3.84 * scale * 100) / 100, costRuns: Math.round(40 * scale),
  };
  const judged = totals.accepted + totals.declined + totals.expired;
  return {
    botId: BOT_ID, days, from: "", to: "", series: [],
    totals: { ...totals, precision: judged ? totals.accepted / judged : null, minutesSaved: totals.reported * 10 + totals.writes * 2 + totals.accepted * 5 },
    minutesPerReport: 10, minutesPerWrite: 2, minutesPerAccepted: 5,
  };
}

function answer(method: string, path: string, search: URLSearchParams, body: unknown): Response | null {
  const bots = `/api/bots/${BOT_ID}`;
  if (path === "/api/config") return json({ viewer: { operator: false, principalId: "pr_alex", name: "Alex Example", role: "admin", permissions: [] }, profile: { name: "Alex Example" }, features: {}, onboarding: { completedAt: 1, launchMode: "solo" } });
  if (path === "/api/auth/session") return json({ authenticated: true, user: { name: "Alex Example", principalId: "pr_alex" } });
  if (path === "/api/org") return json({ org: { name: "Northwind Studio", identity: { kind: "perspicax", issuer: "https://perspicax.example.test" } }, link: { state: "ok" }, viewerRole: "admin", settings: {} });
  if (path === "/api/org/directory") return json({ people: PEOPLE, teams: [{ id: "tm_studio", name: "Studio team", managers: ["pr_alex"], members: ["pr_alex", "pr_sam", "pr_jordan"] }], viewer: { principalId: "pr_alex" } });
  if (path === "/api/bots") return json({ bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {}, botQueuedMessages: {} });
  // the bot's shared vault (#3399, under Bot accounts): one login, never its value
  if (path === `${bots}/credentials/list`) return json({ items: [{ id: "v1", kind: "login", name: "Supplier portal", domains: ["portal.northwind.example"], hasPassword: true, hasTotp: false, hasApiKey: false, hasNotes: false }] });
  if (method !== "GET" && (path === bots || path.startsWith(`${bots}/`) || path.startsWith("/api/"))) {
    if (path.endsWith("/history/restore")) return json({ ok: true, revision: HISTORY.length + 1 });
    if (!/\/(analytics|history)$/.test(path)) return json(body ?? { ok: true });
  }
  if (path === bots) return json({ bot });
  if (path === `${bots}/overview`) return json(overview);
  if (path === `${bots}/history`) return json({ rows: HISTORY, revision: HISTORY.length });
  if (path === `${bots}/analytics` && search.get("view") === "breakdown") return json(breakdown(search.get("period") ?? "30", Number(search.get("offset") ?? "0")));
  if (path === `${bots}/proactive-metrics`) return json(proactiveMetrics([7, 30, 90].includes(Number(search.get("days"))) ? Number(search.get("days")) : 7));
  if (path === `${bots}/analytics`) return json(analytics([7, 30, 90].includes(Number(search.get("days"))) ? Number(search.get("days")) : 30));
  if (path === `${bots}/skills`) return json({ skills, staged: [{ id: "st1", name: "pricing-check", gist: "Compares a quote with the last three prices." }], library: [{ name: "invoice-review", description: "Reviews an invoice line by line." }, { name: "status-digest", description: "Digests a long thread into five lines." }], assignedSkills: ["meeting-notes"] });
  if (path === "/api/org-library/skills") return json({ organization: { name: "Northwind Studio" }, skills: [
    { installId: "ins1", packageName: "northwind-research", publisher: "Northwind Studio", release: "1.2.0", name: "meeting-notes", description: "Turns a transcript into decisions and next steps.", added: true },
    { installId: "ins2", packageName: "northwind-research", publisher: "Northwind Studio", release: "1.2.0", name: "vendor-brief", description: "One page brief on a vendor from public sources.", added: false },
    { installId: "ins3", packageName: "northwind-ops", publisher: "Northwind Studio", release: "0.9.1", name: "weekly-digest", description: "Digest of the week for the leadership team.", added: false },
  ] });
  if (path === `${bots}/skills-library`) return json({ skills: [{ name: "invoice-review", description: "Reviews an invoice line by line." }] });
  if (path === `${bots}/system-prompt`) return json(systemPrompt);
  if (path === `${bots}/soul`) return json({ soul: SOUL, revision: HISTORY.length, bytes: SOUL.length, limit: 8000, file: "SOUL.md", drift: false });
  if (path === `${bots}/grants`) return json(grants);
  if (path === `${bots}/rules`) return json(rulesListing);
  if (path === `${bots}/memory`) return json(memory);
  if (path === `${bots}/workspace`) return json({
    workspacePath: "/workspace/bots/scout", now: NOW, forgottenAfterDays: 30,
    budgets: { rules: { maxLines: 200, maxBytes: 20000 }, memory: { maxLines: 200, maxBytes: 20000 }, soul: { maxBytes: 8000 } }, rulesTemplate: "",
    soul: { ...workspaceEntry("SOUL.md", SOUL.length), virtual: "soul" },
    entries: [workspaceEntry("MEMORY.md", MEMORY.length), workspaceEntry("RULES.md", RULES.length), workspaceEntry("topics/vendors.md", 1840, { load: "on demand" }), workspaceEntry("topics/market-notes.md", 3120, { load: "on demand" })], truncated: false,
  });
  if (path === `${bots}/capabilities`) return json({ botId: BOT_ID, engine: { kind: "claude", label: "Claude" }, items: [
    capabilityItem("connector:account:github", "connector", "GitHub", "Example account"), capabilityItem("mcp:installation:calendar", "mcp", "Calendar", "Example account"),
    capabilityItem("mcp:installation:mail", "mcp", "Mail", "Alex Example"), capabilityItem("mcp:me:notes", "mcp", "Notes", "Alex Example", "off"),
    // still to connect: listed in the Plugins window only (#3399)
    capabilityItem("mcp:installation:github", "mcp", "Github", "Example account", "to_connect"),
  ] });
  if (path === `${bots}/inbound-mail`) return json({ available: true, address: "scout@northwind.example", enabled: true });
  if (path === `${bots}/reach-me`) return json({ saved: true, settings: { channels: ["push", "email"], hours: { always: true } }, channels: { push: { ready: true, devices: 2 }, email: { ready: true } } });
  if (path === `${bots}/background-brief`) return json({ apps: 3, screenContextAvailable: true, settings: { enabled: true, at: "08:00", screenContext: true }, suggestions: [{ id: "brief_a", text: "Reply to Carla about the contract due 2026-11-10", status: "pending" }, { id: "brief_b", text: "Scan unread email from clients", status: "pending", feedback: "less" }] });
  if (/\/background-brief\/[^/]+\/feedback$/.test(path)) return json({ ok: true });
  if (path === `${bots}/tool-grants`) return json({ grants: [] });
  if (path === `${bots}/lifecycle-hooks`) return json({ enabled: true, events: ["turn.start", "turn.end"] });
  if (path === `${bots}/roles/rules`) return json({ rules: [{ id: "rr1", from: { slug: "finance", name: "Finance" }, to: { slug: "", name: "Me" }, path: "/finance/invoices", ownerId: "pr_alex", createdAt: NOW - 4 * DAY }] });
  // As the server answers while Slack as a channel is removed (#3398,
  // shared/team-chat-channels.ts).
  if (path === `${bots}/slack-management`) return json({ available: false });
  if (path === `${bots}/outbound`) return json({ calls: [] });
  if (path === `${bots}/activity`) return json({ items: [], subagents: [], launchedAgents: [] });
  if (path === `${bots}/task-list`) return json({ tasks: [] });
  if (path === `${bots}/webhooks`) return json({ webhooks: [] });
  if (path === `${bots}/primary`) return json({ bot });
  if (path === "/api/me/engines") return json({ engines: [
    { instanceId: "claude", driver: "claude", displayName: "Claude", installed: true, subscription: { supported: true, signedIn: true }, myKey: false, orgKey: true, myTurns: 214, keyWhere: "org" },
    { instanceId: "grok", driver: "grok", displayName: "Grok", installed: true, subscription: { supported: true, signedIn: false }, myKey: true, orgKey: false, myTurns: 12, keyWhere: "mine" },
  ] });
  if (/^\/api\/me\/engines\/[^/]+\/models$/.test(path)) return json({ models: [{ id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }, { id: "haiku", label: "Haiku" }] });
  if (path === "/api/instances") return json({ instances: [
    { instanceId: "claude", displayName: "Claude", driverKind: "claude", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { default: "sonnet", options: [{ id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }, { id: "haiku", label: "Haiku" }] } },
    { instanceId: "grok", displayName: "Grok", driverKind: "grok", access: "key", snapshot: { state: "available", authenticated: true }, models: { default: "grok-4", options: [{ id: "grok-4", label: "Grok 4" }] } },
    { instanceId: "openai", displayName: "OpenAI", driverKind: "codex", access: "key", snapshot: { state: "available", authenticated: true }, models: { default: "gpt-5", options: [{ id: "gpt-5", label: "GPT-5" }] } },
    { instanceId: "local", displayName: "Local oMLX", driverKind: "local", access: "local", snapshot: { state: "available", authenticated: true }, models: { default: "ornith-35b", options: [{ id: "ornith-35b", label: "Ornith 35B" }] } },
  ] });
  if (path === "/api/routines") return json({ routines, runs, folders: [] });
  if (path === "/api/webhooks") return json({ webhooks: [], attempts: [], ingress: null, graphConnectors: [] });
  if (path === "/api/live/call") return json({});
  if (path === "/api/mcp/servers") return json({ servers: [{ name: "mail", enabled: true, auth: "connected" }, { name: "calendar", enabled: true, auth: "connected" }, { name: "github", enabled: true, auth: "none" }] });
  if (path === "/api/messages") return json({ available: true, onThisMac: true, useMessages: true, permissions: { fullDiskAccess: "granted", automation: "granted" } });
  if (path === "/api/custom-rules") return json(customRules);
  if (path === "/api/custom-rules/policy") return json({ alwaysAllow: true });
  if (path === "/api/tool-grants") return json({ grants: [] });
  if (path === "/api/me/tool-grants") return json({ grants: [] });
  if (path.startsWith("/api/remote-sessions") || path === `${bots}/remote-sessions`) return json({ sessions: [] });
  if (path === "/api/me/models") return json({ mine: [], favoriteModels: ["claude/sonnet", "claude/opus"], disabledModels: [] });
  if (path === "/api/approval-rules") return json({ rules: [
    { id: "ar1", botId: BOT_ID, botName: "Scout", tool: "mcp:calendar:read", scope: {}, behavior: "allow", description: "Read your calendar" },
    { id: "ar2", botId: BOT_ID, botName: "Scout", tool: "mcp:mail:send", scope: {}, behavior: "ask", description: "Send an email", destructive: "external-message" },
    { id: "ar3", botId: null, tool: "bash", scope: {}, behavior: "deny", description: "Run a command that deletes files" },
  ] });
  if (path === "/api/workers") return json({ workers: [
    { deviceId: "dev1", name: "Northwind Studio cloud", online: true, engines: [{ instanceId: "claude", label: "Claude", driverKind: "claude", models: [{ id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }] }] },
    { deviceId: "dev2", name: "Studio Mac mini", online: true, engines: [{ instanceId: "claude", label: "Claude", driverKind: "claude", models: [{ id: "sonnet", label: "Sonnet" }] }] },
  ] });
  if (/^\/api\/threads\/[^/]+\/files/.test(path)) return json({ files: [] });
  if (path.includes("/api/artifacts")) return json({ artifacts: [] });
  if (path.includes("/api/pages")) return json({ pages: [] });
  return null;
}

const seen: string[] = [];
const missing: string[] = [];
(window as unknown as { __galleryApi: string[]; __galleryMissing: string[] }).__galleryApi = seen;
(window as unknown as { __galleryApi: string[]; __galleryMissing: string[] }).__galleryMissing = missing;
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const label = `${method} ${url.pathname}${url.search}`;
  seen.push(label);
  let body: unknown = null;
  try { body = typeof init?.body === "string" ? JSON.parse(init.body) : null; } catch { body = null; }
  const response = answer(method, url.pathname, url.searchParams, body);
  if (response) return response;
  missing.push(label);
  return json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;

// The page opens Server-Sent Events for live updates: a quiet stand-in.
class QuietEventSource extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
  readyState = 1; url: string; withCredentials = false;
  onopen: ((e: Event) => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null; onerror: ((e: Event) => void) | null = null;
  constructor(url: string | URL) { super(); this.url = String(url); }
  close() { this.readyState = 2; }
}
(window as unknown as { EventSource: unknown }).EventSource = QuietEventSource;
window.addEventListener("unhandledrejection", (event) => {
  if ((event.reason as { name?: string } | null)?.name === "AbortError") event.preventDefault();
});

const section = (params.get("section") ?? "overview") as BotSettingsSection;

function Open() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "openPersonaEditor", botId: bot.id, section });
  }, [dispatch]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex h-screen bg-app text-ink" data-gallery-bot-profile="">
        <Open />
        <PersonaEditorModal />
      </div>
    </StoreProvider>
  </StrictMode>,
);
