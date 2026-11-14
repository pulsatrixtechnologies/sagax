/** #3656: the real ChatView (its transcript and Composer) on a synthetic
 * store, for headless captures of the "no access" notice in the history
 * (scripts/capture/chat-access-notice.mjs). Every name and text is synthetic.
 * Not shipped in the app.
 * ?skin=<id>&lang=en|fr&view=open|reconnected|two
 *   open: the person's message got no answer, the notice under it;
 *   reconnected: the same after the person connected their subscription again
 *     (GET /api/me/engines now says it runs their turns), before any new message;
 *   two: two messages that got no answer: the one notice covers both;
 *   fallback, credit (#4233): Claude signed out or out of credit, Codex answers
 *     meanwhile: the bot's answer, then the one fix card for the engine;
 *   server-credit (#4233): the server's Claude account out of credit, read by
 *     an administrator: the organization's account, not theirs. */
import { StrictMode, useCallback, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, reducer, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "../state/store";
import type { WireAccessCard } from "../../shared/wire";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
const view = params.get("view") ?? "open";

const ME = "pr_member";
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname === "/api/org") return reply({ org: { identity: { kind: "perspicax", issuer: "https://px.example.test" } } });
  if (url.pathname === "/api/me/engines") {
    const back = view === "reconnected";
    return reply({ engines: [{
      instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true,
      subscription: { supported: true, signedIn: back }, myKey: false, orgKey: false, myTurns: back ? "subscription" : "none",
    }] });
  }
  if (url.pathname.startsWith("/api/")) return reply({});
  return realFetch(input, init);
};

const at = Date.UTC(2026, 10, 11, 14, 0);
const line = (id: string, role: Message["role"], text: string, minute: number, parentId?: string): Message =>
  ({ id, role, kind: "text", text, at: at + minute * 60_000, parentId }) as Message;
const access: WireAccessCard = {
  reason: "no_access", cause: "no_credentials", engine: "Claude", botId: "scout", botName: "Scout",
  ownerPrincipalId: ME, payer: "speaker", payerPrincipalId: ME, subscriptionSignIn: true, keysUrl: "https://px.example.test/console/credentials?kind=model",
};
const serverCard = view === "server-credit";
const credit = view === "credit" || serverCard;
const fallback = view === "fallback" || credit;
const fixCard: WireAccessCard = {
  reason: "no_access", cause: credit ? "out_of_credit" : "sign_in_expired", engine: "Claude", instanceId: "claude", botId: "scout", botName: "Scout",
  ownerPrincipalId: ME, ...(serverCard ? { audiencePrincipalIds: [ME] } : { payerPrincipalId: ME }), ...(credit ? {} : { subscriptionSignIn: true as const }), key: "engine-sign-in:claude", meanwhile: "Codex",
};
const card = (id: string, minute: number, parentId: string): Message => ({ id, role: "bot", kind: "access", access: fallback ? fixCard : access, at: at + minute * 60_000 + 3_000, parentId }) as Message;

const messages: Message[] = [
  line("u0", "user", fr ? "Résume les billets ouverts de la semaine." : "Summarize this week's open tickets.", 0),
  line("b0", "bot", fr ? "Douze billets ouverts, trois en attente du client." : "Twelve open tickets, three waiting on the customer.", 1, "u0"),
  line("u1", "user", fr ? "Prépare un brouillon de réponse pour le plus ancien." : "Draft a reply for the oldest one.", 32, "b0"),
  ...(fallback ? [line("b1", "bot", fr ? "Voici un brouillon pour le billet le plus ancien." : "Here is a draft for the oldest ticket.", 33, "u1")] : []),
  card("a1", fallback ? 33 : 32, fallback ? "b1" : "u1"),
  ...(view === "two" ? [
    // the server writes the card once until the bot answers (shared/failure-dedup.ts)
    line("u2", "user", fr ? "Et donne-moi la liste par priorité." : "And list them by priority.", 47, "a1"),
  ] : []),
];
const scout: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "claude", model: "m" },
  tasks: [{ threadId: "scout-thread", title: fr ? "Billets" : "Tickets", createdAt: at, busy: false, activity: "idle", unread: false, modelSelection: { instanceId: "claude", model: "m" }, approvalMode: "ask" }],
} as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  config: { viewer: { principalId: ME, role: serverCard ? "admin" : "member" } } as AppState["config"],
  selectedId: "scout",
  bots: [scout],
  instances: [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available" }, models: { options: [{ id: "m", label: fr ? "Modèle de la galerie" : "Gallery model" }] } } as unknown as InstanceInfo],
};

function galleryReducer(state: AppState, action: Action): AppState {
  try {
    return reducer(state, action);
  } catch {
    return state;
  }
}

function Gallery() {
  const [state, apply] = useReducer(galleryReducer, start);
  const dispatch = useCallback((action: Action) => apply(action), []);
  const value = useMemo(() => ({ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [state, dispatch]);
  const bot = state.bots.find((entry) => entry.id === "scout")!;
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-chat-access-notice="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
