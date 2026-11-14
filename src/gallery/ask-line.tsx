/** The real ChatView on a synthetic store, for captures of the bot-to-bot
 * traces of a turn (scripts/capture/ask-line.mjs): a bot that asks several
 * teammates (the hand-off receipts and their answers), a routine run that
 * handed work to teammates, and the receiving side (a request from a bot,
 * a reply copied into the teammate's chat, a request stopped before an
 * answer). No server. Every name and text is synthetic. Not shipped.
 * ?skin=<id>&lang=en|fr&side=sender|receiver|all|cards&n=<teammates>
 * &state=running|done|stopped&tools=1 (Tool calls shown)
 * side=outcome (#4238): what a teammate's requests left for the person;
 * &before=1: the same chat as it was before (no outcome, line or card).
 *
 * #3581: side=all is one chat with every trace between bots and every
 * background task in order (Asked; Asked by 1, 3 and 15 names, and 5
 * requests; Messaged; You wrote to; a teammate's and an AI client's stored
 * copies; one and five running tasks; five answers of tasks the bot opened;
 * an answer to the person's request; a coding job). side=cards holds a
 * question, a choice (an approval-style one, one the bot asks and a
 * proactive one) and an approval card, for their one width. */
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
const sideParam = params.get("side");
const side = sideParam === "receiver" || sideParam === "all" || sideParam === "cards" || sideParam === "outcome" ? sideParam : "sender";
const state = (params.get("state") ?? "done") as "running" | "done" | "stopped";
const before = params.get("before") === "1";

const NAMES = [
  "Wren", "Marlin", "Harbor", "Quill", "Beacon", "Ledger", "Cobalt", "Juniper", "Fable", "Atlas",
  "Sable", "Tundra", "Comet", "Pebble", "Saffron", "Osprey", "Pilot",
];
// side=all draws 15 askers: at least that many bots
const roster = side === "all" ? Math.max(count, 16) : count;
const COLORS = ["violet", "blue", "orange", "green", "pink", "yellow"] as const;
const at = Date.UTC(2026, 10, 9, 14, 0);
const receives = side === "receiver" || side === "outcome";
const self = !receives
  ? { id: "scout", name: "Scout", color: "green" } as const
  : { id: "r0", name: "Wren", color: "violet" } as const;
