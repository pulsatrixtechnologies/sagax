/** The real ChatView on a synthetic store, for captures of the bot-to-bot
 * traces of a turn (scripts/capture/ask-line.mjs): a bot that asks several
 * teammates (the hand-off receipts and their answers), a routine run that
 * handed work to teammates, and the receiving side (a request from a bot,
 * a reply copied into the teammate's chat, a request stopped before an
 * answer). No server. Every name and text is synthetic. Not shipped.
 * ?skin=<id>&lang=en|fr&side=sender|receiver&n=<teammates>
 * &state=running|done|stopped&tools=1 (Tool calls shown) */
import { StrictMode, useCallback, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
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
const count = Math.max(1, Number(params.get("n") ?? "5"));
const tools = params.get("tools") === "1";
const side = params.get("side") === "receiver" ? "receiver" : "sender";
const state = (params.get("state") ?? "done") as "running" | "done" | "stopped";

const NAMES = [
  "Wren", "Marlin", "Harbor", "Quill", "Beacon", "Ledger", "Cobalt", "Juniper", "Fable", "Atlas",
  "Sable", "Tundra", "Comet", "Pebble", "Saffron", "Osprey", "Pilot",
];
const COLORS = ["violet", "blue", "orange", "green", "pink", "yellow"] as const;
const at = Date.UTC(2026, 10, 9, 14, 0);
const self = side === "sender"
  ? { id: "scout", name: "Scout", color: "green" } as const
  : { id: "r0", name: "Wren", color: "violet" } as const;
const asker = { id: "scout", name: "Scout", color: "green" } as const;
const teammates = Array.from({ length: count }, (_, i) => ({
  id: `r${i}`,
  name: NAMES[i % NAMES.length]! + (i >= NAMES.length ? ` ${i}` : ""),
  color: COLORS[i % COLORS.length]!,
}));
const brief = fr
  ? "Note de Scout : relis la liste des billets ouverts du client et dis-moi lesquels sont en double, avec le billet maître de chacun."
  : "Note from Scout: go through the client's open tickets and tell me which ones are duplicates, with the master ticket of each.";
const answer = fr ? "Trois doublons : 1042, 1047 et 1051, tous liés au 1040." : "Three duplicates: 1042, 1047 and 1051, all tied to 1040.";

const line = (id: string, role: Message["role"], text: string, second: number, extra: Partial<Message> = {}): Message =>
  ({ id, role, kind: "text", text, at: at + second * 1000, ...extra }) as Message;

function senderMessages(): Message[] {
  const who = fr ? `${count} collègues` : `${count} teammates`;
  const receipts = teammates.map((r, i) => ({
    id: `s${i}`, role: "bot", kind: "activity", at: at + (3 + i) * 1000,
    from: { botId: self.id, name: self.name, color: self.color },
    tool: { name: `Sent to ${r.name}`, ok: true, input: brief, handoffId: `h${i}` },
    threadRef: { botId: r.id, threadId: `${r.id}-w`, title: fr ? "Doublons" : "Duplicates" },
  }) as unknown as Message);
  const results = state === "running" ? [] : teammates.map((r, i) => {
    const stopped = state === "stopped" && i === 1;
    return {
      id: `a${i}`, role: "bot", kind: "activity", at: at + (30 + i) * 1000,
      roomRequest: { id: `h${i}`, phase: "result" },
      from: { botId: r.id, name: r.name, color: r.color },
      tool: stopped ? { name: `${r.name} — stopped: the request was stopped`, ok: false } : { name: `${r.name} replied`, ok: true, output: answer },
      threadRef: { botId: r.id, threadId: `${r.id}-w`, title: fr ? "Doublons" : "Duplicates" },
    } as unknown as Message;
  });
  const run = {
    id: "run1", role: "bot", kind: "routine.run", at: at + 50_000, text: "",
    routineRun: {
      runId: "run-1", routineId: "rt-1", routineName: fr ? "Tri du matin" : "Morning triage",
      status: state === "running" ? "running" : "completed", startedAt: at + 45_000,
      summary: state === "running" ? undefined : (fr ? "Tri fait." : "Triage done."),
      handedTo: teammates.slice(0, Math.min(count, 3)).map((r, i) => ({
        botId: r.id, threadId: `${r.id}-run`, name: r.name, task: brief,
        status: state === "running" ? "running" : state === "stopped" && i === 1 ? "stopped" : "completed",
        startedAt: at + 46_000, ...(state === "running" ? {} : { finishedAt: at + 55_000 }),
      })),
    },
  } as unknown as Message;
  return [
    line("u1", "user", fr ? `Demande à ${who} de trouver les doublons.` : `Ask ${who} to find the duplicates.`, 0),
    line("b1", "bot", fr ? `Je demande à ${who}.` : `Asking ${who} now.`, 2),
    ...receipts,
    ...results,
    line("b2", "bot", state === "running" ? (fr ? "J'attends leurs réponses." : "Waiting on their answers.") : (fr ? "Voici ce qu'ils ont trouvé." : "Here is what they found."), 40),
    run,
  ];
}

function receiverMessages(): Message[] {
  const ref = { botId: self.id, threadId: "r0-w", title: fr ? "Doublons" : "Duplicates" };
  return [
    line("u1", "user", fr ? "Salut Wren." : "Hi Wren.", 0),
    line("b1", "bot", fr ? "Salut!" : "Hi!", 2),
    { id: "in1", role: "bot", kind: "activity", at: at + 5000, from: { botId: asker.id, name: asker.name, color: asker.color }, tool: { name: `Asked by ${asker.name}`, ok: true, input: brief, handoffId: "h0" }, threadRef: ref } as unknown as Message,
    ...(state === "running" ? [] : [{ id: "in1r", role: "bot", kind: "activity", at: at + 20_000, roomRequest: { id: "h0", phase: "result" }, from: { botId: self.id, name: self.name, color: self.color }, tool: { name: `${self.name} replied`, ok: true, output: answer }, threadRef: ref } as unknown as Message]),
    line("m1", "bot", answer, 21, { relayVia: "teammate", relayOf: "x1", relayAsk: { text: brief, by: asker.name, botId: asker.id } } as Partial<Message>),
    line("m2", "bot", "This request was stopped before an answer.", 30, { relayVia: "teammate", relayOf: "x2", relayTrace: "stopped" } as Partial<Message>),
    line("m3", "bot", "This request was stopped before an answer.", 31, { relayVia: "teammate", relayOf: "x3", relayTrace: "stopped", relayAsk: { text: brief, by: asker.name, botId: asker.id } } as Partial<Message>),
  ];
}

const messages = side === "sender" ? senderMessages() : receiverMessages();
// one branch: each line answers the one above it
messages.forEach((message, i) => { if (i > 0) message.parentId = messages[i - 1]!.id; });
const others = side === "sender" ? teammates : [asker, ...teammates.slice(1)];
const owner: Bot = {
  id: self.id, threadId: `${self.id}-thread`, name: self.name, title: "", description: "", color: self.color,
  notifications: true, unread: false, busy: state === "running", messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "gallery", model: "m" },
} as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  config: { features: { showToolCalls: tools } } as AppState["config"],
  selectedId: self.id,
  bots: [owner, ...others.filter((r) => r.id !== self.id).map((r) => ({
    id: r.id, threadId: `${r.id}-t`, name: r.name, title: "", description: "", color: r.color,
    notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "gallery", model: "m" },
  }) as unknown as Bot)],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const thread = /^\/api\/threads\/(r\d+)-(?:w|run)\/messages$/.exec(url.pathname);
  if (thread) {
    const r = [...teammates, asker].find((entry) => entry.id === thread[1]) ?? teammates[0]!;
    return reply({ messages: [
      { id: `${r.id}-1`, role: "user", kind: "text", text: brief, at: at + 3000 },
      ...(state === "running" ? [] : [{ id: `${r.id}-2`, role: "bot", kind: "text", text: answer, at: at + 9000 }]),
    ], hasMore: false });
  }
  if (url.pathname.startsWith("/api/")) return reply({});
  return realFetch(input, init);
};

function galleryReducer(current: AppState, action: Action): AppState {
  try {
    return reducer(current, action);
  } catch {
    return current;
  }
}

function Gallery() {
  const [current, apply] = useReducer(galleryReducer, start);
  const dispatch = useCallback((action: Action) => apply(action), []);
  const value = useMemo(() => ({ state: current, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [current, dispatch]);
  const bot = current.bots.find((entry) => entry.id === self.id)!;
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-ask-line="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
