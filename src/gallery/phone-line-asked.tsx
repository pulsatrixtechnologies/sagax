/** The real ChatView on a synthetic store, for captures of lines that came in
 * on the person's phone line (#4112, scripts/capture/phone-line-asked.mjs):
 * in the live order (each text answered before the next): one text and its
 * answer, three from one number, four from two numbers, a text between two
 * teammate requests, a call request. `pane=teammates` draws the
 * conforming neighbour: teammate requests alone. No server. Every name,
 * number and text is synthetic (555 numbers). Not shipped.
 * ?skin=<id>&lang=en|fr&scene=one|three|two|between|call&pane=chat|teammates */
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
const say = (en: string, fren: string) => (fr ? fren : en);
const scene = (params.get("scene") ?? "three") as "one" | "three" | "two" | "between" | "call";
const pane = params.get("pane") === "teammates" ? "teammates" : "chat";

const NOW = Date.now();
const start = NOW - 900_000;
const self = { id: "reviewer", name: "Reviewer", color: "violet" } as const;
const teammate = { id: "wren", name: "Wren", color: "green" } as const;
const FIRST = "+1 555 010 0142";
const SECOND = "+1 555 010 0199";

const typed = (id: string, at: number, text: string): Message => ({ id, role: "user", kind: "text", at, text }) as Message;
const answer = (id: string, at: number, text: string): Message =>
  ({ id, role: "bot", kind: "text", at, text, turnId: id, turnTerminal: true }) as Message;
const texted = (id: string, at: number, number: string, text: string, via: "sms" | "call" = "sms"): Message =>
  ({ id, role: "user", kind: "text", at, text, via, sender: { name: number, id: "person-1" } }) as Message;
const asked = (id: string, at: number, text: string): Message => ({
  id, role: "bot", kind: "activity", at,
  from: { botId: teammate.id, name: teammate.name, color: teammate.color },
  threadRef: { botId: self.id, threadId: `work-${id}`, title: "Work" },
  tool: { name: `Asked by ${teammate.name}`, ok: true, input: text, handoffId: `h-${id}` },
}) as Message;

const earlier: Message[] = [
  typed("e-u", start - 600_000, say("Any open item on the board this morning?", "Un élément ouvert au tableau ce matin?")),
  answer("e-a", start - 598_000, say("Two items are open, none waits for you.", "Deux éléments sont ouverts, aucun ne t'attend.")),
];

// the live order: each text starts a turn of its own and is answered before
// the next one lands (server/sms-conversation.ts)
const answerTo = (line: Message, after: number, text: string): Message =>
  ({ ...answer(`${line.id}-a`, line.at + after, text), requestMessageId: line.id }) as Message;

function sceneRows(): Message[] {
  const sms1 = say("Is the printer on the second floor fixed?", "L'imprimante du 2e étage est-elle réparée?");
  const sms2 = say("Also check the VPN for the front desk.", "Vérifie aussi le VPN de l'accueil.");
  const sms3 = say("And tell me when it's done.", "Et dis-moi quand c'est fait.");
  const sms4 = say("Is the backup done?", "La sauvegarde est-elle faite?");
  const reply1 = say("Yes, the printer is fixed.", "Oui, l'imprimante est réparée.");
  const reply2 = say("The front desk VPN works again.", "Le VPN de l'accueil fonctionne de nouveau.");
  const reply3 = say("Both are done.", "Les deux sont faits.");
  const reply4 = say("Yes, last night's backup completed.", "Oui, la sauvegarde de cette nuit est terminée.");
  const exchange = (id: string, at: number, number: string, text: string, reply: string, via: "sms" | "call" = "sms") => {
    const line = texted(id, at, number, text, via);
    return [line, answerTo(line, 40_000, reply)];
  };
  if (pane === "teammates") {
    return [
      asked("t1", start, say("Check the open tickets of the front desk.", "Vérifie les billets ouverts de l'accueil.")),
      asked("t2", start + 20_000, say("Summarize the agreements.", "Résume les ententes.")),
      asked("t3", start + 40_000, say("List the duplicates.", "Liste les doublons.")),
    ];
  }
  switch (scene) {
    case "one":
      return exchange("s1", start, FIRST, sms1, reply1);
    case "three":
      return [
        ...exchange("s1", start, FIRST, sms1, reply1),
        ...exchange("s2", start + 60_000, FIRST, sms2, reply2),
        ...exchange("s3", start + 120_000, FIRST, sms3, reply3),
      ];
    case "two":
      return [
        ...exchange("s1", start, FIRST, sms1, reply1),
        ...exchange("s2", start + 60_000, SECOND, sms4, reply4),
        ...exchange("s3", start + 120_000, FIRST, sms2, reply2),
        ...exchange("s4", start + 180_000, SECOND, sms3, reply3),
      ];
    case "between":
      return [
        asked("t1", start, say("Check the open tickets of the front desk.", "Vérifie les billets ouverts de l'accueil.")),
        ...exchange("s1", start + 10_000, FIRST, sms1, reply1),
        asked("t2", start + 60_000, say("Summarize the agreements.", "Résume les ententes.")),
      ];
    case "call":
      return exchange("c1", start, FIRST, say("Read me today's agenda.", "Lis-moi l'agenda d'aujourd'hui."), say("You have two meetings today.", "Tu as deux rencontres aujourd'hui."), "call");
  }
}

const messages = [...earlier, ...sceneRows()];
messages.forEach((message, i) => { message.parentId = i > 0 ? messages[i - 1]!.id : null; });

const owner: Bot = {
  id: self.id, threadId: `${self.id}-thread`, name: self.name, title: "", description: "", color: self.color,
  notifications: true, unread: false, busy: false, messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "gallery", model: "m" },
} as Bot;
const other: Bot = {
  id: teammate.id, threadId: `${teammate.id}-thread`, name: teammate.name, title: "", description: "", color: teammate.color,
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "gallery", model: "m" },
} as Bot;
const startState: AppState = {
  ...initialState,
  connected: true,
  config: { features: { showToolCalls: false } } as AppState["config"],
  selectedId: self.id,
  bots: [owner, other],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname.startsWith("/api/")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
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
  const [current, apply] = useReducer(galleryReducer, startState);
  const dispatch = useCallback((action: Action) => apply(action), []);
  const value = useMemo(() => ({ state: current, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [current, dispatch]);
  const bot = current.bots.find((entry) => entry.id === self.id)!;
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-phone-line="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
