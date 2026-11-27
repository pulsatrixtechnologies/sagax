import type { ReactNode, RefObject } from "react";
import { ArrowUp, Clock, Square } from "lucide-react";
import { t } from "@/lib/i18n";
import { sendBlockStops, type SendBlock } from "@/lib/send-state";
import type { Bot, Group } from "@/state/store";
import { ModelPicker, type ComposerModelMenuControl } from "../ModelPicker";
import { CallButton } from "../CallView";
import { NudgeButton } from "../NudgeButton";
import { ComposerVoiceButton } from "../ComposerVoiceButton";
import { noteVoiceModeUsed } from "@/lib/composer-voice";
import {
  COMPOSER_WIDE_ONLY,
  ComposerCtaSeat,
  ComposerMicButton,
  ComposerSendButton,
  DictationChip,
  SECONDARY_CIRCLE,
  VoiceNoteChip,
} from "../ComposerControls";
import type { botCtaColors } from "@/lib/voice-cta";
import type { ComposerBarItem } from "@/lib/composer-bar-layout";
import { ComposerMovable, type ComposerCustomizeApi } from "./ComposerCustomize";

type CtaTone = ReturnType<typeof botCtaColors> | null;
type DictationEngine = "native" | "xai" | null;

export function ComposerActionBar({
  bot,
  group,
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
  interruptTurn,
  sendLabelFor,
  sendTitleFor,
  nudgePeer,
  nudgeGroup,
  meter,
  trailingOrder = ["model", "usage", "voice"],
  plusSlot,
  customize,
}: {
  bot?: Bot;
  group?: Group;
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
  /** Stops this conversation's running turn (same path as Escape / typed stop). */
  interruptTurn: () => void;
  sendLabelFor: () => string;
  sendTitleFor: () => string;
  nudgePeer?: { id: string; name: string; threadId?: string } | null;
  nudgeGroup?: { id: string; name: string } | null;
  /** Usage pill when placement is inBar (D-20261127-001). */
  meter?: ReactNode;
  /** Right-of-field movable items in order (D-20261126-014). */
  trailingOrder?: readonly ComposerBarItem[];
  /** The + cluster when the layout puts it right of the field. */
  plusSlot?: ReactNode;
  customize?: ComposerCustomizeApi;
}) {
  const customizing = Boolean(customize?.customizing);
  const wrap = (id: ComposerBarItem, node: ReactNode) => {
    if (!node) return null;
    if (!customize) return node;
    return (
      <ComposerMovable id={id} customizing={customizing} api={customize}>
        {node}
      </ComposerMovable>
    );
  };

  const modelChip = bot && !group && !remoteClient ? (
    // M-20261126-104: the model chip sits inside the message box again.
    // #2106: picking writes the bot's model for every thread. #4093: a narrow
    // box folds the chip away; the + menu's Model row opens the same menu
    // through menuControl.
    <span data-composer-model-chip="" className={COMPOSER_WIDE_ONLY}>
      <ModelPicker inComposer key={bot.threadId} bot={bot} threadId={threadId}
        menuControl={modelMenu}
        fallbackAnchor={() => composerRowRef.current?.querySelector<HTMLElement>("[data-composer-plus]") ?? null} />
    </span>
  ) : null;

  const usage = meter ? <span data-composer-meter-slot="">{meter}</span> : null;

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
  const voiceControl = locked || dictating || voiceNoting ? null : (
    <ComposerVoiceButton
      engine={engine}
      dictation={<ComposerMicButton onClick={clickMic} onPress={pressMic} onRelease={releaseMic} needsSetup={!engine} engine={engine} shortcut={dictationShortcut} />}
      conversation={bot && !group ? <CallButton bot={bot} tone={ctaTone} onStart={() => noteVoiceModeUsed("conversation")} /> : undefined}
    />
  );
  // Send stays fixed at the end of the bar (D-20261126-014). Voice moves with
  // the order; when it is the last trailing item it still shares the CTA seat
  // with Send (the default look).
  const voiceOnTrailing = trailingOrder.includes("voice");
  const voiceIsLast = voiceOnTrailing && trailingOrder[trailingOrder.length - 1] === "voice";

  const slot = (id: ComposerBarItem): ReactNode => {
    switch (id) {
      case "plus": return wrap("plus", plusSlot ?? null);
      case "model": return wrap("model", modelChip);
      case "usage": return wrap("usage", usage);
      case "voice":
        if (!voiceControl) return null;
        if (voiceIsLast) {
          return <ComposerCtaSeat typed={typed} send={sendButton} voice={wrap("voice", voiceControl)} />;
        }
        return wrap("voice", voiceControl);
      default: return null;
    }
  };

  return (
    <div data-composer-actions className="composer-band flex items-center gap-2 @max-[30rem]/composer:ml-auto">
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
    {trailingOrder.map((id) => <span key={id} className="contents">{slot(id)}</span>)}
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
  {/* Send fixed at the end when voice is absent from this side or not last. */}
  {!dictating && !voiceNoting && !retroSkin && !voiceIsLast ? sendButton : null}
    {nudgePeer && <NudgeButton principalId={nudgePeer.id} name={nudgePeer.name} threadId={nudgePeer.threadId} />}
    {!nudgePeer && nudgeGroup && <NudgeButton groupId={nudgeGroup.id} name={nudgeGroup.name} />}
    </div>
  );
}
