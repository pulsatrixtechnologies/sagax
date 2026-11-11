/** Isolated gallery for Playwright screenshots (not shipped in the app): the
 * Computer tab's screens at the bot panel's width. A Local VM that is off
 * (Démarrer alone, no control bar over it), the server environment off (the
 * bar under the words), the bot's browser live, closed, and its take-control
 * window. The browser's stream is a stand-in EventSource. This computer's
 * live window on the local page and on the page served by the organization
 * server (modal=local, modal=bundled). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserComputerScreen } from "../components/BrowserPanel";
import { ComputerScreen } from "../components/computer/ComputerScreen";
import { LocalLiveScreen } from "../components/computer/LocalLiveScreen";
import { SandboxDesktopModal } from "../components/computer/SandboxDesktopModal";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin } from "../lib/skins";
import type { Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin");
applySkin(skinParam === "daylight" || skinParam === "pulsatrix" ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

/** A page the stand-in browser shows. */
function pagePicture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 800;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#f6f7f9"; g.fillRect(0, 0, 1280, 800);
  g.fillStyle = "#1f6feb"; g.fillRect(0, 0, 1280, 72);
  g.fillStyle = "#ffffff"; g.font = "bold 30px sans-serif"; g.fillText("Portail client", 40, 46);
  g.fillStyle = "#222"; g.font = "bold 44px sans-serif"; g.fillText("Billets ouverts", 40, 150);
  for (let row = 0; row < 6; row++) {
    g.fillStyle = row % 2 ? "#ffffff" : "#eef1f5"; g.fillRect(40, 190 + row * 80, 1200, 72);
    g.fillStyle = "#333"; g.font = "26px sans-serif"; g.fillText(`#29${7040 + row}  Imprimante du 2e étage`, 64, 236 + row * 80);
  }
  return canvas.toDataURL("image/png").split(",")[1]!;
}

class StandInSource {
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(url: string) {
    setTimeout(() => {
      if (url.includes("/bots/closed/")) { this.emit("offline", {}); return; }
      this.emit("ready", { viewerId: "gallery" });
      this.emit("frame", { seq: 1, data: pagePicture(), format: "png", metadata: { deviceWidth: 1280, deviceHeight: 800 } });
    }, 50);
  }
  addEventListener(name: string, listener: (event: MessageEvent) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  private emit(name: string, data: unknown) { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data: JSON.stringify(data) })); }
  close() {}
}
(globalThis as { EventSource: unknown }).EventSource = StandInSource;

// modal=starting: the desktop viewer never answers, so the window stays in
// its starting state. modal=needs: this computer's capture without Screen
// Recording (the state that needs the person).
if (params.get("modal") === "starting") {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input).includes("/api/desktop-viewer/")
      ? new Promise<Response>(() => {})
      : realFetch(input, init)) as typeof fetch;
}
if (params.get("modal") === "needs") {
  (window as unknown as { ogb: unknown }).ogb = {
    screenFrame: async () => null,
    permStatus: async () => ({ screen: "denied" }),
    permAll: async () => ({ platform: "darwin", permissions: [{ id: "screen", status: "denied", action: { kind: "settings", url: "x-apple.systempreferences:", secondary: { kind: "relaunch" } } }] }),
    permAct: async () => null,
    permOpenSettings: async () => {},
  };
}

// modal=local: the local page's live window, fed by the full frame
// (screenFrame). modal=bundled: the app's page served by the organization
// server, which only gets the bot panel's small thumbnail (#3565).
if (params.get("modal") === "local" || params.get("modal") === "bundled") {
  const picture = () => `data:image/png;base64,${fakeDesktop(params.get("modal") === "bundled" ? 320 : 1280)}`;
  (window as unknown as { ogb: unknown }).ogb = {
    ...(params.get("modal") === "local" ? { screenFrame: async () => picture() } : { screenThumbnail: async () => ({ image: picture(), at: Date.now(), host: "gallery" }) }),
    permStatus: async () => ({ screen: "granted" }),
    permAll: async () => ({ platform: "darwin", permissions: [{ id: "screen", status: "granted" }] }),
    permAct: async () => null,
    permOpenSettings: async () => {},
  };
}

