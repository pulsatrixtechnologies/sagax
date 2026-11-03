// The call button and the call dock. A call is a realtime voice session
// (the maintainer, 2026-11-02: never text to speech): voice-mode/RealtimeCall.tsx runs
// it on the configured realtime voice (server/voice/realtime-call.ts). Without
// one, the button says so and opens the voice settings; the older macOS
// dictation plus text to speech call is gone.
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { AudioLines, PhoneOff } from "lucide-react";
import { CTA_CIRCLE, CTA_DEFAULT, CTA_TONED, ctaStyle, type BotCtaColors } from "@/lib/voice-cta";

import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { endCall, startCall, useOnCall } from "@/lib/call";
import { localSystemVoiceActive } from "@/lib/local-voice";
import { track } from "@/lib/analytics";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { callCapabilityHelp } from "@/lib/call-capability";
import { realtimeCallReady, useVoiceModeCheck, useVoiceModeStatus } from "@/lib/voice-mode/api";
import { RealtimeCallEngine } from "./voice-mode/RealtimeCall";
import { managedProfile } from "@/lib/profile-management";
import { VoiceModeCallButton } from "./voice-mode/VoiceModeCallButton";
import { t } from "@/lib/i18n";
import type { VoiceModeStatus } from "../../shared/voice-mode";
import { LiveCall } from "./voice-mode/LiveCall";

/** An organization server: the server says so in voice mode's status, and
 * the session's viewer is managed by Perspicax. There, voice mode is the
 * only call (VoiceModeCallButton) and the legacy gate never shows. */
export function useOrganizationCall(botId?: string): boolean {
  const { state } = useStore();
  const check = useVoiceModeCheck(botId ?? "");
  return (check.state === "ready" && check.status.organization === true) || managedProfile(state.config?.viewer) !== null;
}

/** The composer's Voice button. `tone`: the open bot's color (src/lib/voice-cta.ts). */
export function CallButton({ bot, tone }: { bot: Bot; tone?: BotCtaColors | null }) {
  const voiceMode = useVoiceModeStatus(bot.id);
  const organization = useOrganizationCall(bot.id);
  if (organization) {
    return (
      <VoiceModeCallButton
        targetId={bot.id}
        targetName={bot.name}
        botId={bot.id}
        tone={tone}
        onStart={() => track("call_started", { driver: bot.modelSelection?.instanceId, voice: "xai" })}
      />
    );
  }
  return (
    <CallTargetButton
      targetId={bot.id}
      targetName={bot.name}
      voices={[bot.voice]}
      setupBotId={bot.id}
      requireExplicitVoices={false}
      voiceMode={voiceMode}
      tone={tone}
      onStart={() => track("call_started", { driver: bot.modelSelection?.instanceId, ...(voiceMode?.available ? { voice: "xai" } : {}) })}
    />
  );
}

