/** Isolated gallery for a bot's question drawn on its card (M-20261119-045).
 * Not shipped in the app. ?lang=<code>&skin=<id>
 * The owner's capture: a bot's long question with bold headings, bullets and
 * several record links, raw on the card while the same words in a chat bubble
 * were drawn. One scene, three columns: the chat bubble (the conforming
 * neighbour), the chat with its history line and the card pinned over the
 * composer, then the card in the conversation and a flat card. Invented
 * words, an invented bot. */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { WaitingHistoryLine } from "../components/ChatView.tsx-parts/chips";
import { ComposerPendingStrip } from "../components/Composer.tsx-parts/ComposerPendingStrip";
import { usePinnedWaiting } from "../components/Composer.tsx-parts/PinnedWaitingCard";
import { OptionCard } from "../components/OptionCard";
import { QuestionCard } from "../components/QuestionCard";
import type { ServedWaitingItem } from "../../shared/waiting-items";
import { cn } from "../lib/cn";
import { CHAT_BUBBLE_TEXT_CLASS } from "../lib/chat-bubble-width";
import { loadLocale, t } from "../lib/i18n";
import { seedPersonProducts } from "../lib/person-products";
import { parsePersonProduct } from "../../shared/person-products";
import { nimbusProductRaw } from "../lib/record-card-fixtures";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);

// the service desk product the links name, with an invented mark
seedPersonProducts([parsePersonProduct({ ...nimbusProductRaw(), id: "cw_psa_service" })!]);

declare global {
  interface Window { __decisions: unknown[] }
}
window.__decisions = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/")) return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const link = (id: number) => `[#${id}](sagax://record/cw_psa_service/ticket/${id})`;
const ASK = [
  "J'ai relu le billet avec la cliente au téléphone.",
  "",
  "**Ce qu'elle confirme**",
  `- L'imprimante du 2e étage est revenue après le pilote : ${link(300478)}`,
  `- Le poste de la réception redémarre seul la nuit : ${link(300481)}`,
  "",
  "**Autre erreur qu'elle a trouvée**",
  `- Le partage réseau refuse son accès depuis lundi : ${link(300490)}`,
  "",
  "**À toi de décider**",
  "Je ferme les deux premiers et j'ouvre un suivi pour le partage ?",
].join("\n");

const bot = { id: "bot-orla", name: "Orla", title: "Répartition", color: "violet", threadId: "thread-main", messages: [], tasks: [] } as unknown as Bot;
const store = {
  state: { bots: [bot], instances: [], groups: [], routines: [], config: { viewer: { principalId: "p-ana" } } },
  dispatch: (action: unknown) => { window.__decisions.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

const OPTIONS = [
  { label: "Fermer les deux, ouvrir un suivi", description: `Ferme **les deux** billets réglés, dont ${link(300478)}` },
  { label: "Attendre sa confirmation écrite" },
];
const asked = (id: string, extra: Record<string, unknown> = {}) => ({
  id, role: "bot", kind: "options", at: 10, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
  card: {
    title: "Ton bot a une question", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question",
    questionRequest: { version: 1, questions: [{ question: ASK, options: OPTIONS }] }, ...extra,
  },
}) as unknown as Message;
const pinnedAsk = asked("pin");
const threadAsk = asked("thread");
const flatAsk = {
  id: "flat", role: "bot", kind: "options", at: 10, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
  card: { title: "Ton bot a une question", subtitle: ASK, options: ["Fermer les deux", "Attendre"], requestId: "req-flat", requestType: "question" },
} as unknown as Message;

function Column({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section data-gallery-column={label} className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
      {children}
    </section>
  );
}

function Gallery() {
  const items: ServedWaitingItem[] = [{
    id: "req-pin", kind: "question", botId: bot.id, botName: bot.name, threadId: "thread-main", messageId: pinnedAsk.id, at: pinnedAsk.at, ageMs: 0,
    title: "", text: "", options: [], answerWith: "option", freeText: true, skippable: true, message: pinnedAsk,
  }];
  const pinned = usePinnedWaiting(items, "thread-main", [], []);
  return (
    <div data-shot="scene" className="grid grid-cols-[360px_520px_400px] gap-6 bg-canvas p-6 text-ink" style={{ width: 1376 }}>
      <Column label="Bulle du chat (référence)">
        <div data-chat-bubble className={cn(CHAT_BUBBLE_TEXT_CLASS, "w-fit max-w-full rounded-[18px] bg-bubble-bot px-3 py-[7px] text-ink")}>
          <ChatMarkdown text={ASK} botId={bot.id} draftId={`bot:${bot.id}:thread-main`} />
        </div>
      </Column>
      <Column label="Chat : ligne d'historique et carte épinglée">
        <div className="flex min-h-[640px] flex-col justify-between rounded-2xl border border-hairline bg-app">
          <div className="px-4 pt-4"><WaitingHistoryLine text={pinnedAsk.card?.title} /></div>
          <div data-composer-dock="" className="px-4 pb-4">
            <ComposerPendingStrip bot={bot} pinned={pinned} threadId="thread-main" storeBots={[bot]} approvalBotFor={() => bot} onCancelTurn={() => {}} />
            <div className="rounded-2xl border border-hairline bg-card px-4 py-3 text-[14px] text-ink-secondary">{t("composer.placeholder.question")}</div>
          </div>
        </div>
      </Column>
      <Column label="Carte dans le fil, carte simple">
        <div data-thread-card=""><QuestionCard threadId="thread-main" bot={bot} message={threadAsk} /></div>
        <div data-flat-card=""><OptionCard botId={bot.id} threadId="thread-main" message={flatAsk} /></div>
      </Column>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BotEditorStore value={store}><Gallery /></BotEditorStore></StrictMode>,
);
