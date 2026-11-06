/** Isolated gallery for Connect apps > Mac > Messages setup.
 * ?view=setup|mac|app&app=mail|calendar|contacts|reminders|notes
 * &state=off|ready|enabled|unavailable|server|error&lang=en|fr&skin=
 * server: the org server answers 404 and the desktop app answers over IPC;
 * error: 404 without the desktop app (readable error, never blank).
 * Synthetic permission states only. */
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";

import { MessagesSetupView } from "../components/plugins/MessagesSetupView";
import { MacAppsInstalledSection } from "../components/plugins/MacAppsView";
import { MacAppSetupView } from "../components/plugins/MacAppSetupView";
import { MAC_APP_SETUP_IDS, type MacAppSetupId, type MacAppsSetupStatus } from "../../shared/mac-apps-setup.ts";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const state = params.get("state") ?? "off";
const view = params.get("view") ?? "setup";

type FakeStatus = {
  available: boolean;
  onThisMac: boolean;
  reason?: string;
  useMessages: boolean;
  permissions: { fullDiskAccess: string; automation: string };
};

const STATUSES: Record<string, FakeStatus> = {
  off: {
    available: true,
    onThisMac: true,
    useMessages: false,
    permissions: { fullDiskAccess: "denied", automation: "notAsked" },
  },
  ready: {
    available: true,
    onThisMac: true,
    useMessages: false,
    permissions: { fullDiskAccess: "granted", automation: "granted" },
  },
  enabled: {
    available: true,
    onThisMac: true,
    useMessages: true,
    permissions: { fullDiskAccess: "granted", automation: "granted" },
  },
  unavailable: {
    available: false,
    onThisMac: false,
    reason: "organization_server",
    useMessages: false,
    permissions: { fullDiskAccess: "unsupported", automation: "unsupported" },
  },
};

const status = STATUSES[state] ?? (state === "server" ? STATUSES.ready! : STATUSES.off!);
const app = (params.get("app") ?? "mail") as Exclude<MacAppSetupId, "messages">;

/** The same states for every Apple app (Messages keeps its FDA row). */
function appsStatus(): MacAppsSetupStatus {
  const granted = status.permissions.automation === "granted";
  return {
    available: status.available,
    onThisMac: status.onThisMac,
    apps: MAC_APP_SETUP_IDS.map((id) => ({
      id,
      enabled: id === "messages" ? status.useMessages : status.useMessages || (id === "calendar" && granted),
      permissions: id === "messages"
        ? { automation: status.permissions.automation as "granted", fullDiskAccess: status.permissions.fullDiskAccess as "granted" }
        : { automation: (status.available ? (state === "off" ? "notAsked" : "granted") : "unsupported") as "granted" },
    })),
  };
}

// "server": the organization server answers 404 and the desktop app answers
// over IPC. "error": 404 and no desktop app (the page shows a readable error).
const remote = state === "server" || state === "error";
if (state === "server") {
  let current = appsStatus();
  (window as unknown as { ogb: unknown }).ogb = {
    platform: "darwin",
    macApps: {
      status: async () => current,
      set: async (id: MacAppSetupId, enabled: boolean) => {
        current = { ...current, apps: current.apps.map((row) => (row.id === id ? { ...row, enabled } : row)) };
        return current;
      },
      test: async () => ({ ok: true, count: 3, names: ["Ada Example", "Bea Example", "Cara Example"] }),
      openSettings: async () => {},
    },
  };
}

const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } });

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (remote && (url.includes("/api/messages") || url.includes("/api/mac-apps"))) {
    return json({ error: "Messages is on your Mac, not on this server.", code: url.includes("/api/mac-apps") ? "mac_apps_not_on_this_mac" : "messages_not_on_this_mac" }, 404);
  }
  if (url.includes("/api/mac-apps/test")) return json({ ok: true, count: 3, names: ["Ada Example", "Bea Example", "Cara Example"] });
  if (url.includes("/api/mac-apps/permissions/open")) return json({ opened: true });
  if (url.includes("/api/mac-apps")) {
    if ((init?.method ?? "GET").toUpperCase() === "PUT") {
      const body = init?.body ? JSON.parse(String(init.body)) as { app?: string; enabled?: boolean } : {};
      const next = appsStatus();
      return json({ ...next, apps: next.apps.map((row) => (row.id === body.app ? { ...row, enabled: body.enabled === true } : row)) });
    }
    return json(appsStatus());
  }
  if (url.includes("/api/messages/test")) return json({ conversationCount: 3, names: ["Ada Example", "Bea Example", "Cara Example"] });
  if (url.includes("/api/messages/permissions/open")) return json({ opened: true, pane: "fullDiskAccess" });
  if (url.includes("/api/messages")) {
    if ((init?.method ?? "GET").toUpperCase() === "PUT") {
      const body = init?.body ? JSON.parse(String(init.body)) as { useMessages?: boolean } : {};
      return json({ ...status, useMessages: body.useMessages === true });
    }
    return json(status);
  }
  return originalFetch(input, init);
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-app text-ink" data-gallery-mac-messages="">
      <div className="mx-auto flex h-full w-full max-w-[720px] flex-col border-x border-hairline/40 bg-panel">
        {children}
      </div>
    </div>
  );
}

function App() {
  const trail = useMemo(() => [
    { label: t("connectApps.title"), onSelect: () => {} },
    { label: t("connectApps.mac.title"), onSelect: () => {} },
  ], []);
  if (view === "mac") {
    return (
      <Frame>
        {/* the Mac page went with #2104: its one row sits in Installed */}
        <MacAppsInstalledSection status={appsStatus()} onOpen={() => {}} />
      </Frame>
    );
  }
  if (view === "app") {
    return (
      <Frame>
        <MacAppSetupView app={app} onBack={() => {}} trail={trail} />
      </Frame>
    );
  }
  return (
    <Frame>
      <MessagesSetupView onBack={() => {}} trail={trail} />
    </Frame>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
