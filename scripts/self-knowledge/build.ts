// Builds the Sagax and Perspicax knowledge base that the bots read through
// sagax_help (server/self-knowledge/self-knowledge.ts). Everything comes from the code and
// the docs of this checkout: the agents tool catalog and its permissions,
// the Settings pages and cards with their labels, the account menu, the
// engines, the server's routes, the release notes, the user docs, docs/ and
// AGENTS.md; Perspicax's part comes from the snapshot that
// scripts/self-knowledge/perspicax-snapshot.ts writes from its repository.
// The short guides of guides.ts are the only hand-written part, and each of
// their references is checked here: a guide that names a tool, a setting or
// a file that no longer exists fails the build.
//
// Deterministic: the same checkout gives the same sections (sorted by id)
// and the same hash. No git, no network: the Docker build runs it too.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { availableTools, PERSPICAX_TOOLS, type CatalogProfile } from "../../server/drivers/agents-catalog.ts";
import { MCP_PERMISSIONS } from "../../server/mcp/mcp-permissions.ts";
import { HOST_LEVEL_AGENT_TOOLS, MEMBER_OWN_SCOPE_AGENT_TOOLS } from "../../server/people/member-tool-scope.ts";
import { READ_ONLY_AGENT_TOOL_NAMES } from "../../server/tools/agent-tool-policy.ts";
import { TOOL_POLICY_ROWS } from "../../server/tool-policy.generated.ts";
import type { KnowledgeBase, KnowledgeSection, PerspicaxSnapshot } from "../../server/self-knowledge/self-knowledge-types.ts";
import { clip, CUSTOMER_TAG_LEFT, docSections, plainText, scrub, slug } from "./markdown.ts";
import { CARD_HOME } from "../../src/lib/settings-sections.ts";
import { TEAM_CHAT_CHANNELS_OFFERED } from "../../shared/team-chat-channels.ts";
import { GUIDES, SETTING_NOTES } from "./guides.ts";

export const KNOWLEDGE_FILE = join("server", "self-knowledge", "knowledge.generated.json");
export const PERSPICAX_SNAPSHOT_FILE = join("server", "self-knowledge", "perspicax.snapshot.json");

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

// ---------------------------------------------------------------- tools

const BASE: CatalogProfile = {
  externalRuntime: false, coordinating: false, ownThreadCreation: false, skillAuthoring: false,
  sharedComputers: false, voiceNotes: false, meetings: false, singleStream: false, routeMessages: false,
  voiceCall: false, cloudHome: false, memoryEnabled: true, groupMemory: false, chief: false,
  createBots: false, botId: "bot", agentApi: false, perspicax: false, claims: false,
};

/** The switches of a turn that show a tool, in words. */
// A person's own chat coordinates (server/index.ts boundedCoordination), so
// coordinating alone is "a person's chat or a room"; a room also sets room.
const CONDITIONS: Array<{ when: string; profile: Partial<CatalogProfile> }> = [
  { when: "in a person's chat or a room", profile: { coordinating: true } },
  { when: "in a room (group conversation)", profile: { coordinating: true, room: true } },
  { when: "for a Primary Bot only", profile: { chief: true } },
  { when: "for a bot allowed to create bots", profile: { createBots: true } },
  { when: "on an organization server linked to Perspicax", profile: { perspicax: true } },
  { when: "when a Perspicax profile is mounted for the person speaking", profile: { claims: true } },
  { when: "when the bot has a voice configured", profile: { voiceNotes: true } },
  { when: "during a live phone call", profile: { voiceCall: true } },
  { when: "when Settings > Developer > Experimental > Meeting notetaker is on", profile: { meetings: true } },
  { when: "when computer sharing is on", profile: { sharedComputers: true } },
  { when: "when skill authoring is on", profile: { skillAuthoring: true } },
  { when: "with the agent-to-agent API (direct turns)", profile: { agentApi: true } },
  { when: "for a Primary Bot with the agent-to-agent API", profile: { agentApi: true, chief: true } },
  { when: "in a single-stream conversation (threads off)", profile: { singleStream: true } },
  { when: "when the bot routes messages sent while it is busy", profile: { routeMessages: true } },
  { when: "in a person's 1:1 chat on a server with a GitHub app", profile: { githubConnect: true } },
  { when: "when the engine has no web search of its own and the person saved a search provider", profile: { webSearch: true } },
  { when: "when the bot may send an API key of the person", profile: { vaultHttp: true } },
  { when: "when the person's phone offers tools now", profile: { phoneTools: ["location"] } },
  { when: "in a room whose shared memory is on", profile: { coordinating: true, room: true, groupMemory: true } },
  { when: "in a person's chat when they ask for separate jobs", profile: { coordinating: true, ownThreadCreation: true } },
];

