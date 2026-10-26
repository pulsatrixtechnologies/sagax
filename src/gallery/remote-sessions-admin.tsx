/** Isolated gallery for headless screenshots of the admin Remote Sessions
 * page: the active list, history (ended and failed rows), the unattended
 * column, and the logs view. Not shipped in the app. A mocked fetch feeds
 * seeded rows and a redacted log so nothing connects. ?lang=<code>&skin=<id>. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RemoteSessionsAdminPage, RemoteSessionLogList } from "../components/remote-session/RemoteSessionsAdminPage";
import type { RemoteSessionAdminRow, RemoteSessionLogEntry } from "../../shared/remote-session-admin";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const DAY = "2026-10-22T";
const rows: RemoteSessionAdminRow[] = [
  {
    id: "a1b2c3d4e5f6", code: "UD6HFH", host: "POSTE-RECEPTION", user: "marie", os: "windows", osKnown: true,
    startedAt: `${DAY}13:02:00Z`, endAt: `${DAY}18:00:00Z`, status: "connected", elevated: true,
    botId: "bot-atlas", botLabel: "Atlas", openedBy: "technicien@gox", reachable: true,
    unattended: true, unattendedSince: "2026-09-30T09:00:00Z", unattendedExpiresAt: "2026-12-29T09:00:00Z", bannerVisible: false, signed: true,
  },
  {
    id: "b2c3d4e5f6a7", code: "K7M2PQ", host: "SERVEUR-PAIE", user: "service", os: "windows", osKnown: true,
    startedAt: `${DAY}11:40:00Z`, endAt: `${DAY}17:30:00Z`, status: "connected", elevated: false,
    botId: "bot-boreas", botLabel: "Boreas", openedBy: "technicien@gox", reachable: true,
    unattended: true, unattendedSince: "2026-10-10T14:00:00Z", unattendedExpiresAt: "2027-01-08T14:00:00Z", bannerVisible: true, signed: false,
  },
  {
    id: "c3d4e5f6a7b8", code: "Z4N8RT", host: "MBP-DESIGN", user: "julie", os: "macos", osKnown: true,
    startedAt: `${DAY}09:15:00Z`, endAt: `${DAY}10:05:00Z`, status: "ended", elevated: false,
    botId: "bot-atlas", botLabel: "Atlas", openedBy: "julie@gox", reachable: false, unattended: false,
  },
  {
    id: "d4e5f6a7b8c9", code: "P9Q3WX", host: "POSTE-COMPTA", user: "-", os: "windows", osKnown: false,
    startedAt: `${DAY}08:40:00Z`, endAt: `${DAY}08:42:00Z`, status: "failed", elevated: false,
    botId: "bot-boreas", botLabel: "Boreas", openedBy: "technicien@gox", reachable: false, unattended: false,
  },
];

const log: RemoteSessionLogEntry[] = [
  { at: `${DAY}13:02:04Z`, kind: "start" },
  { at: `${DAY}13:02:20Z`, kind: "exec", command: "Get-Service -Name Spooler", readOnly: true },
  { at: `${DAY}13:03:10Z`, kind: "control.grant" },
  { at: `${DAY}13:05:48Z`, kind: "control.release", counts: { keys: 42, clicks: 9 } },
  { at: `${DAY}13:06:30Z`, kind: "exec", command: "Restart-Service -Name Spooler", readOnly: false, approved: true, exitCode: 0 },
  { at: `${DAY}13:08:12Z`, kind: "transfer", direction: "upload", file: "pilote-imprimante.msi" },
  { at: `${DAY}13:20:00Z`, kind: "control.stop", reason: "released" },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/admin/remote-sessions") && url.includes("/logs")) {
    return new Response(JSON.stringify({ entries: log }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/admin/remote-sessions")) {
    const q = new URL(url, location.origin).searchParams;
    let shown = rows;
    if (q.get("active") === "1") shown = shown.filter((r) => r.status === "connected");
    if (q.get("unattended") === "1") shown = shown.filter((r) => r.unattended);
    const search = q.get("q")?.toLowerCase();
    if (search) shown = shown.filter((r) => `${r.host} ${r.user ?? ""} ${r.code} ${r.botLabel}`.toLowerCase().includes(search));
    return new Response(JSON.stringify({ sessions: shown, admin: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/auth/session")) return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

function Gallery() {
  return (
    <div className="min-h-screen bg-app text-ink">
      <div data-gallery-sample="list" className="h-[640px] w-[1100px] overflow-hidden border-b border-hairline/50">
        <RemoteSessionsAdminPage />
      </div>
      <div data-gallery-sample="logs" className="w-[720px] p-5">
        <div className="overflow-hidden rounded-2xl border border-hairline/60 bg-panel">
          <div className="border-b border-hairline/50 px-4 py-3 text-[14px] font-medium text-ink">{t("remoteSessionsAdmin.logs.title", { host: "POSTE-RECEPTION" })}</div>
          <p className="border-b border-hairline/40 px-4 py-2 text-[12px] text-ink-secondary">{t("remoteSessionsAdmin.logs.retention")}</p>
          <div className="px-4 py-3"><RemoteSessionLogList entries={log} /></div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
