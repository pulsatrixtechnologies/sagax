/** Isolated gallery for headless screenshots of the admin Remote Sessions
 * page: the active list, history (ended and failed rows), the unattended
 * column, and the logs view. Not shipped in the app. A mocked fetch feeds
 * seeded rows and a redacted log so nothing connects.
 * ?lang=<code>&skin=<id>&width=<px>&height=<px>&hosts=0 (no enrolled host)
 * &devices=0 (none of the person's devices: an older server)
 * &shared=0 (no host shared by a colleague) &connect=0 (the issued code
 * never gets a computer) &dialog=add&step=os|mode|done (#2956: opens the
 * Add computer wizard on that step with fake data). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { RemoteSessionsAdminPage, RemoteSessionLogList } from "../components/remote-session/RemoteSessionsAdminPage";
import type { RemoteSessionAdminRow, RemoteSessionLogEntry } from "../../shared/remote-session-admin";
import type { UnattendedHostRow } from "../../shared/remote-unattended-host";
import { loadLocale, t } from "../lib/i18n";
import { StoreProvider, useStore, type Bot } from "../state/store";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const width = Number(params.get("width") ?? 1100);
const height = Number(params.get("height") ?? 640);
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
    id: "c3d4e5f6a7b8", code: "Z4N8RT", host: "srv-linux", user: "root", os: "linux", osKnown: true,
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

// Enrolled hosts (#2723): a Linux server online now, a PC offline for days.
// Perspicax does not say the OS: the page reads it from a past session.
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
// #2957: the first host is limited to one bot and shared with a group; the
// third one reaches this person through a colleague's share (&shared=0 hides it).
const hosts: UnattendedHostRow[] = params.get("hosts") === "0" ? [] : [
  { hostId: `h_${"ab".repeat(16)}`, hostname: "srv-linux", org: "Clinique Nord", scope: "full-control", installedBy: null, enrolledAt: "2026-09-30T09:00:00Z", expiresAt: "2026-12-29T09:00:00Z", lastSeenAt: iso(now - 20_000), revokedAt: null, state: "enrolled",
    bots: ["bot-atlas"], shares: [{ kind: "team", id: "team-support", name: "Support" }] },
  { hostId: `h_${"cd".repeat(16)}`, hostname: "POSTE-COMPTA", org: "Clinique Nord", scope: "view-only", installedBy: null, enrolledAt: "2026-10-10T14:00:00Z", expiresAt: "2027-01-08T14:00:00Z", lastSeenAt: iso(now - 3 * 86_400_000), revokedAt: null, state: "enrolled", bots: null, shares: [] },
  ...(params.get("shared") === "0" ? [] : [
    { hostId: `h_${"ef".repeat(16)}`, hostname: "SRV-FICHIERS", org: "Clinique Nord", scope: "full-control", installedBy: null, enrolledAt: "2026-10-20T15:00:00Z", expiresAt: "2027-01-18T15:00:00Z", lastSeenAt: iso(now - 90_000), revokedAt: null, state: "enrolled", sharedBy: "Marie Tremblay" } satisfies UnattendedHostRow,
  ]),
];
// Once the wizard issued a code, the next list poll shows the new computer
// (the "Connected" state of its last step); &connect=0 keeps it waiting.
let issued = false;
const connected = (): UnattendedHostRow[] => issued && params.get("connect") !== "0"
  ? [{ hostId: `h_${"12".repeat(16)}`, hostname: "MBP-JULIE", org: "Clinique Nord", scope: "full-control", installedBy: null, enrolledAt: iso(Date.now()), expiresAt: iso(Date.now() + 90 * 86_400_000), lastSeenAt: iso(Date.now()), revokedAt: null, state: "enrolled", os: "macos" }]
  : [];
const directory = {
  people: [
    { principalId: "marie@clinique", name: "Marie Tremblay", login: "marie", role: "member", disabled: false },
    { principalId: "julie@clinique", name: "Julie Gagnon", login: "julie", role: "admin", disabled: false },
    { principalId: "paul@clinique", name: "Paul Roy", login: "paul", role: "member", disabled: false },
  ],
  teams: [
    { id: "team-support", name: "Support", managers: [], members: ["marie@clinique"] },
    { id: "team-compta", name: "Comptabilité", managers: [], members: ["paul@clinique"] },
  ],
};

// My devices: this Mac first, an iPhone online, an iPad offline.
const devices = params.get("devices") === "0" ? [] : [
  { key: "k-mbp", name: "MacBook Pro", kind: "computer", platform: "darwin", online: true, lastSeenAt: now, access: "always", current: true, desktopId: "d-mbp" },
  { key: "k-iphone", name: "iPhone", kind: "phone", platform: "ios", online: true, lastSeenAt: now - 60_000, access: null, current: false, desktopId: null },
  { key: "k-ipad", name: "iPad", kind: "phone", platform: "ios", online: false, lastSeenAt: now - 26 * 3_600_000, access: null, current: false, desktopId: null },
];
const bridge = {
  connected: true, tunnel: false, activity: [], devices,
  desktops: devices.filter((d) => d.desktopId).map((d) => ({ id: d.desktopId, name: d.name, platform: d.platform, connectedAt: now, lastSeenAt: d.lastSeenAt, online: d.online, busy: false, capabilities: { localVm: true }, access: d.access, current: d.current })),
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/\/api\/admin\/remote-sessions\/hosts\/[^/]+\/bots$/.test(url)) {
    const body = init?.body ? JSON.parse(String(init.body)) as { botIds: string[] | null } : { botIds: null };
    return new Response(JSON.stringify({ bots: body.botIds }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (/\/api\/admin\/remote-sessions\/hosts\/[^/]+\/shares/.test(url)) {
    const shares = hosts[0]?.shares ?? [];
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { kind: "person" | "team"; id: string };
      const name = body.kind === "team" ? directory.teams.find((team) => team.id === body.id)?.name : directory.people.find((who) => who.principalId === body.id)?.name;
      return new Response(JSON.stringify({ shares: [...shares, { kind: body.kind, id: body.id, name: name ?? body.id }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (init?.method === "DELETE") return new Response(JSON.stringify({ shares: [] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ shares }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/admin/remote-sessions/hosts")) {
    return new Response(JSON.stringify({ hosts: [...hosts, ...connected()], available: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/org/directory")) {
    return new Response(JSON.stringify(directory), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (new URL(url, location.origin).pathname === "/api/org") {
    const org = { org: { name: "Clinique Nord", identity: { kind: "perspicax", issuer: "https://perspicax.example.org" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
    return new Response(JSON.stringify(org), { status: 200, headers: { "content-type": "application/json" } });
  }
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
  if (url.includes("/api/remote-hosts/code")) {
    issued = true;
    return new Response(JSON.stringify({
      code: "K7QM-2R", enrollUrl: "https://sagax.example.org/enroll/K7QM-2R", org: "Clinique Nord", scope: "full-control", expiresAt: iso(now + 3_600_000),
      installCommand: "curl -fsSL https://sagax.example.org/install.sh | sudo sh -s -- --code K7QM-2R",
      installCommands: {
        macos: "curl -fsSL https://sagax.example.org/install.sh | sudo sh -s -- --code K7QM-2R",
        linux: "curl -fsSL https://sagax.example.org/install.sh | sudo sh -s -- --code K7QM-2R",
        windows: "$env:SAGAX_CODE='K7QM-2R'; irm https://sagax.example.org/install.ps1 | iex",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (/\/api\/remote-hosts\/[^/]+\/access/.test(url)) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/me/desktop-bridge/computers/access")) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/me/desktop-bridge")) return new Response(JSON.stringify(bridge), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/auth/session")) return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  // The store hydrates on mount: everything else answers "not here" offline.
  if (new URL(url, location.origin).pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const BOTS = [
  { id: "bot-atlas", name: "Atlas", chiefOfStaff: true },
  { id: "bot-nova", name: "Nova" },
  { id: "bot-pixel", name: "Pixel" },
];
const dialogStep = params.get("dialog") === "add" ? (params.get("step") ?? "os") : null;

function Hydrate() {
  const { dispatch } = useStore();
  useEffect(() => {
    const bots = BOTS.map((bot) => ({ ...bot, soul: "", tasks: [], messages: [] }) as unknown as Bot);
    dispatch({ type: "hydrate", bots, groups: [], sections: [] } as never);
  }, [dispatch]);
  // The wizard opens from the page's own button so the capture shows the
  // real stack (page under the layer); the step is walked with its own
  // controls, which keeps the gallery honest about what each step renders.
  useEffect(() => {
    if (!dialogStep) return;
    const click = (selector: string) => (document.querySelector<HTMLElement>(selector))?.click();
    const walk = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      click("[data-remote-admin-add]");
      if (dialogStep === "os") return;
      await new Promise((resolve) => setTimeout(resolve, 60));
      click("[data-add-computer-os=\"macos\"]");
      click("[data-add-computer-next]");
      if (dialogStep === "mode") return;
      await new Promise((resolve) => setTimeout(resolve, 60));
      click("[data-add-computer-generate]");
    };
    void walk();
  }, []);
  return null;
}

function Gallery() {
  return (
    <div className="min-h-screen bg-app text-ink">
      <div data-gallery-sample="list" className="flex overflow-hidden border-b border-hairline/50" style={{ width, height }}>
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col"><RemoteSessionsAdminPage /></div>
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
    <StoreProvider>
      <Hydrate />
      <Gallery />
    </StoreProvider>
  </StrictMode>,
);