type Tool = { name: string; description: string };
/** Every switch of `wider` is set the same in `profile`, which sets more. */
const narrower = (profile: Partial<CatalogProfile>, wider: Partial<CatalogProfile>) =>
  Object.keys(profile).length > Object.keys(wider).length &&
  Object.entries(wider).every(([key, value]) => profile[key as keyof CatalogProfile] === value);
const names = (profile: CatalogProfile) => new Set((availableTools(profile) as Tool[]).map((tool) => tool.name));

const TIER_WORDS: Record<string, string> = {
  read: "read: changes nothing",
  own: "own work: the bot's own memory, files, cards or conversation",
  dispatch: "dispatch: puts other bots, people or routines to work",
  claim: "claim: holds shared work",
  admin: "admin: settings, pairing, credentials or anything lasting for the organization",
};

function toolSections(): KnowledgeSection[] {
  const tools = new Map<string, Tool>();
  const add = (profile: CatalogProfile) => { for (const tool of availableTools(profile) as Tool[]) if (!tools.has(tool.name)) tools.set(tool.name, tool); };
  // BASE is a routine or a delegated turn; a person's own chat coordinates.
  const base = names(BASE);
  const direct = names({ ...BASE, coordinating: true });
  const directJobs = names({ ...BASE, coordinating: true, ownThreadCreation: true });
  const room = names({ ...BASE, coordinating: true, room: true });
  add(BASE);
  const shown = CONDITIONS.map((condition) => {
    const profile = { ...BASE, ...condition.profile };
    add(profile);
    return { when: condition.when, profile: condition.profile, names: names(profile) };
  });
  for (const tool of PERSPICAX_TOOLS as Tool[]) if (!tools.has(tool.name)) tools.set(tool.name, tool);
  const permission = new Map<string, (typeof MCP_PERMISSIONS)[number]>();
  for (const entry of MCP_PERMISSIONS) {
    if (entry.tool) permission.set(entry.tool, entry);
    for (const alias of entry.aliases ?? []) permission.set(alias, entry);
  }
  const out: KnowledgeSection[] = [];
  for (const tool of tools.values()) {
    const when: string[] = [];
    if (base.has(tool.name)) {
      if (!direct.has(tool.name)) {
        when.push(directJobs.has(tool.name)
          ? "in routines and delegated turns; in a person's chat when they ask for separate jobs"
          : "in routines and delegated turns only (a person's chat and rooms use coordinate_bots)");
      } else if (!room.has(tool.name)) when.push("not in rooms");
    } else {
      const matching = shown.filter((entry) => entry.names.has(tool.name) && !base.has(tool.name));
      // a narrower condition (a room, after "a person's chat or a room") says nothing more
      const kept = matching.filter((entry) => !matching.some((other) => other !== entry && narrower(entry.profile, other.profile)));
      const conditions = kept.map((entry) => entry.when);
      when.push(conditions.length ? conditions.slice(0, 2).join(" or ") : "in some turns only");
      // shown under its condition in a person's chat but not in a room
      const first = kept[0];
      if (first && !first.profile.room && names({ ...BASE, ...first.profile, coordinating: true }).has(tool.name) &&
        !names({ ...BASE, ...first.profile, coordinating: true, room: true }).has(tool.name)) when.push("not in rooms");
    }
    const perm = permission.get(tool.name);
    const member = MEMBER_OWN_SCOPE_AGENT_TOOLS[tool.name];
    const access = [
      perm ? `permission ${perm.key} (${TIER_WORDS[perm.tier] ?? perm.tier})` : null,
      READ_ONLY_AGENT_TOOL_NAMES.has(tool.name) ? "read-only, no approval card" : "may show an approval card, depending on the bot's approval mode",
      member ? "on an organization server a member's bot runs it within the member's own scope"
        : HOST_LEVEL_AGENT_TOOLS.has(tool.name) || !perm || perm.tier === "admin" ? "on an organization server a member's call waits for an admin" : null,
      perm?.source === "perspicax" ? "served by Perspicax with the speaker's own grants" : null,
    ].filter(Boolean).join("; ");
    out.push({
      id: `tool:${tool.name}`,
      kind: "tool",
      title: `Tool ${tool.name}`,
      where: `bot tool${when.length ? `, ${when.join("; ")}` : ", every conversation"}`,
      access,
      keywords: tool.name.replace(/_/g, " "),
      text: clip(tool.description, 1600),
      source: perm?.source === "perspicax" || PERSPICAX_TOOLS.some((entry: Tool) => entry.name === tool.name) ? "server/drivers/agents-catalog.ts (PERSPICAX_TOOLS)" : "server/drivers/agents-catalog.ts",
    });
  }
  return out;
}

