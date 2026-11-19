/** Isolated gallery for Playwright screenshots of Connect apps and Browse
 * bots in their window (no server). Not shipped in the app.
 * ?view=manage|org-settings|bots|bots-in-apps&skin=<id>&lang=<code>&role=member|admin&app=none
 *   &page=bots|pages opens Plugins on that tab (#2104: a deep link to Bots or Pages)
 * manage: the real Connect apps panel (PluginsPanel) on a stand-in /api
 * shaped like an organization member's (2026-10-26): GitHub added by hand
 * and again by a marketplace plugin, five plugins, the person's Claude
 * account with Gmail, Google Drive and Google Calendar, two Grok sign-ins
 * with the real state of their connectors and a ChatGPT sign-in (#3358).
 * Names are neutral. role=admin: the same person as an organization admin
 * (the organization's sources and access). org-settings: Settings >
 * Organization for that person. settings-subpage: a Settings sub-page in
 * the same window size, the navigation Connect apps' pages follow
 * (2026-10-28). The bot Rocket has its own plugins (For Rocket).
 * &products=1 (#4185): the person's Perspicax products at the Me scope;
 * &products=many: twelve of them, every state; &products=real: the 22 a
 * linked person really gets. With &bot=1 (#4359): the
 * same products at Rocket's This bot scope, one switch each.
 * scripts/capture/connect-apps-grokbot.mjs clicks through the screens. */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { X } from "lucide-react";
import { BotCatalogView } from "../components/bot-catalog/BotCatalogView";
import { CATEGORY_MODAL, cardActionClass } from "../components/category-modal";
import { PluginsPanel } from "../components/PluginsPanel";
import { PerspicaxOrgSettings } from "../components/PerspicaxOrgSettings";
import { SettingsSubPage } from "../components/SettingsSubPage";
import type { PerspicaxOrg } from "../lib/perspicax-org";
import { catalogCategories, catalogSections, catalogTemplates } from "../lib/bot-catalog";
import { loadLocale, t } from "../lib/i18n";
import { flowSupersededFixture, flowSupersededPluginsFixture } from "../lib/flow-superseded.fixture";
import { capabilityFixture } from "../lib/capabilities.fixture";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore } from "../state/store";
import { parsePersonProducts } from "../../shared/person-products";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

/** Capabilities gallery chrome: the panel brings its own centred modal. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-app text-ink" data-gallery-sample="" data-gallery-frame="">
      {children}
    </div>
  );
}

const crumbToApps = [{ label: t("connectApps.title"), onSelect: () => {} }];

const TEMPLATES = catalogTemplates([]);

/** Browse Bots alone, or (inApps) opened from Connect apps in its window. */
function Bots({ inApps }: { inApps?: boolean }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const sections = catalogSections({ organization: true, entries: [] }, TEMPLATES, { category, query, showArchived: false, app: null });
  return (
    <Frame>
      <BotCatalogView
        trail={inApps ? crumbToApps : undefined}
        organization
        categories={catalogCategories(sections.flatMap((entry) => entry.items))}
        category={category}
        onCategory={setCategory}
        query={query}
        onQuery={setQuery}
        sections={sections}
        expanded={null}
        onExpand={() => {}}
        showArchived={false}
        onShowArchived={() => {}}
        hasArchived={false}
        creatorAvatar={() => undefined}
        onOpen={() => {}}
        renderAction={() => <button type="button" className={cardActionClass()}>{t("botCatalog.action.use")}</button>}
        onTemplateTool={() => {}}
      />
    </Frame>
  );
}