const asker = { id: "scout", name: "Scout", color: "green" } as const;
const teammates = Array.from({ length: roster }, (_, i) => ({
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

/** #4238: the person's chat with their bot after a teammate's three
 * requests: the "Asked by" line (each request's outcome behind it), the one
 * line of what the last one left for the person, and its keyed cards. */
function outcomeMessages(): Message[] {
  const ref = { botId: self.id, threadId: "r0-w", title: fr ? "Revue de la journée" : "Day review" };
  const from = { botId: asker.id, name: asker.name };
  const asks = [
    { key: "slot-0900", kind: "ask" as const, text: fr ? "Deux plages réservées à 9 h : laquelle garder, la visite client ou la revue ?" : "Two slots booked at 9:00: which one stays, the client visit or the review?" },
    { key: "access:service-notes", kind: "fix" as const, text: fr ? "Corps des billets refusés : accorde la permission de lire les notes de service." : "Ticket bodies refused: grant the permission to read service notes." },
    { key: "offline", kind: "tell" as const, text: fr ? "Deux ordinateurs étaient hors ligne ce matin." : "Two computers were offline this morning." },
  ];
  const outcome = (kind: "nothing" | "told" | "asked", items: typeof asks, second: number) => ({ kind, items, threadId: "r0-w", from, at: at + second * 1000 });
  const incoming = (id: string, second: number, peerOutcome: ReturnType<typeof outcome>): Message => ({
    id, role: "bot", kind: "activity", at: at + second * 1000,
    from: { botId: asker.id, name: asker.name, color: asker.color },
    tool: { name: `Asked by ${asker.name}`, ok: true, input: brief, handoffId: id },
    threadRef: ref, peerOutcome,
  }) as unknown as Message;
  const card = (id: string, second: number, item: (typeof asks)[number], options: string[]): Message => ({
    id, role: "bot", kind: "options", at: at + second * 1000,
    card: { title: "", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question", askKey: item.key, noHold: true, questionRequest: { version: 1, questions: [{ question: item.text, options: options.map((label) => ({ label })) }] } },
  }) as unknown as Message;
  // the same chat before #4238: the three requests' "Asked by" line alone
  if (before) {
    return [
      line("u1", "user", fr ? "Salut Wren." : "Hi Wren.", 0),
      line("b1", "bot", fr ? "Salut!" : "Hi!", 2),
      ...(["in1", "in2", "in3"] as const).map((id, index) => {
        const { peerOutcome: _none, ...row } = incoming(id, [5, 12, 20][index]!, outcome("nothing", [], 0)) as Message & { peerOutcome?: unknown };
        return row as Message;
      }),
    ];
  }
  return [
    line("u1", "user", fr ? "Salut Wren." : "Hi Wren.", 0),
    line("b1", "bot", fr ? "Salut!" : "Hi!", 2),
    incoming("in1", 5, outcome("nothing", [], 9)),
    incoming("in2", 12, outcome("told", [asks[2]!], 15)),
    incoming("in3", 20, outcome("asked", asks, 26)),
    line("o1", "bot", "Scout: 2 things need you, 1 thing to know", 27, { peerOutcome: { ...outcome("asked", asks, 27), line: true }, threadRef: ref } as Partial<Message>),
    card("c1", 28, asks[0]!, fr ? ["La visite client", "La revue"] : ["Client visit", "Review"]),
    card("c2", 29, asks[1]!, fr ? ["C'est accordé", "Pas pour moi"] : ["Granted", "Not for me"]),
  ];
}

/** #3581: one chat with every trace between bots and every background task. */
function allMessages(): Message[] {
  let second = 0;
  const next = () => (second += 2);
  const incoming = (id: string, from: { id: string; name: string; color: string }, i: number): Message => ({
    id, role: "bot", kind: "activity", at: at + next() * 1000,
    from: { botId: from.id, name: from.name, color: from.color },
    tool: { name: `Asked by ${from.name}`, ok: true, input: brief, handoffId: id },
    threadRef: { botId: self.id, threadId: `${from.id}-in${i}`, title: fr ? "Doublons" : "Duplicates" },
  }) as unknown as Message;
  const say = (id: string, en: string, frText: string) => line(id, "bot", fr ? frText : en, next());
  const task = (id: string, title: string, state: "running" | "done", startedAgo: number): Message => ({
    id, role: "bot", kind: "activity", at: at + next() * 1000, tool: { name: `Parallel task #${title}`, ok: true },
    threadRef: { botId: self.id, threadId: `${id}-t`, title },
    parallelTask: { threadId: `${id}-t`, title, requestMessageId: id, role: "card", state, startedAt: Date.now() - startedAgo },
  }) as unknown as Message;
  const taskAnswer = (id: string, title: string, text: string, replyToId?: string): Message => ({
    id, role: "bot", kind: "text", at: at + next() * 1000, text,
    ...(replyToId ? { replyToId } : {}),
    parallelTask: { threadId: `${id}-t`, title, requestMessageId: replyToId ?? id, role: "result", state: "done" },
  }) as unknown as Message;
  const titles = fr
    ? ["Revue de la PR 3552", "Revue de la PR 3553", "Tri des courriels", "Relance des factures", "Vérif des sauvegardes"]
    : ["Review of pull request 3552", "Review of pull request 3553", "Mail triage", "Invoice follow-up", "Backup check"];
  const answers = fr
    ? ["Deux constats, les deux corrigés sur la branche. Le premier était une validation manquante dans le parseur.", "Rien à changer. Le code suit déjà la règle.", "Quatre courriels triés, un attend ta réponse. Les autres sont classés.", "Trois relances envoyées. Deux clients ont déjà payé.", "Les 12 sauvegardes ont réussi. Rien d'autre à signaler."]
    : ["Two findings, both fixed on the branch. The first was a missing check in the parser.", "Nothing to change. The code already follows the rule.", "Four messages sorted, one waits for your answer. The others are filed.", "Three reminders sent. Two clients have already paid.", "All 12 backups completed. Nothing else to report."];
  const rows: Message[] = [
    line("u1", "user", fr ? "Demande à Wren et Marlin de trouver les doublons." : "Ask Wren and Marlin to find the duplicates.", next()),
    ...teammates.slice(0, 2).map((r, i) => ({
      id: `s${i}`, role: "bot", kind: "activity", at: at + next() * 1000,
      from: { botId: self.id, name: self.name, color: self.color },
      tool: { name: `Sent to ${r.name}`, ok: true, input: brief, handoffId: `h${i}` },
      threadRef: { botId: r.id, threadId: `${r.id}-w`, title: fr ? "Doublons" : "Duplicates" },
    }) as unknown as Message),
    ...teammates.slice(0, 2).map((r, i) => ({
      id: `a${i}`, role: "bot", kind: "activity", at: at + next() * 1000, roomRequest: { id: `h${i}`, phase: "result" },
      from: { botId: r.id, name: r.name, color: r.color }, tool: { name: `${r.name} replied`, ok: true, output: answer },
      threadRef: { botId: r.id, threadId: `${r.id}-w`, title: fr ? "Doublons" : "Duplicates" },
    }) as unknown as Message),
    say("b1", "Here is what they found.", "Voici ce qu'ils ont trouvé."),
    incoming("one", teammates[2]!, 0),
    say("b2", "Done for Harbor.", "Fait pour Harbor."),
    ...teammates.slice(2, 5).map((r, i) => incoming(`three${i}`, r, i)),
    say("b3", "Three requests answered.", "Trois demandes traitées."),
    ...teammates.slice(1, 16).map((r, i) => incoming(`fifteen${i}`, r, i)),
    say("b4", "All fifteen answered.", "Les quinze ont leur réponse."),
    ...[0, 1, 2, 3, 4].map((i) => incoming(`five${i}`, teammates[3]!, i)),
    say("b5", "Quill's five requests are done.", "Les cinq demandes de Quill sont faites."),
    ...teammates.slice(5, 7).map((r, i) => ({
      id: `send${i}`, role: "bot", kind: "activity", at: at + next() * 1000,
      tool: { name: `Sent to ${r.name}`, ok: true, input: brief },
      threadRef: { botId: r.id, threadId: `${r.id}-send`, title: r.name },
      sendReceipt: { id: `d${i}`, senderId: self.id, botId: r.id, threadId: `${r.id}-send`, state: "done", summary: answer },
    }) as unknown as Message),
    { ...line("note", "user", brief, next()), teamNote: { botId: teammates[7]!.id, botName: teammates[7]!.name, threadId: `${teammates[7]!.id}-step`, text: brief, at, lastAt: at, count: 1 } } as Message,
    say("b6", "Noted.", "C'est noté."),
    line("copy1", "bot", answer, next(), { relayVia: "teammate", relayOf: "x1", relayAsk: { text: brief, by: teammates[1]!.name, botId: teammates[1]!.id } } as Partial<Message>),
    line("copy2", "bot", answer, next(), { relayVia: "mcp", relayOf: "x2", relayAsk: { text: brief, by: fr ? "Client IA" : "AI client" } } as Partial<Message>),
    say("b7", "Back to you.", "Je reviens à toi."),
    task("t1", titles[2]!, "running", 70_000),
    say("b8", "Working on the next one.", "Je passe à la suivante."),
    ...titles.map((title, i) => task(`run${i}`, title, "running", (i + 1) * 40_000)),
    ...titles.map((title, i) => task(`end${i}`, title, "done", 0)),
    ...titles.map((title, i) => taskAnswer(`ans${i}`, title, answers[i]!)),
    line("u2", "user", fr ? "Rédige le courriel de renouvellement." : "Draft the renewal email.", next()),
    taskAnswer("ansP", fr ? "Courriel de renouvellement" : "Renewal email", fr ? "Voici le brouillon : bonjour, ton contrat arrive à échéance le 30 novembre, on le renouvelle aux mêmes conditions." : "Here is the draft: hello, your contract ends on November 30, and we renew it on the same terms.", "u2"),
    task("code", fr ? "Corriger l'ordre des colonnes" : "Fix the column order", "running", 6 * 60_000),
  ];
  return rows;
}

/** #3581: a question, a choice and an approval card in one chat. */
function cardMessages(): Message[] {
  return [
    line("u1", "user", fr ? "Prépare le changement." : "Get the change ready.", 0),
    { id: "q", role: "bot", kind: "options", at: at + 2000, card: { title: "", subtitle: "", options: [], requestId: "req-q", requestType: "question", questionRequest: { version: 1, questions: [{ question: fr ? "Je mets en pause mes deux webhooks ?" : "Do I pause my two webhooks?", options: [{ label: fr ? "Oui, mets-les en pause" : "Yes, pause them" }, { label: fr ? "Non, garde-les actifs" : "No, keep them on" }] }] } } } as unknown as Message,
    { id: "c", role: "bot", kind: "options", at: at + 3000, card: { title: fr ? "Je ferme les 3 billets en double ?" : "Do I close the 3 duplicate tickets?", subtitle: "", options: fr ? ["Oui", "Non"] : ["Yes", "No"], requestId: "req-c", tool: "ask_choice" } } as unknown as Message,
    // a choice the bot asks (no tool behind it) and a proactive choice: both open cards
    { id: "o", role: "bot", kind: "options", at: at + 3500, card: { title: fr ? "Quelle branche je prends pour le correctif ?" : "Which branch do I take for the fix?", subtitle: "", options: ["main", "release"], requestId: "req-o" } } as unknown as Message,
    { id: "pc", role: "bot", kind: "options", at: at + 3700, card: { title: fr ? "Je surveille la répartition pour toi ?" : "Shall I watch the dispatch for you?", subtitle: fr ? "Je t'écris seulement quand ça compte." : "I write only when it matters.", options: fr ? ["Oui", "Non"] : ["Yes", "No"], proactiveProposal: { id: "pp-choice" }, proactiveChoice: { domain: "dispatch", label: fr ? "Répartition" : "Dispatch", botName: "Atlas", watches: [{ id: "unassigned", label: fr ? "Billets sans technicien assigné" : "Tickets with no technician assigned", cadence: fr ? "toutes les heures" : "every hour", on: true, tools: [] }] } } } as unknown as Message,
    { id: "p", role: "bot", kind: "options", at: at + 4000, card: { title: fr ? "Exécuter la commande ?" : "Run the command?", subtitle: "pnpm vitest run src/board", options: fr ? ["Permettre", "Refuser"] : ["Allow", "Deny"], requestId: "req-p", tool: "Bash" } } as unknown as Message,
  ];
}

const messages = side === "sender" ? senderMessages() : side === "all" ? allMessages() : side === "cards" ? cardMessages() : side === "outcome" ? outcomeMessages() : receiverMessages();
// one branch: each line answers the one above it
messages.forEach((message, i) => { if (i > 0) message.parentId = messages[i - 1]!.id; });
const others = receives ? [asker, ...teammates.slice(1)] : teammates;
const owner: Bot = {
  id: self.id, threadId: `${self.id}-thread`, name: self.name, title: "", description: "", color: self.color,
  notifications: true, unread: false, busy: state === "running", messages, activeLeafId: messages.at(-1)?.id,
  // side=all: the running background tasks are live
  ...(side === "all" ? { tasks: messages.filter((m) => m.parallelTask?.role === "card" && m.parallelTask.state === "running").map((m) => ({ threadId: m.parallelTask!.threadId, title: m.parallelTask!.title, busy: true, activity: "working", turnStartedAt: m.parallelTask!.startedAt })) } : {}),
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
  // side=all: the coding job's activity entry
  if (url.pathname.endsWith("/activity/item") && url.searchParams.toString().includes("code-t")) {
    return reply({ item: {
      id: "thread:code-t", kind: "session", botId: self.id, botName: self.name, title: fr ? "Corriger l'ordre des colonnes" : "Fix the column order",
      status: "running", startedAt: Date.now() - 6 * 60_000, updatedAt: Date.now(), threadId: "code-t", coding: true,
      currentStep: fr ? "Exécute les tests du tableau" : "Running the board tests",
      code: { folder: "/srv/repos/board", branch: "fix/column-order", repo: "example/board", pullRequests: [], branches: [{ name: "fix/column-order", repo: "example/board", pushed: false, at: Date.now() }], commits: [] },
      steps: [], files: [], children: [], stepsTruncated: false,
    } });
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
