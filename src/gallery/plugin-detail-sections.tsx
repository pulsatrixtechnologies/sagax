/** Isolated gallery for headless screenshots of a plugin's detail page in
 * Connect apps (#4154): its Accounts and Tools sections, built by the real
 * detail builders (PluginsPanel.tsx-parts/detailBuilders.tsx). No server: a
 * stand-in /api answers the GitHub connection. Not shipped in the app.
 * ?case=neither|account|tools|both|github|uses-github|sign-in|connector
 *   &skin=<id>&lang=<code>
 *   &credentials=sealed (#4155: the saved list does not open on this server)
 *   or error (a read that failed this time: the server's 503)
 * scripts/capture/plugin-detail-sections.mjs takes the shots. */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { GithubAccountSection } from "../components/plugins/GithubAccountSection";
import { PluginDetailView } from "../components/plugins/PluginDetailView";
import { MyGithubConnection } from "../components/settings/MyConnectionsSettings";
import { detailProps } from "../components/PluginsPanel.tsx-parts/detailBuilders";
import type { DetailContext, MarketplaceListing } from "../components/PluginsPanel.tsx-parts/types";
import type { McpServers } from "../components/McpServersPanel";
import type { McpServerListing, ProbeResult } from "../components/mcpServersModel";
import type { PluginItem } from "../lib/plugins-model";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

// The GitHub plugin's connection reads the person's GitHub account and the
// other credentials: a stand-in answer, nothing leaves the page.
const API: Record<string, unknown> = {
  "/api/me/connections": { github: { state: "none", deviceFlow: true }, servers: [], sandbox: true },
  "/api/me/github/credentials": { canManageOrg: false, deviceFlow: true, credentials: [
    { id: "gt_0000000000000011", label: "Second GitHub organization", hint: "9c1d", owner: "mine", chosenBy: 1 },
  ] },
};
const credentialsCase = params.get("credentials");
if (credentialsCase === "sealed") API["/api/me/github/credentials"] = { canManageOrg: false, deviceFlow: true, credentials: [], unreadable: "sealed" };
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  if (credentialsCase === "error" && url.pathname === "/api/me/github/credentials") {
    return new Response(JSON.stringify({ error: "The saved credentials could not be read.", code: "store_unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify(API[url.pathname] ?? {}), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof window.fetch;

const MARKET = "example-market";
const plugin = (name: string, description: string): PluginItem => ({
  key: `plugin:${name}@${MARKET}`, kind: "plugin", id: `${name}@${MARKET}`, name, description,
  category: "productivity", installed: true, status: "connected", action: null, source: MARKET, version: "1.2.0",
});
const child = (parent: PluginItem, kind: PluginItem["kind"], name: string, extra: Partial<PluginItem> = {}): PluginItem => ({
  key: `${kind}:${name}`, kind, id: name, name, description: "", category: "productivity", installed: true,
  status: "connected", action: null, source: MARKET, parent: parent.key, ...extra,
});

const neither = plugin("release-kit", "Release checklists");
const tools = plugin("design-kit", "Interface reviews");
const both = plugin("issues-kit", "Issues and triage");
const github = plugin("github", "GitHub's MCP server");
const usesGithub = plugin("repo-tools", "Repository chores");
const items: PluginItem[] = [
  neither, tools, both, github, usesGithub,
  child(tools, "skill", "interface-review"),
  child(both, "mcp", "issues"),
  child(both, "skill", "triage"),
  child(github, "mcp", "github-github", { githubAccount: "missing", status: "needs_auth" }),
  child(usesGithub, "mcp", "repo-chores", { githubAccount: "missing", status: "needs_auth" }),
];
const marketplaces: MarketplaceListing[] = [{
  name: MARKET, source: "example-org/example-market", plugins: [
    { name: "release-kit", installed: true, servers: [], skills: [] },
    { name: "design-kit", installed: true, servers: [], skills: ["interface-review"] },
    { name: "issues-kit", installed: true, servers: ["issues"], skills: ["triage"] },
    { name: "github", installed: true, servers: ["github-github"], skills: [] },
    { name: "repo-tools", installed: true, servers: ["repo-chores"], skills: [] },
  ],
}];

// Connectors added by hand: one whose only part is its keys (it lists no
// tool), one that asks for a sign-in with a client the person registers, and
// one with no account at all.
const servers: McpServerListing[] = [
  { name: "docs-search", type: "http", url: "https://docs.example.test/mcp", headerKeys: ["Authorization"], enabled: true, auth: "none" },
  { name: "tickets", type: "http", url: "https://tickets.example.test/mcp", headerKeys: [], enabled: true, auth: "required", authIssuer: "tickets.example.test", authClient: "needed" },
  { name: "local-notes", command: "notes-server", args: ["--stdio"], envKeys: [], enabled: true } as McpServerListing,
];
const probe: Record<string, ProbeResult> = {
  "docs-search": { ok: true, tools: [] },
  "local-notes": { ok: true, tools: [{ name: "find_note" }, { name: "write_note" }] },
};
const noop = () => {};
const later = async () => {};
const mcp = {
  servers, probe, busy: null, waiting: {}, oauthError: {}, editing: null, error: null, notice: null,
  clientDraft: { tickets: { clientId: "", clientSecret: "", redirectUri: "http://127.0.0.1:3000/api/mcp/oauth/callback" } },
  signIn: later, signOut: later, remove: later, test: later, toggle: later, setDisabledTools: later,
  startEdit: noop, startFixKeys: noop, setClientDraft: noop, forgetClientDraft: noop,
} as unknown as McpServers;
const mcpItem = (name: string): PluginItem => ({
  key: `mcp:${name}`, kind: "mcp", id: name, name, description: "", category: "productivity",
  installed: true, status: "connected", action: null, source: "manual",
});

const context = (githubSection: ReactNode): DetailContext => ({
  mcp, openGithub: noop, githubKey: github.key, githubSection, mcpAccountDraft: null, setMcpAccountDraft: noop,
  items, marketplaces, installing: null, openItem: noop, uninstallPlugin: noop, updatePlugin: noop,
  scope: "workspace", botCard: null,
});

const CASES: Record<string, PluginItem> = {
  neither, tools, both, github, "uses-github": usesGithub,
  account: mcpItem("docs-search"), "sign-in": mcpItem("tickets"), connector: mcpItem("local-notes"),
};
const chosen = CASES[params.get("case") ?? "both"] ?? both;

function Gallery() {
  const base = detailProps(chosen, context(<GithubAccountSection connection={<MyGithubConnection />} />));
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-app text-ink" data-gallery-sample={params.get("case") ?? "both"}>
      <PluginDetailView {...base} onBack={noop} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