// ---------------------------------------------------------------- settings

type Locale = Record<string, string>;

function locales(root: string): { en: Locale; fr: Locale } {
  return { en: JSON.parse(read(root, "src/locales/en.json")), fr: JSON.parse(read(root, "src/locales/fr.json")) };
}

const label = (key: string, en: Locale, fr: Locale) => {
  const english = en[key] ?? key;
  const french = fr[key];
  return { english, french: french && french !== english ? french : "" };
};

export interface SettingsSectionRow { id: string; group: string; labelKey: string; keywords: string[] }

const SETTINGS_NAV = "src/components/settings/settings-nav.ts";

/** The pages of Settings (settings-nav.ts SECTIONS). Throws naming that file
 * when the export is missing or no row matches, never a later TypeError on
 * an empty page map. */
export function settingsSectionRows(root: string): SettingsSectionRow[] {
  const source = read(root, SETTINGS_NAV);
  const start = source.indexOf("export const SECTIONS");
  if (start < 0) {
    throw new Error(`${SETTINGS_NAV}: expected "export const SECTIONS" (Settings pages for sagax_help)`);
  }
  const end = source.indexOf("\n];", start);
  if (end < 0) {
    throw new Error(`${SETTINGS_NAV}: SECTIONS array is not closed with ];`);
  }
  const block = source.slice(start, end);
  const rows: SettingsSectionRow[] = [];
  for (const match of block.matchAll(/\{ id: "(\w+)", group: "(\w+)", labelKey: "([\w.]+)",[^\n]*?keywords: \[([^\]]*)\]/g)) {
    rows.push({ id: match[1], group: match[2], labelKey: match[3], keywords: [...match[4].matchAll(/"([^"]+)"/g)].map((word) => word[1]) });
  }
  if (rows.length === 0) {
    throw new Error(`${SETTINGS_NAV}: SECTIONS found but no { id, group, labelKey, keywords } rows matched`);
  }
  return rows;
}

const NAV_GROUP_KEYS: Record<string, string> = { you: "settings.nav.you", ai: "settings.nav.ai", workspace: "settings.nav.workspace", app: "settings.nav.app" };

/** Card id prefix to the page that holds it (src/lib/settings-sections.ts).
 * A card that moved by itself (CARD_HOME, 2026-10-28) wins over its prefix. */
const CARD_PAGE: Record<string, string> = {
  connections: "engines", voice: "voice", connectedApps: "engines", orgImport: "organization", myConnections: "general",
  notifications: "notifications", security: "security", credentials: "credentials",
};
const HIDDEN_PAGES = new Set(["companion", "activity", "mail", "people", "workspaces"]);

function settingsSections(root: string): KnowledgeSection[] {
  const { en, fr } = locales(root);
  const rows = settingsSectionRows(root);
  const pageName = new Map(rows.map((row) => [row.id, label(row.labelKey, en, fr)]));
  const out: KnowledgeSection[] = [];
  for (const row of rows) {
    const name = pageName.get(row.id)!;
    const group = label(NAV_GROUP_KEYS[row.group] ?? row.group, en, fr);
    const note = SETTING_NOTES[row.id];
    out.push({
      id: `setting:${row.id}`,
      kind: "setting",
      title: `Settings page ${name.english}${name.french ? ` (${name.french})` : ""}`,
      where: `Settings > ${name.english}${name.french ? ` (FR: Réglages > ${name.french})` : ""}, under ${group.english}`,
      ...(note?.access ? { access: note.access } : {}),
      keywords: row.keywords.join(" "),
      text: `${note?.text ? `${note.text} ` : ""}Holds: ${row.keywords.slice(0, 40).join(", ")}.`,
      source: SETTINGS_NAV,
    });
  }
  // Cards: every settings card with an id and a title, under its page.
  const cards = new Map<string, KnowledgeSection>();
  for (const file of walk(root, "src/components", (path) => path.endsWith(".tsx") && !path.includes(".test."))) {
    const source = read(root, file);
    for (const match of source.matchAll(/(?:cardId|data-settings-card)="([A-Za-z0-9.-]+)"/g)) {
      const id = match[1];
      if (cards.has(id)) continue;
      const start = source.lastIndexOf("<", match.index!);
      const tag = source.slice(start, match.index! + 600);
      const end = tag.indexOf(">\n");
      const window = end > 0 ? tag.slice(0, end) : tag;
      const titleKey = /(?:title|label|heading)=\{t\("([\w.]+)"/.exec(window)?.[1];
      const titleText = /(?:title|label)="([^"]+)"/.exec(window)?.[1];
      if (!titleKey && !titleText) continue;
      const prefix = id.split(".")[0];
      const page = id.startsWith("bot.") ? null : HIDDEN_PAGES.has(prefix) ? null : (Object.hasOwn(CARD_HOME, id) ? CARD_HOME[id] : undefined) ?? CARD_PAGE[prefix] ?? (pageName.has(prefix) ? prefix : null);
      if (!page && !id.startsWith("bot.")) continue;
      const title = titleKey ? label(titleKey, en, fr) : { english: titleText!, french: "" };
      const subtitleKey = /subtitle=\{t\("([\w.]+)"/.exec(window)?.[1] ?? /summary=\{t\("([\w.]+)"/.exec(window)?.[1];
      const subtitle = subtitleKey ? label(subtitleKey, en, fr) : null;
      const pageLabel = page ? pageName.get(page)! : null;
      cards.set(id, {
        id: `card:${id}`,
        kind: "setting",
        title: `${title.english}${title.french ? ` (${title.french})` : ""}`,
        where: prefix === "myConnections"
          ? `the sidebar's Capabilities (Capacités) > ${title.english}`
          : page
          ? `Settings > ${pageLabel!.english} > ${title.english}${pageLabel!.french ? ` (FR: Réglages > ${pageLabel!.french} > ${title.french || title.english})` : ""}`
          : `a bot's settings (open the bot, then its settings) > ${title.english}`,
        ...(SETTING_NOTES[page ?? ""]?.access ? { access: SETTING_NOTES[page!].access } : {}),
        text: subtitle && !/checking|vérification/i.test(subtitle.english) ? `${subtitle.english}${subtitle.french ? ` / ${subtitle.french}` : ""}` : `${title.english} card.`,
        source: file,
      });
    }
  }
  out.push(...cards.values());
  return out;
}

/** The pages of a bot's editor (Edit bot), src/components/bot-settings/
 * sections.ts, under their group (src/lib/persona-sections.ts). Details and
 * Routines stay in the bot panel. */
function botEditorSections(root: string): KnowledgeSection[] {
  const { en, fr } = locales(root);
  const groups = read(root, "src/lib/persona-sections.ts");
  const groupOf = new Map<string, string>();
  for (const match of groups.matchAll(/\{ id: "(\w+)", sections: \[([^\]]*)\] \}/g)) {
    for (const section of match[2].matchAll(/"(\w+)"/g)) groupOf.set(section[1], match[1]);
  }
  const edit = label("persona.edit", en, fr);
  const out: KnowledgeSection[] = [];
  for (const match of read(root, "src/components/bot-settings/sections.ts").matchAll(/\{ id: "(\w+)", label: "([^"]+)",(?: labelKey: "([\w.]+)",)?[^\n]*?keywords: \[([^\]]*)\]/g)) {
    const [, id, fallback, labelKey, words] = match;
    // Slack as a channel between a team and a bot is removed for now
    // (#3398): no surface offers it, so the model is not told it is there.
    if (id === "slack" && !TEAM_CHAT_CHANNELS_OFFERED) continue;
    const name = labelKey ? label(labelKey, en, fr) : { english: fallback, french: "" };
    const group = groupOf.get(id) ?? (id === "memory" ? groupOf.get("files") : undefined);
    const groupName = group ? label(`persona.group.${group}`, en, fr) : null;
    const where = group
      ? `the bot's editor: open the bot, ${edit.english} (${edit.french}) > ${groupName!.english} > ${name.english}${name.french ? ` (${groupName!.french || groupName!.english} > ${name.french})` : ""}`
      : `the bot panel (open the bot) > Details > ${name.english}${name.french ? ` (${name.french})` : ""}`;
    out.push({
      id: `bot-setting:${id}`,
      kind: "setting",
      title: `Bot settings: ${name.english}${name.french ? ` (${name.french})` : ""}`,
      where,
      access: "the bot's owner, or someone allowed to manage it",
      keywords: [...words.matchAll(/"([^"]+)"/g)].map((word) => word[1]).join(" "),
      text: `${name.english} of one bot. Holds: ${[...words.matchAll(/"([^"]+)"/g)].map((word) => word[1]).join(", ")}.`,
      source: "src/components/bot-settings/sections.ts",
    });
  }
  return out;
}

/** The account menu (the person's avatar at the bottom of the sidebar). */
function menuSections(root: string): KnowledgeSection[] {
  const { en, fr } = locales(root);
  const source = read(root, "src/components/SidebarProfileMenu.tsx");
  const keys = [...new Set([...source.matchAll(/t\("((?:sidebar\.(?:menu|account|nav)|releaseNotes|achievements)\.[\w.]+)"\)/g)].map((match) => match[1]))]
    .filter((key) => !/monthCost|you$|solo$/.test(key));
  return keys.map((key) => {
    const name = label(key, en, fr);
    return {
      id: `menu:${key}`,
      kind: "menu" as const,
      title: `Account menu: ${name.english}${name.french ? ` (${name.french})` : ""}`,
      where: `account menu (the person's avatar at the bottom of the sidebar) > ${name.english}`,
      text: `${name.english}${name.french ? ` / ${name.french}` : ""}: an entry of the account menu.`,
      source: "src/components/SidebarProfileMenu.tsx",
    };
  });
}

// ---------------------------------------------------------------- engines, routes

function engineSections(root: string): KnowledgeSection[] {
  const lock = JSON.parse(read(root, "engines.lock.json")) as {
    engines: Array<{ id: string; name: string; version: string; redistributable?: boolean }>;
    notPreinstalled?: Array<{ id: string; name: string; reason: string }>;
  };
  const out: KnowledgeSection[] = lock.engines.map((engine) => ({
    id: `engine:${engine.id}`,
    kind: "engine" as const,
    title: `Engine ${engine.name}`,
    where: "Settings > Models; a bot's model picker",
    text: `${engine.name} (${engine.id}) ${engine.version} is preinstalled in the Sagax server image${engine.redistributable === false ? " built for your own servers (its licence is not open source)" : ""}. On the desktop the person signs in or installs it from Settings > Models.`,
    source: "engines.lock.json",
  }));
  for (const engine of lock.notPreinstalled ?? []) {
    out.push({ id: `engine:${engine.id}`, kind: "engine", title: `Engine ${engine.name}`, where: "Settings > Models", text: `${engine.name} is not preinstalled on the server image: ${engine.reason}`, source: "engines.lock.json" });
  }
  return out;
}

function routeSections(): KnowledgeSection[] {
  const groups = new Map<string, string[]>();
  for (const row of TOOL_POLICY_ROWS) {
    const route = row.route.replace(/^\^/, "").replace(/\$$/, "").replace(/\\\//g, "/");
    if (route.startsWith("/api/internal") || !route.startsWith("/")) continue;
    const group = route.split("/").slice(0, 3).join("/").replace(/[^\w/-].*$/, "");
    const list = groups.get(group) ?? [];
    list.push(`${row.method} ${route}${row.kind === "prefix" ? "*" : ""} (${row.tier})`);
    groups.set(group, list);
  }
  return [...groups].map(([group, routes]) => ({
    id: `route:${group}`,
    kind: "route" as const,
    title: `Server routes ${group}`,
    access: "the app calls these with the person's session; a bot reaches them only through act, as the person, within the person's rights",
    text: clip(routes.join("; "), 900),
    source: "server/tool-policy.generated.ts",
  }));
}

// ---------------------------------------------------------------- docs

function walk(root: string, dir: string, keep: (path: string) => boolean): string[] {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path).sort()) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") visit(full);
      } else {
        const rel = relative(root, full);
        if (keep(rel)) out.push(rel);
      }
    }
  };
  visit(base);
  return out;
}

/** docs/*.md left out: plans, process notes and records for maintainers. */
const DOCS_LEFT_OUT = new Set([
  "docs/TODO.md", "docs/ci.md", "docs/releasing.md", "docs/notes/history-rewrite-plan.md", "docs/localization.md",
  "docs/mascots.md", "docs/team-incidents.md",
  // infrastructure of a deployment, not what the app does
  "docs/sandbox-kubernetes.md", "docs/user-sandbox-perspicax-infra.md", "docs/runtime-contract.md", "docs/browser-packaging.md",
  "docs/media-proxy.md", "docs/no-phone-home.md", "docs/grok-latency.md",
]);

/** First line of a docs/ page generated from apps/docs/content (scripts/docs-copies.mjs). */
const GENERATED_COPY = "<!-- Generated from apps/docs/content/";

/** Developer notes left out: the misuse policy's internals (the bots
 * already get the policy itself), whose older text names a product the
 * public repository's term scan refuses in a new file. The notes moved from
 * AGENTS.md to docs/code/ (#3292). */
const NOTES_LEFT_OUT = new Set(["doc:docs/code/security.md#misuse-guardrails-2026-10-12"]);

function versionKey(version: string): number[] { return version.split(".").map((part) => Number(part) || 0); }
function newerFirst(a: string, b: string): number {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
}

/** Notes of the last releases, one section per heading, installation left out. */
export function releaseSections(root: string, dir = "docs/releases", product = "Sagax", prefix = "release", keep = 12): KnowledgeSection[] {
  if (!existsSync(join(root, dir))) return [];
  const versions = readdirSync(join(root, dir)).filter((file) => /^\d+\.\d+\.\d+\.md$/.test(file)).map((file) => file.replace(/\.md$/, "")).sort(newerFirst).slice(0, keep);
  const out: KnowledgeSection[] = [];
  for (const version of versions) {
    const markdown = read(root, `${dir}/${version}.md`);
    const date = /<!--\s*date:\s*([\d-]+)\s*-->/.exec(markdown)?.[1] ?? "";
    for (const section of docSections({ path: `${dir}/${version}.md`, markdown, kind: "release", prefix, fallbackTitle: `${product} ${version}${date ? ` (${date})` : ""}` })) {
      if (/installation|install|téléchargement|download|checksums?/i.test(section.title.split(": ").pop() ?? "")) continue;
      out.push({ ...section, id: `${prefix}:${version}#${section.id.split("#")[1]}` });
    }
  }
  return out;
}

function docsSections(root: string): KnowledgeSection[] {
  const out: KnowledgeSection[] = [];
  for (const path of walk(root, "apps/docs/content", (file) => /\.mdx?$/.test(file))) {
    const area = path.replace(/^apps\/docs\/content\/docs\//, "").replace(/\.mdx?$/, "").replace(/\/index$/, "");
    out.push(...docSections({ path, markdown: read(root, path), kind: "doc", fallbackTitle: area, maxLevel: 2 }));
  }
  for (const path of walk(root, "docs", (file) => /^docs\/[^/]+\.md$/.test(file) || /^docs\/(mcp|ios)\/[^/]+\.md$/.test(file))) {
    if (DOCS_LEFT_OUT.has(path)) continue;
    const markdown = read(root, path);
    // A generated copy of a docs site page (scripts/docs-copies.mjs): its source is indexed above.
    if (markdown.startsWith(GENERATED_COPY)) continue;
    out.push(...docSections({ path, markdown, kind: "doc", fallbackTitle: path.replace(/^docs\//, "").replace(/\.md$/, ""), maxLevel: 2 }));
  }
  // The developer notes: the rules of AGENTS.md, and the descriptions of the
  // code that moved out of it into docs/code/ (#3292).
  out.push(...docSections({ path: "AGENTS.md", markdown: read(root, "AGENTS.md"), kind: "notes", fallbackTitle: "Sagax", maxLevel: 2 }));
  for (const path of walk(root, "docs/code", (file) => /^docs\/code\/[^/]+\.md$/.test(file))) {
    out.push(...docSections({ path, markdown: read(root, path), kind: "notes", fallbackTitle: path.replace(/^docs\/code\//, "").replace(/\.md$/, ""), maxLevel: 2 })
      .filter((section) => !NOTES_LEFT_OUT.has(section.id)));
  }
  return out;
}

// ---------------------------------------------------------------- guides

export function checkGuides(root: string, toolNames: ReadonlySet<string>, sectionIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const guide of GUIDES) {
    for (const ref of guide.refs) {
      const [kind, value] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
      if (kind === "tool" && !toolNames.has(value)) problems.push(`${guide.id}: tool ${value} is not in the catalog`);
      else if (kind === "file" && !existsSync(join(root, value))) problems.push(`${guide.id}: file ${value} does not exist`);
      else if (["setting", "card", "menu", "px", "bot-setting", "engine"].includes(kind) && !sectionIds.has(ref)) problems.push(`${guide.id}: ${ref} is not a generated section`);
      else if (!["tool", "file", "setting", "card", "menu", "px", "bot-setting", "engine"].includes(kind)) problems.push(`${guide.id}: unknown reference ${ref}`);
    }
  }
  for (const id of Object.keys(SETTING_NOTES)) if (!sectionIds.has(`setting:${id}`)) problems.push(`SETTING_NOTES.${id} is not a Settings page`);
  return problems;
}

// ---------------------------------------------------------------- audit

const SECRET_PATTERNS = [
  /(?<![\w-])sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/, /\bghp_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bwhsec_[A-Za-z0-9_-]{24,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bAIza[0-9A-Za-z_-]{30,}/,
];
const ALLOWED_EMAIL = /@(example\.(?:com|org|test|net)|[\w-]+\.example(?:\.\w+)?|example|pulsatrix\.ca|users\.noreply\.github\.com|localhost|x\.y\.z)$/;

/** What must never be in the base, whatever the checkout holds (a Docker
 * build copies untracked files too): a secret, a real person's address, a
 * customer named in an example tag. The generator refuses to write a base
 * that fails; the test runs it on the committed one. */
export function auditKnowledgeText(text: string): string[] {
  const problems: string[] = [];
  for (const pattern of SECRET_PATTERNS) if (pattern.test(text)) problems.push(`secret-like text ${pattern}`);
  for (const match of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi)) {
    // a letter TLD: an npm spec (name@1.2.3) is not an address
    const email = match[0].toLowerCase();
    if (!ALLOWED_EMAIL.test(email) && !/^(git@|noreply@|no-reply@)/.test(email)) problems.push(`email address ${email}`);
  }
  if (CUSTOMER_TAG_LEFT.test(text)) problems.push("a customer tag (client:<name>) left unscrubbed");
  return problems;
}

// ---------------------------------------------------------------- assemble

export function readPerspicaxSnapshot(root: string): PerspicaxSnapshot | null {
  const path = join(root, PERSPICAX_SNAPSHOT_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as PerspicaxSnapshot : null;
}

export function hashSections(sections: readonly KnowledgeSection[]): string {
  return createHash("sha256").update(JSON.stringify(sections)).digest("hex").slice(0, 16);
}

/** The whole base; `generated` is the day given (the CLI keeps the old day
 * when the hash did not change). */
export function buildKnowledge(root: string, generated: string): KnowledgeBase {
  const pkg = JSON.parse(read(root, "package.json")) as { forkVersion?: string; version: string };
  const perspicax = readPerspicaxSnapshot(root);
  const tools = toolSections();
  const generatedSections = [
    ...tools,
    ...settingsSections(root),
    ...menuSections(root),
    ...botEditorSections(root),
    ...engineSections(root),
    ...routeSections(),
    ...releaseSections(root),
    ...docsSections(root),
    ...(perspicax?.sections ?? []),
  ];
  const ids = new Set(generatedSections.map((section) => section.id));
  const toolNames = new Set(tools.map((section) => section.id.slice("tool:".length)));
  const problems = checkGuides(root, toolNames, ids);
  if (problems.length) throw new Error(`self-knowledge guides are stale:\n${problems.join("\n")}`);
  const guides: KnowledgeSection[] = GUIDES.map((guide) => ({
    id: `guide:${guide.id}`,
    kind: "guide",
    title: guide.title,
    ...(guide.where ? { where: guide.where } : {}),
    ...(guide.access ? { access: guide.access } : {}),
    keywords: guide.keywords,
    text: guide.text,
    source: guide.refs.join(", "),
  }));
  const byId = new Map<string, KnowledgeSection>();
  for (const section of [...guides, ...generatedSections]) if (!byId.has(section.id)) byId.set(section.id, scrub(section));
  const sections = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const counts: Record<string, number> = {};
  for (const section of sections) counts[section.kind] = (counts[section.kind] ?? 0) + 1;
  return {
    version: pkg.forkVersion ?? pkg.version,
    generated,
    hash: hashSections(sections),
    ...(perspicax ? { perspicax: { version: perspicax.version, commit: perspicax.commit, date: perspicax.date } } : {}),
    counts,
    sections,
  };
}

/** One section per line: a change reads as a change of a few lines. */
export function serializeKnowledge(kb: KnowledgeBase): string {
  const { sections, ...head } = kb;
  return `{\n${Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join("\n")}\n  "sections": [\n${sections.map((section) => `    ${JSON.stringify(section)}`).join(",\n")}\n  ]\n}\n`;
}

export { plainText, slug };