export function CallTargetButton({
  targetId,
  targetName,
  voices,
  setupBotId,
  requireExplicitVoices,
  voiceMode,
  onStart,
  tone,
}: {
  targetId: string;
  targetName: string;
  voices: Array<string | undefined>;
  /** Agent profile to open when voice setup is missing (rooms choose a member). */
  setupBotId?: string;
  /** Rooms cannot rely on one workspace fallback for multiple speakers. */
  requireExplicitVoices: boolean;
  /** Voice mode with xAI (server/voice/voice-mode.ts): when available it carries
   * the call on any desktop (macOS, Windows) or browser, without the macOS
   * dictation helper. */
  voiceMode?: VoiceModeStatus | null;
  onStart: () => void;
  /** The open bot's color for the fill; absent: the skin's ink. */
  tone?: BotCtaColors | null;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { capabilities, ready: capabilitiesReady } = useDesktopCapabilities();
  const active = useOnCall() === targetId;
  // 2026-11-02 (the maintainer): a call is a realtime voice session, never text to
  // speech: without the realtime voice the button says so and opens the
  // voice settings; the dictation plus text to speech call is not offered.
  const xaiVoice = realtimeCallReady(voiceMode);
  const realtimeOnly = !requireExplicitVoices;
  const nativeHelp = capabilitiesReady
    ? callCapabilityHelp(capabilities, Boolean(window.ogb?.speechStart))
    : null;
  const capabilityHelp = xaiVoice
    ? null
    : realtimeOnly
      ? { label: t("voiceMode.realtimeNeededLabel"), reason: t("voiceMode.realtimeNeededReason") }
      : nativeHelp && voiceMode && !voiceMode.available
        ? { label: t("voiceMode.needsXaiKeyLabel"), reason: t("voiceMode.needsXaiKeyReason") }
        : nativeHelp;
  const supported = xaiVoice || (!realtimeOnly && capabilitiesReady && !capabilityHelp);
  const localVoice = localSystemVoiceActive();
  const configured = xaiVoice || localVoice || Boolean(state.config?.tts?.configured);
  const everyTargetHasVoice = voices.length > 0 && voices.every((voice) => Boolean(voice));
  const voiceReady =
    xaiVoice ||
    localVoice ||
    (configured && (requireExplicitVoices ? everyTargetHasVoice : Boolean(state.config?.tts?.ready || everyTargetHasVoice)));
  const unavailable = !active && (realtimeOnly ? !xaiVoice : (!capabilitiesReady && !xaiVoice) || !supported || !voiceReady);
  const voiceSetupRequired = realtimeOnly ? !xaiVoice : capabilitiesReady && supported && !voiceReady;
  const [helpOpen, setHelpOpen] = useState(false);
  const helpMotion = useMenuMotion(Boolean(unavailable && helpOpen));
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const helpId = useId();
  const label = active
    ? t("callView.hangUpOn", { name: targetName })
    : xaiVoice
      ? t("voiceMode.start", { name: targetName })
      : realtimeOnly && capabilityHelp
      ? capabilityHelp.label
      : !capabilitiesReady
      ? t("callView.checkingAvailability")
      : !supported
        ? capabilityHelp?.label ?? t("callView.unavailable")
        : !configured
          ? t("callView.setupVoice")
          : !voiceReady
            ? t("callView.pickVoice")
            : t("callView.callName", { name: targetName });

  const reason = xaiVoice
    ? ""
    : realtimeOnly && capabilityHelp
    ? capabilityHelp.reason
    : !capabilitiesReady
    ? t("callView.checkingReason")
    : capabilityHelp
      ? capabilityHelp.reason
        : !configured
          ? t("callView.setupReason")
          : !voiceReady
            ? voices.length > 1
              ? t("callView.groupVoiceReason")
              : t("callView.chooseVoiceReason")
            : "";

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setHelpOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHelpOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [helpOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          if (active) return endCall(targetId);
          if (unavailable) {
            setHelpOpen((open) => !open);
            return;
          }
          onStart();
          startCall(targetId);
        }}
        aria-expanded={unavailable ? helpOpen : undefined}
        aria-controls={unavailable ? helpId : undefined}
        data-call-target={targetId}
        data-voice-mode={xaiVoice ? "xai" : undefined}
        aria-label={label}
        title={label}
        data-composer-voice=""
        style={active ? undefined : ctaStyle(tone)}
        className={cn(
          CTA_CIRCLE,
          active
            ? "bg-danger text-white hover:brightness-110"
            : tone
              ? CTA_TONED
              : unavailable
                ? "bg-raised text-ink-tertiary"
                : CTA_DEFAULT,
        )}
      >
        {active ? <PhoneOff size={15} /> : <AudioLines size={16} strokeWidth={2.25} />}
        {unavailable && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warning ring-2 ring-app" aria-hidden="true" />
        )}
      </button>

      {helpMotion.shown && (
        <div
          id={helpId}
          role="group"
          aria-label={t("callView.unavailable")}
          className={cn("absolute bottom-full right-0 z-30 mb-2 w-[280px] rounded-xl border border-hairline popover-surface bg-panel p-3 text-left shadow-2xl", helpMotion.className)} {...helpMotion.exitProps}
        >
          <div className="text-[13px] font-medium text-ink">{t("callView.unavailable")}</div>
          <div className="mt-1 text-[12px] leading-[1.45] text-ink-secondary">{reason}</div>
          {voiceSetupRequired && (
            <button
              type="button"
              onClick={() => {
                setHelpOpen(false);
                // A room's member opens on its main thread when threads are hidden.
                const setupBot = setupBotId && setupBotId !== targetId ? state.bots.find((candidate) => candidate.id === setupBotId) : undefined;
                if (setupBot) openBot(dispatch, setupBot, showThreads);
                dispatch({ type: "toggleSettings", open: true, section: "voice" });
              }}
              className="mt-2.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110"
            >
              {t("callView.openAgentSettings")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Voice mode's call engine, once for the whole window: it runs the call of
 * the bot on the line whatever the app shows (another bot, settings) and
 * whoever started it (the app's call button or the desktop mascot). The
 * app's pill and the mascot's only show it (live-call-store.ts). */
export function CallEngineHost() {
  const { state } = useStore();
  const id = useOnCall();
  const bot = id ? state.bots.find((candidate) => candidate.id === id) : undefined;
  const voiceMode = useVoiceModeStatus(bot?.id ?? "");
  if (!bot || voiceMode?.available !== true) return null;
  // a call is a realtime voice session (the maintainer, 2026-11-02): never text to speech
  if (!realtimeCallReady(voiceMode)) return null;
  return <RealtimeCallEngine key={bot.id} bot={bot} />;
}

/** The older call's full overlay. Voice mode docks its bar at the top of
 * the chat column instead (VoiceCallDock). */
export function CallOverlay(_props: { bot: Bot }) {
  // the dictation plus text to speech call is never a call any more (the maintainer,
  //  2026-11-02): the call button says to set up the realtime voice instead
  return null;
}

/** Same length as `--animate-call-dock-out` in styles.css. */
const CALL_DOCK_EXIT_MS = 180;

/** Voice mode (xAI): a live, full-duplex call (voice-mode/LiveCall.tsx),
 * shown as a compact pill centered at the top of the chat column, under the
 * bot's name chip. The collapsed pill keeps its own small row in the layout
 * (never covering a message); its expanded card (settings, transcript)
 * hangs below that row over the thread. When the call ends the row folds
 * away (the call itself is already over by then). */
export function VoiceCallDock({ bot }: { bot: Bot }) {
  const active = useOnCall() === bot.id;
  const voiceMode = useVoiceModeStatus(bot.id);
  const live = active && voiceMode?.available === true;
  const motion = useMenuMotion(live);
  const dock = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  useEffect(() => {
    const element = dock.current;
    if (!live || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => (height.current = element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [live]);
  if (live) {
    return (
      <div ref={dock} className="animate-call-dock-in relative z-20 mb-2 h-16 px-3" data-voice-call-dock>
        <div className="pointer-events-none absolute inset-x-3 top-0">
          <LiveCall bot={bot} />
        </div>
      </div>
    );
  }
  if (!motion.shown || height.current === 0) return null;
  // The call has ended: only the room it took folds away, an empty picture
  // of the bar (no controls, out of the accessibility tree).
  return (
    <div
      aria-hidden
      inert
      data-voice-call-dock-exit
      className="animate-call-dock-out pointer-events-none mx-auto mb-2 w-[min(420px,calc(100%-24px))] overflow-hidden rounded-full border border-hairline-weak bg-elevated"
      style={{ "--call-dock-h": `${height.current}px`, animationDuration: `${CALL_DOCK_EXIT_MS}ms` } as CSSProperties}
    />
  );
}
