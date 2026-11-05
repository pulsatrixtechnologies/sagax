import { Loader2, PhoneOff, X } from "lucide-react";
import { endCall } from "@/lib/call";
import { normalizeState } from "@/lib/mascot";
import { speaker } from "@/lib/tts";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import type { Phase } from "./types";

export function GroupCallStage(props: {
  group: Group;
  members: Bot[];
  phase: Phase;
  heard: string;
  note: string | null;
  speakingMemberId: string | null;
  pushToTalk: boolean;
  speechCaption: string | null | undefined;
  speechError: string | null | undefined;
  onListen: () => void;
  onInterrupt: () => void;
}) {
  const {
    group,
    members,
    phase,
    heard,
    note,
    speakingMemberId,
    pushToTalk,
    speechCaption,
    speechError,
    onListen,
    onInterrupt,
  } = props;

  const speakingMember = members.find((member) => member.id === speakingMemberId);
  const workingMember = members.find((member) => member.id === group.busyBotId);
  const focusId = speakingMember?.id ?? workingMember?.id;
  const status =
    phase === "listening"
      ? pushToTalk
        ? "Push to talk"
        : "Listening"
      : phase === "sending"
        ? "Bringing the group in"
        : phase === "speaking"
          ? (speakingMember?.name ?? "Group member") + " is speaking"
          : workingMember
            ? workingMember.name + " is working"
            : "Working";

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-app/95 px-8 backdrop-blur-sm">
      <button
        onClick={() => endCall(group.id)}
        aria-label={t("call.live.hangUp")}
        className="absolute right-5 top-5 rounded-md p-2 text-ink-secondary hover:bg-raised hover:text-ink"
      >
        <X size={18} />
      </button>

      <div className="max-w-full overflow-x-auto px-4 py-3">
        <div className="flex min-w-max items-end justify-center gap-3">
          {members.map((member) => {
            const focused = member.id === focusId;
            const state =
              speakingMember?.id === member.id
                ? "sending"
                : workingMember?.id === member.id
                  ? "working"
                  : phase === "listening"
                    ? "listening"
                    : normalizeState(member.mascotExpression) ?? "happy";
            return (
              <div
                key={member.id}
                className={cn(
                  "flex w-[124px] flex-col items-center gap-2 rounded-3xl px-2 py-3 transition-[scale,opacity,background-color,box-shadow] duration-moderate ease-out-quint motion-reduce:transition-none",
                  focused ? "scale-105 bg-raised/70 shadow-lg" : "opacity-75",
                )}
              >
                <BotAvatar
                  bot={member}
                  state={state}
                  size={94}
                  animated
                  motion={workingMember?.id === member.id ? "working" : "none"}
                  motionKey={workingMember?.id === member.id ? 1 : 0}
                />
                <span className={cn("text-[13px] font-medium", focused ? "text-ink" : "text-ink-secondary")}>
                  {member.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center">
        <div className="text-[20px] font-medium text-ink">{group.name}</div>
        <div className="flex items-center gap-2 text-[13.5px] text-ink-secondary">
          {(phase === "working" || phase === "sending") && <Loader2 size={13} className="animate-spin" />}
          {status}
        </div>
      </div>

      <div className="min-h-[3.5rem] max-w-[620px] text-center text-[15px] leading-relaxed text-ink">
        {phase === "listening" ? (
          heard || (
            <span className="text-ink-secondary">
              {pushToTalk
                ? "Release Control + Option to send…"
                : "Say a name, say “everyone,” or just talk to the group…"}
            </span>
          )
        ) : phase === "speaking" ? (
          speechCaption
        ) : (
          <span className="text-ink-secondary">{workingMember ? "You’ll hear each response in turn." : ""}</span>
        )}
      </div>

      {note && (
        <div className="flex max-w-[520px] flex-col items-center gap-2 text-center text-[12.5px] text-warning">
          <span>{note}</span>
          <button
            onClick={onListen}
            className="rounded-full border border-warning/40 px-3 py-1.5 text-[12px] hover:bg-warning/10"
          >
            {t("call.tryMicAgain")}
          </button>
        </div>
      )}
      {speechError && <div className="max-w-[460px] text-center text-[12.5px] text-danger">{speechError}</div>}

      <div className="flex items-center gap-3">
        {speaker.isSpeaking() && (
          <button
            onClick={onInterrupt}
            className="rounded-full border border-hairline/50 px-4 py-2 text-[13.5px] text-ink hover:bg-raised"
          >
            Interrupt
          </button>
        )}
        <button
          onClick={() => endCall(group.id)}
          className="flex items-center gap-2 rounded-full bg-danger px-5 py-2.5 text-[14px] font-medium text-white hover:brightness-110"
        >
          <PhoneOff size={16} /> Hang up
        </button>
      </div>

      <div className="text-[11.5px] text-ink-tertiary">
        Hold Control + Option to talk · Say a member’s name to direct the turn · Space interrupts · Esc hangs up
      </div>
    </div>
  );
}
