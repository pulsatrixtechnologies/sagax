// The voice call pill (voice mode): a compact rounded pill centered at the
// top of the chat column, under the bot's name chip: the bot's avatar, a
// dotted live waveform, then Settings, Transcript, Mic and End. Collapsed,
// it takes only its own small row of the layout (ChatView's banner stack).
// Settings or Transcript expand it downward into a card of the same width
// that overlays the thread and closes on Escape or a click outside. The card
// grows out of the pill row's bottom edge (a 0fr to 1fr grid row and opacity,
// MenuMotion useReveal) and folds back into it; the row itself never moves. On a narrow
// column the waveform shrinks first, then folds away; the controls never
// shrink.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Hand, MessageSquareMore, Mic, MicOff, Pause, Play, Settings, X } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { speaker } from "@/lib/tts";
import { fetchVoiceModeVoices, type VoiceOption } from "@/lib/voice-mode/api";
import type { VoiceCall } from "@/lib/voice-mode/call";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { notifyCallSettings, useCallSettings, writeCallSettings } from "@/lib/voice-mode/call-settings";
import { useVoiceModeSettings, writeVoiceModeSettings } from "@/lib/voice-mode/settings";
import { forgetVoiceprint } from "@/lib/voice-mode/speaker-id";
import type { VoiceModeRefusalCause } from "../../../shared/voice-mode";
import { BotAvatar } from "../Avatar";
import { requestSettingsCard } from "../SettingsPrimitives";
import { openProviderKeyDialog } from "../settings/ProviderKeys";
import { REVEAL_MOTION_MS, REVEAL_SHELL_CLASS, reducedMotion, useReveal } from "../MenuMotion";
import type { CallMetrics } from "./LiveCall";
import { formatCallTime, phaseLabel } from "@/lib/voice-mode/call-labels";

export { formatCallTime, phaseLabel };
import { VoiceModeSettingsPanel, type Enrollment, type VoiceModeList } from "./VoiceModeSettingsPanel";
import { readableOr } from "../../../shared/human-id";

/** The access card of a refused voice turn: shown in the speaker's own bar
 * only (the audience of every access card), never in the thread. */
export interface VoiceAccessCard {
  cause: VoiceModeRefusalCause;
  admin: boolean;
  keysUrl?: string;
}

/** What the card says, to the person it is about. Exported for tests. */
/** The call's debug switch (localStorage "omb.voiceCall.debug"): the
 * settings card then shows the last answer's latency stages. */
function callDebug(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("omb.voiceCall.debug") === "1";
  } catch {
    return false;
  }
}

export function voiceAccessCardText(card: VoiceAccessCard): string[] {
  if (card.cause === "payer_disabled") return [t("voiceMode.noAccess.disabled")];
  if (card.cause === "perspicax_unreachable") return [t("voiceMode.noAccess.unreachable")];
  if (card.cause === "server_engine_not_allowed") return [t("voiceMode.noAccess.notGiven")];
  return [t("voiceMode.noAccess.xaiKey"), ...(card.admin ? [t("access.noAccess.mine.admin")] : [])];
}

export interface VoiceModeBarProps {
  bot: Bot;
  call: VoiceCall;
  state: CallState;
  /** the words recognized so far in the person's turn */
  heard: string;
  /** the bot's sentence now audible */
  caption?: string;
  note: string | null;
  /** a passing notice ("another voice was ignored") */
  notice?: string | null;
  /** an access card: no xAI key serves this person */
  refusal: VoiceAccessCard | null;
  transcript: Array<{ id: string; who: "you" | "bot"; text: string; interrupted?: boolean; unheard?: string }>;
  metrics?: CallMetrics;
  onRetry(): void;
  onEnd(): void;
  /** when the call started (Date.now()); the bar's opening when absent */
  startedAt?: number;
  /** the card open at first (tests draw each state with it) */
  defaultPanel?: "settings" | "transcript";
}

const COLUMN = 7; // px between dot columns (CSS pixels)
const ROW = 6; // px between dots in a column
const RADIUS = 2; // a dot is 4px wide
const ROWS = 5; // dots in the tallest column

/** Time since the call started (or the bar opened), ticking once a second. */
function useCallElapsed(startedAt?: number): number {
  const [started] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now - started;
}

