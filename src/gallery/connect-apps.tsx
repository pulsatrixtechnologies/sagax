/** Isolated gallery for Playwright screenshots of Connect apps and Browse
 * bots in their window (no server). Not shipped in the app.
 * ?view=manage|org-settings|bots|bots-in-apps&skin=<id>&lang=<code>&role=member|admin&app=none
 * manage: the real Connect apps panel (PluginsPanel) on a stand-in /api
 * shaped like an organization member's (2026-10-26): GitHub added by hand
 * and again by a marketplace plugin, five plugins, the person's Claude
 * account with Gmail, Google Drive and Google Calendar, a Grok account.
 * Names are neutral. role=admin: the same person as an organization admin
 * (the organization's sources and access). org-settings: Settings >
 * Organization for that person. settings-subpage: a Settings sub-page in
 * the same window size, the navigation Connect apps' pages follow
 * (2026-10-28). The bot Rocket has its own plugins (For Rocket).
 * scripts/capture/connect-apps-manage.mjs clicks through the tabs. */
import { StrictMode, useState } from "react";
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
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
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
// &app=none: no GitHub OAuth App on the server (Connect GitHub takes a token)
const deviceFlow = params.get("app") !== "none";
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
    { id: "bot-a", name: "Rocket", instanceId: "claude-main", model: "default", ownerUserId: "p-1", threads: [], messages: [] },
    { id: "bot-b", name: "Atlas", instanceId: "grok-main", model: "default", ownerUserId: "p-1", mcpServers: ["twilio-docs"], threads: [], messages: [] },
  ], groups: [], sections: [] },
  "/api/org": ORG,
  // the GitHub plugin's page: the account, and one list of other credentials (2026-10-28)
  "/api/me/github/credentials": { canManageOrg: admin, deviceFlow, credentials: [
    { id: "gt_0000000000000011", label: "Second GitHub organization", hint: "9c1d", owner: "mine", chosenBy: 1 },
    { id: "gt_0000000000000001", label: "Private repositories", hint: "4f2a", owner: "org", chosenBy: 0 },
  ] },
  "/api/me/connections": { github: { state: "none", deviceFlow }, servers: [
    { name: "notes", kind: "remote", type: "http", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 1, authState: "connected" },
  ], sandbox: true },
  "/api/mcp/servers": { servers: [
    { name: "twilio-docs", type: "http", url: "https://mcp.twilio.com/docs", enabled: true, source: "twilio", headerKeys: [], auth: "none" },
    { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, headerKeys: ["Authorization"], auth: "none" },
    // the GitHub plugin's server reads the person's GitHub account (not connected here)
    { name: "github-github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, source: "claude-plugins-official", headerKeys: ["Authorization"], auth: "none", github: "missing" },
  ], reserved: [] },
  "/api/marketplaces": { marketplaces: [
    { name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", plugins: [
      { name: "github", description: "GitHub's MCP server", installed: true, servers: ["github-github"], skills: [], category: "development" },
      { name: "frontend-design", description: "Distinctive interfaces", installed: true, servers: [], skills: ["frontend-design"], category: "design", homepage: "https://claude.com/plugins" },
      { name: "code-review", description: "Reviews a pull request", installed: true, servers: [], skills: ["code-review"], category: "development", updateAvailable: true, installedVersion: "1.0.0", version: "1.1.0", homepage: "https://github.com/anthropics/claude-plugins-official" },
      { name: "pdf-tools", description: "Read and fill PDF forms", installed: false, servers: [], skills: ["pdf"], category: "productivity" },
      { name: "sentry", description: "Errors and releases", installed: false, servers: ["sentry"], skills: [], category: "monitoring" },
    ] },
    { name: "example-ops", source: "example-org/ops-marketplace", visibility: "org", mine: true, hasToken: true, credential: { chosen: { id: "gt_0000000000000011", label: "Second GitHub organization", owner: "mine" }, used: { via: "credential", label: "Second GitHub organization", at: 1 } }, plugins: [
      { name: "ops-flow", description: "Service desk routines", installed: true, servers: [], skills: ["triage", "dispatch", "time-review"], category: "productivity", homepage: "https://www.wikipedia.org" },
      { name: "ops-flow-tenant", description: "This organization's boards and rules", installed: true, servers: [], skills: ["tenant-rules"], category: "productivity" },
    ] },
  ] },
  "/api/skills-library": { skills: [
    { name: "frontend-design", description: "Distinctive interfaces", source: "claude-plugins-official", enabled: true },
    { name: "code-review", description: "Reviews a pull request", source: "claude-plugins-official", enabled: true },
    { name: "triage", description: "", source: "example-ops", enabled: true },
    { name: "dispatch", description: "", source: "example-ops", enabled: true },
    { name: "time-review", description: "", source: "example-ops", enabled: true },
    { name: "tenant-rules", description: "", source: "example-ops", enabled: true },
    { name: "weekly-summary", description: "Friday recap of my threads", source: "local-import", enabled: true },
  ] },
  "/api/plugins/search": { featured: [
    { id: "notion", name: "Notion", description: "Pages, databases and notes", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", site: "notion.so", auth: "oauth", category: "productivity" },
    { id: "linear", name: "Linear", description: "Issues, projects and cycles", url: "https://mcp.linear.app/mcp", domain: "mcp.linear.app", site: "linear.app", auth: "oauth", category: "productivity" },
    { id: "slack", name: "Slack", description: "Channels and messages", url: "https://mcp.slack.com/mcp", domain: "mcp.slack.com", site: "slack.com", auth: "oauth", category: "communication" },
    { id: "figma", name: "Figma", description: "Design files and comments", url: "https://mcp.figma.com/mcp", domain: "mcp.figma.com", site: "figma.com", auth: "oauth", category: "design" },
    { id: "stripe", name: "Stripe", description: "Payments and customers", url: "https://mcp.stripe.com", domain: "mcp.stripe.com", site: "stripe.com", auth: "oauth", category: "finance" },
  ], results: [], nextCursor: null, registryAvailable: true },
  "/api/me/harness-connectors": { manageUrl: "https://claude.ai/customize/connectors", canManage: true, enabled: true, claude: { available: true, connectors: [
    { name: "Gmail", status: "connected" },
    { name: "Google Drive", status: "connected" },
    { name: "Google Calendar", status: "connected" },
    { name: "Canva", status: "needs_auth" },
  ] }, codex: { available: false } },
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
      { name: "code-review", description: "Reviews a pull request", installed: true, external: false, category: "development", contents: { agents: ["reviewer"], commands: ["review"], skills: ["code-review"] } },
    ] }],
    plugins: [{ key: "code-review@claude-plugins-official", name: "code-review", marketplace: "claude-plugins-official", enabled: true, removed: [], declaredMcpServers: [] }],
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

if (["manage", "org-settings", "settings-subpage"].includes(params.get("view") ?? "manage")) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
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
    const body = MANAGE_API[url.pathname];
    if (body !== undefined && method === "GET") return json(body);
    if (url.pathname.startsWith("/api/bots/") && url.pathname.endsWith("/plugins")) return json({ error: "not here" }, 404);
    return json({ error: "gallery" }, 404);
  }) as typeof window.fetch;
}

function Manage() {
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
