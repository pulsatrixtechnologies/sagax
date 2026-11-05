import type { RefObject } from "react";
import { ArrowUp, Clock } from "lucide-react";
import { t } from "@/lib/i18n";
import { sendBlockLocks, type SendBlock } from "@/lib/send-state";
import type { Bot, Group } from "@/state/store";
import { ModelPicker, type ComposerModelMenuControl } from "../ModelPicker";
import { CallButton } from "../CallView";
import { GroupCallButton } from "../GroupCallView";
import { NudgeButton } from "../NudgeButton";
import {
  ComposerCtaSeat,
  ComposerMicButton,
  ComposerSendButton,
  DictationChip,
  VoiceNoteChip,
} from "../ComposerControls";
import type { botCtaColors } from "@/lib/voice-cta";

type CtaTone = ReturnType<typeof botCtaColors> | null;
type DictationEngine = "native" | "xai" | null;

export function ComposerActionBar({
  bot,
  group,
  members,
  remoteClient,
  locked,
  threadId,
  modelMenu,
  composerRowRef,
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
  sendLabelFor,
  sendTitleFor,
  nudgePeer,
  nudgeGroup,
}: {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  remoteClient: boolean;
  locked: boolean;
  threadId: string;
  modelMenu: RefObject<ComposerModelMenuControl | null>;
  composerRowRef: RefObject<HTMLDivElement | null>;
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
  sendLabelFor: () => string;
  sendTitleFor: () => string;
  nudgePeer?: { id: string; name: string; threadId?: string } | null;
  nudgeGroup?: { id: string; name: string } | null;
}) {
  return (
    <div data-composer-actions className="composer-band flex items-center gap-1 @max-[30rem]/composer:ml-auto">
    {bot && !group && !remoteClient && (
      // no chip: the mascot's model chip opens its menu
      <ModelPicker inComposer headless key={bot.threadId} bot={bot} threadId={threadId}
        menuControl={modelMenu}
        fallbackAnchor={() => composerRowRef.current?.querySelector<HTMLElement>("[data-composer-plus]") ?? null} />
    )}
    {/* No Stop button: Escape in the empty field, or a message that
        only says "stop", ends the running turn. */}
  {!locked && (
    <ComposerMicButton
      onClick={clickMic}
      onPress={pressMic}
      onRelease={releaseMic}
      hidden={dictating || voiceNoting}
      needsSetup={!engine}
      engine={engine}
      shortcut={dictationShortcut}
    />
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
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:brightness-110"
    >
      {busy && !canSteer ? <Clock size={15} /> : <ArrowUp size={17} />}
      <span className="r98-send-label">{t("chat.send")}</span>
    </button>
  )}
  {/* No Send button: Enter sends. Grok Bot's round CTA turns into the
      send arrow while something is typed, Voice otherwise. */}
  {!dictating && !voiceNoting && (() => {
    const sendButton = !retroSkin && !locked ? (
      <ComposerSendButton
        onClick={() => send()}
        disabled={attachmentPending || !hasContent || Boolean(sendBlock)}
        tone={ctaTone}
        queued={busy && !canSteer}
        label={sendLabelFor()}
        title={sendTitleFor()}
      />
    ) : null;
    const typed = Boolean(sendButton && hasContent);
    if (bot && !group) {
      // an engine at its limit or out of credit: no call either (send-state engine_limit)
      if (sendBlockLocks(sendBlock as SendBlock | null)) return null;
      return <ComposerCtaSeat typed={typed} send={sendButton} voice={<CallButton bot={bot} tone={ctaTone} />} />;
    }
    if (group) return typed ? sendButton : <GroupCallButton group={group} members={members ?? []} />;
    return typed ? sendButton : null;
  })()}
    {nudgePeer && <NudgeButton principalId={nudgePeer.id} name={nudgePeer.name} threadId={nudgePeer.threadId} />}
    {!nudgePeer && nudgeGroup && <NudgeButton groupId={nudgeGroup.id} name={nudgeGroup.name} />}
    </div>
  );
}
