/** Isolated gallery for headless screenshots of listening to a conversation
 * (#4100, src/components/ListeningCard.tsx) beside its conforming neighbour,
 * the live phone call card (src/components/OutboundCard.tsx). A session runs
 * in this page with a fake microphone, a fake live transcriber and a fake
 * voice detector, so the card shows real lines. The sidebar's pill (the Live
 * call pill's listening variant) sits at real sidebar widths under eleven
 * bots with long names, beside the call variant. Not shipped in the app.
 * ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotAvatar } from "../components/Avatar";
import { ListeningBadge, ListeningCard, ListeningRowLine } from "../components/ListeningCard";
import { LiveCallPill } from "../components/LiveCallPill";
import { OutboundCard } from "../components/OutboundCard";
import { loadLocale, t } from "../lib/i18n";
import { startListening } from "../lib/listening/listening-session";
import { configureLiveMedia, startLiveCall } from "../lib/live-call-media";
import { SIDEBAR_DEFAULT_WIDTH } from "../lib/sidebar-preferences";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type Bot, type Message } from "../state/store";
import { answerEndedTranscript, createFakeListening } from "./listening-fakes";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const fr = lang === "fr";

const bot = { id: "bot-gallery", name: "Rocket Operations Assistant", color: "blue", threadId: "t-gallery", tasks: [] } as unknown as Bot;
const other = { id: "bot-other", name: "Nova", color: "violet", threadId: "t-other", tasks: [] } as unknown as Bot;
// a full sidebar: eleven bots, long names among them
const COLORS = ["blue", "violet", "green", "orange", "pink", "teal"];
const sidebarBots: Bot[] = [bot, other, ...["Atlas", "Juniper Research Companion", "Helios", "Quill", "Marigold Scheduling Desk", "Orbit", "Sable", "Wren", "Cobalt Billing Reviewer"]
  .map((name, i) => ({ id: `bot-${i}`, name, color: COLORS[i % COLORS.length], threadId: `t-${i}`, tasks: [] }) as unknown as Bot)];
const storeValue = { state: { ...initialState, bots: sidebarBots }, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
// the neighbour: a Live call with Nova from another chat (the microphone prompt never answers)
configureLiveMedia({ getUserMedia: () => new Promise<MediaStream>(() => {}) });
void startLiveCall({ botId: other.id, threadId: other.threadId });

function SidebarColumn({ width, variant }: { width: number; variant: "call" | "listening" }) {
  return (
    <div data-gallery-sidebar={`${variant}-${width}`} style={{ width }} className="flex shrink-0 flex-col rounded-2xl bg-sidebar py-2">
      {sidebarBots.map((entry) => (
        <div key={entry.id} className="flex min-w-0 items-center gap-2.5 px-3 py-1.5">
          <BotAvatar bot={entry} size={28} animated={false} forward={false} trackPointer={false} />
          <span className="min-w-0 truncate text-[14px] font-medium leading-5 text-sidebar-ink">{entry.name}</span>
          <ListeningBadge botId={entry.id} />
        </div>
      ))}
      <div className="mt-2"><LiveCallPill variant={variant} currentBotId="bot-3" onOpen={() => {}} /></div>
    </div>
  );
}

const { deps, utter } = createFakeListening(bot);
answerEndedTranscript(bot, fr);

const liveStartedAt = Date.now() - 67_000;
const call = { id: "m-call", role: "bot", kind: "text", text: "", outbound: {
  kind: "call", id: "call_0000000000000017", status: "done", phase: "in_call", liveStartedAt, liveAnsweredAt: liveStartedAt + 8_000, calleeName: "Marie Tremblay", botName: "Rocket",
  destination: "+1 514 555 0142", mode: "conversation", language: "fr", maxMinutes: 5,
  objective: fr ? "Prendre rendez-vous pour l'entretien." : "Book the yearly service.",
  liveTranscript: [
    { speaker: "bot", text: fr ? "Bonjour, ici Rocket, un assistant IA." : "Hello, this is Rocket, an AI assistant.", at: liveStartedAt + 5_000 },
    { speaker: "callee", text: fr ? "Oui, bonjour." : "Yes, hello.", at: liveStartedAt + 12_000 },
  ],
} } as unknown as Message;

const rowOn = { id: "m-on", role: "bot", kind: "text", text: "", at: 1, listening: { sessionId: "ls_0000000000000000000a", state: "listening", startedAt: 0, lineCount: 3, speakers: [] } } as unknown as Message;
const rowEnded = { id: "m-ended", role: "bot", kind: "text", text: "", at: 2, listening: {
  sessionId: "ls_0000000000000000000b", state: "ended", startedAt: 0, endedAt: 24 * 60_000, lineCount: 42,
  speakers: [{ key: "s1", label: t("listening.speaker", { n: 1 }) }, { key: "s2", label: t("listening.speaker", { n: 2 }) }, { key: "s3", label: "Alex" }],
} } as unknown as Message;
const rowElsewhere = { id: "m-else", role: "bot", kind: "text", text: "", at: 3, listening: {
  sessionId: "ls_0000000000000000000c", state: "listening", startedAt: 0, lineCount: 5, speakers: [],
  last: { speaker: t("listening.speaker", { n: 2 }), text: fr ? "Parfait, vendredi alors." : "Great, Friday then." },
} } as unknown as Message;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={storeValue as never}>
    <main className="grid min-h-screen grid-cols-2 gap-8 bg-canvas p-6 text-ink" data-gallery-panel>
      <section className="space-y-5" data-gallery-listening>
        <div className="rounded-2xl border border-hairline-weak pt-3"><ListeningCard bot={bot} messages={[]} /></div>
        <div className="rounded-2xl border border-hairline-weak pt-3"><ListeningCard bot={other} messages={[rowElsewhere]} /></div>
        <div className="space-y-3 px-3" data-gallery-rows>
          <ListeningRowLine message={rowOn} />
          <ListeningRowLine message={rowEnded} />
        </div>
      </section>
      <section data-gallery-neighbour>
        <OutboundCard message={call} />
      </section>
      <section data-gallery-sidebars className="col-span-2 flex items-start gap-6">
        <SidebarColumn width={SIDEBAR_DEFAULT_WIDTH} variant="listening" />
        <SidebarColumn width={SIDEBAR_DEFAULT_WIDTH} variant="call" />
        <SidebarColumn width={220} variant="listening" />
        <SidebarColumn width={220} variant="call" />
      </section>
    </main>
    </BotEditorStore>
  </StrictMode>,
);

await startListening({ botId: bot.id, threadId: bot.threadId, personName: "Alex" }, deps);
await utter(fr ? "On peut livrer vendredi?" : "Can we ship it on Friday?", true);
await utter(fr ? "Oui, je le mets dans le brief." : "Yes, I'll put that in the brief.", true);
await utter(fr ? "Parfait, et on revoit le budget" : "Great, and we review the budget", false);
document.body.dataset.galleryReady = "";
