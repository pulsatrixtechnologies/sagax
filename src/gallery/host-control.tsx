/** Isolated gallery for headless screenshots of web work out of sight and of
 * a bot controlling this computer's own screen (2026-10-28,
 * shared/host-control.ts). Not shipped in the app.
 * ?lang=<code>&skin=<id>&view=web|screen|wake&before=1
 * `view=wake` (QA 0.8.66 F1): a turn still waiting on a cold sandbox, the
 * row counting its seconds; `before=1` shows the old silent row.
 * `before=1` draws the same conversation as an older build showed it: no
 * banner and no line while the bot drives the screen.
 * #3296: `view=wake&live=1` is the live row (what is waited for, since when,
 * counting); `view=restart` the composer's queue while Sagax restarts
 * (`before=1`: the capacity line beside it, the conforming neighbour);
 * `view=wake&ended=1` a row left with no end whose turn is over (stopped,
 * or cut by a restart three hours ago): it reads in the past tense. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { HostControlIndicator } from "../components/HostControlIndicator";
import { StatusActivityRow } from "../components/StatusActivityRow";
import { QueuedComposerMessages } from "../components/ComposerQueuedMessages";
import { ThreadRefsContext } from "../components/ThreadRefs";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Message } from "../state/store";
import { HOST_CONTROL_NOTICE } from "../../shared/host-control";
import { SANDBOX_WAKE_NOTICE } from "../../shared/sandbox-wake";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const before = params.get("before") === "1";
const viewParam = params.get("view");
const view = viewParam === "screen" || viewParam === "wake" || viewParam === "restart" ? viewParam : "web";
const live = params.get("live") === "1";
const ended = params.get("ended") === "1";
const fr = lang === "fr";

const BOT = { id: "bot-scout", name: "Scout", threadId: "thread-1" };
const notice = { id: "n1", role: "bot", kind: "activity", at: 0, tool: { name: HOST_CONTROL_NOTICE, ok: true } } as Message;

function UserBubble({ text }: { text: string }) {
  return <div className="ml-auto w-fit max-w-[80%] rounded-2xl bg-accent px-4 py-2 text-[14px] text-white">{text}</div>;
}

const wakeAsk = { id: "w0", role: "user", kind: "text", at: Date.now() - 15_000, text: "" } as Message;
const wakeNotice = { id: "w1", role: "bot", kind: "activity", at: Date.now() - 14_000, tool: { name: SANDBOX_WAKE_NOTICE, ok: true } } as Message;
const wakeSince = Date.now() - 154_000;
const wakeLive = { id: "w2", role: "bot", kind: "activity", at: wakeSince, tool: { name: SANDBOX_WAKE_NOTICE, ok: true, sandboxWake: { waitingFor: "cluster", since: wakeSince, checkedAt: Date.now() - 4_000 } } } as Message;

const leftSince = Date.now() - 3 * 3_600_000 - 12 * 60_000;
const wakeLeftOpen = { id: "w3", role: "bot", kind: "activity", at: leftSince, tool: { name: SANDBOX_WAKE_NOTICE, ok: true, sandboxWake: { waitingFor: "cluster", since: leftSince } } } as Message;

function Conversation() {
  if (view === "restart") {
    const text = fr ? "Est-ce que les sauvegardes sont finies?" : "Are the backups done?";
    return (
      <div className="pt-6">
        <QueuedComposerMessages items={[{ queueId: "q1", text, reason: before ? "capacity" : "restart" }]} onCancel={() => {}} onEdit={() => {}} />
        <div className="relative z-[2] rounded-2xl border border-hairline/40 bg-raised px-4 py-3 text-[14px] text-ink-tertiary">{t("composer.placeholder.bot", { name: BOT.name })}</div>
      </div>
    );
  }
  if (view === "wake" && ended) {
    return (
      <>
        <UserBubble text={fr ? "Fais le ménage dans mes fichiers de test." : "Clean up my test files."} />
        <StatusActivityRow message={wakeLeftOpen} transcript={[wakeAsk, wakeLeftOpen]} busy={false} />
      </>
    );
  }
  if (view === "wake" && live) {
    return (
      <>
        <UserBubble text={fr ? "Fais le ménage dans mes fichiers de test." : "Clean up my test files."} />
        <StatusActivityRow message={wakeLive} transcript={[wakeAsk, wakeLive]} busy />
      </>
    );
  }
  if (view === "wake") {
    return (
      <>
        <UserBubble text={fr ? "Fais le ménage dans mes fichiers de test." : "Clean up my test files."} />
        <StatusActivityRow message={wakeNotice} transcript={before ? undefined : [wakeAsk, wakeNotice]} busy={!before} />
      </>
    );
  }
  if (view === "web") {
    return (
      <>
        <UserBubble text={fr ? "Montre-moi la dernière vidéo de Lumière Studio." : "Show me the latest video from Lumière Studio."} />
        <div className="text-[14px] text-ink">
          <ChatMarkdown text={fr
            ? "Voici la dernière vidéo de Lumière Studio, publiée hier :\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"
            : "Here is Lumière Studio's latest video, posted yesterday:\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ"} />
        </div>
      </>
    );
  }
  return (
    <>
      <UserBubble text={fr ? "Ouvre ça dans mon Chrome." : "Open it in my Chrome."} />
      <p className="text-[14px] text-ink">{fr ? "Je prends le contrôle de ton ordinateur pour l'ouvrir dans Chrome." : "I'm taking control of your computer to open this in Chrome."}</p>
      {!before && <StatusActivityRow message={notice} />}
    </>
  );
}

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div data-shot="host-control" className="mx-auto flex max-w-[760px] flex-col overflow-hidden rounded-2xl bg-card">
        {view === "screen" && !before && <HostControlIndicator load={async () => [BOT]} stop={async () => {}} />}
        <div className="flex flex-col gap-3 px-5 py-4">
          <Conversation />
        </div>
      </div>
      <span className="sr-only">{t("hostControl.stop")}</span>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <ThreadRefsContext.Provider value={{ threads: [], currentBotId: undefined }}>
        <Gallery />
      </ThreadRefsContext.Provider>
    </StoreProvider>
  </StrictMode>,
);