// ?view=manage: the stand-in /api an organization member's panel reads
// (&role=admin: an organization admin's).
const admin = params.get("role") === "admin";
// &app=none: no organization GitHub OAuth App (Connect GitHub still uses the built-in one)
const deviceFlow = params.get("app") !== "none";
const githubStore = params.get("github");
const ORG: PerspicaxOrg = {
  org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://px.example.test" } },
  link: { state: "ok" }, viewerRole: admin ? "admin" : "member",
  settings: {
    pluginMarketplaces: { mode: "list", allow: ["example-org/*", "anthropics/claude-plugins-official"] },
    github: { clientId: deviceFlow ? "Ov23liExample0001" : null, fromEnvironment: false },
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MANAGE_API: Record<string, unknown> = {
  "/api/instances": { instances: [
    { instanceId: "claude-main", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "person@example.com", method: "login" } } },
    { instanceId: "grok-main", driverKind: "grokAgent", displayName: "Grok", access: "subscription", snapshot: { state: "available", authenticated: true, account: { method: "login" } } },
  ] },
  "/api/config": { viewer: { role: admin ? "admin" : "member", principalId: "p-1" }, features: {} },
  "/api/bots": { bots: [
    // &bundle=off: a vendor (Beacon Security) the person has not turned on, for the bundle card of Discover
    { id: "bot-a", name: "Rocket", instanceId: "claude-main", model: "default", ownerUserId: "p-1", threads: [], messages: [], ...(params.get("bundle") === "off" ? { products: { "prod-edr": false, "prod-more-1": false } } : {}) },
    { id: "bot-b", name: "Atlas", instanceId: "grok-main", model: "default", ownerUserId: "p-1", mcpServers: ["twilio-docs"], threads: [], messages: [], ...(params.get("bundle") === "off" ? { products: { "prod-edr": false, "prod-more-1": false } } : {}) },
  ], groups: [], sections: [] },
  "/api/org": ORG,
  // &addplugins=1 (#4647): the owner on this machine, so Connect apps opens on the installation's own scope
  ...(params.has("addplugins") ? { "/api/auth/session": { kind: "loopback" } } : {}),
  // the GitHub plugin's page: the account, and one list of other credentials (2026-10-28)
  "/api/me/github/credentials": { canManageOrg: admin, deviceFlow, credentials: [
    { id: "gt_0000000000000011", label: "Second GitHub organization", hint: "9c1d", owner: "mine", chosenBy: 1 },
    { id: "gt_0000000000000001", label: "Private repositories", hint: "4f2a", owner: "org", chosenBy: 0 },
  ] },
  // &github=store_sealed or store_unavailable: a saved account this launch cannot read (#4155)
  "/api/me/connections": { github: githubStore === "store_sealed"
    ? { state: "error", deviceFlow, code: githubStore, error: "Your saved GitHub account cannot be opened on this server anymore. Connect GitHub again." }
    : githubStore === "store_unavailable"
      ? { state: "error", deviceFlow, code: githubStore, error: "Your saved GitHub account is kept, but this server cannot read its key right now." }
      : { state: "none", deviceFlow }, servers: [
    { name: "notes", kind: "remote", type: "http", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 1, authState: "connected" },
  ], sandbox: true },
  "/api/mcp/servers": { servers: [
    { name: "twilio-docs", type: "http", url: "https://mcp.twilio.com/docs", enabled: true, source: "twilio", headerKeys: [], auth: "none" },
    { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, headerKeys: ["Authorization"], auth: "none" },
    // the GitHub plugin's server reads the person's GitHub account (not connected here; &github=store_*: saved, unreadable)
    { name: "github-github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, source: "claude-plugins-official", headerKeys: ["Authorization"], auth: "none", github: githubStore === "store_sealed" || githubStore === "store_unavailable" ? "unreadable" : "missing" },
    // the example plugin's connectors (invented): one reaches a service and needs a sign-in, one is connected, one is local
    { name: "review-notes", type: "http", url: "https://notes.example.test/mcp", enabled: true, source: "claude-plugins-official", headerKeys: [], auth: "connected", accounts: [{ id: "default", auth: "connected" }] },
    { name: "ticket-search", type: "http", url: "https://tickets.example.test/mcp", enabled: true, source: "claude-plugins-official", headerKeys: [], auth: "required" },
    { name: "diff-reader", type: "stdio", command: "diff-reader", args: ["--stdio"], enabled: true, source: "claude-plugins-official", envKeys: [] },
  ], reserved: [] },
  "/api/marketplaces": { marketplaces: [
    { name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", plugins: [
      { name: "github", description: "GitHub's MCP server", installed: true, servers: ["github-github"], skills: [], category: "development" },
      { name: "frontend-design", description: "Distinctive interfaces", installed: true, servers: [], skills: ["frontend-design"], category: "design", homepage: "https://claude.com/plugins" },
      { name: "code-review", description: "Reviews a pull request branch by branch.\nIt reads the diff, checks it against the team's checklist and writes a summary that names every file it skipped.", installed: true, servers: ["review-notes", "ticket-search", "diff-reader"], skills: ["code-review", "review-checklist"], category: "development", updateAvailable: true, installedVersion: "1.0.0", version: "1.1.0", homepage: "https://github.com/anthropics/claude-plugins-official" },
      { name: "pdf-tools", description: "Read and fill PDF forms", installed: false, servers: [], skills: ["pdf"], category: "productivity" },
      { name: "sentry", description: "Errors and releases", installed: false, servers: ["sentry"], skills: [], category: "monitoring" },
      // enough installed plugins for Manage's "Show all" (Grok Bot shows 6 rows, #2146)
      { name: "playwright", description: "Drives a browser for end-to-end checks", installed: true, servers: [], skills: ["browser-check"], category: "development" },
      { name: "commit-commands", description: "Commit, push and open a pull request", installed: true, servers: [], skills: ["commit"], category: "development" },
      { name: "security-guidance", description: "Warns before risky edits", installed: true, servers: [], skills: ["security-review"], category: "security" },
      { name: "data-notebooks", description: "Explores CSV and notebook files", installed: true, servers: [], skills: ["notebook"], category: "productivity" },
    ] },
    { name: "example-ops", source: "example-org/ops-marketplace", visibility: "org", mine: true, hasToken: true, credential: { chosen: { id: "gt_0000000000000011", label: "Second GitHub organization", owner: "mine" }, used: { via: "credential", label: "Second GitHub organization", at: 1 } }, plugins: [
      { name: "ops-flow", description: "Service desk routines", installed: true, servers: [], skills: ["triage", "dispatch", "time-review"], category: "productivity", homepage: "https://www.wikipedia.org" },
      { name: "ops-flow-tenant", description: "This organization's boards and rules", installed: true, servers: [], skills: ["tenant-rules"], category: "productivity" },
      // #4097: a long name, for the rows' second line and truncation
      { name: "quarterly-reporting-and-dashboards-assistant", description: "Builds the quarter's reports and dashboards from the service desk's tickets", installed: false, servers: [], skills: ["quarterly-report"], category: "productivity" },
    ] },
    // #2759: Cursor's official plugins, converted (what did not convert is on the plugin's page)
    { name: "cursor-plugins", source: "cursor/plugins", visibility: "org", plugins: [
      { name: "cursor-team-kit", description: "Team workflows for CI, code review and shipping", installed: true, servers: [], skills: ["ship-it", "rule-no-inline-imports"], category: "developer-tools", convertedFrom: "cursor", notConverted: ["rules_always", "agent_settings:is_background, model", "hooks"] },
      { name: "linear", description: "Issues, projects and cycles from your editor", installed: false, servers: ["linear"], skills: [], category: "productivity", convertedFrom: "cursor", notConverted: [] },
    ] },
    // #4647: a catalog to add from, several in a row
    ...(params.has("addplugins") ? [{ name: "catalog-six", source: "example-org/catalog-six", visibility: "org", plugins: [
      { name: "notes-wiki", description: "Search and write pages of a team wiki", installed: false, servers: [], skills: ["wiki"], category: "productivity" },
      { name: "parts-feed", description: "Look up parts and prices from a supplier feed", installed: false, servers: [], skills: ["parts"], category: "productivity" },
      { name: "reseller-hub", description: "Quotes and orders from a reseller portal", installed: false, servers: [], skills: ["quotes"], category: "productivity" },
      { name: "vault-sync", description: "Find a shared credential's name and owner", installed: false, servers: [], skills: ["vault"], category: "security" },
      { name: "desk-flow", description: "Service desk routines and dispatch", installed: false, servers: [], skills: ["dispatch"], category: "productivity" },
      { name: "endpoint-guard", description: "Threats and agents of an endpoint console", installed: false, servers: [], skills: ["threats"], category: "security" },
    ] }] : []),
  ] },
  "/api/skills-library": { skills: [
    { name: "frontend-design", description: "Distinctive interfaces", source: "claude-plugins-official", enabled: true },
    { name: "code-review", description: "Reviews a pull request", source: "claude-plugins-official", enabled: true },
    { name: "review-checklist", description: "The team's checklist, one item at a time", source: "claude-plugins-official", enabled: true },
    { name: "triage", description: "", source: "example-ops", enabled: true },
    { name: "dispatch", description: "", source: "example-ops", enabled: true },
    { name: "time-review", description: "", source: "example-ops", enabled: true },
    { name: "tenant-rules", description: "", source: "example-ops", enabled: true },
    { name: "weekly-summary", description: "Friday recap of my threads", source: "local-import", enabled: true, updateKey: "skill:me:me:weekly-summary" },
    { name: "meeting-notes", description: "Turns a call transcript into notes and actions", source: "local-import", enabled: true },
    { name: "release-checklist", description: "Steps before a version ships", source: "local-import", enabled: true },
    { name: "browser-check", description: "", source: "claude-plugins-official", enabled: true },
    { name: "commit", description: "", source: "claude-plugins-official", enabled: true },
    { name: "security-review", description: "", source: "claude-plugins-official", enabled: true },
    { name: "notebook", description: "", source: "claude-plugins-official", enabled: true },
    { name: "ship-it", description: "Ship a branch", source: "cursor-plugins", enabled: true },
    { name: "rule-no-inline-imports", description: "Keep imports at top of file", source: "cursor-plugins", enabled: true },
  ].map((skill) => ({ tags: [], version: null, importedAt: 1_761_600_000_000, warnings: [], assignedBots: [], ...skill })) },
  "/api/plugins/search": { featured: [
    { id: "notion", name: "Notion", description: "Pages, databases and notes", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", site: "notion.so", auth: "oauth", category: "productivity" },
    { id: "linear", name: "Linear", description: "Issues, projects and cycles", url: "https://mcp.linear.app/mcp", domain: "mcp.linear.app", site: "linear.app", auth: "oauth", category: "productivity" },
    { id: "slack", name: "Slack", description: "Channels and messages", url: "https://mcp.slack.com/mcp", domain: "mcp.slack.com", site: "slack.com", auth: "oauth", category: "communication" },
    { id: "figma", name: "Figma", description: "Design files and comments", url: "https://mcp.figma.com/mcp", domain: "mcp.figma.com", site: "figma.com", auth: "oauth", category: "design" },
    { id: "stripe", name: "Stripe", description: "Payments and customers", url: "https://mcp.stripe.com", domain: "mcp.stripe.com", site: "stripe.com", auth: "oauth", category: "finance" },
    { id: "asana", name: "Asana", description: "Tasks, projects and goals", url: "https://mcp.asana.com/mcp", domain: "mcp.asana.com", site: "asana.com", auth: "oauth", category: "productivity" },
    { id: "atlassian", name: "Atlassian", description: "Jira issues and Confluence pages", url: "https://mcp.atlassian.com/mcp", domain: "mcp.atlassian.com", site: "atlassian.com", auth: "oauth", category: "productivity" },
    { id: "dropbox", name: "Dropbox", description: "Files and shared folders", url: "https://mcp.dropbox.com/mcp", domain: "mcp.dropbox.com", site: "dropbox.com", auth: "oauth", category: "productivity" },
    { id: "zoom", name: "Zoom", description: "Meetings and recordings", url: "https://mcp.zoom.com/mcp", domain: "mcp.zoom.com", site: "zoom.com", auth: "oauth", category: "communication" },
    { id: "intercom", name: "Intercom", description: "Customer conversations", url: "https://mcp.intercom.com/mcp", domain: "mcp.intercom.com", site: "intercom.com", auth: "oauth", category: "communication" },
    { id: "hubspot", name: "HubSpot", description: "Contacts, deals and tickets", url: "https://mcp.hubspot.com/mcp", domain: "mcp.hubspot.com", site: "hubspot.com", auth: "oauth", category: "sales" },
    { id: "airtable", name: "Airtable", description: "Bases, tables and records", url: "https://mcp.airtable.com/mcp", domain: "mcp.airtable.com", site: "airtable.com", auth: "oauth", category: "productivity" },
    { id: "box", name: "Box", description: "Content and file workflows", url: "https://mcp.box.com/mcp", domain: "mcp.box.com", site: "box.com", auth: "oauth", category: "productivity" },
    { id: "calendly", name: "Calendly", description: "Scheduling links and events", url: "https://mcp.calendly.com/mcp", domain: "mcp.calendly.com", site: "calendly.com", auth: "oauth", category: "productivity" },
    { id: "square", name: "Square", description: "Payments, orders and catalog", url: "https://mcp.square.com/mcp", domain: "mcp.square.com", site: "square.com", auth: "oauth", category: "finance" },
    { id: "vercel", name: "Vercel", description: "Deployments and projects", url: "https://mcp.vercel.com/mcp", domain: "mcp.vercel.com", site: "vercel.com", auth: "oauth", category: "development" },
    { id: "cloudflare", name: "Cloudflare", description: "Workers, DNS and analytics", url: "https://mcp.cloudflare.com/mcp", domain: "mcp.cloudflare.com", site: "cloudflare.com", auth: "oauth", category: "development" },
  ], results: [], nextCursor: null, registryAvailable: true },
  "/api/me/harness-connectors": { manageUrl: "https://claude.ai/customize/connectors", canManage: true, enabled: true, claude: { available: true, connectors: [
    { name: "Gmail", status: "connected" },
    { name: "Google Drive", status: "connected" },
    { name: "Google Calendar", status: "connected" },
    { name: "Canva", status: "needs_auth" },
  ] }, codex: { available: true, connectors: [{ name: "Notion", status: "connected" }] },
  // #3358: the person's Grok sign-ins as the connector registry knows them
  grok: { accounts: [
    { label: "Grok", slot: "primary", auth: "subscription", at: 1_761_650_000_000, connectors: [
      { id: "outlook", name: "Outlook (Exchange)", status: "connected" },
      { id: "microsoft-teams", name: "Microsoft Teams", status: "needs_auth" },
    ] },
    { label: "Grok (personal account)", slot: "second", kind: "personal", auth: "subscription", at: 1_761_650_000_000, connectors: [
      { id: "gmail", name: "Gmail", status: "failed" },
    ] },
  ] } },
  "/api/me/org-capabilities": { owner: "perspicax", items: [] },
  "/api/org/capabilities": { owner: "perspicax", capabilities: [], installed: {} },
  "/api/pages": { pages: [
    { id: "pg-kpi", title: "Weekly KPIs", status: "published", access: "org", expiresAt: null, currentVersion: 2, botId: "bot-a", threadId: "t1", createdAt: 1_761_600_000_000, updatedAt: 1_761_650_000_000, expired: false, url: "https://sagax.example/p/pg-kpi", reachable: true, versions: [
      { n: 1, kind: "html", title: "Weekly KPIs", createdAt: 1_761_600_000_000, state: "published", bytes: 4200, botId: "bot-a" },
      { n: 2, kind: "html", title: "Weekly KPIs", createdAt: 1_761_650_000_000, state: "published", bytes: 4800, botId: "bot-a" },
    ] },
    { id: "pg-test", title: "KPI Test", status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "bot-a", threadId: "t2", createdAt: 1_761_610_000_000, updatedAt: 1_761_610_000_000, expired: false, versions: [
      { n: 1, kind: "html", title: "KPI Test", createdAt: 1_761_610_000_000, state: "proposed", bytes: 1300, botId: "bot-a" },
    ] },
  ] },
  // Rocket's own plugins (the "For Rocket" scope): Code Review on it, GitHub not
  "/api/bots/bot-a/plugins": {
    marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", addedAt: 1, updatedAt: 1, plugins: [
      { name: "github", description: "GitHub's MCP server", installed: false, external: false, category: "development", contents: { agents: [], commands: [], skills: [] } },
      { name: "code-review", description: "Reviews a pull request branch by branch.\nIt reads the diff, checks it against the team's checklist and writes a summary that names every file it skipped.", installed: true, external: false, category: "development", version: "1.0.0", updateKey: "plugin:me:me:code-review@claude-plugins-official", contents: { agents: ["reviewer"], commands: ["review"], skills: ["code-review", "review-checklist"] } },
    ] }, { name: "cursor-plugins", source: "cursor/plugins", visibility: "org", addedAt: 1, updatedAt: 1, plugins: [
      { name: "cursor-team-kit", description: "Team workflows for CI, code review and shipping", installed: true, external: false, category: "developer-tools", updateKey: "plugin:me:me:cursor-team-kit@cursor-plugins", contents: { agents: ["ci-watcher"], commands: [], skills: ["rule-no-inline-imports", "ship-it"] }, convertedFrom: "cursor", notConverted: ["rules_always", "agent_settings:is_background, model", "hooks"] },
    ] }],
    plugins: [
      { key: "code-review@claude-plugins-official", name: "code-review", marketplace: "claude-plugins-official", enabled: true, removed: [], declaredMcpServers: ["review-notes", "ticket-search", "diff-reader"] },
      { key: "cursor-team-kit@cursor-plugins", name: "cursor-team-kit", marketplace: "cursor-plugins", enabled: true, removed: [], declaredMcpServers: [] },
    ],
    policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true,
  },
  "/api/routines": { routines: [], runs: [] },
  "/api/webhooks": { webhooks: [], attempts: [] },
  // Browse Bots opened from Discover (2026-10-28): no bot of the person yet,
  // the built-in templates, an empty marketplace list
  // (2026-10-29: a few neutral bots, so the Bots tab and the search show rows)
  "/api/bot-catalog": { organization: true, viewer: { principalId: "p-1", admin, canCreate: true }, entries: [
    { id: "bot-a", name: "Rocket", title: "Planner", description: "Plans the week and keeps the to-do list", look: { color: "orange" }, owner: { principalId: "p-1", name: "Example member" }, source: "mine", archived: false, primary: true },
    { id: "bot-b", name: "Atlas", title: "Research assistant", description: "Reads the sources and writes a short brief", look: { color: "blue" }, owner: { principalId: "p-1", name: "Example member" }, source: "mine", archived: false, primary: false, catalog: { published: true, category: "research" } },
    { id: "bot-c", name: "Quill", title: "Release notes", description: "Turns merged changes into release notes", look: { color: "green" }, owner: { principalId: "p-2", name: "Example teammate" }, source: "shared", archived: false, primary: false },
    { id: "bot-d", name: "Compass", title: "Onboarding guide", description: "Walks a new teammate through the first week", look: { color: "purple" }, owner: { principalId: "p-3", name: "Example admin" }, source: "organization", archived: false, primary: false, catalog: { published: true, category: "support", featured: true } },
  ] },
  "/api/team-library/xai": { label: "xAI Bot Marketplace", url: "https://x.ai/bot/marketplace", fetchedAt: 1, bots: [] },
};

