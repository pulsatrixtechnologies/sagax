/** Isolated gallery for headless captures of a bot reply that links to media
 * (an HLS stream, a video file, an audio clip, an expired signed link, a link
 * the media server refuses) next to a reply with a bare picture, drawn by the
 * real 1:1 chat (ChatView). Answers /api itself with a made-up bot. The media
 * comes from `?media=<https origin>` (a local test server of the capture
 * script); nothing reaches a real server. Not shipped in the app.
 * ?skin=<id>&lang=<code>&media=<origin> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import { DesktopCapabilitiesProvider } from "../components/DesktopCapabilities";
import { ChatView } from "../components/ChatView";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const fr = lang === "fr";
const media = params.get("media") ?? "https://media.example.test";
// signed playback links: a far future exp, and one already past
const live = `${media}/v1/share/recordings/rec-42/index.m3u8?u=1&exp=9999999999&t=sig`;
const gone = `${media}/v1/share/recordings/rec-41/index.m3u8?u=1&exp=1000000000&t=sig`;

const at = Date.UTC(2026, 10, 17, 13, 0);
const replies = fr
  ? [
      `Voici la capture du tableau de bord.\n\n${media}/picture.png`,
      `Voici l'enregistrement de la réunion :\n\n${live}`,
      `Le clip de démo : ${media}/demo-clip.mp4`,
      `La note vocale du client :\n\n${media}/client-message.mp3`,
      `Le lien de lecture de l'enregistrement d'hier : ${gone}`,
      `[Écouter l'appel archivé](${media}/denied/archived-call.mp3)`,
    ]
  : [
      `Here is the dashboard capture.\n\n${media}/picture.png`,
      `Here is the meeting recording:\n\n${live}`,
      `The demo clip: ${media}/demo-clip.mp4`,
      `The client's voice note:\n\n${media}/client-message.mp3`,
      `The player link for yesterday's recording: ${gone}`,
      `[Listen to the archived call](${media}/denied/archived-call.mp3)`,
    ];
const messages = [
  { id: "u1", role: "user", kind: "text", text: fr ? "Montre-moi les enregistrements." : "Show me the recordings.", at },
  ...replies.map((text, i) => ({ id: `b${i}`, role: "bot", kind: "text", text, at: at + (i + 1) * 60_000 })),
];
const atlas = {
  id: "atlas", threadId: "t-atlas", name: "Atlas", title: "Service desk", description: "", notifications: true, color: "pink", unread: false,
  ownerUserId: "pr_me", modelSelection: { instanceId: "fake", model: "test" }, messages, tasks: [],
} as unknown as Bot;

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const target = new URL(url, location.href);
  if (target.origin !== location.origin || !target.pathname.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (target.pathname === "/api/bots") return json({ bots: [atlas], groups: [], sections: [], computerControl: {} });
  if (target.pathname === "/api/config") return json({ profile: { name: "Alex Gagnon", email: "alex@example.test" }, viewer: { principalId: "pr_me", role: "member" } });
  return json({ error: "gallery" }, 404);
}) as typeof window.fetch;
class SilentEventSource {
  onmessage = null;
  onerror = null;
  onopen = null;
  readyState = 0;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
(window as unknown as { EventSource: unknown }).EventSource = SilentEventSource;

function Chat() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    if (state.hydrated && state.selectedId !== "atlas") dispatch({ type: "select", id: "atlas" });
  }, [state.hydrated, state.selectedId, dispatch]);
  const one = state.bots.find((b) => b.id === "atlas");
  return <div className="flex h-dvh bg-app text-ink">{one && state.selectedId === "atlas" ? <ChatView bot={one} /> : null}</div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><DesktopCapabilitiesProvider><Chat /></DesktopCapabilitiesProvider></StoreProvider>
  </StrictMode>,
);
