/** Isolated gallery for the pinned ask whose words are long (M-20261119-007).
 * Not shipped in the app. ?lang=<code>&skin=<id>&case=long|short
 * The chat's real structure: a pane with the transcript scroller filling it
 * and the composer dock floating over it (ChatViewShell). The pinned card
 * sits in the dock above the composer box. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComposerPendingStrip } from "../components/Composer.tsx-parts/ComposerPendingStrip";
import { usePinnedWaiting } from "../components/Composer.tsx-parts/PinnedWaitingCard";
import type { ServedWaitingItem } from "../../shared/waiting-items";
import { CHAT_BUBBLE_WIDTH_CLASS } from "../lib/chat-bubble-width";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const which = params.get("case") ?? "long";
const fr = lang === "fr";

declare global {
  interface Window { __decisions: unknown[] }
}
window.__decisions = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/auth/session")) return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const bot = { id: "bot-orla", name: "Orla", title: "Chief of Staff", color: "violet", threadId: "thread-main", messages: [], tasks: [] } as unknown as Bot;
const store = {
  state: { bots: [bot], instances: [], groups: [], routines: [], config: { viewer: { principalId: "p-ana" } } },
  dispatch: (action: unknown) => { window.__decisions.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

const report = Array.from({ length: 28 }, (_, index) => (fr
  ? `Point ${index + 1} du bilan : tâche terminée, résultat vérifié, rien à signaler.`
  : `Item ${index + 1} of the status report: task done, result checked, nothing to flag.`)).join("\n");
const flat = {
  id: "flat1", role: "bot", kind: "options", at: 10, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
  card: {
    title: fr ? "Bilan de la semaine" : "Weekly status",
    subtitle: which === "short" ? (fr ? "Je continue ?" : "Shall I continue?") : report,
    options: fr ? ["Continuer", "Arrêter ici"] : ["Continue", "Stop here"], requestId: "req-flat1", requestType: "question",
  },
} as unknown as Message;

const bubbles = Array.from({ length: 14 }, (_, index) => (fr ? `Orla : message ${index + 1} du fil, avant la question.` : `Orla: thread message ${index + 1}, before the question.`));

function Gallery() {
  const items: ServedWaitingItem[] = [{
    id: "req-flat1", kind: "question", botId: bot.id, botName: bot.name, threadId: "thread-main", messageId: flat.id, at: flat.at, ageMs: 0,
    title: "", text: "", options: [], answerWith: "option", freeText: true, skippable: true, message: flat,
  }];
  const pinned = usePinnedWaiting(items, "thread-main", [], []);
  return (
    <div data-shot="chat" className="flex flex-col bg-canvas text-ink" style={{ width: 1100, height: 720 }}>
      <div className="flex h-12 shrink-0 items-center border-b border-hairline px-4 text-[14px] font-semibold" data-chat-header="">Orla · Chief of Staff</div>
      <div className="relative min-h-0 flex-1">
        <div data-virtual-root="" className="h-full overflow-y-auto overscroll-y-contain px-4 pb-48">
          <div className="mx-auto flex max-w-[760px] flex-col gap-3 pt-4">
            {bubbles.map((text) => (
              <div key={text} className={`rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink ${CHAT_BUBBLE_WIDTH_CLASS.fit}`}>{text}</div>
            ))}
          </div>
        </div>
        <div data-composer-dock="" className="pointer-events-none absolute inset-x-0 bottom-0 z-[2]">
          <div className="pointer-events-auto mx-auto w-full max-w-[760px] px-6 pb-6">
            <ComposerPendingStrip bot={bot} pinned={pinned} threadId="thread-main" storeBots={[bot]} approvalBotFor={() => bot} onCancelTurn={() => {}} />
            <div className="rounded-2xl border border-hairline bg-card px-4 py-3 text-[14px] text-ink-secondary">{t("composer.placeholder.question")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BotEditorStore value={store}><Gallery /></BotEditorStore></StrictMode>,
);
