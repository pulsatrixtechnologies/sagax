import { ArrowUp, Clock, Square } from "lucide-react";
import { t } from "@/lib/i18n";
import { sendBlockStops, type SendBlock } from "@/lib/send-state";
import type { Bot, Group } from "@/state/store";
import { CallButton } from "../CallView";
import { NudgeButton } from "../NudgeButton";
import { ComposerVoiceButton } from "../ComposerVoiceButton";
import { noteVoiceModeUsed } from "@/lib/composer-voice";
import {
  ComposerCtaSeat,
  ComposerMicButton,
  ComposerSendButton,
  DictationChip,
  SECONDARY_CIRCLE,
  VoiceNoteChip,
} from "../ComposerControls";
import type { botCtaColors } from "@/lib/voice-cta";

type CtaTone = ReturnType<typeof botCtaColors> | null;
type DictationEngine = "native" | "xai" | null;

export function ComposerActionBar({
  bot,
  group,
  locked,
  dictating,
  voiceNoting,
  recording,
  engine,
  dictationShortcut,
  clickMic,
  pressMic,
  releaseMic,
  dictation,
  voiceNote,
  sendAfterDictation,
  ctaTone,
  retroSkin,
  send,
  attachmentPending,
  hasContent,
  sendBlock,
  busy,
  canSteer,
  interruptTurn,
  sendLabelFor,
  sendTitleFor,
  nudgePeer,
  nudgeGroup,
}: {
  bot?: Bot;
  group?: Group;
  locked: boolean;
  dictating: boolean;
  voiceNoting: boolean;
  recording: boolean;
  engine: DictationEngine;
  dictationShortcut: string;
  clickMic: () => void;
  pressMic: () => void;
  releaseMic: () => void;
  dictation: {
    seconds: number;
    levels: number[];
    phase: string;
    stop: () => void;
    cancel: () => void;
  };
  voiceNote: {
    seconds: number;
    bars: number[];
    phase: string;
    cancel: () => void;
    finish: () => void | Promise<void>;
  };
  sendAfterDictation: { current: boolean };
  ctaTone: CtaTone;
  retroSkin: boolean;
  send: () => void;
  attachmentPending: boolean;
  hasContent: boolean;
  sendBlock: unknown;
  busy: boolean;
  canSteer: boolean;
  /** Stops this conversation's running turn (same path as Escape / typed stop). */
  interruptTurn: () => void;
  sendLabelFor: () => string;
  sendTitleFor: () => string;
  nudgePeer?: { id: string; name: string; threadId?: string } | null;
  nudgeGroup?: { id: string; name: string } | null;
}) {
  return (
    <div data-composer-actions className="composer-band flex items-center gap-2 @max-[30rem]/composer:ml-auto">
    {/* Stop while the turn runs. Escape in an empty field, or a message that
        only says "stop" / "arrête", still ends it the same way (#2042). */}
    {busy && !locked && !dictating && !voiceNoting && (
      <button
        type="button"
        onClick={interruptTurn}
        aria-label={t("chat.stopTurn")}
        title={t("chat.stop")}
        data-composer-stop=""
        className={SECONDARY_CIRCLE}
      >
        <Square size={14} className="fill-current" aria-hidden="true" />
      </button>
    )}
  {!locked && dictating && (
    <DictationChip
      seconds={dictation.seconds}
      levels={dictation.levels}
      processing={dictation.phase === "processing"}
      onStop={dictation.stop}
      onCancel={dictation.cancel}
      onSend={() => {
        sendAfterDictation.current = true;
        if (recording) dictation.stop();
      }}
      sendTone={ctaTone}
    />
  )}
  {!locked && voiceNoting && (
    <VoiceNoteChip
      seconds={voiceNote.seconds}
      bars={voiceNote.bars}
      sending={voiceNote.phase === "sending"}
      onCancel={voiceNote.cancel}
      onSend={() => void voiceNote.finish()}
      sendTone={ctaTone}
    />
  )}
  {/* Hibou 98 draws Send as a labelled push button, always there */}
  {retroSkin && !locked && (
    <button
      onClick={() => send()}
      disabled={attachmentPending || !hasContent}
      data-r98-send=""
      aria-label={sendLabelFor()}
      title={sendTitleFor()}
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink hover:brightness-110"
    >
      {busy && !canSteer ? <Clock size={15} /> : <ArrowUp size={17} />}
      <span className="r98-send-label">{t("chat.send")}</span>
    </button>
  )}
  {/* No Send button: Enter sends. The seat holds the one voice button
      (M-20261125-072: the mic for dictation or the waves for the voice
      conversation, and its arrow), and the send arrow beside it once
      something is typed (M-20261125-071: the voice button stays usable). */}
  {!dictating && !voiceNoting && (() => {
    const sendButton = !retroSkin && !locked ? (
      <ComposerSendButton
        onClick={() => send()}
        disabled={attachmentPending || !hasContent || sendBlockStops(sendBlock as SendBlock | null)}
        tone={ctaTone}
        queued={busy && !canSteer}
        label={sendLabelFor()}
        title={sendTitleFor()}
      />
    ) : null;
    const typed = Boolean(sendButton && hasContent);
    const voice = locked ? null : (
      <ComposerVoiceButton
        engine={engine}
        dictation={<ComposerMicButton onClick={clickMic} onPress={pressMic} onRelease={releaseMic} needsSetup={!engine} engine={engine} shortcut={dictationShortcut} />}
        // voice mode cannot start in a group chat: no conversation there
        conversation={bot && !group ? <CallButton bot={bot} tone={ctaTone} onStart={() => noteVoiceModeUsed("conversation")} /> : undefined}
      />
    );
    if (!voice) return typed ? sendButton : null;
    return <ComposerCtaSeat typed={typed} send={sendButton} voice={voice} />;
  })()}
    {nudgePeer && <NudgeButton principalId={nudgePeer.id} name={nudgePeer.name} threadId={nudgePeer.threadId} />}
    {!nudgePeer && nudgeGroup && <NudgeButton groupId={nudgeGroup.id} name={nudgeGroup.name} />}
    </div>
  );
}
