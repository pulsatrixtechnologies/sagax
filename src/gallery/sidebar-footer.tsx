/** Isolated gallery for Playwright screenshots of the sidebar foot with
 * Settings > Appearance > Sidebar shortcuts on (the two menu rows, no title
 * or points under the name) and off (the account row alone, title and
 * points under the name). Not shipped in the app.
 * The capture script answers /api itself (an empty roster).
 * ?view=foot shows the reference design's foot instead (the avatar, Connect apps and
 * the update button), with a stand-in updater bridge:
 * &update=none|ready|downloading (percent 40)|preparing; &pill=0 leaves the
 * update button out (the foot as it was before it); &width=<px> (280) and
 * &name=<text> (a long one by default); &apps=<0-3> connected apps; &points=0 / &title=0 switch "Show my
 * points" / "Show my title" off.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LayoutGrid, Puzzle } from "lucide-react";
import { SidebarPlaces, type SidebarPlace } from "../components/SidebarPlaces";
import { SidebarProfileMenu } from "../components/SidebarProfileMenu";
import { SidebarFoot } from "../components/SidebarFoot";
import type { UpdaterState } from "../lib/updater";
import { resetAchievementsForTests } from "../lib/achievements";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const UPDATER: Record<string, UpdaterState> = {
  none: { status: "idle" },
  ready: { status: "downloaded", version: "0.5.21" },
  downloading: { status: "downloading", version: "0.5.21", percent: 40 },
  preparing: { status: "preparing", version: "0.5.21" },
};
const updaterState = UPDATER[params.get("update") ?? ""];
if (updaterState) {
  const ogb = ((window as unknown as { ogb?: Record<string, unknown> }).ogb ??= {});
  ogb.updater = {
    check: async () => updaterState,
    install: async () => {},
    onState: (cb: (state: UpdaterState) => void) => { cb(updaterState); return () => {}; },
  };
}
resetAchievementsForTests({
  status: "ready",
  snapshot: {
    points: 195,
    maxPoints: 1500,
    level: { level: 2, from: 0, to: 200 },
    unlockedCount: 0,
    count: 0,
    streak: 0,
    rewards: [],
    recent: [],
    items: [],
    settings: { showPoints: params.get("points") !== "0", showTitle: params.get("title") !== "0", toasts: true, native: false, public: false, title: "commander" },
  },
});

// ?view=foot: the profile carries a long name (&name=<text>); every other
// /api call is left to the capture script.
if (params.get("view") === "foot") {
  const realFetch = window.fetch.bind(window);
  const profileName = params.get("name") ?? "Jean Exemple-Martin";
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url, location.href).pathname === "/api/config") {
      return new Response(JSON.stringify({ profile: { name: profileName } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    // &apps=<n> (0 to 3) connected apps, with stand-in logos
    const path = new URL(url, location.href).pathname;
    const apps = [["Gmail", "mail.google.com"], ["Notion", "notion.so"], ["Google Drive", "drive.google.com"]].slice(0, Math.min(3, Math.max(0, Number(params.get("apps") ?? 3))));
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    // &data=real: the shape an organization server really answers
    // (2026-10-26): its own servers on MCP hosts (headers, no sign-in state;
    // one of them twice, once from a marketplace plugin), and the person's
    // apps as connectors of their Claude account, a name and a status only
    if (params.get("data") === "real") {
      if (path === "/api/mcp/servers") {
        return json({ servers: [
          { name: "twilio-docs", type: "http", url: "https://mcp.twilio.com/docs", enabled: true, source: "twilio" },
          { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true },
          { name: "github-github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, source: "claude-plugins-official" },
        ] });
      }
      if (path === "/api/plugins/search") return json({ featured: [], results: [], nextCursor: null, registryAvailable: true });
      if (path === "/api/me/harness-connectors") {
        return json({ claude: { available: true, connectors: [
          { name: "Docs", status: "connected" },
          { name: "Google Drive", status: "connected" },
          { name: "Gmail", status: "connected" },
          { name: "Google Calendar", status: "connected" },
          { name: "Canva", status: "needs_auth" },
          { name: "Microsoft 365", status: "connected" },
        ] } });
      }
    }
    if (path === "/api/me/harness-connectors") return json({ claude: { available: false, connectors: [] } });
    if (path === "/api/mcp/servers") return json({ servers: apps.map(([name, host]) => ({ name, enabled: true, type: "http", url: `https://${host}/mcp`, auth: "connected" })) });
    // the catalog's marks (inline stand-ins), lent to the connected servers
    const mark = (letter: string, fill: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/><text x="32" y="44" font-size="36" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="white">${letter}</text></svg>`)}`;
    const marks: Record<string, string> = { Gmail: mark("M", "#d93025"), Notion: mark("N", "#111111"), "Google Drive": mark("D", "#1a73e8") };
    if (path === "/api/plugins/search") return json({ featured: apps.map(([name, host]) => ({ id: name.toLowerCase(), name, description: "", url: `https://${host}/mcp`, domain: host, auth: "oauth", installed: true, iconUrl: marks[name] })) });
    return realFetch(input, init);
  }) as typeof window.fetch;
}

const places: SidebarPlace[] = [
  { key: "plugins", tourId: "nav-apps", label: t("connectApps.title"), icon: Puzzle, animation: "puzzle", onSelect: () => {} },
  { key: "browse-bots", label: t("sidebar.browseBots"), icon: LayoutGrid, animation: "grid", onSelect: () => {} },
];

function Foot({ on }: { on: boolean }) {
  return (
    <div className="flex w-[280px] flex-col rounded-xl border-[0.5px] border-hairline-weak bg-sidebar" data-gallery={on ? "on" : "off"}>
      <div className="px-3 pt-3 text-[12px] text-sidebar-ink-secondary">{on ? "Raccourcis : activé" : "Raccourcis : désactivé"}</div>
      <div className="h-24" />
      <div className="pb-3 pl-2 pr-3 pt-1">
        {on && <SidebarPlaces places={places} />}
        <SidebarProfileMenu memberLine={!on} />
      </div>
    </div>
  );
}

/** The reference design's foot, as Sidebar.tsx lays it out, at the sidebar's width
 * (&width=<px>, 280 by default like the app) for a person with a long name. */
function ReferenceFoot() {
  const width = Math.min(400, Math.max(240, Number(params.get("width")) || 280));
  return (
    <div className="flex flex-col rounded-xl border-[0.5px] border-hairline-weak bg-sidebar" style={{ width }} data-gallery="foot">
      <div className="h-24" />
      <div className="px-4 pb-4">
        <SidebarFoot onOpenApps={() => {}} />
      </div>
    </div>
  );
}

function Gallery() {
  if (params.get("view") === "foot") {
    return (
      <StoreProvider>
        <div className="flex min-h-screen items-end bg-app p-8 text-ink">
          <ReferenceFoot />
        </div>
      </StoreProvider>
    );
  }
  return (
    <StoreProvider>
      <div className="flex min-h-screen items-end gap-8 bg-app p-8 text-ink">
        <Foot on />
        <Foot on={false} />
      </div>
    </StoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
