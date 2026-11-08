/** Isolated gallery for headless screenshots of a remote computer in the
 * chat: its facts card, then its terminal (live, ended and open, ended and
 * folded), laid out like Bubble does in the transcript column (px-5 gutter,
 * the column width for both cards, no bubble padding), so a capture at a few
 * window widths shows how the cards follow the chat. Fetch and the terminal
 * WebSocket are answered in the page. Not shipped.
 * ?skin=<id>&lang=<code>&before=1 (bubble widths before #2724) */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { RemoteSessionView } from "../../shared/remote-session";
import type { TerminalEmbed } from "../../shared/terminal-resources";
import { RemoteSessionCard } from "../components/remote-session/RemoteSessionCard";
import { TerminalChatEmbed } from "../components/terminal/TerminalChatEmbed";
import { CHAT_BUBBLE_WIDTH_CLASS, CHAT_COLUMN_CLASS } from "../lib/chat-bubble-width";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const before = params.get("before") === "1";

const SCREEN = "<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='800'><rect width='1280' height='800' fill='#1f4e79'/><rect x='0' y='760' width='1280' height='40' fill='#202020'/><rect x='300' y='160' width='680' height='400' rx='8' fill='#f3f3f3'/><text x='640' y='370' fill='#52606d' font-family='sans-serif' font-size='28' text-anchor='middle'>POSTE-02</text></svg>";
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/screen")) return new Response(SCREEN, { status: 200, headers: { "content-type": "image/svg+xml" } });
  if (url.includes("/api/")) return new Response(JSON.stringify({ runs: [], routines: [], items: [], sessions: [], hosts: [], devices: [] }), { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};
class GalleryWebSocket {
  static readonly OPEN = 1;
  readyState = 1;
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    setTimeout(() => {
      this.onopen?.();
      this.onmessage?.({ data: "Microsoft Windows [version 10.0.22631]\r\n\r\nPS C:\\Users\\usager> hostname\r\nPOSTE-02\r\nPS C:\\Users\\usager> " });
    }, 50);
  }
  send() {}
  close() {}
}
(window as unknown as { WebSocket: unknown }).WebSocket = GalleryWebSocket;

const NOW = Date.now();
const view: RemoteSessionView = {
  id: "0123456789ab",
  code: "BQDHS7",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: new Date(NOW + 2 * 3_600_000).toISOString(),
  hostname: "POSTE-02",
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
const base: TerminalEmbed = { sessionId: "live", provider: "tailcat", resourceId: view.id, label: "Session à distance", hostLabel: "POSTE-02", status: "live", openedAt: NOW - 4 * 60_000 };
const TRANSCRIPT = "PS C:\\Users\\usager> hostname\nPOSTE-02\nPS C:\\Users\\usager> Get-Service Spooler\n\nStatus   Name               DisplayName\n------   ----               -----------\nRunning  Spooler            Spouleur d'impression\n\nPS C:\\Users\\usager> exit";
const endedOpen: TerminalEmbed = { ...base, sessionId: "ended-open", status: "ended", endedAt: NOW, collapsed: false, transcript: TRANSCRIPT };
const endedFolded: TerminalEmbed = { ...base, sessionId: "ended-folded", status: "ended", endedAt: NOW, collapsed: true, transcript: TRANSCRIPT };

const remoteBubble = before ? CHAT_BUBBLE_WIDTH_CLASS.wide : CHAT_BUBBLE_WIDTH_CLASS.column;
const terminalBubble = before ? `${CHAT_BUBBLE_WIDTH_CLASS.column} bg-card px-3 py-[7px]` : CHAT_BUBBLE_WIDTH_CLASS.column;

function Row({ name, bubble, children }: { name: string; bubble: string; children: React.ReactNode }) {
  return (
    <div data-gallery-sample={name} className="flex w-full flex-col items-start">
      <div className={`rounded-[18px] text-[13px] leading-5 text-ink ${bubble}`}>{children}</div>
    </div>
  );
}

function Gallery() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-app px-5 py-6 text-ink">
      <div className={CHAT_COLUMN_CLASS} data-gallery-column="">
        <Row name="remote-card" bubble={remoteBubble}><RemoteSessionCard botId="wren" threadId="thread-1" view={view} /></Row>
        <Row name="terminal-live" bubble={terminalBubble}><TerminalChatEmbed embed={base} /></Row>
        <Row name="terminal-ended-open" bubble={terminalBubble}><TerminalChatEmbed embed={endedOpen} /></Row>
        <Row name="terminal-ended-folded" bubble={terminalBubble}><TerminalChatEmbed embed={endedFolded} /></Row>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Gallery />
    </StoreProvider>
  </StrictMode>,
);