function amplitude(analyser: AnalyserNode | null, data: Uint8Array<ArrayBuffer>, bars: number): number[] {
  if (!analyser) return Array.from({ length: bars }, () => 0);
  analyser.getByteTimeDomainData(data);
  const out: number[] = [];
  const span = Math.floor(data.length / bars);
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    for (let j = i * span; j < (i + 1) * span; j++) peak = Math.max(peak, Math.abs((data[j] ?? 128) - 128) / 128);
    out.push(Math.min(1, peak * 2.5));
  }
  return out;
}

/** Both sides of the call as a row of dots: each column grows taller and
 * brighter with the loudest side at that point (the bot's voice in the
 * accent, the person's in ink); a quiet line is one dim dot per column. */
function Waveform({ call, state }: { call: VoiceCall; state: CallState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const quiet = state.phase === "held" || state.phase === "connecting";
  const muted = state.muted;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    let frame = 0;
    const data = new Uint8Array(1024);
    const draw = (time: number) => {
      const ratio = window.devicePixelRatio || 1;
      const cssWidth = element.clientWidth;
      const cssHeight = element.clientHeight;
      if (element.width !== Math.round(cssWidth * ratio) || element.height !== Math.round(cssHeight * ratio)) {
        element.width = Math.round(cssWidth * ratio);
        element.height = Math.round(cssHeight * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
      const columns = Math.max(1, Math.floor(cssWidth / COLUMN));
      const { mic, bot } = call.analysers;
      const theirs = quiet ? [] : amplitude(bot, data, columns);
      const mine = quiet || muted ? [] : amplitude(mic, data, columns);
      const style = getComputedStyle(element);
      const ink = style.color;
      const accent = style.getPropertyValue("--color-accent").trim() || ink;
      const middle = cssHeight / 2;
      const offset = (cssWidth - (columns - 1) * COLUMN) / 2;
      for (let i = 0; i < columns; i++) {
        const shimmer = quiet ? 0 : 0.08 * Math.abs(Math.sin(time / 600 + i * 0.45));
        const level = Math.max(theirs[i] ?? 0, mine[i] ?? 0);
        const reach = Math.round(level * (ROWS - 1) / 2); // dots above and below the middle
        context.fillStyle = (theirs[i] ?? 0) >= (mine[i] ?? 0) && level > 0.05 ? accent : ink;
        for (let row = -reach; row <= reach; row++) {
          context.globalAlpha = Math.min(1, 0.22 + shimmer + level * 0.75 - Math.abs(row) * 0.08);
          context.beginPath();
          context.arc(offset + i * COLUMN, middle + row * ROW, RADIUS, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [call, quiet, muted]);
  return <canvas ref={canvas} className="block h-8 w-full text-ink" aria-hidden="true" />;
}

/** A round control of the pill. */
const ROUND = "flex size-10 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** The icons of the round controls (px). */
const ICON = 18;

type Panel = "settings" | "transcript" | null;

export function VoiceModeBar(props: VoiceModeBarProps) {
  const { bot, call, state, heard, caption, note, notice, refusal, transcript, metrics, onRetry, onEnd, defaultPanel, startedAt } = props;
  const { dispatch } = useStore();
  const settings = useVoiceModeSettings();
  const callSettings = useCallSettings();
  const [panel, setPanel] = useState<Panel>(defaultPanel ?? null);
  const settingsOpen = panel === "settings";
  const transcriptOpen = panel === "transcript";
  const [list, setList] = useState<VoiceModeList | null>(null);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{ id: string; loading: boolean } | null>(null);
  const elapsed = useCallElapsed(startedAt);
  const [enrollment, setEnrollment] = useState<Enrollment>(call.enrolled ? { state: "enrolled" } : { state: "none" });
  const pill = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLButtonElement>(null);
  const cardId = useId();

  useEffect(() => {
    if (!settingsOpen || voices !== null) return;
    const controller = new AbortController();
    fetchVoiceModeVoices(bot.id, controller.signal).then(
      (list) => setVoices(list),
      (error: unknown) => {
        if (!controller.signal.aborted) setVoicesError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => controller.abort();
  }, [bot.id, settingsOpen, voices]);

  // Expanded, the card closes on Escape (an open list first) or a click
  // anywhere outside the pill.
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (list) return setList(null);
      (panel === "settings" ? gear : bubble).current?.focus();
      setPanel(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (pill.current && event.target instanceof Node && !pill.current.contains(event.target)) {
        setPanel(null);
        setList(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [panel, list]);

  const muted = state.muted;
  const held = state.phase === "held";
  const status = phaseLabel(state.phase, muted);
  const line = state.phase === "hearing" || state.phase === "interrupted" ? heard : state.phase === "speaking" ? caption : "";
  const push = callSettings.input === "push";
  const time = formatCallTime(elapsed);

  // The transcript follows the conversation to its last line, before the
  // frame is painted (never a visible jump).
  const toLastLine = useCallback(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);
  const toTop = useCallback(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, []);
  useLayoutEffect(() => {
    if (transcriptOpen) toLastLine();
  }, [transcriptOpen, transcript.length, transcript[transcript.length - 1]?.text, line, toLastLine]);

  const preview = useCallback(
    (voiceId: string) => {
      if (previewing?.id === voiceId) {
        speaker.stop();
        setPreviewing(null);
        return;
      }
      call.interrupt();
      setPreviewing({ id: voiceId, loading: true });
      const label = readableOr(voices?.find((voice) => voice.id === voiceId)?.label ?? voiceId, t("ids.customVoice"));
      const unsubscribe = speaker.subscribe((snapshot) => {
        if (snapshot.status === "speaking") setPreviewing((current) => (current?.id === voiceId ? { id: voiceId, loading: false } : current));
      });
      void speaker
        .speak(t("voiceMode.previewLine", { voice: label }), { botId: bot.id, voiceMode: { settings: { ...settings, voice: voiceId } } })
        .finally(() => {
          unsubscribe();
          setPreviewing((current) => (current?.id === voiceId ? null : current));
        });
    },
    [bot.id, call, previewing, settings, voices],
  );

  const enroll = useCallback(() => {
    setEnrollment({ state: "recording", share: 0 });
    void call.enroll((share) => setEnrollment({ state: "recording", share })).then((ok) => {
      setEnrollment(ok ? { state: "enrolled" } : { state: "failed" });
      if (ok) writeCallSettings({ onlyMyVoice: true });
      notifyCallSettings();
    });
  }, [call]);

  const forget = useCallback(() => {
    forgetVoiceprint();
    call.forgetVoice();
    setEnrollment({ state: "none" });
    notifyCallSettings();
  }, [call]);

  const toggle = (next: Exclude<Panel, null>) => {
    setPanel((open) => (open === next ? null : next));
    setList(null);
  };
  const alert = Boolean(refusal || note || notice);
  // What the card under the row shows: a panel, or an alert alone.
  const cardKey: string | null = panel ?? (alert ? "alert" : null);
  const expanded = cardKey !== null;
  // Closing, the card keeps drawing the panel it had while it folds away.
  const heldPanel = useRef<Panel>(panel);
  if (cardKey !== null) heldPanel.current = panel;
  const shownPanel = cardKey !== null ? panel : heldPanel.current;
  // Settings to Transcript (or back): the old panel fades out over the new
  // one fading in while the card takes the new height.
  const [lastPanel, setLastPanel] = useState<Panel>(panel);
  const [leaving, setLeaving] = useState<Exclude<Panel, null> | null>(null);
  if (panel !== lastPanel) {
    setLastPanel(panel);
    setLeaving(panel && lastPanel && !reducedMotion() ? lastPanel : null);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), REVEAL_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const cardMotion = useReveal(expanded, cardKey, panel === "transcript" ? toLastLine : toTop);

  const body = (which: Exclude<Panel, null>) => which === "settings" ? (
    <>
      <VoiceModeSettingsPanel
        settings={settings}
        voices={voices}
        voicesError={voicesError}
        open={list}
        previewing={previewing}
        onOpen={setList}
        onChange={(patch) => writeVoiceModeSettings(patch)}
        onPreview={preview}
        call={callSettings}
        enrollment={enrollment}
        onCallChange={(patch) => writeCallSettings(patch)}
        onEnroll={enroll}
        onForget={forget}
        latency={callDebug() ? metrics?.stages ?? null : null}
      />
      <button
        type="button"
        aria-pressed={held}
        data-voice-hold
        onClick={() => (held ? call.resume() : call.hold())}
        className={cn("mb-1 flex w-full items-center justify-center gap-2 rounded-lg bg-raised px-3 py-1.5 text-[13px] hover:brightness-110", held ? "text-warning" : "text-ink")}
      >
        {held ? <Play size={14} /> : <Pause size={14} />}
        {held ? t("voiceMode.resume") : t("voiceMode.hold")}
      </button>
    </>
  ) : (
    <div aria-label={t("voiceMode.transcript")} data-voice-transcript>
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[11.5px] text-ink-tertiary" data-voice-transcript-head>
        <span className="truncate">{bot.name}</span>
        <span className="shrink-0 tabular-nums" data-voice-timer>{time} · {status}</span>
      </div>
      {transcript.length === 0 && !line ? (
        <div className="py-1 text-[13px] text-ink-tertiary">{t("voiceMode.transcriptEmpty")}</div>
      ) : (
        <div className="flex flex-col gap-1.5 text-[13px] leading-snug">
          {transcript.map((entry) => (
            <div
              key={entry.id}
              className={cn("max-w-[85%] rounded-2xl px-3 py-1.5", entry.who === "you" ? "self-end rounded-br-md bg-raised text-ink" : "self-start rounded-bl-md bg-inset text-ink")}
              data-voice-line={entry.who}
              data-voice-interrupted={entry.interrupted ? "" : undefined}
            >
              {entry.text}
              {entry.interrupted && <span className="ml-1.5 rounded bg-panel/60 px-1 text-[11px] text-ink-tertiary">{t("voiceMode.interruptedMark")}</span>}
              {entry.unheard && (
                <span className="mt-0.5 block text-[12px] text-ink-tertiary" data-voice-unheard>
                  {t("voiceMode.unheardMark")} <span className="italic">{entry.unheard}</span>
                </span>
              )}
            </div>
          ))}
          {line && (
            <div
              className={cn("max-w-[85%] rounded-2xl px-3 py-1.5 opacity-70", state.phase === "speaking" ? "self-start rounded-bl-md bg-inset" : "self-end rounded-br-md bg-raised")}
              data-voice-line="live"
            >
              {line}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section
      ref={pill}
      className={cn(
        // The radius only moves between finite values (half the row, then
        // the card's corners at the bottom), with the card's own motion.
        "@container/callpill pointer-events-auto mx-auto w-full max-w-[420px] overflow-hidden rounded-t-[32px] border border-hairline-weak bg-elevated text-ink shadow-[0_8px_28px_rgba(0,0,0,0.28)] transition-[border-radius] duration-moderate ease-out-quint motion-reduce:transition-none",
        expanded ? "rounded-b-[22px]" : "rounded-b-[32px]",
      )}
      aria-label={t("voiceMode.callWith", { name: bot.name })}
      data-voice-bar
      data-voice-pill
      data-voice-panel={panel ?? (alert ? "alert" : "none")}
      data-voice-phase={state.phase}
      data-voice-first-audio-ms={metrics?.firstAudioMs}
      data-voice-sent-ms={metrics?.sentMs}
      data-voice-duck-ms={metrics?.duckMs}
      data-voice-bargein-ms={metrics?.bargeInMs}
      data-voice-utterance={metrics?.utteranceId}
      data-voice-endpoint-ms={call.endpointMs}
      data-voice-models={call.modelsReady ? "on-device" : "level"}
    >
      <div className="flex h-16 items-center gap-2 px-3" data-voice-pill-row>
        <button
          type="button"
          onClick={state.botAudible ? () => call.interrupt() : undefined}
          className="shrink-0 rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={state.botAudible ? t("voiceMode.interrupt") : bot.name}
          title={`${bot.name} · ${time} · ${status}`}
          data-voice-avatar
        >
          <BotAvatar
            bot={bot}
            size={40}
            state={state.phase === "listening" || state.phase === "hearing" ? "listening" : state.phase === "speaking" ? "sending" : state.phase === "thinking" || state.phase === "interrupted" ? "thinking" : "working"}
          />
        </button>
        <span className="sr-only" aria-live="polite" data-voice-status>{line || status}</span>
        <div className="hidden min-w-0 flex-1 px-1 @[21rem]/callpill:block" data-voice-waveform>
          <Waveform call={call} state={state} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2" data-voice-controls>
          {push && (
            <button
              type="button"
              aria-label={t("voiceMode.pushToTalk")}
              title={t("voiceMode.pushHint")}
              data-voice-ptt
              disabled={muted || held}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                call.pushToTalk(true);
              }}
              onPointerUp={() => call.pushToTalk(false)}
              onPointerCancel={() => call.pushToTalk(false)}
              className={cn(ROUND, "disabled:opacity-40", state.phase === "hearing" && "bg-accent text-accent-ink")}
            >
              <Hand size={ICON} />
            </button>
          )}
          <button
            ref={gear}
            type="button"
            aria-label={t("voiceMode.settings")}
            title={t("voiceMode.settings")}
            aria-expanded={settingsOpen}
            aria-controls={settingsOpen ? cardId : undefined}
            data-voice-gear
            onClick={() => toggle("settings")}
            className={cn(ROUND, settingsOpen && "text-ink ring-2 ring-ink/40")}
          >
            <Settings size={ICON} />
          </button>
          <button
            ref={bubble}
            type="button"
            aria-label={t("voiceMode.transcript")}
            title={t("voiceMode.transcript")}
            aria-expanded={transcriptOpen}
            aria-controls={transcriptOpen ? cardId : undefined}
            data-voice-transcript-toggle
            onClick={() => toggle("transcript")}
            className={cn(ROUND, transcriptOpen && "bg-ink text-panel hover:text-panel")}
          >
            <MessageSquareMore size={ICON} />
          </button>
          <button
            type="button"
            aria-label={muted ? t("voiceMode.unmute") : t("voiceMode.mute")}
            title={muted ? t("voiceMode.unmute") : t("voiceMode.mute")}
            aria-pressed={muted}
            data-voice-mute
            onClick={() => call.setMuted(!muted)}
            className={cn(ROUND, muted && "text-danger hover:text-danger")}
          >
            {muted ? <MicOff size={ICON} /> : <Mic size={ICON} />}
          </button>
          <button
            type="button"
            aria-label={t("voiceMode.end")}
            title={t("voiceMode.end")}
            data-voice-end
            onClick={onEnd}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={ICON} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {cardMotion.shown && (
        <div className={cn("relative overflow-hidden", REVEAL_SHELL_CLASS)} data-voice-card-motion {...cardMotion.shellProps} {...cardMotion.exitProps}>
          <div id={cardId} className="overflow-hidden border-t border-hairline-weak" data-voice-card>
            <div ref={scroller} className="max-h-[min(55vh,360px)] overflow-y-auto px-3 py-2.5" data-voice-callbar-panels>
              {shownPanel && (
                <div key={shownPanel} className={leaving ? "animate-card-fade-in" : undefined} data-voice-card-body={shownPanel}>
                  {body(shownPanel)}
                </div>
              )}
              {refusal && (
                <div role="alert" className="my-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-ink" data-voice-access-card>
                  {voiceAccessCardText(refusal).map((line, index) => (
                    <div key={index} className={index === 0 ? "font-medium" : "mt-0.5 text-ink-secondary"}>{line}</div>
                  ))}
                  {refusal.admin && refusal.cause === "no_credentials" && (
                    <button
                      type="button"
                      data-voice-action="open-connections"
                      onClick={() => {
                        requestSettingsCard("engines.keys");
                        dispatch({ type: "toggleAppSettings", open: true, section: "engines" });
                        // Grok voice runs on the xAI key (2026-10-14): open its row.
                        openProviderKeyDialog("xai");
                      }}
                      className="mr-1.5 mt-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:brightness-110"
                    >
                      {t("voiceMode.openXaiKey")}
                    </button>
                  )}
                  {refusal.keysUrl && refusal.cause === "no_credentials" && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.ogb?.openExternal) void window.ogb.openExternal(refusal.keysUrl!);
                        else window.open(refusal.keysUrl, "_blank", "noopener");
                      }}
                      className="mt-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:brightness-110"
                    >
                      {t("voiceMode.addOwnKey")}
                    </button>
                  )}
                </div>
              )}
              {(note || notice) && !refusal && (
                <div className={cn("my-1 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[12.5px]", note ? "bg-warning/10 text-warning" : "bg-raised/60 text-ink-secondary")} role={note ? "alert" : "status"}>
                  <span>{note ?? notice}</span>
                  {note && (
                    <button type="button" onClick={onRetry} className="shrink-0 rounded-full border border-warning/40 px-2.5 py-0.5 text-[12px] hover:bg-warning/10">
                      {t("voiceMode.retry")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {leaving && (
            // the panel just left: a picture of it, fading out over the new one
            <div aria-hidden inert className="animate-card-fade-out pointer-events-none absolute inset-x-0 top-0 border-t border-transparent" data-voice-card-leaving={leaving}>
              <div className="flex max-h-[min(55vh,360px)] flex-col justify-end overflow-hidden px-3 py-2.5">
                {body(leaving)}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
