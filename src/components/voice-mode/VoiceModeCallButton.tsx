// The call button on an organization server (server mode, or a browser on
// the server). Voice mode with xAI is the only call there: no macOS
// dictation helper and no "This computer" (PR #18), so the legacy call gate
// ("Call unavailable ... Choose This computer") must never show. The server
// decides (GET /api/bots/<id>/voice/status): available opens the voice bar;
// otherwise the popover shows the speaker's private access card, with the
// organization's key only for an admin, or why the server could not answer.
import { useEffect, useId, useRef, useState } from "react";
import { AudioLines, PhoneOff } from "lucide-react";

import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { CTA_CIRCLE, CTA_DEFAULT, CTA_TONED, ctaStyle, type BotCtaColors } from "@/lib/voice-cta";
import { endCall, startCall, useOnCall } from "@/lib/call";
import { t } from "@/lib/i18n";
import { realtimeCallReady, refreshVoiceMode, useVoiceModeCheck, type VoiceModeCheck } from "@/lib/voice-mode/api";
import { useMenuMotion } from "../MenuMotion";
import { openProviderKeyDialog } from "../settings/ProviderKeys";
import { voiceAccessCardText } from "./VoiceModeBar";

export type VoiceUnavailableAction = "open-connections" | "add-key" | "retry";

export interface VoiceUnavailableView {
  title: string;
  lines: string[];
  actions: VoiceUnavailableAction[];
  /** the refusal's cause, or the state (for tests and the Electron check) */
  cause: string;
}

/** What the popover says when the voice bar cannot open. Pure. */
export function voiceUnavailableView(check: VoiceModeCheck, options: { group?: boolean } = {}): VoiceUnavailableView | null {
  const title = t("voiceMode.unavailableTitle");
  if (options.group) return { title, lines: [t("voiceMode.groupUnavailable")], actions: [], cause: "group" };
  if (check.state === "loading") return { title, lines: [t("voiceMode.checking")], actions: [], cause: "loading" };
  if (check.state === "error") return { title, lines: [t("voiceMode.checkFailed", { error: check.error })], actions: ["retry"], cause: "error" };
  if (realtimeCallReady(check.status)) return null;
  // a voice without the realtime session is no call (the maintainer, 2026-11-02): say what it needs
  if (check.status.available) return { title, lines: [t("voiceMode.realtimeNeededReason")], actions: ["open-connections"], cause: "realtime" };
  const refusal = check.status.refusal ?? { cause: "no_credentials" as const };
  const admin = refusal.admin === true;
  const actions: VoiceUnavailableAction[] = [];
  if (refusal.cause === "no_credentials") {
    if (admin) actions.push("open-connections");
    if (refusal.keysUrl) actions.push("add-key");
  } else if (refusal.cause === "server_engine_not_allowed") {
    if (refusal.keysUrl) actions.push("add-key");
  } else if (refusal.cause === "perspicax_unreachable") {
    actions.push("retry");
  }
  return { title, lines: voiceAccessCardText({ cause: refusal.cause, admin, keysUrl: refusal.keysUrl }), actions, cause: refusal.cause };
}

export function VoiceModeCallButton({ targetId, targetName, botId, group, onStart, tone }: {
  targetId: string;
  targetName: string;
  /** the bot to ask about (absent for a room) */
  botId?: string;
  group?: boolean;
  onStart: () => void;
  /** The open bot's color for the fill (src/lib/voice-cta.ts). */
  tone?: BotCtaColors | null;
}) {
  const { dispatch } = useStore();
  const check = useVoiceModeCheck(botId ?? "");
  const active = useOnCall() === targetId;
  const available = !group && check.state === "ready" && realtimeCallReady(check.status);
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open && !available && !active);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const view = available ? null : voiceUnavailableView(check, { group });
  const keysUrl = check.state === "ready" ? check.status.refusal?.keysUrl : undefined;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const start = () => {
    setOpen(false);
    onStart();
    startCall(targetId);
  };

  const label = active ? `Hang up on ${targetName}` : available ? t("voiceMode.start", { name: targetName }) : t("voiceMode.unavailableTitle");

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => {
          if (active) return endCall(targetId);
          if (available) return start();
          setOpen((value) => !value);
          // the server decides, every time: a key added meanwhile opens the bar at once
          if (botId && !group) {
            void refreshVoiceMode(botId).then((next) => {
              if (next.state === "ready" && realtimeCallReady(next.status)) start();
            });
          }
        }}
        aria-expanded={available ? undefined : open}
        aria-controls={available ? undefined : popoverId}
        data-call-target={targetId}
        data-voice-mode={available ? "xai" : "unavailable"}
        aria-label={label}
        title={label}
        data-composer-voice=""
        style={active ? undefined : ctaStyle(tone)}
        className={cn(
          CTA_CIRCLE,
          active ? "bg-danger text-white hover:brightness-110" : tone ? CTA_TONED : available ? CTA_DEFAULT : "bg-raised text-ink-tertiary",
        )}
      >
        {active ? <PhoneOff size={15} /> : <AudioLines size={16} strokeWidth={2.25} />}
        {!available && !active && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warning ring-2 ring-app" aria-hidden="true" />}
      </button>

      {motion.shown && view && (
        <div
          id={popoverId}
          role="group"
          aria-label={view.title}
          data-voice-unavailable={view.cause}
          className={cn("absolute bottom-full right-0 z-30 mb-2 w-[300px] rounded-xl border border-hairline popover-surface bg-panel p-3 text-left shadow-2xl", motion.className)}
          {...motion.exitProps}
        >
          <div className="text-[13px] font-medium text-ink">{view.title}</div>
          {view.lines.map((line, index) => (
            <div key={index} className="mt-1 text-[12px] leading-[1.45] text-ink-secondary">{line}</div>
          ))}
          {view.actions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {view.actions.includes("open-connections") && (
                <button
                  type="button"
                  data-voice-action="open-connections"
                  onClick={() => {
                    setOpen(false);
                    dispatch({ type: "toggleAppSettings", open: true, section: "providers" });
                    // Grok voice runs on the xAI key (2026-10-14): open its row.
                    openProviderKeyDialog("xai");
                  }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110"
                >
                  {t("voiceMode.openXaiKey")}
                </button>
              )}
              {view.actions.includes("add-key") && keysUrl && (
                <button
                  type="button"
                  data-voice-action="add-key"
                  onClick={() => {
                    setOpen(false);
                    if (window.ogb?.openExternal) void window.ogb.openExternal(keysUrl);
                    else window.open(keysUrl, "_blank", "noopener");
                  }}
                  className="rounded-lg border border-hairline px-3 py-1.5 text-[12px] text-ink hover:bg-raised"
                >
                  {t("voiceMode.addOwnKey")}
                </button>
              )}
              {view.actions.includes("retry") && botId && (
                <button
                  type="button"
                  data-voice-action="retry"
                  onClick={() => {
                    void refreshVoiceMode(botId).then((next) => {
                      if (next.state === "ready" && realtimeCallReady(next.status)) start();
                    });
                  }}
                  className="rounded-lg border border-hairline px-3 py-1.5 text-[12px] text-ink hover:bg-raised"
                >
                  {t("voiceMode.retry")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
