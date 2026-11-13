/** Isolated gallery for headless captures of a bot message that carries a
 * long list of attached images (300, the first 50 reachable, the other 250
 * gone, some of them optionally stalled), drawn by the real 1:1 chat (ChatView). Answers /api itself with a
 * made-up bot; picture bytes come from the dev server, nothing reaches a
 * real server. Not shipped in the app. ?skin=<id>&lang=<code>&count=<n>&ok=<n>&hang=<n> */
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
await loadLocale(params.get("lang") ?? "fr");
const count = Number(params.get("count") ?? 300);
const reachable = Number(params.get("ok") ?? 50);
// ?hang=<n>: the first n unreachable pictures never answer (a stalled request)
const hanging = Number(params.get("hang") ?? 0);

const at = Date.UTC(2026, 10, 13, 13, 0);
const attachments = Array.from({ length: count }, (_, i) => ({
  kind: "image" as const,
  path: `/store/${i < reachable ? "ok" : i < reachable + hanging ? "hang" : "gone"}-${i}.png`,
  mime: "image/png",
}));
const messages = [
  { id: "u1", role: "user", kind: "text", text: "Envoie-moi les captures de la passe.", at },
  { id: "b1", role: "bot", kind: "text", text: "Voici les captures de la passe de ce matin.", attachments, at: at + 60_000 },
];
const atlas = {
  id: "atlas", threadId: "t-atlas", name: "Atlas", title: "Service desk", description: "", notifications: true, color: "pink", unread: false,
  ownerUserId: "pr_me", modelSelection: { instanceId: "fake", model: "test" }, messages, tasks: [],
} as unknown as Bot;

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith("/api/") || path.startsWith("/api/attachments/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (path === "/api/bots") return json({ bots: [atlas], groups: [], sections: [], computerControl: {} });
  if (path === "/api/config") return json({ profile: { name: "Alex Gagnon", email: "alex@example.test" }, viewer: { principalId: "pr_me", role: "member" } });
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
