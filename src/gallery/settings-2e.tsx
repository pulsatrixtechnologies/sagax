/** Isolated gallery for screenshots of the parity 2E settings (not shipped):
 * Accessibility, the notification sound row, the time zone rows and the
 * other computers with Rename and Remove. &skin=<id>, &lang=<code>. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccessibilityGroup } from "../components/settings/AppearanceSettings";
import { BotWorkplaceSettings } from "../components/settings/BotWorkplaceSettings";
import { TimeZoneRows } from "../components/settings/TimeZoneSettings";
import { NotificationSettings } from "../components/NotificationSettings";
import { SettingsGroup } from "../components/SettingsPrimitives";
import type { DesktopBridgeStatus } from "../lib/desktop-bridge";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const now = Date.now();
const status: DesktopBridgeStatus = {
  connected: true,
  tunnel: false,
  workplace: { routines: false, network: "all", place: "auto" } as DesktopBridgeStatus["workplace"],
  activity: [],
  desktops: [
    { id: "d1", name: "MacBook de Julie", platform: "darwin", online: true, busy: false, lastSeenAt: now },
    { id: "d2", name: "PC du bureau", platform: "win32", online: true, busy: false, lastSeenAt: now - 5_000 },
    { id: "d3", name: "Portable de voyage", platform: "darwin", online: false, busy: false, lastSeenAt: now - 3 * 86_400_000 },
  ],
};

const original = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  if (url.includes("/api/settings/bot")) {
    return new Response(JSON.stringify({ settings: { autoReviewDefault: false, timeZone: "America/Toronto", timeZoneAuto: params.get("auto") === "1" }, scope: "person", hostTimeZone: "UTC", effectiveTimeZone: "America/Toronto" }), { headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/me/desktop-bridge/computers/")) return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  return original(input, init);
};

function Gallery() {
  return (
    <main className="min-h-screen bg-app p-6 text-ink" data-gallery-settings="">
      <div className="mx-auto flex max-w-[680px] flex-col gap-6">
        <AccessibilityGroup />
        <SettingsGroup title={t("settings.group.appearance")} groupId="appearance">
          <TimeZoneRows />
        </SettingsGroup>
        <NotificationSettings />
        <SettingsGroup title={t("settings.section.computer")} groupId="computer">
          <BotWorkplaceSettings status={status} />
        </SettingsGroup>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
