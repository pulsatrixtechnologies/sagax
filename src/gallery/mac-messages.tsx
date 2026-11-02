/** Isolated gallery for Connect apps > Mac > Messages setup.
 * ?state=off|ready|enabled|unavailable&lang=en|fr&skin=
 * Synthetic permission states only. */
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";

import { MessagesSetupView } from "../components/plugins/MessagesSetupView";
import { MacAppsView } from "../components/plugins/MacAppsView";
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

const status = STATUSES[state] ?? STATUSES.off!;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.includes("/api/messages/test")) {
    return new Response(JSON.stringify({ conversationCount: 3, names: ["Ada Example", "Bea Example", "Cara Example"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/api/messages/permissions/open")) {
    return new Response(JSON.stringify({ opened: true, pane: "fullDiskAccess" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("/api/messages")) {
    if ((init?.method ?? "GET").toUpperCase() === "PUT") {
      const body = init?.body ? JSON.parse(String(init.body)) as { useMessages?: boolean } : {};
      return new Response(JSON.stringify({ ...status, useMessages: body.useMessages === true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(status), {
      status: status.available ? 200 : 200,
      headers: { "content-type": "application/json" },
    });
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
        <MacAppsView
          onBack={() => {}}
          trail={[{ label: t("connectApps.title"), onSelect: () => {} }]}
          onOpenMessages={() => {}}
          messagesEnabled={status.useMessages}
          messagesAvailable={status.available}
        />
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
