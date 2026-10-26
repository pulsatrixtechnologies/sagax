/** Isolated gallery for headless screenshots of a Tailcat remote session:
 * the bot panel's Sessions à distance section above Routines (its
 * neighbour), and the chat card beside the bot computer's own screen card
 * (the reference it must match): a Windows computer with its live screen, a
 * computer whose facts are not there yet (the card says why) and a server
 * without a desktop (shell only). ?takeover=1 opens the take-control window.
 * The capture answers /api itself (GET .../remote-sessions, .../screen) and
 * the control WebSocket, so ?rows=0 shows the empty state. Not shipped.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CalendarClock, Plus } from "lucide-react";
import type { RemoteSessionView } from "../../shared/remote-session";
import { ComputerScreen } from "../components/computer/ComputerScreen";
import { RemoteSessionCard } from "../components/remote-session/RemoteSessionCard";
import { RemoteTakeover } from "../components/remote-session/RemoteScreenCard";
import { RemoteSessionsSection } from "../components/remote-session/RemoteSessionsSection";
import { RoutineList } from "../components/routines/RoutineList";
import { TakeControlPill } from "../components/SandboxDesktopView";
import { setLocale, t } from "../lib/i18n";
import type { Routine } from "../lib/routines";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const NOW = Date.now();
const H = 3_600_000;
const view: RemoteSessionView = {
  id: "0123456789ab",
  code: "BQDHS7",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: new Date(NOW + 2 * H).toISOString(),
  hostname: "POSTE-01",
  osName: "Windows 11 Professionnel",
  user: "exemple\\usager",
  model: "OptiPlex 7010",
  serial: "7XK2Q93",
  cpu: "Intel Core i7-13700",
  ram: "32 Go",
  disk: "212 Go libres sur 476 Go",
  inventory: "ready",
  suggestions: [{ id: "rights" }, { id: "cpu" }, { id: "errors" }, { id: "startup" }],
};
/** A Mac whose OS the tunnel did not tell yet (8F2NZU): never "Windows". */
const unknown: RemoteSessionView = {
  id: "8f2a0c1d2e3f",
  code: "8F2NZU",
  state: "connected",
  os: "windows",
  osKnown: false,
  elevated: false,
  endAt: new Date(NOW + 2 * H).toISOString(),
  inventory: "os-unknown",
  suggestions: [],
};
const headless: RemoteSessionView = {
  ...view,
  id: "aaaaaaaaaaaa",
  code: "GVPZGU",
  hostname: "SRV-FICHIERS",
  osName: "Windows Server 2022 Standard",
  model: "PowerEdge R650",
  headless: true,
  suggestions: [{ id: "cpu" }, { id: "errors" }],
};
const routine = (id: string, name: string, everyMinutes: number): Routine => ({
  id, name, prompt: "", target: "bot", botId: "melonie", runOn: "maus", enabled: true,
  schedule: { type: "interval", everyMinutes, anchorAt: 1 }, durationMinutes: 30, nextRunAt: NOW + H, createdAt: 1, updatedAt: 1,
} as Routine);

// A mocked desktop (never a real screen) for the bot computer's reference card.
const MOCK_FRAME = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='800'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#1f2933'/><stop offset='1' stop-color='#3e4c59'/></linearGradient></defs><rect width='1280' height='800' fill='url(#g)'/><rect x='200' y='140' width='760' height='440' rx='10' fill='#f5f7fa'/><rect x='200' y='140' width='760' height='36' rx='10' fill='#cbd2d9'/><text x='640' y='380' fill='#52606d' font-family='sans-serif' font-size='28' text-anchor='middle'>Ordinateur du bot</text></svg>`,
);

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex w-[520px] shrink-0 flex-col gap-2">
      <h3 className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{title}</h3>
      {children}
    </section>
  );
}

function Gallery() {
  return (
    <div className="flex items-start gap-6 bg-app p-4 text-ink">
      <aside data-gallery-panel="" style={{ width: Number(params.get("panel")) || 380 }} className="shrink-0 rounded-xl border border-hairline/40 bg-panel">
        <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
          <RemoteSessionsSection bot={{ id: "melonie" } as Bot} />
          <section data-bot-settings-section="routines" className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CalendarClock size={16} className="text-ink-secondary" />
              <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h2>
              <span className="ui-icon-button"><Plus size={15} /></span>
            </div>
            <RoutineList routines={[routine("r1", "Résumé du matin", 1440)]} runs={[]} onOpen={() => {}} grouped toggle={false} />
          </section>
        </div>
      </aside>
      <div data-gallery-compare="" className="flex shrink-0 items-start gap-6">
        <Column title="Ordinateur du bot (référence)">
          <div data-gallery-bot-screen="" className="group/reference">
            <ComputerScreen
              source="server"
              state="running"
              caption={t("computer.screenOf", { name: "Melonie" })}
              live={<><img src={MOCK_FRAME} alt="" className="h-full w-full object-contain" /><TakeControlPill onClick={() => {}} /></>}
              controls={{ pause: () => {}, stop: () => {} }}
            />
          </div>
        </Column>
        <Column title="Session Tailcat (Windows)">
          <div data-gallery-card="">
            <RemoteSessionCard botId="melonie" threadId="thread-1" view={view} />
          </div>
        </Column>
      </div>
      <div data-gallery-states="" className="flex shrink-0 items-start gap-6">
        <Column title="OS pas encore connu (8F2NZU)">
          <div data-gallery-unknown="">
            <RemoteSessionCard botId="melonie" threadId="thread-1" view={unknown} />
          </div>
        </Column>
        <Column title="Serveur sans interface">
          <div data-gallery-headless="">
            <RemoteSessionCard botId="melonie" threadId="thread-1" view={headless} />
          </div>
        </Column>
      </div>
      {params.get("takeover") === "1" && <RemoteTakeover botId="melonie" view={view} state="running" controls={{ pause: () => {}, stop: () => {} }} onClose={() => {}} />}
    </div>
  );
}

// the capture serves this list; ?rows=0 serves an empty one
(window as unknown as { __remoteRows: RemoteSessionView[] }).__remoteRows = params.get("rows") === "0" ? [] : [view, unknown, headless, { ...view, id: "bbbbbbbbbbbb", code: "TP2T2G", hostname: undefined, user: undefined }];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Gallery />
    </StoreProvider>
  </StrictMode>,
);