// The same contract, with independent state for the person's Me scope.
MANAGE_API["/api/me/plugins"] = { ...(MANAGE_API["/api/bots/bot-a/plugins"] as object) };

// ?products=1 (#4185): the person's Perspicax products at the Me scope, one
// per state; without it the server has none to show (the window unchanged).
// Neutral names; no key value ever appears, only a masked ending.
if (params.has("products")) {
  const form = { kind: "basic", fields: [
    { slot: "username", label: { en: "Username", fr: "Nom d'utilisateur" }, secret: false, required: true },
    { slot: "password", label: { en: "Password", fr: "Mot de passe" }, secret: true, required: true },
  ] };
  // Perspicax's own shape (crates/gateway/openapi.json PersonProduct): base_url,
  // reason_code, profiles, key.source user/profile/default with auth_type and
  // last4, actions as an object of booleans
  const allowed = (...names: string[]) => Object.fromEntries(["set_own_key", "replace_key", "test", "remove_own_key", "sign_in", "sign_out"].map((name) => [name, names.includes(name)]));
  const setup = { missing: [], per_customer_address: false };
  const products = [
    { id: "prod-psa", name: "Service Desk", auth_state: "ok", setup, state: "connected", base_url: "https://desk.example.com", reason_code: null, takes_key_kind: "basic",
      profiles: [{ name: "Technicians", mode: "hybrid", personal: false }, { name: "direct", mode: "compact", personal: true }],
      key: { source: "user", named: true, own: true, name: "Mine", auth_type: "basic", last4: "a1b2", last4_slot: "username", expires_at: new Date(Date.now() + 40 * 86_400_000).toISOString(),
        last_test: { at: new Date(Date.now() - 3 * 3_600_000).toISOString(), ok: true, code: "ok", status: 200 } },
      form, actions: allowed("set_own_key", "test", "remove_own_key"), console_url: "https://px.example.test/console/products/prod-psa" },
    { id: "prod-docs", name: "Knowledge Base", auth_state: "missing", setup, state: "key_missing", base_url: "https://docs.example.org", reason_code: "no_key", takes_key_kind: "api_key",
      profiles: [{ name: "Technicians", mode: "compact", personal: false }],
      key: { source: null, named: false, own: false },
      form: { kind: "api_key", fields: [{ slot: "token", label: { en: "API token", fr: "Jeton API" }, secret: true, required: true }] },
      actions: allowed("set_own_key"), console_url: "https://px.example.test/console/products/prod-docs" },
    { id: "prod-edr", name: "Endpoint Security", auth_state: "failing", setup, state: "key_refused", base_url: "https://edr.example.net", reason_code: "unauthorized", takes_key_kind: "basic",
      profiles: [{ name: "Security", mode: "minimal", personal: false }],
      key: { source: "profile", named: true, own: false, name: "Security team", auth_type: "basic", last4: "9f0c", last4_slot: "username",
        last_test: { at: new Date(Date.now() - 20 * 60_000).toISOString(), ok: false, code: "unauthorized", status: 401, since: new Date(Date.now() - 2 * 86_400_000).toISOString() } },
      form, actions: allowed("set_own_key", "replace_key", "test"), console_url: "https://px.example.test/console/products/prod-edr" },
    { id: "prod-wiki", name: "Team Wiki", auth_state: "ok", setup, state: "connected", base_url: "https://wiki.example.org", reason_code: null, takes_key_kind: "bearer",
      profiles: [{ name: "Technicians", mode: "group", personal: false }],
      key: { source: "default", named: false, own: false }, form: null, actions: allowed("test"), console_url: "https://px.example.test/console/products/prod-wiki" },
    { id: "prod-voice", name: "Phone Lines", auth_state: "none", setup: { missing: ["address"], per_customer_address: true }, state: "not_served", base_url: null, reason_code: null, takes_key_kind: null,
      profiles: [], key: { source: null, named: false, own: false }, form: null, actions: allowed(), console_url: "https://px.example.test/console/products/prod-voice" },
  ];
  // &products=many: twelve rows, every state, the longest French ones, to
  // check at phone width that a long state never cuts a product's name
  if (params.get("products") === "many") {
    const more: Array<[string, string]> = [
      ["Remote Monitoring and Management", "key_expired"], ["Backup and Recovery", "key_misfit"],
      ["Documentation Platform", "setup_incomplete"], ["Email Security Gateway", "sign_in_needed"],
      ["Network Controller", "key_refused"], ["Password Manager", "setup_incomplete"],
      ["Quoting and Procurement", "no_key_needed"], ["Dashboards", "unknown_state"],
    ];
    more.forEach(([name, state], index) => products.push({ id: `prod-more-${index}`, name, auth_state: "missing", setup, state, base_url: null, reason_code: null, takes_key_kind: null, profiles: [{ name: "Technicians", mode: "group", personal: false }], key: { source: null, named: false, own: false }, form: null, actions: allowed(), console_url: "" } as never));
  }
  // &products=real (#4359): the list a linked person really gets, its ids and
  // titles as api_list serves them (a family split in twelve long titles)
  if (params.get("products") === "real") {
    const family = ["company", "configurations", "expense", "finance", "marketing", "procurement", "project", "sales", "schedule", "service", "system", "time"];
    const real: Array<[string, string]> = [
      ["bookstack", "BookStack API (content scope)"], ["brightgauge", "ConnectWise BrightGauge (internal web API)"], ["cw_cpq", "ConnectWiseSellService"],
      ...family.map((part): [string, string] => [`cw_psa_${part}`, `Connectwise Manage Public Endpoints: ${part}`]),
      ["cw_rmm", "ConnectWise Platform APIs"], ["edrtool", "S1 MGMT API"], ["twilio_api", "Twilio - Api"], ["twilio_lookups", "Twilio - Lookups"],
      ["twilio_messaging", "Twilio - Messaging"], ["twilio_monitor", "Twilio - Monitor"], ["x360recover", "X360Recover API"],
    ];
    products.splice(0, products.length, ...real.map(([id, name]) => ({ id, name, auth_state: "ok", setup, state: "connected", base_url: null, reason_code: null, takes_key_kind: null, profiles: [{ name: "Technicians", mode: "group", personal: false }], key: { source: "default", named: false, own: false }, form: null, actions: allowed("test"), console_url: "" } as never)));
  }
  // #4453: the console files products under their vendor (invented names):
  // one vendor row unfolds into its products; a product of no vendor stands alone
  if (params.get("products") === "many") {
    // example marks the console would serve: inline SVG, invented shapes (no real brand)
    const mark = (fill: string, body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fill}"/>${body}</svg>`)}`;
    const harbor = mark("#1d4ed8", '<path d="M32 12v26M20 24h24M14 38c3 10 11 14 18 14s15-4 18-14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="14" r="4" fill="#fff"/>');
    const beacon = mark("#be185d", '<path d="M32 12l16 28H16z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><circle cx="32" cy="48" r="4" fill="#fff"/>');
    const tile = (fill: string, body: string) => mark(fill, body);
    // the console's wide `logo` is a wordmark (the banner must never draw it): an invented horizontal one
    const wordmark = (fill: string, label: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 64"><rect width="240" height="64" rx="12" fill="#fff"/><circle cx="30" cy="32" r="12" fill="${fill}"/><text x="52" y="40" font-family="Arial" font-weight="700" font-size="22" fill="#111">${label}</text></svg>`)}`;
    const vendorHarbor = { id: "harbor", name: "Harbor Suite", description: { en: "Service desk, monitoring, quoting and dashboards in one place.", fr: "Service desk, supervision, soumissions et tableaux de bord au même endroit." }, icon: { url: harbor }, logo: wordmark("#1d4ed8", "HARBOR") };
    const vendorBeacon = { id: "beacon", name: "Beacon Security", description: { en: "Endpoint protection and backup.", fr: "Protection des postes et sauvegarde." }, icon: { url: beacon }, logo: wordmark("#be185d", "BEACON") };
    const filed: Record<string, { group: typeof vendorHarbor; endpoints?: string[]; icon?: { url: string }; description?: string }> = {
      "prod-psa": { group: vendorHarbor, icon: { url: tile("#0f766e", '<path d="M18 20h28v24H18zM18 28h28" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>') }, description: "Tickets, time and agreements for the service desk", endpoints: ["Tickets", "Time entries", "Projects", "Agreements", "Invoices", "Companies", "Contacts", "Schedule", "Configurations", "Reports"] },
      "prod-more-0": { group: vendorHarbor, icon: { url: tile("#7c3aed", '<rect x="16" y="18" width="32" height="20" rx="3" fill="none" stroke="#fff" stroke-width="4"/><path d="M26 46h12" stroke="#fff" stroke-width="4" stroke-linecap="round"/>') }, endpoints: ["Devices", "Alerts", "Scripts"] },
      "prod-more-6": { group: vendorHarbor, icon: { url: tile("#b45309", '<path d="M20 22h24l-3 20H23zM28 22v-4a4 4 0 018 0v4" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>') }, endpoints: ["Quotes", "Catalog", "Orders"] },
      "prod-more-7": { group: vendorHarbor, endpoints: ["Gauges", "Dashboards"] },
      "prod-edr": { group: vendorBeacon, icon: { url: tile("#9f1239", '<path d="M32 14l14 6v12c0 9-6 15-14 18-8-3-14-9-14-18V20z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>') } },
      "prod-more-1": { group: vendorBeacon },
    };
    for (const product of products as Array<{ id: string }>) Object.assign(product, filed[product.id] ?? {});
    // &harbor=15: one vendor of fifteen connectors that share a long prefix (the bundle's Overview and Connectors tab)
    if (params.get("harbor") === "15") {
      for (const product of products as Array<{ id: string; group?: unknown }>) if (product.group === vendorHarbor) delete product.group;
      const areas = ["Company", "Configurations", "Expense", "Finance", "Marketing", "Procurement", "Project", "Sales", "Schedule", "Service", "System", "Time", "Reports", "Agreements", "Documents"];
      areas.forEach((area, index) => (products as unknown[]).push({ id: `prod-harbor-${index}`, name: `Harbor Suite Public Endpoints: ${area}`, auth_state: "ok", setup, state: index === 4 ? "key_expired" : index === 8 ? "key_refused" : "connected", base_url: null, reason_code: null, takes_key_kind: null, profiles: [{ name: "Technicians", mode: "group", personal: false }], key: { source: "default", named: false, own: false }, form: null, actions: allowed("test"), console_url: "", group: vendorHarbor, endpoints: Array.from({ length: 3 + (index % 5) }, (_, n) => `${area} tool ${n + 1}`) } as never));
    }
  }
  // what Perspicax answers, read as the Sagax server reads it
  const served = parsePersonProducts(products);
  MANAGE_API["/api/me/perspicax/products"] = { products: served };
  for (const product of served) MANAGE_API[`/api/me/perspicax/products/${product.id}`] = { product };
}

// #4453: what the organization console offers or requires of the person, per
// kind (invented names): in the console's section at the top of each kind
if (params.has("products") && !admin) {
  const offered = (id: string, form: "plugin" | "skill" | "mcp", name: string, description: string, mode: "offered" | "imposed", on: boolean, version?: string, vendor?: string) => ({
    id, mount: id, form, name, description, mode, enabled: true, state: on ? "installed" : "off", on, canToggle: mode === "offered", ...(version ? { version } : {}), ...(vendor ? { vendor } : {}),
  });
  MANAGE_API["/api/me/org-capabilities"] = { owner: "perspicax", items: [
    offered("oc-1", "plugin", "Harbor Toolkit", "Templates and checks for the service desk", "offered", false, "1.2.0"),
    offered("oc-2", "plugin", "Compliance Pack", "The organization's review rules", "imposed", true, "0.9.4"),
    offered("oc-3", "skill", "Weekly summary", "Writes the week's recap", "offered", true),
    offered("oc-4", "mcp", "Team search", "Searches the shared drive", "offered", false),
    // a skill that goes with a vendor's bundle: its Skills tab
    offered("oc-5", "skill", "Service desk macros", "Canned replies for the service desk", "offered", true, undefined, "harbor"),
  ] };
}
// &productPlugin=1 (#4696; &productPlugin=off: turned off): the person installed, from a marketplace, a plugin
// of skills named for the Harbor Suite group (invented): it joins that group's
// card and page instead of standing alone under "Added by you"
if (params.has("productPlugin")) {
  const mine = MANAGE_API["/api/me/plugins"] as { plugins: unknown[]; marketplaces: Array<{ name: string; plugins: unknown[] }> };
  MANAGE_API["/api/me/plugins"] = {
    ...mine,
    marketplaces: [...mine.marketplaces, { name: "example-tools", source: "example-org/tools-marketplace", visibility: "org", addedAt: 1, updatedAt: 1, plugins: [
      { name: "harbor-suite", description: "Harbor Suite: every Harbor product in one plugin", installed: true, external: false, category: "productivity", version: "0.31.9", updateKey: "plugin:me:me:harbor-suite@example-tools", contents: { agents: [], commands: [], skills: ["init", "service-dispatch", "service-ticket", "time"] } },
    ] }],
    plugins: [...mine.plugins, { key: "harbor-suite@example-tools", name: "harbor-suite", marketplace: "example-tools", enabled: params.get("productPlugin") !== "off", removed: [], declaredMcpServers: [] }],
  };
}
// ?empty=plugins: a person with no plugin of their own (the first-block banner)
if (params.get("empty") === "plugins") {
  const mine = MANAGE_API["/api/me/plugins"] as { plugins: unknown[]; marketplaces: Array<{ plugins: Array<{ installed: boolean }> }> };
  MANAGE_API["/api/me/plugins"] = { ...mine, plugins: [], marketplaces: mine.marketplaces.map((market) => ({ ...market, plugins: market.plugins.map((plugin) => ({ ...plugin, installed: false })) })) };
}

// #4504: what has an update waiting (invented items): two plugins (one will fail when run),
// a skill, and one the organization console pins (no mark: the console decides its version)
let galleryUpdates = [
  { key: "plugin:me:me:code-review@claude-plugins-official", kind: "plugin", name: "Code Review", scope: "me", installedVersion: "1.0.0", availableVersion: "1.1.0", updateAvailable: true, updateNotes: "Reviews now run on the whole branch, and the summary names the files it skipped.", canUpdate: true },
  { key: "plugin:me:me:cursor-team-kit@cursor-plugins", kind: "plugin", name: "Cursor Team Kit", scope: "me", installedVersion: "0.9.1", availableVersion: "0.10.0", updateAvailable: true, canUpdate: true },
  ...(params.has("productPlugin") ? [{ key: "plugin:me:me:harbor-suite@example-tools", kind: "plugin", name: "Harbor Suite", scope: "me", installedVersion: "0.31.9", availableVersion: "0.32.0", updateAvailable: true, canUpdate: true }] : []),
  { key: "skill:me:me:weekly-summary", kind: "skill", name: "weekly-summary", scope: "me", installedVersion: "a1b2c3d", availableVersion: "e4f5a6b", updateAvailable: true, canUpdate: true },
  { key: "plugin:organization:organization:compliance-pack", kind: "plugin", name: "Compliance Pack", scope: "organization", organization: "required", pinned: "0.9.4", installedVersion: "0.9.4", availableVersion: "0.9.5", updateAvailable: true, canUpdate: false },
] as Array<Record<string, unknown> & { key: string; name: string; canUpdate: boolean; installedVersion?: string; availableVersion?: string }>;
// ?updates=history: plugins updated by themselves; no banner, the plugin's own page keeps one line (M-20261119-040)
const galleryHistory = params.get("updates") === "history" ? [{ kind: "plugin", name: "Code Review", at: Date.UTC(2026, 10, 18, 15), from: "0.33.6", to: "0.33.8" }] : [];
if (params.has("updates")) {
  MANAGE_API["/api/me/capability-updates"] = { history: galleryHistory, get count() { return params.get("updates") === "history" ? 0 : galleryUpdates.filter((item) => item.canUpdate).length; }, checkedAt: Date.now(), checking: false, get items() { return params.get("updates") === "history" ? [] : galleryUpdates; } };
}

// ?superseded=1: the real member panel, with an obsolete bot tenant copy.
// All /api responses and the removal stay inside this gallery.
const superseded = params.has("superseded");
let flowInventory = flowSupersededFixture();
if (superseded) {
  MANAGE_API["/api/bots/bot-a/capabilities"] = flowInventory;
  MANAGE_API["/api/bots/bot-a/plugins"] = flowSupersededPluginsFixture();
}
// ?bot=1 (#2759): what Rocket receives, Code Review and a converted Cursor plugin among it
if (params.has("bot")) {
  const plugin = (name: string, label: string, market: string, skills: string[], agents: string[] = []) => ({
    key: `plugin:bot:${name}@${market}`, form: "plugin" as const, name: label, source: { kind: "marketplace" as const, label: market, version: "1.0.0" },
    scope: "bot" as const, state: "on" as const, enabled: true, canToggle: true,
    brings: { skills, commands: [], agents, mcpServers: [] }, engine: { skills: "prompt" as const, agents: "prompt" as const, nothing: false },
  });
  MANAGE_API["/api/bots/bot-a/capabilities"] = {
    botId: "bot-a", engine: { kind: "claude", label: "Claude" },
    items: [
      plugin("code-review", "Code Review", "claude-plugins-official", ["code-review"], ["reviewer"]),
      plugin("cursor-team-kit", "Cursor Team Kit", "cursor-plugins", ["rule-no-inline-imports", "ship-it"], ["ci-watcher"]),
      // #4453: a skill, the person's own server, a server everyone may use
      // (this bot's switch) and an engine account's connector, one per kind tab
      ...capabilityFixture().items.filter((item) => item.form === "skill" || item.form === "mcp" || item.form === "connector"),
    ],
  };
}
// ?bot=1&products=1 (#4359): the same products at Rocket's This bot scope,
// one switch each, Endpoint Security switched off for Rocket (with
// &products=real, the service family's service part and the EDR)
if (params.has("bot") && params.has("products")) {
  const listed = (MANAGE_API["/api/me/perspicax/products"] as { products: Array<{ id: string; name: string; state: string }> }).products;
  const inventory = MANAGE_API["/api/bots/bot-a/capabilities"] as { items: unknown[] };
  inventory.items = [...inventory.items, ...listed.filter((product) => product.state !== "not_served").map((product) => {
    const enabled = !["prod-edr", "cw_psa_service", "edrtool"].includes(product.id);
    return {
      key: `product:bot:${product.id}`, form: "product", name: product.name, product: product.id,
      source: { kind: "perspicax", label: "Example Org" }, scope: "bot", state: enabled ? "on" : "off", enabled, canToggle: true,
      engine: enabled ? { mcp: "mounted", tools: "mounted", nothing: false } : { nothing: true },
      ...(enabled ? { mounts: ["perspicax"] } : { reason: "disabled" }),
    };
  })];
}
MANAGE_API["/api/me/skills-library"] = MANAGE_API["/api/skills-library"];

// Connect apps > Tailscale (synthetic gallery). ?tailscale=disconnected|ready|waiting|connected
// seeds the public view; POSTs mutate it in memory. Secrets never appear in answers.
const COMPUTERS = [
  { id: "sandbox:p-1", label: "Bot computer", place: "sandbox" as const },
];
type GalleryTailscalePhase = "disconnected" | "ready" | "pending_approval" | "connected" | "error";
const seedPhase = ((): GalleryTailscalePhase => {
  const raw = params.get("tailscale") ?? "disconnected";
  if (raw === "ready" || raw === "waiting" || raw === "connected" || raw === "error") {
    return raw === "waiting" ? "pending_approval" : raw;
  }
  return "disconnected";
})();
let galleryTailscale: {
  phase: GalleryTailscalePhase;
  credentials: { kind: "authKey" | "oauth"; hint: string; tags: string[] } | null;
  computer: (typeof COMPUTERS)[number] | null;
  keyKind: "ephemeral" | "reusable" | null;
  device: { name: string; addresses: string[]; pendingApproval: boolean; nodeId?: string } | null;
  error: string | null;
  computers: typeof COMPUTERS;
} = {
  phase: seedPhase,
  credentials: seedPhase === "disconnected" ? null : { kind: "authKey", hint: "9f2a", tags: ["tag:sagax"] },
  computer: seedPhase === "disconnected" || seedPhase === "ready" ? null : COMPUTERS[0]!,
  keyKind: seedPhase === "disconnected" || seedPhase === "ready" ? null : "ephemeral",
  device: seedPhase === "pending_approval"
    ? { name: "sagax-bot", addresses: [], pendingApproval: true, nodeId: "n-gallery1" }
    : seedPhase === "connected"
      ? { name: "sagax-bot", addresses: ["100.64.0.12", "fd7a:115c:a1e0::12"], pendingApproval: false, nodeId: "n-gallery1" }
      : null,
  error: seedPhase === "error" ? "The control plane did not answer. Try again." : null,
  computers: COMPUTERS,
};

/** The example plugin's files and a skill's, for Contents (invented, small). */
const GALLERY_PLUGIN_FILES: Record<string, string> = {
  "README.md": "# Code Review\n\nReviews a pull request branch by branch.\n\n## What it does\n\n- Reads the diff and the files around it\n- Checks it against the team's checklist\n- Writes a summary that **names every file it skipped**\n\n## Use it\n\nType `/review` in a chat, or let the bot pick it up when you ask for a review.\n\n```sh\n./scripts/run-checks.sh main\n```\n",
  ".claude-plugin/plugin.json": '{\n  "name": "code-review",\n  "version": "1.0.0",\n  "description": "Reviews a pull request branch by branch"\n}\n',
  "commands/review.md": "Review the current branch against main and write the summary.\n",
  "agents/reviewer.md": "---\nname: reviewer\ndescription: Reads a diff like a careful colleague\n---\n\nRead the whole diff before you write anything.\n",
  "skills/code-review/SKILL.md": "---\nname: code-review\ndescription: Reviews a pull request\n---\n\nStart with the riskiest file. Say what you did not read.\n",
  "skills/code-review/checklist.md": "# Checklist\n\n1. Does it do what the title says?\n2. Is there a test that fails without it?\n3. Is anything renamed twice?\n",
  "skills/review-checklist/SKILL.md": "---\nname: review-checklist\ndescription: The team's checklist, one item at a time\n---\n\nAsk the items one at a time.\n",
  "scripts/run-checks.sh": "#!/bin/sh\n# usage: run-checks.sh <base-branch>\nset -eu\ngit diff --stat \"$1\"...HEAD\n",
};
/** An organization plugin's files (Compliance Pack), for its page's Contents. */
const GALLERY_ORG_FILES: Record<string, string> = {
  "README.md": "# Compliance Pack\n\nThe organization's review rules.\n\n- Every change names its reviewer\n- Anything touching billing waits for a second look\n",
  "skills/review-rules/SKILL.md": "---\nname: review-rules\ndescription: The review rules\n---\n\nName the reviewer first.\n",
};
const GALLERY_SKILL_FILES: Record<string, string> = {
  "notes/format.md": "# Format\n\nThree sections: what moved, what waits, what needs a decision.\n",
  "scripts/collect.py": "# gathers the week's threads\nprint('collecting')\n",
};

if (["manage", "org-settings", "settings-subpage"].includes(params.get("view") ?? "manage")) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    if (superseded && url.pathname === "/api/bots/bot-a/plugins/pulsatrix-flow-osprey%40osprey" && method === "DELETE") {
      flowInventory = { ...flowInventory, items: flowInventory.items.filter((item) => item.scope !== "bot") };
      MANAGE_API["/api/bots/bot-a/capabilities"] = flowInventory;
      MANAGE_API["/api/bots/bot-a/plugins"] = flowSupersededPluginsFixture(false);
      return json(MANAGE_API["/api/bots/bot-a/plugins"]);
    }
    // Connect GitHub: always the link and the code. &device=fail shows the
    // refusal (Try again, token under Advanced); &code=XXXX-XXXX shows a
    // code GitHub really handed out (scripts/capture/github-plugin.mjs).
    if (url.pathname === "/api/me/github/device" && method === "POST") {
      if (params.get("device") === "fail") {
        return json({ error: "GitHub sign-in with a link and a code is not available on this server right now. Try again later.", code: "device_flow_unavailable" }, 409);
      }
      const started = { userCode: params.get("code") ?? "ABCD-1234", verificationUri: "https://github.com/login/device", expiresAt: Date.now() + 15 * 60_000 };
      MANAGE_API["/api/me/connections"] = { ...(MANAGE_API["/api/me/connections"] as object), github: { state: "pending", deviceFlow: true, ...started } };
      return json(started);
    }
    if (url.pathname === "/api/me/tailscale" && method === "GET") return json(galleryTailscale);
    if (url.pathname === "/api/me/tailscale" && method === "DELETE") {
      galleryTailscale = {
        phase: "disconnected",
        credentials: null,
        computer: null,
        keyKind: null,
        device: null,
        error: null,
        computers: COMPUTERS,
      };
      return json(galleryTailscale);
    }
    if (url.pathname === "/api/me/tailscale/setup" && method === "POST") {
      let body: { mode?: string; authKey?: string; clientId?: string } = {};
      try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* ignore */ }
      const kind = body.mode === "oauth" ? "oauth" as const : "authKey" as const;
      const hint = kind === "oauth"
        ? String(body.clientId ?? "client").slice(0, 4)
        : String(body.authKey ?? "key").slice(-4);
      galleryTailscale = {
        ...galleryTailscale,
        phase: "ready",
        credentials: { kind, hint: hint || "saved", tags: ["tag:sagax"] },
        computer: null,
        keyKind: null,
        device: null,
        error: null,
      };
      return json(galleryTailscale);
    }
    if (url.pathname === "/api/me/tailscale/join" && method === "POST") {
      let body: { computerId?: string; keyKind?: string } = {};
      try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* ignore */ }
      const computer = COMPUTERS.find((entry) => entry.id === body.computerId) ?? COMPUTERS[0]!;
      galleryTailscale = {
        ...galleryTailscale,
        phase: "pending_approval",
        computer,
        keyKind: body.keyKind === "reusable" ? "reusable" : "ephemeral",
        device: { name: "sagax-bot", addresses: [], pendingApproval: true, nodeId: "n-gallery1" },
        error: null,
      };
      return json(galleryTailscale);
    }
    if (url.pathname === "/api/me/tailscale/refresh" && method === "POST") {
      return json(galleryTailscale);
    }
    if (url.pathname === "/api/me/tailscale/disconnect" && method === "POST") {
      galleryTailscale = {
        ...galleryTailscale,
        phase: galleryTailscale.credentials ? "ready" : "disconnected",
        computer: null,
        keyKind: null,
        device: null,
        error: null,
      };
      return json(galleryTailscale);
    }
    // what an item holds, read only (the Contents tab): a small invented set
    const holds = /^\/api\/(?:marketplaces\/[^/]+\/plugins\/[^/]+|me\/plugins\/[^/]+|me\/org-capabilities\/[^/]+|bots\/[^/]+\/plugins\/[^/]+|(?:me\/)?skills-library\/[^/]+)\/files$/.exec(url.pathname);
    if (holds && method === "GET") {
      const isSkill = url.pathname.includes("skills-library");
      const set = isSkill ? GALLERY_SKILL_FILES : url.pathname.includes("org-capabilities") ? GALLERY_ORG_FILES : GALLERY_PLUGIN_FILES;
      const wanted = url.searchParams.get("path");
      if (!wanted) return json({ files: Object.entries(set).map(([path, text]) => ({ path, bytes: text.length, kind: "text" }))});
      const text = set[wanted] ?? (isSkill && wanted === "SKILL.md" ? "---\nname: weekly-summary\ndescription: Friday recap of my threads\n---\n\nRead the week's threads, then write a short recap: what moved, what waits, what needs a decision.\n" : undefined);
      return text === undefined ? json({ error: "no such file" }, 404) : json({ path: wanted, kind: "text", text, bytes: text.length });
    }
    const skillDetail = /^\/api\/(?:me\/)?skills-library\/([^/]+)$/.exec(url.pathname);
    if (skillDetail && method === "GET") {
      const name = decodeURIComponent(skillDetail[1]);
      const listed = (MANAGE_API["/api/skills-library"] as { skills: Array<{ name: string; description: string; source: string; enabled: boolean }> }).skills.find((skill) => skill.name === name);
      if (listed) {
        const text = `---\nname: ${name}\ndescription: ${listed.description || name}\n---\n\nRead the week's threads, then write a short recap: what moved, what waits, what needs a decision.\n`;
        return json({ name, text, description: listed.description, source: listed.source, enabled: listed.enabled, changedAfterReview: false, reviewedText: null, warnings: [], files: [], editable: true, origin: "library" });
      }
    }
    if (params.has("updates") && url.pathname === "/api/me/capability-updates" && method === "POST") {
      const asked = JSON.parse(String(init?.body ?? "{}")) as { keys?: string[]; all?: true };
      const wanted = galleryUpdates.filter((item) => item.canUpdate && (asked.all || asked.keys?.includes(item.key)));
      await new Promise((resolve) => setTimeout(resolve, params.get("updates") === "slow" ? 4000 : 400));
      const results = wanted.map((item) => item.name === "Cursor Team Kit"
        ? { key: item.key, kind: item.kind, name: item.name, status: "failed", error: "The marketplace could not be reached." }
        : { key: item.key, kind: item.kind, name: item.name, status: "updated", from: item.installedVersion, to: item.availableVersion });
      galleryUpdates = galleryUpdates.filter((item) => !results.some((result) => result.key === item.key && result.status === "updated"));
      return json({ results, count: galleryUpdates.filter((item) => item.canUpdate).length });
    }
    // &addplugins=1 (#4647): a catalog of six plugins to add in a row; each add answers after a pause
    // (the third fails), so the cards show their own spinner, Added state and error
    const addPlugin = params.has("addplugins") ? /^\/api\/marketplaces\/([^/]+)\/plugins\/([^/]+)$/.exec(url.pathname) : null;
    if (addPlugin && method === "POST") {
      const [, market, plugin] = addPlugin.map(decodeURIComponent);
      await new Promise((resolve) => setTimeout(resolve, Number(params.get("addplugins")) > 1 ? Number(params.get("addplugins")) : 1500));
      if (plugin === "reseller-hub") return json({ error: "The marketplace could not be reached." }, 422);
      const listed = (MANAGE_API["/api/marketplaces"] as { marketplaces: Array<{ name: string; plugins: Array<{ name: string; installed: boolean }> }> }).marketplaces;
      for (const entry of listed.find((candidate) => candidate.name === market)?.plugins ?? []) if (entry.name === plugin) entry.installed = true;
      return json({ marketplaces: listed, skipped: [] });
    }
    // &solo=1: a server with no organization: the person is the installation (the workspace scope, where a plugin lists what it brought)
    if (params.has("solo") && url.pathname === "/api/org") return json({ error: "no organization" }, 404);
    const body = MANAGE_API[url.pathname];
    if (body !== undefined && method === "GET") return json(body);
    if (url.pathname.startsWith("/api/bots/") && url.pathname.endsWith("/plugins")) return json({ error: "not here" }, 404);
    return json({ error: "gallery" }, 404);
  }) as typeof window.fetch;
}