const live = { id: "live", name: "Assistant", browserProfile: "own" } as unknown as Bot;
const closed = { id: "closed", name: "Assistant", browserProfile: "own" } as unknown as Bot;
const machine = "Alexs-MacBook-Pro.local";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section data-gallery={title}><h1 className="mb-3 text-[13px] font-semibold text-ink-secondary">{title}</h1>{children}</section>;
}

function fakeDesktop(width = 1280): string {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = width * 5 / 8;
  const g = canvas.getContext("2d")!;
  g.scale(width / 1280, width / 1280);
  g.fillStyle = "#1a1b1e"; g.fillRect(0, 0, 1280, 800);
  g.fillStyle = "#2a2d33"; g.fillRect(40, 40, 400, 280);
  g.fillStyle = "#3a3f48"; g.fillRect(480, 40, 360, 180);
  g.fillStyle = "#c8ccd4"; g.font = "28px sans-serif"; g.fillText("Workspace", 60, 90);
  g.fillStyle = "#8b909a"; g.font = "20px sans-serif"; g.fillText("notes.md", 60, 130);
  return canvas.toDataURL("image/png").split(",")[1]!;
}

function Gallery() {
  const modal = params.get("modal");
  const picture = modal === "sandbox" ? fakeDesktop() : pagePicture();
  return (
    <div className="min-h-screen bg-app p-5 text-ink">
      <div className="mx-auto flex w-[380px] flex-col gap-8">
        <Section title="VM locale éteinte">
          <ComputerScreen source="local" state="off" caption={`${t("computer.screenOf", { name: "Assistant" })} · ${machine}`}
            message={t("computerScreen.localOff")} actions={[{ label: t("computerScreen.play"), onClick: () => {}, primary: true }]}
            controls={{ play: () => {} }} />
        </Section>
        <Section title="Environnement serveur éteint">
          <ComputerScreen source="server" state="off" caption={t("computer.screenOf", { name: "Assistant" })}
            message={t("computerScreen.serverOff")} controls={{ play: () => {} }} />
        </Section>
        <Section title="Environnement serveur en marche">
          {/* Pause / Stop given on purpose: a bot's computer never draws them. */}
          <ComputerScreen source="server" state="running" caption={t("computer.screenOf", { name: "Wren" })} onOpen={() => {}} openAlwaysShown
            live={<img alt="" className="h-full w-full object-cover" src={`data:image/png;base64,${fakeDesktop()}`} />}
            controls={{ pause: () => {}, stop: () => {} }} />
        </Section>
        <Section title="Navigateur en direct"><BrowserComputerScreen bot={live} /></Section>
        <Section title="Navigateur fermé"><BrowserComputerScreen bot={closed} /></Section>
      </div>
      {modal === "browser" && <SandboxDesktopModal kind="browser" title={t("computer.browserOf", { name: "Assistant" })} state="running" onClose={() => {}}
        screen={() => <img alt="" className="h-full w-full rounded-xl object-contain" src={`data:image/png;base64,${picture}`} />} />}
      {modal === "sandbox" && <SandboxDesktopModal title={t("computer.screenOf", { name: "Assistant" })} state="running"
        onClose={() => {}}
        screen={() => <img alt="" className="h-full w-full rounded-xl object-contain" src={`data:image/png;base64,${picture}`} />} />}
      {modal === "starting" && <SandboxDesktopModal title={t("computer.screenOf", { name: "Assistant" })} state="running" onClose={() => {}} />}
      {(modal === "local" || modal === "bundled") && <SandboxDesktopModal title={t("computer.screenOf", { name: "Assistant" })} state="running" onClose={() => {}}
        screen={(control) => <LocalLiveScreen control={control} />} />}
      {modal === "needs" && <SandboxDesktopModal title={t("computer.screenOf", { name: "Assistant" })} state="running" onClose={() => {}}
        screen={(control) => <LocalLiveScreen control={control} />} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
