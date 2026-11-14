/** Isolated gallery for headless screenshots of Teach a task (#4208). Not
 * shipped in the app. Synthetic data only.
 * ?lang=<code>&skin=<id>&case=chooser|recording|steps|learn-before|learn-after
 * - chooser: the message bar's + > Teach a task choice;
 * - recording: the bot's browser in the screen window, recording (the bar,
 *   Stop with the elapsed time, Discard, the red frame);
 * - steps: Stop leads to the recorded steps, ready to save as a skill;
 * - computer-menu / computer-details: the bot panel's Computer section, its
 *   "..." menu with Computer details last, then that window (what the old
 *   side panel held);
 * - learn-before / learn-after: a /learn the bot cannot settle alone, before
 *   (it guessed in its reply) and after (its question pinned over the box). */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "../components/ConfirmProvider";
import { SandboxDesktopModal } from "../components/computer/SandboxDesktopModal";
import { LiveBrowserView } from "../components/BrowserPanel.tsx-parts/LiveBrowserView";
import { TeachChooserDialog, TeachStepsDialog } from "../components/TeachStepsDialog";
import { ComposerPendingStrip } from "../components/Composer.tsx-parts/ComposerPendingStrip";
import { usePinnedWaiting } from "../components/Composer.tsx-parts/PinnedWaitingCard";
import { QuestionCard } from "../components/QuestionCard";
import { ComputerCard } from "../components/bot-settings/ComputerCard";
import type { ServedWaitingItem } from "../../shared/waiting-items";
import type { TeachStep } from "../../shared/teach-recording";
import { CHAT_BUBBLE_WIDTH_CLASS } from "../lib/chat-bubble-width";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const which = params.get("case") ?? "chooser";
const fr = lang === "fr";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
window.fetch = async () => json({});

const bot = { id: "bot-orla", name: "Orla", color: "violet", threadId: "thread-main", messages: [], tasks: [], browser: true, modelSelection: { instanceId: "i", model: "m" } } as unknown as Bot;
const store = {
  state: { bots: [bot], instances: [], groups: [], routines: [], config: { features: { browser: true }, browserEngine: { kind: "engine" }, browserProfiles: [], box: { configured: true, included: true } }, computerControl: {} },
  dispatch: () => {},
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

/** A page in the bot's browser, drawn on a canvas (the stream's frame). */
function pageFrame(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 800;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#f6f7f9"; g.fillRect(0, 0, 1280, 800);
  g.fillStyle = "#1f2a44"; g.fillRect(0, 0, 1280, 72);
  g.fillStyle = "#ffffff"; g.font = "600 28px system-ui"; g.fillText(fr ? "Portail des rapports" : "Reports portal", 40, 46);
  g.fillStyle = "#ffffff"; g.fillRect(40, 120, 1200, 600);
  g.fillStyle = "#1f2a44"; g.font = "600 30px system-ui"; g.fillText(fr ? "Rapport mensuel" : "Monthly report", 80, 190);
  g.fillStyle = "#5b6475"; g.font = "22px system-ui";
  for (let row = 0; row < 6; row += 1) g.fillText(`${fr ? "Ligne" : "Row"} ${row + 1}  ·  ${(1240 + row * 115).toLocaleString()} $`, 80, 260 + row * 52);
  g.fillStyle = "#2f6fed"; g.fillRect(80, 600, 260, 64);
  g.fillStyle = "#ffffff"; g.font = "600 22px system-ui"; g.fillText(fr ? "Télécharger" : "Download", 140, 640);
  return canvas.toDataURL("image/png").split(",")[1]!;
}

const STEPS: TeachStep[] = [
  { id: "s1", kind: "open", url: "https://reports.example.com/monthly" },
  { id: "s2", kind: "click", url: "https://reports.example.com/monthly", target: { role: "link", name: fr ? "Rapport mensuel" : "Monthly report", tag: "a" } },
  { id: "s3", kind: "type", url: "https://reports.example.com/monthly", target: { role: "textbox", name: fr ? "Mois" : "Month", tag: "input" }, text: "2026-10" },
  { id: "s4", kind: "click", url: "https://reports.example.com/monthly", target: { role: "button", name: fr ? "Télécharger" : "Download", tag: "button" } },
];

function Recording() {
  const [frame] = useState(() => ({ seq: 1, data: pageFrame(), format: "png" as const, metadata: { deviceWidth: 1280, deviceHeight: 800 }, viewerId: "v", generation: 1 }));
  const ref = <T,>(value: T) => ({ current: value });
  const noop = () => {};
  const later = async () => {};
  const props = {
    bot, allowed: true, frame, tabs: [{ tabId: "1", title: fr ? "Portail des rapports" : "Reports portal", url: "https://reports.example.com/monthly", active: true }],
    address: "https://reports.example.com/monthly", setAddress: noop, connected: true, control: { held: true, controlling: true, owned: true },
    pending: false, error: "", showProfiles: false, setShowProfiles: noop, showTyping: false, setShowTyping: noop, masked: false, setMasked: noop,
    takeControl: noop, handBack: noop, viewport: { width: 1280, height: 800 }, takeStatus: "" as const, busy: false, reconnecting: false,
    showNetwork: false, setShowNetwork: noop, recording: true, recordingStartedAt: Date.now() - 42_000, taught: undefined, setTaught: noop, teachNote: "",
    addressInput: ref(null), profilesButton: ref(null), profilesPopover: ref(null), typingPopover: ref(null), typingField: ref(null), menuSummary: ref(null),
    profileName: t("browser.profile.own", { name: bot.name }), interactive: true, typingReady: true, commandsReady: true, heldElsewhere: false, taking: false, mine: true,
    pageTitle: fr ? "Portail des rapports" : "Reports portal", holder: t("sandboxDesktop.controlling"),
    pill: "flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border bg-menu px-2.5 py-1 text-[11px] shadow-sm sm:text-[12px]",
    generation: ref(1), viewer: ref("v"), browserControl: ref(null), urlEditing: ref(false),
    command: noop, input: noop, reconnect: noop, execute: later, startRecording: later, stopRecording: later, discardRecording: later,
    action: async () => ({}), confirm: async () => false, setError: noop,
  };
  return <SandboxDesktopModal kind="browser" title={t("computer.browserOf", { name: bot.name })} state="running" onClose={noop}
    screen={() => <LiveBrowserView {...(props as unknown as Parameters<typeof LiveBrowserView>[0])} />} />;
}

function Chooser() {
  const plus = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className="flex min-h-[560px] w-[760px] flex-col justify-end bg-canvas px-6 pb-6 text-ink">
      <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-card px-3 py-3 text-[14px] text-ink-secondary">
        <button ref={plus} type="button" data-composer-plus="" className="flex size-8 items-center justify-center rounded-full bg-control text-ink">+</button>
        <span>{t("composer.placeholder.bot", { name: bot.name })}</span>
      </div>
      {ready && <TeachChooserDialog botName={bot.name} anchorRef={plus} onShow={() => {}} onDescribe={() => {}} onClose={() => {}} />}
    </div>
  );
}

