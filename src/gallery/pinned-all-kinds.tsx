/** Isolated gallery for headless screenshots of the card pinned over the
 * composer with every kind of item and every topic (#3438). Not shipped in
 * the app. ?lang=<code>&skin=<id>&case=one|two&width=1440|390
 * one: a question from work another bot handed over, as the conversation
 * receives it (the hand-off's card and the parked work's input request).
 * two: the same, plus a choice question asked two days earlier in the
 * previous topic of the one conversation.
 * approval: the same, plus an approval asked two days earlier in the
 * previous topic, decided from the pinned card in that topic.
 * offer (#3512): only the offer card « Garder le brief du jour ? » the bot
 * posted on its own, two days earlier, in the previous topic.
 * unknown (#3543): the same as one, plus an item of a kind this app does
 * not know, in a conversation it has not loaded: its text, and its
 * conversation opens. The pinned row draws the server's items
 * (GET /api/approvals?waiting=1), built here as the server serves them.
 * Every action is recorded in window.__decisions. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComposerPendingStrip } from "../components/Composer.tsx-parts/ComposerPendingStrip";
import { usePinnedWaiting } from "../components/Composer.tsx-parts/PinnedWaitingCard";
import { AttentionCard } from "../components/AttentionCard";
import { ApprovalCard } from "../components/ApprovalCard";
import { InputRequestCard } from "../components/InputRequestCard";
import { QuestionCard } from "../components/QuestionCard";
import { TopicDivider } from "../components/ChatView.tsx-parts/stream";
import { CHAT_BUBBLE_WIDTH_CLASS } from "../lib/chat-bubble-width";
import { loadLocale, t } from "../lib/i18n";
import * as pending from "../lib/pending-question";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import type { ServedWaitingItem } from "../../shared/waiting-items";
import { OptionCard } from "../components/OptionCard";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const which = params.get("case") ?? "one";
const width = Number(params.get("width") ?? 1440);

declare global {
  interface Window { __decisions: unknown[] }
}
window.__decisions = [];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/")) {
    window.__decisions.push({ url, body: init?.body });
    return json({});
  }
  return realFetch(input, init);
};

const DAY = 86_400_000;
const now = Date.now();
const fr = lang === "fr";
const bot = { id: "bot-orla", name: "Orla", color: "violet", threadId: "thread-main", messages: [], tasks: [] } as unknown as Bot;
const store = {
  state: { bots: [bot], instances: [], groups: [], routines: [] },
  dispatch: (action: unknown) => { window.__decisions.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

const QUESTION = fr ? "Quel site je migre en premier : le siège ou l'entrepôt ?" : "Which site do I migrate first: the head office or the warehouse?";
const handoff = {
  id: "attention-1", role: "bot", kind: "text", at: now - 40 * 60_000, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
  attention: { kind: "question", botId: bot.id, botName: bot.name, threadId: "work-1", sourceMessageId: "src-1", openedBy: { botId: "bot-kiro", name: "Kiro" }, items: [{ text: QUESTION }] },
} as unknown as Message;
const inputRequest = {
  id: "input-1", role: "bot", kind: "activity", at: now - 39 * 60_000, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
  tool: { name: `Orla needs your input: ${QUESTION}`, ok: true },
  inputRequest: { botId: bot.id, threadId: "work-1", botName: bot.name, title: fr ? "Travail d'équipe" : "Teammate work", question: QUESTION },
} as unknown as Message;
const oldChoice = {
  id: "old-q", role: "bot", kind: "options", at: now - 2 * DAY, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
  card: {
    title: "", subtitle: "", options: [], requestId: "req-old-q", requestType: "question",
    questionRequest: { version: 1, questions: [{ question: fr ? "Je garde les deux copies de sauvegarde ?" : "Do I keep both backup copies?", options: (fr ? ["Oui, garde les deux", "Non, juste la plus récente"] : ["Yes, keep both", "No, only the newest"]).map((label) => ({ label })) }] },
  },
} as unknown as Message;

const oldApproval = {
  id: "old-ap", role: "bot", kind: "options", at: now - 2 * DAY, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
  card: {
    title: fr ? "Approbation requise" : "Approval needed", subtitle: "ls -la ~/backups", toolInput: JSON.stringify({ command: "ls -la ~/backups" }),
    options: ["Allow", "Deny"], requestId: "req-old-ap", tool: "Bash", allowSession: true,
  },
} as unknown as Message;

const briefOffer = {
  id: "old-offer", role: "bot", kind: "options", at: now - 2 * DAY, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
  card: fr
    ? { title: "Garder le brief du jour ?", subtitle: "Le brief du jour était actif par défaut, sans que tu l'aies choisi : je l'ai arrêté. Si tu dis oui, je te l'envoie chaque jour à 8 h 00, comme une de mes routines, que tu peux mettre en pause, modifier ou supprimer.", options: ["Oui", "Pas maintenant"], proactiveProposal: { id: "proposal-brief" } }
    : { title: "Keep today's brief?", subtitle: "Today's brief was on by default, without you choosing it: I stopped it. If you say yes, I send it to you every day at 08:00, as one of my routines, which you can pause, edit or delete.", options: ["Yes", "Not now"], proactiveProposal: { id: "proposal-brief" } },
} as unknown as Message;

const current = which === "offer" ? [] : [handoff, inputRequest];
const earlier = which === "two" ? [oldChoice] : which === "approval" ? [oldApproval] : which === "offer" ? [briefOffer] : [];
const hidden = pending.inputRequestsDrawnElsewhere(current);

/** One item as the server serves it, with its message. */
function served(message: Message, threadId: string): ServedWaitingItem {
  const words = message.attention?.items[0]?.text ?? message.card?.questionRequest?.questions[0]?.question ?? message.card?.title ?? "";
  const kind: ServedWaitingItem["kind"] = message.attention ? "request" : message.card?.proactiveProposal ? "proposal" : message.card?.questionRequest ? "question" : "approval";
  const id = message.attention ? `attention:${message.id}` : message.card?.proactiveProposal ? `proactive:${message.card.proactiveProposal.id}` : message.card?.requestId ?? message.id;
  return {
    id, kind, botId: bot.id, botName: bot.name, threadId, messageId: message.id, at: message.at, ageMs: now - message.at, title: words, text: words, options: [],
    answerWith: "text", freeText: true, skippable: true, message, ...(message.card?.proactiveProposal ? { proactiveId: message.card.proactiveProposal.id } : {}),
  };
}

