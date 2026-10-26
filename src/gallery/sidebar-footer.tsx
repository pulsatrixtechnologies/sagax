/** Isolated gallery for Playwright screenshots of the sidebar foot with
 * Settings > Appearance > Sidebar shortcuts on (the two menu rows, no title
 * or points under the name) and off (the account row alone, title and
 * points under the name). Not shipped in the app.
 * The capture script answers /api itself (an empty roster).
 * ?view=foot shows the reference design's foot instead (the avatar, Connect apps and
 * the update button), with a stand-in updater bridge:
 * &update=none|ready|downloading (percent 40)|preparing; &pill=0 leaves the
 * update button out (the foot as it was before it); &width=<px> (280) and
 * &name=<text> (a long one by default); &points=0 / &title=0 switch "Show my
 * points" / "Show my title" off.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LayoutGrid, Puzzle } from "lucide-react";
import { SidebarPlaces, type SidebarPlace } from "../components/SidebarPlaces";
import { SidebarProfileMenu } from "../components/SidebarProfileMenu";
import { SidebarUpdatePill } from "../components/SidebarUpdatePill";
import type { UpdaterState } from "../lib/updater";
import { resetAchievementsForTests } from "../lib/achievements";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

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
    return realFetch(input, init);
  }) as typeof window.fetch;
}

const places: SidebarPlace[] = [
  { key: "plugins", tourId: "nav-apps", label: t("sidebar.nav.connectedApps"), icon: Puzzle, animation: "puzzle", onSelect: () => {} },
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
        <div data-sidebar-account-row className="flex items-center gap-1.5 [container-type:inline-size]">
          <SidebarProfileMenu avatarOnly withName />
          {/* the same tile as Sidebar.tsx's SidebarConnectApps (not exported) */}
          <button
            type="button"
            data-sidebar-connect-apps=""
            className="flex h-[var(--foot-tile-h,2.25rem)] min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink"
          >
            <Puzzle size={16} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{t("chat.connectApps.pill")}</span>
          </button>
          {params.get("pill") !== "0" && <SidebarUpdatePill />}
        </div>
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
