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
import { startListening, type ListeningDeps } from "../lib/listening/listening-session";
import { configureLiveMedia, startLiveCall } from "../lib/live-call-media";
import { SIDEBAR_DEFAULT_WIDTH } from "../lib/sidebar-preferences";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type Bot, type Message } from "../state/store";
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

// a session driven by fakes: each utterance is voiced frames, words, then silence
let onFrame: ((frame: Float32Array) => void) | null = null;
let heardCount = 0;
const VOICES = [0, 1].map((at) => { const vector = new Float32Array(512); vector[at] = 1; return vector; });
let probability = 0;
const ears: Array<{ partial: Set<(text: string) => void>; words: string }> = [];
const deps: ListeningDeps = {
  openMicrophone: async (cb) => { onFrame = cb; return { stop: () => {} }; },
  transcriber: () => {
    const ear = { partial: new Set<(text: string) => void>(), words: "" };
    ears.push(ear);
    return {
      connect: async () => true,
      onPartial: (cb) => { ear.partial.add(cb); return () => ear.partial.delete(cb); },
      begin: () => { ear.words = ""; },
      push: () => {},
      probe: () => false,
      audio: () => new Float32Array(32_000),
      finishHeard: async () => ({ text: ear.words }),
      discard: () => {},
      close: () => {},
    };
  },
  // two voices, one after the other
  models: async () => ({ vad: { probability: async () => probability, reset: () => {} }, embedder: { embed: async () => VOICES[heardCount++ % 2]! } }),
  request: async <T,>(path: string) => (path.endsWith("/listening")
    ? { session: { sessionId: "ls_0000000000000000000a", botId: bot.id, threadId: bot.threadId, state: "listening", startedAt: Date.now(), lineCount: 0, speakers: [], sources: { microphone: true, computer: false } } }
    : {}) as T,
  now: () => Date.now(),
  setTimer: () => null,
  clearTimer: () => {},
};
// the ended session's transcript, as GET /api/listening/:id answers it
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/api/listening/ls_0000000000000000000b")) return realFetch(input, init);
  const said = fr
    ? ["On commence par le budget.", "D'accord, je prends les chiffres.", "Alex, tu envoies le résumé?"]
    : ["Let's start with the budget.", "Sure, I'll take the numbers.", "Alex, will you send the summary?"];
  const body = {
    session: { sessionId: "ls_0000000000000000000b", botId: bot.id, threadId: bot.threadId, state: "ended", startedAt: 0, endedAt: 24 * 60_000, lineCount: 3,
      speakers: [{ key: "s1", label: t("listening.speaker", { n: 1 }) }, { key: "s2", label: t("listening.speaker", { n: 2 }) }, { key: "s3", label: "Alex" }], sources: { microphone: true, computer: false } },
    lines: said.map((text, i) => ({ seq: i + 1, at: i * 4_000, speaker: `s${i + 1}`, text })),
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

const settle = () => new Promise((done) => setTimeout(done, 30));
async function utter(words: string, final: boolean) {
  probability = 0.9;
  for (let i = 0; i < 12; i++) onFrame!(new Float32Array(512).fill(0.2));
  await settle();
  const ear = ears[0]!;
  ear.words = words;
  for (const cb of ear.partial) cb(words);
  if (!final) return;
  probability = 0;
  for (let i = 0; i < 40; i++) onFrame!(new Float32Array(512));
  await settle();
}

const liveStartedAt = Date.now() - 67_000;
const call = { id: "m-call", role: "bot", kind: "text", text: "", outbound: {
  kind: "call", id: "call_0000000000000017", status: "done", phase: "in_call", liveStartedAt, calleeName: "Marie Tremblay", botName: "Rocket",
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
