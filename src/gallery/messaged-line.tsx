/** The real ChatView on a synthetic store, for captures of a turn that
 * messages several bots (scripts/capture/messaged-line.mjs): the person's
 * line, the bot's line, its "Messaged" chips, the bot's reply. No server.
 * Every name and text is synthetic. Not shipped in the app.
 * ?skin=<id>&lang=en|fr&n=<recipients>&tools=1 (Tool calls shown)&fail=1
 * (the last send failed)&open=1 (opens the full list when it is folded) */
import { StrictMode, useCallback, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, reducer, type Action, type AppState, type Bot, type Group, type InstanceInfo, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
const count = Math.max(1, Number(params.get("n") ?? "2"));
const tools = params.get("tools") === "1";
const fail = params.get("fail") === "1";

const NAMES = [
  "Osprey · Service desk and mailbox operations", "test", "Ledger", "Harbor", "Quill", "Beacon", "Marlin", "Cobalt",
  "Juniper", "Fable", "Atlas", "Wren", "Sable", "Tundra", "Comet", "Pebble", "Saffron",
];
const COLORS = ["violet", "blue", "orange", "green", "pink", "yellow"] as const;
const at = Date.UTC(2026, 10, 9, 14, 0);
const self = { id: "scout", name: "Scout", color: "green" } as const;
const recipients = Array.from({ length: count }, (_, i) => ({
  id: `r${i}`,
  name: NAMES[i % NAMES.length]! + (i >= NAMES.length ? ` ${i}` : ""),
  color: COLORS[i % COLORS.length]!,
}));
const groups: Group[] = recipients.map((r) => ({
  id: `dm-${r.id}`, threadId: `dm-${r.id}-t`, name: r.name, dm: true, memberIds: [self.id, r.id],
  defaultResponder: { kind: "member", botId: r.id }, bulletin: "", unread: false, createdAt: at, messages: [],
}) as unknown as Group);

const line = (id: string, role: Message["role"], text: string, second: number, extra: Partial<Message> = {}): Message =>
  ({ id, role, kind: "text", text, at: at + second * 1000, ...extra }) as Message;
const who = recipients.length === 2 ? `${recipients[0]!.name.split(" ·")[0]} ${fr ? "et" : "and"} test` : (fr ? `${count} collègues` : `${count} teammates`);
const messages: Message[] = [
  line("u1", "user", fr ? `Dis bonjour à ${who}.` : `Say hello to ${who}.`, 0),
  line("b1", "bot", fr ? `J'envoie un bonjour à ${who} maintenant.` : `Sending a hello to ${who} now.`, 2, { requestMessageId: "u1" } as Partial<Message>),
  ...recipients.map((r, i) => ({
    id: `c${i}`, role: "bot", kind: "activity", at: at + (3 + i) * 1000,
    tool: { name: `Messaged @${r.name}`, ok: !(fail && i === recipients.length - 1) },
    comm: { groupId: `dm-${r.id}`, withBotId: r.id, withName: r.name, withColor: r.color, direction: "sent", text: fr ? "Bonjour!" : "Hello!" },
  }) as Message),
  line("b2", "bot", fr ? "C'est fait, le bonjour est parti." : "Done, the hello went out.", 40),
];
// one branch: each line answers the one above it
messages.forEach((message, i) => { if (i > 0) message.parentId = messages[i - 1]!.id; });
const scout: Bot = {
  id: self.id, threadId: "scout-thread", name: self.name, title: "", description: "", color: self.color,
  notifications: true, unread: false, busy: false, messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "gallery", model: "m" },
} as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  config: { features: { showToolCalls: tools } } as AppState["config"],
  selectedId: self.id,
  groups,
  bots: [scout, ...recipients.map((r) => ({
    id: r.id, threadId: `${r.id}-t`, name: r.name, title: "", description: "", color: r.color,
    notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "gallery", model: "m" },
  }) as unknown as Bot)],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const thread = /^\/api\/threads\/dm-(r\d+)-t\/messages$/.exec(url.pathname);
  if (thread) {
    const r = recipients.find((entry) => entry.id === thread[1])!;
    return reply({ messages: [
      { id: `${r.id}-1`, role: "bot", kind: "text", text: fr ? "Bonjour!" : "Hello!", at: at + 3000, from: { botId: self.id, name: self.name, color: self.color } },
      { id: `${r.id}-2`, role: "bot", kind: "text", text: fr ? "Salut Scout!" : "Hi Scout!", at: at + 9000, from: { botId: r.id, name: r.name, color: r.color } },
    ], hasMore: false });
  }
  if (url.pathname.startsWith("/api/")) return reply({});
  return realFetch(input, init);
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
  const bot = state.bots.find((entry) => entry.id === self.id)!;
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-messaged-line="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