function ask(id: string, at: number, question: string, options: string[]): Message {
  return {
    id, role: "bot", kind: "options", at, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
    card: { title: "", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question", questionRequest: { version: 1, questions: [{ question, options: options.map((label) => ({ label })) }] } },
  } as unknown as Message;
}
const learnAsk = ask("q-learn", 10,
  fr ? "Pour le rapport mensuel, je pars de quel compte ?" : "For the monthly report, which account do I start from?",
  fr ? ["Le compte de l'équipe", "Mon compte personnel"] : ["The team account", "My personal account"]);

function Bubble({ mine, children }: { mine?: boolean; children: string }) {
  return <div className={`rounded-[18px] px-3 py-[7px] text-[13px] leading-5 text-ink ${mine ? "self-end bg-raised" : "bg-card"} ${CHAT_BUBBLE_WIDTH_CLASS.fit}`}>{children}</div>;
}

function Learn({ after }: { after: boolean }) {
  const items: ServedWaitingItem[] = after ? [{
    id: "req-q-learn", kind: "question", botId: bot.id, botName: bot.name, threadId: "thread-main", messageId: learnAsk.id, at: learnAsk.at, ageMs: 0,
    title: "", text: "", options: [], answerWith: "text", freeText: true, skippable: true, message: learnAsk,
  }] : [];
  const pinned = usePinnedWaiting(items, "thread-main", [], []);
  return (
    <div data-shot="chat" className="flex min-h-[560px] w-[760px] flex-col bg-canvas text-ink">
      <div className="mx-auto flex w-full flex-1 flex-col justify-end gap-3 px-6 pt-6">
        <Bubble mine>{fr ? "/learn comment je télécharge le rapport mensuel" : "/learn how I download the monthly report"}</Bubble>
        {after
          ? <div className={CHAT_BUBBLE_WIDTH_CLASS.fit}><QuestionCard threadId="thread-main" bot={{ id: bot.id, name: bot.name }} message={learnAsk} /></div>
          : <Bubble>{fr ? "J'ai supposé que tu utilises le compte de l'équipe et j'ai écrit la skill avec ce compte." : "I assumed you use the team account and wrote the skill with it."}</Bubble>}
        <div className="h-10" />
      </div>
      <div data-composer-dock className="mx-auto w-full px-6 pb-6">
        <ComposerPendingStrip bot={bot} pinned={pinned} threadId="thread-main" storeBots={[bot]} approvalBotFor={() => bot} onCancelTurn={() => {}} />
        <div className="rounded-2xl border border-hairline bg-card px-4 py-3 text-[14px] text-ink-secondary">
          {pinned.current?.kind === "question" ? t("composer.placeholder.question") : t("composer.placeholder.bot", { name: bot.name })}
        </div>
      </div>
    </div>
  );
}

/** The bot panel's Computer section, with its "..." menu open, then (for
 * computer-details) Computer details open from it. */
function ComputerSection({ details }: { details: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      box.current?.querySelector<HTMLButtonElement>("[data-computer-card-more]")?.click();
      if (details) window.setTimeout(() => document.querySelector<HTMLButtonElement>("[data-computer-card-details]")?.click(), 150);
    }, 150);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div ref={box} className="min-h-[560px] w-[400px] bg-panel px-4 pt-4 text-ink">
      <ComputerCard bot={{ ...bot, computer: "cloud" } as Bot} onPatch={() => {}} />
    </div>
  );
}

function Gallery() {
  return (
    <div data-gallery-sample={which} className="inline-block bg-canvas">
      {which === "chooser" && <Chooser />}
      {which === "recording" && <Recording />}
      {which === "steps" && <TeachStepsDialog botId={bot.id} botName={bot.name} steps={STEPS} recordedAt={new Date(Date.now() - 60_000).toISOString()} onClose={() => {}} />}
      {(which === "computer-menu" || which === "computer-details") && <ComputerSection details={which === "computer-details"} />}
      {(which === "learn-before" || which === "learn-after") && <Learn after={which === "learn-after"} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><ConfirmProvider><BotEditorStore value={store}><Gallery /></BotEditorStore></ConfirmProvider></StrictMode>,
);
