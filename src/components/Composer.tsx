import { api } from "@/state/store";
import { COMPOSER_ATTACH_EVENT } from "./Composer.tsx-parts/constants";
import type { ComposerProps } from "./Composer.tsx-parts/types";

import { useComposerSession } from "./Composer.tsx-parts/useComposerSession";
import { useComposerFocus } from "./Composer.tsx-parts/useComposerFocus";
import { useComposerDraftState } from "./Composer.tsx-parts/useComposerDraft";
import { useComposerCommands } from "./Composer.tsx-parts/useComposerCommands";
import { useComposerQueue } from "./Composer.tsx-parts/useComposerQueue";
import { useComposerSend } from "./Composer.tsx-parts/useComposerSend";
import { useComposerVoice } from "./Composer.tsx-parts/useComposerVoice";
import { useComposerKeyDown } from "./Composer.tsx-parts/useComposerKeyDown";
import { ComposerShell } from "./Composer.tsx-parts/ComposerShell";

/** Asked by the desktop mascot's balloon (FloatingBots.tsx): `detail.botId`'s composer opens its file picker. */
export { COMPOSER_ATTACH_EVENT };

/** Renders the editable message composer and its pending attachments. */
export function Composer({
  bot: profile,
  group,
  members,
  onEditLast,
  nudgePeer = null,
  nudgeGroup = null,
  replyTo,
  onClearReply,
  onConsumeReply,
  onRestoreReply,
  aboutPage,
  focusOnOpen = true,
  onRetryLast,
}: ComposerProps) {
  const session = useComposerSession({ profile, group, members });
  const { bot, threadId } = session;

  const draftId = group
    ? `group:${group.id}:${group.threadId}`
    : `bot:${bot?.id ?? ""}:${bot?.threadId ?? ""}`;

  const focus = useComposerFocus({ draftId, focusOnOpen, replyTo });

  const draft = useComposerDraftState({
    draftId,
    bot,
    group,
    onRestoreReply,
    inputRef: focus.inputRef,
    setCaret: focus.setCaret,
    setDismissedAt: focus.setDismissedAt,
    imageTargetsSupport: session.imageTargetsSupport,
  });

  const commands = useComposerCommands({
    text: draft.text,
    caret: focus.caret,
    setCaret: focus.setCaret,
    editText: draft.editText,
    setChannelMode: draft.setChannelMode,
    bot,
    group,
    members,
    storeBots: session.storeBots,
    config: session.config,
    instances: session.instances,
    routines: session.routines,
    ownerOrAdmin: session.ownerOrAdmin,
    remoteClient: session.remoteClient,
    threadId,
    api,
    dispatch: session.dispatch as never,
    dismissedAt: focus.dismissedAt,
    setDismissedAt: focus.setDismissedAt,
    dismissedSlashAt: focus.dismissedSlashAt,
    setDismissedSlashAt: focus.setDismissedSlashAt,
    inputRef: focus.inputRef,
    mentionListRef: focus.mentionListRef,
    commandListRef: focus.commandListRef,
  });

  const queue = useComposerQueue({
    threadId,
    draftId,
    draftIdRef: focus.draftIdRef,
    inputRef: focus.inputRef,
    fileInput: focus.fileInput,
    bot,
    group,
    busy: session.busy,
    locked: session.locked,
    canSteer: session.canSteer,
    approval: session.approval,
    dispatch: session.dispatch as never,
  });

  const sendApi = useComposerSend({
    draftId,
    text: draft.text,
    setText: draft.setText,
    attachments: draft.attachments,
    setAttachments: draft.setAttachments,
    editText: draft.editText,
    editAttachments: draft.editAttachments,
    effectiveText: draft.effectiveText,
    effectiveChannelMode: draft.effectiveChannelMode,
    channelMode: draft.channelMode,
    setChannelMode: draft.setChannelMode,
    attachmentPending: draft.attachmentPending,
    engineSupportsImages: draft.engineSupportsImages,
    imageTargetsSupport: session.imageTargetsSupport,
    locked: session.locked,
    busy: session.busy,
    canSteer: session.canSteer,
    autoRoutesBusySend: session.autoRoutesBusySend,
    sendBlock: session.sendBlock,
    sendState: session.sendState,
    bot,
    group,
    threadId,
    replyTo,
    onConsumeReply,
    onRestoreReply,
    restoreDraft: draft.restoreDraft,
    addAttachments: draft.addAttachments,
    dispatch: session.dispatch as never,
    getState: session.getState as never,
    config: session.config,
    threads: session.threads,
    currentBotId: session.currentBotId,
    sendLabel: session.sendLabel,
    interruptTurn: queue.interruptTurn,
    runLoopCommand: commands.runLoopCommand,
    runGoalSubcommand: commands.runGoalSubcommand,
    goalStatus: commands.goalStatus,
    inputRef: focus.inputRef,
    setCaret: focus.setCaret,
    setAttachmentNotice: draft.setAttachmentNotice,
    refocusInput: focus.refocusInput,
  });

  const voice = useComposerVoice({
    bot,
    group,
    remoteClient: session.remoteClient,
    capabilities: session.capabilities,
    threadId,
    draftId,
    text: draft.text,
    caret: focus.caret,
    setCaret: focus.setCaret,
    editText: draft.editText,
    editAttachments: draft.editAttachments,
    setChannelMode: draft.setChannelMode,
    typedGoalText: draft.typedGoalText,
    effectiveChannelMode: draft.effectiveChannelMode,
    learnAvailable: commands.learnAvailable,
    browserTeach: commands.browserTeach,
    myChromeOffered: commands.myChromeOffered,
    setTeachChooser: commands.setTeachChooser,
    setMyChromeRecord: commands.setMyChromeRecord,
    showInBrowser: commands.showInBrowser,
    fileInput: focus.fileInput,
    inputRef: focus.inputRef,
    dispatch: session.dispatch as never,
    send: sendApi.send,
  });

  const onKeyDown = useComposerKeyDown({
    commandPickerOpen: commands.commandPickerOpen,
    mentionPickerOpen: commands.mentionPickerOpen,
    commandCandidates: commands.commandCandidates,
    candidates: commands.candidates,
    highlight: commands.highlight,
    setHighlight: commands.setHighlight,
    pickCommand: commands.pickCommand,
    pickMention: commands.pickMention,
    slash: commands.slash,
    mention: commands.mention,
    setDismissedSlashAt: focus.setDismissedSlashAt,
    setDismissedAt: focus.setDismissedAt,
    onClearReply,
    replyTo,
    recording: voice.recording,
    busy: session.busy,
    locked: session.locked,
    hasContent: sendApi.hasContent,
    onEditLast,
    interruptTurn: queue.interruptTurn,
    sendKey: session.sendKey,
    canSteer: session.canSteer,
    steerAgainUntilRef: queue.steerAgainUntilRef,
    pendingCount: queue.pendingCount,
    steerQueued: queue.steerQueued,
    send: sendApi.send,
    dictation: voice.dictation,
    micHold: voice.micHold,
    pressMic: voice.pressMic,
    toggleMic: voice.toggleMic,
  });

  return (
    <ComposerShell
      session={session}
      draft={draft}
      focus={focus}
      commands={commands}
      queue={queue}
      sendApi={sendApi}
      voice={voice}
      onKeyDown={onKeyDown}
      group={group}
      nudgePeer={nudgePeer}
      nudgeGroup={nudgeGroup}
      replyTo={replyTo}
      onClearReply={onClearReply}
      members={members}
      aboutPage={aboutPage}
      onRetryLast={onRetryLast}
    />
  );
}
