/** The real ChatView on a synthetic store, for captures of a turn that folds
 * its notes (#3581, scripts/capture/turn-fold.mjs): a long settled turn (its
 * notes and steps behind "Worked", the answer as the only bubble), a turn
 * that runs at three moments, and a heavy chat (five turns, one of them with
 * 17 notes and 40 steps). `pane=room` draws the neighbour: a room's "Worked"
 * row, the same ActivityRun a room draws over a member's answer. No server.
 * Every name and text is synthetic. Not shipped.
 * ?skin=<id>&lang=en|fr&moment=settled|run1|run2|run3|heavy&tools=1&pane=chat|room&open=1 */
import { StrictMode, useCallback, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";

import { ActivityRun } from "../components/ActivityRun";
import { ChatView } from "../components/ChatView";
import { ToolActivity } from "../components/ToolActivity";
import { roomTurnFolds } from "../lib/activity-runs";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, reducer, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
const tools = params.get("tools") === "1";
const moment = (params.get("moment") ?? "settled") as "settled" | "run1" | "run2" | "run3" | "heavy";
const pane = params.get("pane") === "room" ? "room" : "chat";
const running = moment.startsWith("run");

const NOW = Date.now();
const start = NOW - 173_000;
const say = (en: string, fren: string) => (fr ? fren : en);

const note = (id: string, turnId: string, at: number, text: string): Message =>
  ({ id, role: "bot", kind: "text", at, text, turnId }) as Message;
const answer = (id: string, turnId: string, at: number, text: string): Message =>
  ({ id, role: "bot", kind: "text", at, text, turnId, turnTerminal: true }) as Message;
const step = (id: string, turnId: string, at: number, name: string, input: Record<string, unknown>, ok: boolean | undefined = true): Message =>
  ({ id, role: "bot", kind: "activity", at, turnId, tool: { name, ...(ok === undefined ? {} : { ok, durationMs: 1_400 }), input: JSON.stringify(input) } }) as Message;
const user = (id: string, at: number, text: string): Message => ({ id, role: "user", kind: "text", at, text }) as Message;

const NOTES = [
  say("I'm reading ticket 1042 and its notes first.", "Je lis d'abord le billet 1042 et ses notes."),
  say("The notes ask for another format, so I'm reading them again with the right filter.", "Les notes demandent un autre format, je les relis avec le bon filtre."),
  say("Two of the four notes are duplicates of ticket 1040. I'm checking whether 1040 is still open.", "Deux des quatre notes sont des doublons du billet 1040. Je vérifie si 1040 est encore ouvert."),
];
const ANSWER = say(
  "Ticket 1042: the printer on the second floor has failed three times since Monday. Two of its notes repeat ticket 1040, which is still open. I suggest merging 1042 into 1040 and ordering the part.",
  "Billet 1042 : l'imprimante du 2e étage a fait défaut trois fois depuis lundi. Deux de ses notes reprennent le billet 1040, encore ouvert. Je te propose de fusionner 1042 dans 1040 et de commander la pièce.",
);

/** One turn: three notes between steps, then the answer. */
function longTurn(turnId: string, at: number, upTo: "run1" | "run2" | "run3" | "settled"): Message[] {
  const rows: Message[] = [note(`${turnId}-n1`, turnId, at + 2_000, NOTES[0]!)];
  if (upTo === "run1") return rows;
  rows.push(
    step(`${turnId}-s1`, turnId, at + 4_000, "Read", { file_path: "/srv/notes/1042.md" }),
    step(`${turnId}-s2`, turnId, at + 9_000, "WebSearch", { query: "printer model 4250 fuser error" }, upTo === "run2" ? undefined : true),
  );
  if (upTo === "run2") return rows;
  rows.push(
    note(`${turnId}-n2`, turnId, at + 40_000, NOTES[1]!),
    step(`${turnId}-s3`, turnId, at + 60_000, "Bash", { command: "jq '.items | length' notes.json" }),
    note(`${turnId}-n3`, turnId, at + 120_000, NOTES[2]!),
  );
  if (upTo === "run3") return rows;
  rows.push(
    step(`${turnId}-s4`, turnId, at + 150_000, "Grep", { pattern: "1040", path: "notes" }),
    answer(`${turnId}-a`, turnId, at + 173_000, ANSWER),
  );
  return rows;
}

/** The heavy chat: four settled turns (one with 17 notes and 40 steps), then
 * the turn of the moment. */
function heavyTurns(): Message[] {
  const rows: Message[] = [];
  const base = NOW - 4 * 3_600_000;
  for (let turn = 0; turn < 4; turn += 1) {
    const turnId = `h${turn}`;
    const at = base + turn * 600_000;
    rows.push(user(`${turnId}-u`, at, say(`Check the queue, pass ${turn + 1}.`, `Vérifie la file, passe ${turn + 1}.`)));
    const notes = turn === 1 ? 17 : 2;
    const steps = turn === 1 ? 40 : 3;
    for (let i = 0; i < Math.max(notes, steps); i += 1) {
      if (i < steps) rows.push(step(`${turnId}-s${i}`, turnId, at + 1_000 + i * 2_000, i % 3 === 0 ? "Read" : i % 3 === 1 ? "Bash" : "Grep", { file_path: `/srv/queue/${i}.json`, command: `jq . ${i}.json`, pattern: "open" }));
      if (i < notes) rows.push(note(`${turnId}-n${i}`, turnId, at + 2_000 + i * 2_000, say(`Note ${i + 1}: queue item ${i + 1} read, nothing blocked.`, `Note ${i + 1} : élément ${i + 1} de la file lu, rien de bloqué.`)));
    }
    rows.push(answer(`${turnId}-a`, turnId, at + 120_000, say(`Pass ${turn + 1}: the queue has ${12 - turn} open items, none waits for you.`, `Passe ${turn + 1} : la file compte ${12 - turn} éléments ouverts, aucun ne t'attend.`)));
  }
  return rows;
}

const ask = say("Summarize ticket 1042 and tell me what to do with it.", "Résume le billet 1042 et dis-moi quoi en faire.");
const earlier: Message[] = [
  user("e-u", start - 600_000, say("Hi, are you there?", "Salut, es-tu là?")),
  answer("e-a", "e", start - 598_000, say("Yes, what can I do for you?", "Oui, qu'est-ce que je peux faire pour toi?")),
];
type Moment = typeof moment;
function messagesFor(at: Moment): Message[] {
  const turnMoment = at === "heavy" ? "run3" : at === "settled" ? "settled" : at;
  const rows: Message[] = [
    ...(at === "heavy" ? heavyTurns() : earlier),
    user("u", start, ask),
    ...longTurn("t", start, turnMoment),
  ];
  rows.forEach((message, i) => { message.parentId = i > 0 ? rows[i - 1]!.id : null; });
  return rows;
}
const messages = messagesFor(moment);

const self = { id: "reviewer", name: "Reviewer", color: "violet" } as const;
const busy = running || moment === "heavy";
const owner: Bot = {
  id: self.id, threadId: `${self.id}-thread`, name: self.name, title: "", description: "", color: self.color,
  notifications: true, unread: false, busy, turnStartedAt: busy ? start : undefined, messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "gallery", model: "m" },
} as Bot;
const startState: AppState = {
  ...initialState,
  connected: true,
  config: { features: { showToolCalls: tools } } as AppState["config"],
  selectedId: self.id,
  bots: [owner],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname.startsWith("/api/")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

/** The capture moves a live turn on (window.__moment) to see whether the chat
 * jumps when a note folds. */
type MomentAction = { type: "gallery/moment"; moment: Moment };
function galleryReducer(current: AppState, action: Action | MomentAction): AppState {
  if (action.type === "gallery/moment") {
    const rows = messagesFor(action.moment);
    const live = action.moment.startsWith("run") || action.moment === "heavy";
    return { ...current, bots: current.bots.map((bot) => bot.id === self.id ? { ...bot, messages: rows, activeLeafId: rows.at(-1)?.id, busy: live, turnStartedAt: live ? start : undefined } : bot) };
  }
  try {
    return reducer(current, action);
  } catch {
    return current;
  }
}

/** The neighbour: a room draws a member's settled turn as its "Worked" row
 * (RoomMessageItem) over the answer, from roomTurnFolds. */
function RoomPane() {
  const turn = [user("u", start, ask), ...longTurn("t", start, "settled")];
  const folds = roomTurnFolds(turn);
  const nameOf = () => undefined;
  return (
    <div data-gallery-room="" className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-4 py-6">
      {turn.filter((message) => !folds.hiddenIds.has(message.id) && message.kind !== "activity").map((message) => {
        const fold = folds.byTerminalId.get(message.id);
        return (
          <div key={message.id} className="contents">
            {fold && (
              <ActivityRun
                messages={fold.messages}
                elapsedMs={fold.elapsedMs}
                nameOf={nameOf}
                renderStep={(row) => <ToolActivity tool={row.tool!} />}
                renderMessage={(row) => <div className="self-start rounded-[18px] bg-card px-3 py-2 text-[14px] text-ink">{row.text}</div>}
              />
            )}
            <div className={message.role === "user" ? "self-end rounded-[18px] bg-bubble-user px-3 py-2 text-[14px] text-ink" : "self-start text-[14px] text-ink"}>{message.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function Gallery() {
  const [current, apply] = useReducer(galleryReducer, startState);
  const dispatch = useCallback((action: Action) => apply(action), []);
  (window as unknown as { __moment?: (next: Moment) => void }).__moment = (next) => apply({ type: "gallery/moment", moment: next });
  const value = useMemo(() => ({ state: current, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [current, dispatch]);
  const bot = current.bots.find((entry) => entry.id === self.id)!;
  if (pane === "room") return <div className="min-h-dvh w-full bg-app text-ink"><RoomPane /></div>;
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-turn-fold="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