const forBot = params.has("bot");
const deepLinkPage = ["bots", "pages", "sources"].includes(params.get("page") ?? "") ? params.get("page") as "bots" | "pages" | "sources" : null;

function Manage() {
  const { state, dispatch } = useStore();
  const ready = state.bots.some((bot) => bot.id === "bot-a");
  useEffect(() => {
    if (superseded && ready) dispatch({ type: "togglePlugins", open: true, surface: "apps", botId: "bot-a" });
    // ?bot=1 (#2759): Plugins opened for Rocket, its own plugins in the "This bot" scope
    // ?bot=1&add=mcp (#3910): the same bot's Add > MCP servers, on Manage where a server is added
    else if (forBot && ready) dispatch({ type: "togglePlugins", open: true, surface: params.get("add") === "mcp" ? "mcp" : "apps", botId: "bot-a" });
  }, [ready, dispatch]);
  useEffect(() => {
    if (deepLinkPage) dispatch({ type: "togglePlugins", open: true, page: deepLinkPage });
  }, [dispatch]);
  if ((superseded || forBot) && (!ready || state.pluginsBotId !== "bot-a")) return <Frame>{null}</Frame>;
  return (
    <Frame>
      <PluginsPanel />
    </Frame>
  );
}

/** A Settings sub-page (General > About me) in Connect apps' window size:
 * the navigation the panel's own pages follow. */
