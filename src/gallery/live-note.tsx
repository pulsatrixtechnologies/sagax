/** The real ChatView through one live turn, frame by frame, for captures of
 * where the bot's text is drawn while it works (#3696,
 * scripts/capture/live-note.mjs). Three scripts: a short note, two steps,
 * then an answer (`steps`); a long answer alone (`long`); a one-line answer
 * alone (`short`). The capture moves a frame on in place (window.__frame) so
 * a bubble that goes away or a jump of the list shows. No server. Every name
 * and text is synthetic. Not shipped.
 * ?skin=<id>&lang=en|fr&script=steps|long|short */
import { StrictMode, useCallback, useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, reducer, StreamingPreview, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
const script = (params.get("script") ?? "steps") as "steps" | "long" | "short";

const NOW = Date.now();
const start = NOW - 60_000;
const say = (en: string, fren: string) => (fr ? fren : en);

const user = (id: string, at: number, text: string): Message => ({ id, role: "user", kind: "text", at, text }) as Message;
const text = (id: string, at: number, body: string, terminal = false): Message =>
  ({ id, role: "bot", kind: "text", at, text: body, turnId: "t", ...(terminal ? { turnTerminal: true } : {}) }) as Message;
const step = (id: string, at: number, name: string, input: Record<string, unknown>, ok?: boolean): Message =>
  ({ id, role: "bot", kind: "activity", at, turnId: "t", tool: { name, ...(ok === undefined ? {} : { ok, durationMs: 1_400 }), input: JSON.stringify(input) } }) as Message;

const NOTE = say("Yes, I will check the request and its notes.", "Oui, je vérifie la demande et ses notes.");
const ANSWER = say(
  "Ticket 1042: the printer on the second floor has failed three times since Monday. Two of its notes repeat ticket 1040, which is still open. I suggest merging 1042 into 1040 and ordering the part.",
  "Billet 1042 : l'imprimante du 2e étage a fait défaut trois fois depuis lundi. Deux de ses notes reprennent le billet 1040, encore ouvert. Je te propose de fusionner 1042 dans 1040 et de commander la pièce.",
);
const YES = say("Yes, it is still open.", "Oui, il est encore ouvert.");
const ask = script === "short"
  ? say("Is ticket 1040 still open?", "Le billet 1040 est-il encore ouvert?")
  : say("Summarize ticket 1042 and tell me what to do with it.", "Résume le billet 1042 et dis-moi quoi en faire.");
const earlier: Message[] = [
  user("e-u", start - 600_000, say("Hi, are you there?", "Salut, es-tu là?")),
  { ...text("e-a", start - 598_000, say("Yes, what can I do for you?", "Oui, qu'est-ce que je peux faire pour toi?"), true), turnId: "e" } as Message,
  user("u", start, ask),
];
const words = (body: string, count: number) => body.split(" ").slice(0, count).join(" ");

/** One frame: the rows, the text being written, whether the turn runs. */
type Frame = { name: string; rows: Message[]; streaming?: string; busy: boolean };
const read = step("s1", start + 4_000, "Read", { file_path: "/srv/notes/1042.md" });
const search = step("s2", start + 9_000, "WebSearch", { query: "printer model 4250 fuser error" });
const FRAMES: Record<typeof script, Frame[]> = {
  steps: [
    { name: "first-words", rows: [], streaming: words(NOTE, 2), busy: true },
    { name: "short-sentence", rows: [], streaming: NOTE, busy: true },
    { name: "first-step", rows: [text("n1", start + 2_000, NOTE), { ...read, tool: { ...read.tool!, ok: undefined } } as Message], busy: true },
    { name: "second-step", rows: [text("n1", start + 2_000, NOTE), read, search], busy: true },
    { name: "answer-first-words", rows: [text("n1", start + 2_000, NOTE), read, { ...search, tool: { ...search.tool!, ok: true, durationMs: 1_400 } } as Message], streaming: words(ANSWER, 4), busy: true },
    { name: "answer-opened", rows: [text("n1", start + 2_000, NOTE), read, { ...search, tool: { ...search.tool!, ok: true, durationMs: 1_400 } } as Message], streaming: words(ANSWER, 24), busy: true },
    { name: "turn-ended", rows: [text("n1", start + 2_000, NOTE), read, { ...search, tool: { ...search.tool!, ok: true, durationMs: 1_400 } } as Message, text("a", start + 40_000, ANSWER, true)], busy: false },
  ],
  long: [
    { name: "first-words", rows: [], streaming: words(ANSWER, 3), busy: true },
    { name: "short-form", rows: [], streaming: words(ANSWER, 12), busy: true },
    { name: "answer-opened", rows: [], streaming: words(ANSWER, 22), busy: true },
    { name: "answer-written", rows: [], streaming: ANSWER, busy: true },
    { name: "answer-received", rows: [text("a", start + 30_000, ANSWER)], busy: true },
    { name: "turn-ended", rows: [text("a", start + 30_000, ANSWER, true)], busy: false },
  ],
  short: [
    { name: "first-words", rows: [], streaming: words(YES, 1), busy: true },
    { name: "full-line", rows: [], streaming: YES, busy: true },
    { name: "line-received", rows: [text("a", start + 3_000, YES)], busy: true },
    { name: "turn-ended", rows: [text("a", start + 3_000, YES, true)], busy: false },
  ],
};
const frames = FRAMES[script];

const self = { id: "reviewer", name: "Reviewer", color: "violet" } as const;
const threadId = `${self.id}-thread`;
function botAt(index: number, current?: Bot): Bot {
  const frame = frames[Math.min(index, frames.length - 1)]!;
  const rows = [...earlier, ...frame.rows];
  rows.forEach((message, i) => { message.parentId = i > 0 ? rows[i - 1]!.id : null; });
  return {
    ...(current ?? {
      id: self.id, threadId, name: self.name, title: "", description: "", color: self.color,
      notifications: true, unread: false, modelSelection: { instanceId: "gallery", model: "m" },
    }),
    busy: frame.busy, turnStartedAt: frame.busy ? start : undefined, messages: rows, activeLeafId: rows.at(-1)?.id,
  } as Bot;
}
const startState: AppState = {
  ...initialState,
  connected: true,
  config: { features: { showToolCalls: false } } as AppState["config"],
  selectedId: self.id,
  bots: [botAt(0)],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname.startsWith("/api/")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

type FrameAction = { type: "gallery/frame"; index: number };
function galleryReducer(current: AppState, action: Action | FrameAction): AppState {
  if (action.type === "gallery/frame") {
    return { ...current, bots: current.bots.map((bot) => bot.id === self.id ? botAt(action.index, bot) : bot) };
  }
  try {
    return reducer(current, action);
  } catch {
    return current;
  }
}

function Gallery() {
  const [current, apply] = useReducer(galleryReducer, startState);
  const [index, setIndex] = useState(0);
  const dispatch = useCallback((action: Action) => apply(action), []);
  const w = window as unknown as { __frame?: (next: number) => void; __frames?: string[] };
  w.__frames = frames.map((frame) => frame.name);
  // the rows and the text being written change in one commit, as the store does
  w.__frame = (next) => { apply({ type: "gallery/frame", index: next }); setIndex(next); };
  const value = useMemo(() => ({ state: current, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [current, dispatch]);
  const streaming = frames[index]?.streaming;
  const live = useMemo(() => (streaming ? { [threadId]: streaming } : {}), [streaming]);
  const bot = current.bots.find((entry) => entry.id === self.id)!;
  return (
    <BotEditorStore value={value as never}>
      <StreamingPreview streaming={live}>
        <div data-gallery-live-note="" data-frame={frames[index]?.name} className="flex h-dvh w-full overflow-hidden bg-app">
          <ChatView bot={bot} />
        </div>
      </StreamingPreview>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