const unknownItem: ServedWaitingItem = {
  id: "later-kind:1", kind: "checklist" as unknown as ServedWaitingItem["kind"], botId: bot.id, botName: bot.name, threadId: "thread-elsewhere", messageId: "m-later",
  at: now - 3 * DAY, ageMs: 3 * DAY, options: [], answerWith: "text", freeText: true, skippable: true,
  title: fr ? "Signer la liste de vérification de la mise en production" : "Sign the release checklist",
  text: fr ? "Signer la liste de vérification de la mise en production\n\nIl reste trois points : les sauvegardes, le DNS et l'avis aux clients." : "Sign the release checklist\n\nThree points are left: the backups, the DNS and the customer notice.",
};

// the hand-off's card and its input request are one ask: one item
const servedItems: ServedWaitingItem[] = [
  ...earlier.map((message) => served(message, "topic-1")),
  ...current.filter((message) => !hidden.has(message.id)).map((message) => served(message, "thread-main")),
  ...(which === "unknown" ? [unknownItem] : []),
].sort((x, y) => x.at - y.at);

function Bubble({ children }: { children: string }) {
  return <div className={`rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink ${CHAT_BUBBLE_WIDTH_CLASS.fit}`}>{children}</div>;
}

function Gallery() {
  const pinned = usePinnedWaiting(servedItems, "thread-main", current);
  const narrow = width < 600;
  return (
    <div data-shot="chat" className="flex flex-col bg-canvas text-ink" style={{ width, minHeight: narrow ? 760 : 640 }}>
      <div className={`mx-auto flex w-full flex-1 flex-col justify-end gap-3 ${narrow ? "px-3 pt-4" : "max-w-[760px] px-6 pt-6"}`}>
        {earlier.length > 0 && (
          <>
            <Bubble>{fr ? "Orla : la sauvegarde de nuit a deux copies complètes." : "Orla: the nightly backup has two full copies."}</Bubble>
            {which === "approval"
              ? <div className={CHAT_BUBBLE_WIDTH_CLASS.fit}><ApprovalCard bot={bot} message={oldApproval} /></div>
              : which === "offer"
                ? <div className={CHAT_BUBBLE_WIDTH_CLASS.fit}><OptionCard botId={bot.id} threadId="topic-1" message={briefOffer} /></div>
                : <div className={CHAT_BUBBLE_WIDTH_CLASS.fit}><QuestionCard threadId="topic-1" bot={{ id: bot.id, name: bot.name }} message={oldChoice} /></div>}
            <TopicDivider task={{ threadId: "thread-main", title: fr ? "Migration" : "Migration", createdAt: now - DAY }} />
          </>
        )}
        {which === "offer" ? (
          <Bubble>{fr ? "Orla : la migration du siège est terminée." : "Orla: the head office migration is done."}</Bubble>
        ) : (
          <>
            <Bubble>{fr ? "Orla : Kiro m'a passé la migration, il reste une décision pour toi." : "Orla: Kiro handed me the migration, one decision is left for you."}</Bubble>
            <AttentionCard card={handoff.attention!} bot={bot} onReply={async () => undefined} />
            {!hidden.has(inputRequest.id) && <InputRequestCard message={inputRequest} threadId="thread-main" />}
          </>
        )}
        <div className="h-10" />
      </div>
      <div data-composer-dock className={`mx-auto w-full ${narrow ? "px-3 pb-3" : "max-w-[760px] px-6 pb-6"}`}>
        <ComposerPendingStrip bot={bot} pinned={pinned} threadId="thread-main" storeBots={[bot]} approvalBotFor={() => bot} onCancelTurn={() => window.__decisions.push({ type: "cancelTurn" })} />
        <div className="rounded-2xl border border-hairline bg-card px-4 py-3 text-[14px] text-ink-secondary">
          {t("composer.placeholder.bot", { name: bot.name })}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BotEditorStore value={store}><Gallery /></BotEditorStore></StrictMode>,
);