function SettingsSubpageSample() {
  return (
    <div className={CATEGORY_MODAL.backdrop}>
      <div role="dialog" aria-label="Settings" className={CATEGORY_MODAL.frame}>
        <div className={CATEGORY_MODAL.content}>
          <button type="button" aria-label="Close" className={CATEGORY_MODAL.close}><X size={18} /></button>
          <SettingsSubPage pageId="about-me" sectionLabel={t("settings.section.general")} title="About me" onBack={() => {}}>
            <div className="rounded-[14px] border-[0.5px] border-border p-4 text-[13px] text-ink-secondary">Text a bot reads about you.</div>
          </SettingsSubPage>
        </div>
      </div>
    </div>
  );
}

/** Settings > Organization as the settings window draws it. */
function OrgSettings() {
  return (
    <div className="mx-auto max-w-[760px] px-6 py-8" data-gallery-org-settings>
      <PerspicaxOrgSettings org={ORG} onChanged={() => {}} />
    </div>
  );
}

const VIEWS: Record<string, () => React.ReactNode> = {
  manage: () => <Manage />,
  "org-settings": () => <OrgSettings />,
  "settings-subpage": () => <SettingsSubpageSample />,
  bots: () => <Bots />,
  "bots-in-apps": () => <Bots inApps />,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-app text-ink">{(VIEWS[params.get("view") ?? "manage"] ?? VIEWS.manage!)()}</div>
    </StoreProvider>
  </StrictMode>,
);
