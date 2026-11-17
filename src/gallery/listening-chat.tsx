/** The real ChatView on a synthetic store, for captures of listening to a
 * conversation (#4100) in every state it has in a bot's chat
 * (scripts/capture/listening-chat.mjs). No server; every name and text is
 * synthetic. Not shipped in the app.
 * ?skin=<id>&lang=en|fr&state=start|listening|sent|stopped|computer|nostt|micdenied */
import { StrictMode, useCallback, useEffect, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
import { ProviderKeyDialog } from "../components/settings/ProviderKeys";
import { loadLocale, t } from "../lib/i18n";
import { startListening } from "../lib/listening/listening-session";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, reducer, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "../state/store";
import { answerEndedTranscript, createFakeListening, ENDED_SESSION_ID } from "./listening-fakes";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
const state = params.get("state") ?? "listening";

const at = Date.now() - 3_600_000;
const line = (id: string, role: Message["role"], text: string, second: number, extra: Partial<Message> = {}): Message =>
  ({ id, role, kind: "text", text, at: at + second * 1000, ...extra }) as Message;
const speakers = [{ key: "s1", label: t("listening.speaker", { n: 1 }) }, { key: "s2", label: t("listening.speaker", { n: 2 }) }, { key: "s3", label: "Alex" }];

const earlier: Message[] = [
  line("u1", "user", fr ? "Prépare-moi pour la réunion budget de 10 h." : "Get me ready for the 10 am budget meeting.", 0),
  line("b1", "bot", fr ? "C'est prêt: trois points à couvrir, les chiffres du trimestre sont dans le brief." : "Ready: three points to cover, the quarter's figures are in the brief.", 5),
];
const rowOn = { id: "l1", role: "bot", kind: "text", text: "", at: at + 60_000, listening: { sessionId: "ls_0000000000000000000a", state: "listening", startedAt: at, lineCount: 3, speakers: [] } } as unknown as Message;
const rowEnded = { id: "l2", role: "bot", kind: "text", text: "", at: at + 60_000, listening: { sessionId: ENDED_SESSION_ID, state: "ended", startedAt: 0, endedAt: 24 * 60_000, lineCount: 3, speakers } } as unknown as Message;

const sent = [
  line("u2", "user", fr ? "Qu'est-ce qu'ils ont décidé pour le budget, jusqu'ici?" : "What have they decided about the budget so far?", 120),
  line("b2", "bot", fr ? "Jusqu'ici: livraison vendredi, et le budget se revoit en fin de séance. Alex doit envoyer le résumé." : "So far: delivery on Friday, and the budget is reviewed at the end. Alex is to send the summary.", 125),
];
const stopped = [
  line("b3", "bot", fr
    ? "J'ai écouté 24 min. Décisions: on commence par le budget, tu prends les chiffres, Alex envoie le résumé. Veux-tu que je le rédige?"
    : "I listened for 24 min. Decisions: start with the budget, you take the numbers, Alex sends the summary. Want me to draft it?", 1_500),
];
const messages: Message[] = [
  ...earlier,
  ...(state === "listening" || state === "computer" ? [rowOn] : []),
  ...(state === "sent" ? [rowOn, ...sent] : []),
  ...(state === "stopped" ? [rowEnded, ...stopped] : []),
];
messages.forEach((message, i) => { if (i > 0) message.parentId = messages[i - 1]!.id; });

const scout: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "gallery", model: "m" },
} as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  config: { features: {} } as AppState["config"],
  selectedId: scout.id,
  bots: [scout],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname.startsWith("/api/listening/")) return realFetch(input, init);
  if (url.pathname.startsWith("/api/")) return reply({});
  return realFetch(input, init);
};
answerEndedTranscript(scout, fr);

function galleryReducer(current: AppState, action: Action): AppState {
  try {
    return reducer(current, action);
  } catch {
    return current;
  }
}

const fakes = createFakeListening(scout, { ...(state === "micdenied" ? { microphone: "denied" as const } : {}), ...(state === "computer" ? { computer: "denied" as const } : {}) });
const SAID = fr
  ? ["On peut livrer vendredi?", "Oui, je le mets dans le brief.", "Parfait, et on revoit le budget"]
  : ["Can we ship it on Friday?", "Yes, I'll put that in the brief.", "Great, and we review the budget"];

let started = false;

function Gallery() {
  const [current, apply] = useReducer(galleryReducer, start);
  const dispatch = useCallback((action: Action) => apply(action), []);
  const value = useMemo(() => ({ state: current, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [current, dispatch]);
  const bot = current.bots.find((entry) => entry.id === scout.id)!;
  useEffect(() => {
    // StrictMode runs this twice: the session starts once
    if (started) return;
    started = true;
    void (async () => {
      // the store opens Settings by default; the menu entry is what opens it here
      dispatch({ type: "toggleAppSettings", open: false });
      if (state === "listening" || state === "sent" || state === "computer") {
        await startListening({ botId: scout.id, threadId: scout.threadId, personName: "Alex" }, fakes.deps);
        await fakes.utter(SAID[0]!, true);
        await fakes.utter(SAID[1]!, true);
        await fakes.utter(SAID[2]!, false);
      } else if (state === "micdenied") {
        await startListening({ botId: scout.id, threadId: scout.threadId, personName: "Alex" }, fakes.deps)
          .catch((error: unknown) => dispatch({ type: "error", message: t("listening.couldNotStart", { error: error instanceof Error ? error.message : String(error) }) }));
      }
      document.body.dataset.galleryReady = "";
    })();
  }, [dispatch]);
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-listening-chat="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
        {state === "nostt" && <ProviderKeyDialog />}
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
