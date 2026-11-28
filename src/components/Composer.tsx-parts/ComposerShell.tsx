import { useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { useChatComposerShellClass } from "@/lib/chat-bubble-width";
import { useComposerBottomSpaceStyle } from "@/lib/composer-bottom-space";
import { clearPageCiteDraft, usePageCiteDraft } from "@/lib/page-cite-draft";
import { fixSendBlock } from "@/lib/send-state";
import { effectivePlace } from "@/lib/place";
import { changeDraftAttachmentPending } from "@/lib/drafts";
import { retryAttachmentUpload } from "@/lib/attachment-uploads";
import type { CitationAttachment } from "@/lib/citations";
import type { Bot, Message } from "@/state/store";
import { ComposerAttachments } from "../ComposerAttachments";
import { ComposerCommandMenu } from "../ComposerCommandMenu";
import { ComposerSendBlock } from "../ComposerSendBlock";
import { ComposerFoldedModelRow } from "../ComposerControls";
import { QueuedComposerMessages } from "../ComposerQueuedMessages";
import { WorkplaceNotice } from "../WorkplaceNotice";
import { ComposerNotices } from "./ComposerNotices";
import { ComposerMentionMenu } from "./ComposerMentionMenu";
import { ComposerPendingStrip } from "./ComposerPendingStrip";
import { ComposerEditor } from "./ComposerEditor";
import { ComposerActionBar } from "./ComposerActionBar";
import { ComposerUnderRow } from "./ComposerUnderRow";
import { ComposerMeter } from "../ComposerMeter";
import { ComposerWarningDialogs } from "./ComposerWarningDialogs";
import { composeMessage } from "@/lib/composer-attachments";
import type { MemeAttachmentPick } from "../MemePicker";
import { composerBarSlots, type ComposerBarItem } from "@/lib/composer-bar-layout";
import {
  ComposerBarContextMenu,
  ComposerBelowDropZone,
  ComposerCustomizeChrome,
  ComposerMovable,
  useComposerCustomize,
  useComposerCustomizeLayout,
} from "./ComposerCustomize";
import { ComposerPlusCluster } from "./ComposerPlusCluster";
import { ModelPicker } from "../ModelPicker";
import { COMPOSER_WIDE_ONLY } from "../ComposerControls";
import { CallButton } from "../CallView";
import { ComposerVoiceButton } from "../ComposerVoiceButton";
import { ComposerMicButton } from "../ComposerControls";
import { noteVoiceModeUsed } from "@/lib/composer-voice";

type AnyProps = Record<string, any>;

/** Composes the composer chrome from the extracted hooks and presentational parts. */
export function ComposerShell({
  session,
  draft,
  focus,
  commands,
  queue,
  sendApi,
  voice,
  onKeyDown,
  group,
  nudgePeer,
  nudgeGroup,
  replyTo,
  onClearReply,
  members,
  aboutPage,
  onRetryLast,
}: {
  session: AnyProps;
  draft: AnyProps;
  focus: AnyProps;
  commands: AnyProps;
  queue: AnyProps;
  sendApi: AnyProps;
  voice: AnyProps;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  group?: import("@/state/store").Group;
  nudgePeer?: { id: string; name: string; threadId?: string } | null;
  nudgeGroup?: { id: string; name: string } | null;
  replyTo?: Message | null;
  onClearReply?: () => void;
  members?: Bot[];
  aboutPage?: string;
  onRetryLast?: () => void;
}) {
  const { bot, locked, dispatch, storeBots, config, remoteClient, threadId,
    sendState, sendBlock, busy, canSteer, composerTask,
    openQuestions, pinned, approvalBotFor, modeBot,
    perspicaxOrg, fullAccessAvailable } = session;
  // the placeholder speaks of what is pinned right now: an approval, or a
  // question that typing answers (#3214)
  const pinnedApproval = pinned.current?.kind === "approval" ? pinned.current.pending : undefined;
  const pinnedQuestions = pinned.current?.kind === "question" ? openQuestions : [];
  const { draftId: draftIdValue, text, attachments, attachmentPending, failedSends, channelMode,
    editText, editAttachments, addAttachments, removeAttachment, displayPasteInChatBox,
    attachmentNotice, setAttachmentNotice, engineSupportsImages } = draft;
  const {
    setCaret, setDismissedAt, setDismissedSlashAt,
    inputRef, mentionListRef, commandListRef, fileInput, modelMenu, composerRowRef,
  } = focus;
  const {
    highlight, setHighlight, commandCandidates, candidates,
    commandMotion, mentionMotion, pickCommand, pickMention,
    roomPeople, mentionEveryoneCount, learnAvailable, browserTeach,
    teachChooser, setTeachChooser, myChromeOffered, myChromeRecord, setMyChromeRecord,
    myChromeTaught, setMyChromeTaught, showInBrowser, engineCommands, groupEngineCommands,
  } = commands;
  const {
    queuedMessages, canSteerQueued, steering, interruptTurn, steerQueued, editQueued,
  } = queue;
  const {
    pickFiles, hasContent, sendLabelFor, sendTitleFor, retroSkin, retryFailedSend,
    send, handlePaste, uploadImage, uploadFile,
  } = sendApi;
  const {
    dictation, recording, dictating, voiceNote, voiceNoting, engine,
    pressMic, releaseMic, clickMic, sendAfterDictation,
    dictationShortcut, ctaTone, startDraftWith, goalModeOn, leaveGoalMode, plusItems,
  } = voice;

  // Measured Grok HTML Pages: visible placeholder stays Message <botname>.
  // Source-derived j7O9JP Message about title is the stage-chat aria-label,
  // only on the composer docked on the page (ChatView passes the live title).
  const pageTitle = !group ? aboutPage : undefined;
  const composerAria = pageTitle?.trim()
    ? t("composer.placeholder.page", { title: pageTitle.trim() })
    : t("composer.placeholder.bot", { name: group ? group.name : (bot?.name ?? "") });
  const pageCiteDraft = usePageCiteDraft(threadId);
  const pageCite = group ? null : pageCiteDraft;

  const sendMeme = (pick: MemeAttachmentPick) => {
    const attachment = {
      kind: "image" as const,
      id: crypto.randomUUID(),
      path: pick.path,
      name: pick.name ?? "meme.gif",
      size: 0,
      mime: pick.mime,
      ...(pick.meme ? { meme: pick.meme } : {}),
    };
    const body = composeMessage("", [attachment]);
    if (!body) return;
    const sendId = crypto.randomUUID();
    if (group) {
      dispatch({ type: "sendGroup", groupId: group.id, text: body, sendId, threadId, mode: "chat" });
    } else if (bot) {
      dispatch({ type: "send", botId: bot.id, text: body, sendId, threadId });
    }
  };

  const composerShellClass = useChatComposerShellClass();
  const composerBottomSpaceStyle = useComposerBottomSpaceStyle();
  const { layout, placement } = useComposerCustomizeLayout();
  const customize = useComposerCustomize();
  const [memesOpen, setMemesOpen] = useState(false);
  const showMeter = Boolean(bot && !group && !remoteClient);
  const meter = showMeter ? <ComposerMeter bot={bot} threadId={threadId} /> : null;
  const slots = composerBarSlots(layout, placement);
  const plusCluster = (
    <ComposerPlusCluster
      locked={locked}
      bot={bot}
      group={group}
      composerRowRef={composerRowRef}
      fileInput={fileInput}
      plusItems={plusItems}
      plusRows={bot && !group && !remoteClient
        ? (close) => <ComposerFoldedModelRow bot={bot} modelMenu={modelMenu} close={close} />
        : undefined}
      onSendMeme={locked ? undefined : sendMeme}
      memesOpen={memesOpen}
      setMemesOpen={setMemesOpen}
      teachChooser={teachChooser}
      setTeachChooser={setTeachChooser}
      browserTeach={browserTeach}
      showInBrowser={showInBrowser}
      myChromeOffered={myChromeOffered}
      myChromeRecord={myChromeRecord}
      setMyChromeRecord={setMyChromeRecord}
      myChromeTaught={myChromeTaught}
      setMyChromeTaught={setMyChromeTaught}
      learnAvailable={learnAvailable}
      startDraftWith={startDraftWith}
      engine={engine}
      goalModeOn={goalModeOn}
      leaveGoalMode={leaveGoalMode}
      attachmentPending={attachmentPending}
    />
  );
  const leadingVoice = !locked && !dictating && !voiceNoting ? (
    <ComposerVoiceButton
      engine={engine}
      dictation={<ComposerMicButton onClick={clickMic} onPress={pressMic} onRelease={releaseMic} needsSetup={!engine} engine={engine} shortcut={dictationShortcut} />}
      conversation={bot && !group ? <CallButton bot={bot} tone={ctaTone} onStart={() => noteVoiceModeUsed("conversation")} /> : undefined}
    />
  ) : null;
  const leadingModel = bot && !group && !remoteClient ? (
    <span data-composer-model-chip="" className={COMPOSER_WIDE_ONLY}>
      <ModelPicker inComposer key={`lead-${bot.threadId}`} bot={bot} threadId={threadId}
        menuControl={modelMenu}
        fallbackAnchor={() => (composerRowRef.current?.querySelector("[data-composer-plus]") as HTMLElement | null) ?? null} />
    </span>
  ) : null;
  const renderLeadingItem = (id: ComposerBarItem): ReactNode => {
    const node = id === "plus" ? plusCluster
      : id === "model" ? leadingModel
      : id === "usage" ? (placement === "inBar" ? meter : null)
      : id === "voice" ? leadingVoice
      : null;
    if (!node) return null;
    return (
      <ComposerMovable key={id} id={id} customizing={customize.customizing} api={customize}>
        {node}
      </ComposerMovable>
    );
  };
  const leading = slots.left.map(renderLeadingItem);
  const plusOnTrailing = slots.right.includes("plus");
  const aboveMeter = showMeter && placement === "above" ? (
    <div data-composer-above-row="" className="flex min-h-7 items-center justify-end px-2 pb-1">
      <ComposerMovable id="usage" customizing={customize.customizing} api={customize}>{meter}</ComposerMovable>
    </div>
  ) : null;
  const belowRow = showMeter && placement === "below" ? (
    <ComposerUnderRow meter={
      <ComposerMovable id="usage" customizing={customize.customizing} api={customize}>{meter}</ComposerMovable>
    } />
  ) : null;
  return (
    <div className={composerShellClass} style={composerBottomSpaceStyle}>
      {/* No fill or hairline on this wrapper. The dock overlays the transcript. */}
      <ComposerNotices
        dictationError={dictation.error}
        voiceNoteError={voiceNote.error}
        failedSends={failedSends}
        draftId={draftIdValue}
        onRetryFailed={retryFailedSend}
      />
      <div className="pointer-events-auto relative w-full">
        <WorkplaceNotice place={modeBot ? effectivePlace(modeBot, composerTask) : null} />
        {commandMotion.shown && (
          <ComposerCommandMenu
            listRef={commandListRef}
            className={commandMotion.className}
            exitProps={commandMotion.exitProps}
            items={commandCandidates}
            highlight={highlight}
            loading={group ? groupEngineCommands.loading : engineCommands.loading}
            onRefresh={group
              ? groupEngineCommands.lists.some((list: { answer: { available?: boolean } }) => list.answer.available) ? groupEngineCommands.refresh : undefined
              : engineCommands.answer?.available ? engineCommands.refresh : undefined}
            onPick={pickCommand}
            onHighlight={setHighlight}
          />
        )}
        {mentionMotion.shown && (
          <ComposerMentionMenu
            listRef={mentionListRef}
            className={mentionMotion.className}
            exitProps={mentionMotion.exitProps}
            candidates={candidates}
            highlight={highlight}
            roomPeopleCount={roomPeople.length}
            mentionEveryoneCount={mentionEveryoneCount}
            onPick={pickMention}
            onHighlight={setHighlight}
          />
        )}
        <ComposerPendingStrip
          groupId={group?.id}
          bot={bot}
          pinned={pinned}
          threadId={threadId}
          storeBots={storeBots}
          approvalBotFor={approvalBotFor}
          onCancelTurn={interruptTurn}
        />
        <ComposerAttachments
          items={attachments}
          onAdd={addAttachments}
          onRemove={removeAttachment}
          onChangeCitation={(citation: CitationAttachment) => editAttachments((current: typeof attachments) => current.map((attachment: (typeof attachments)[number]) => attachment.id === citation.id ? citation : attachment))}
          onDisplayInChatBox={displayPasteInChatBox}
          allowImages={engineSupportsImages}
          notice={attachmentNotice}
          onNotice={setAttachmentNotice}
          onPendingChange={(pending: boolean) => changeDraftAttachmentPending(draftIdValue, pending)}
          uploadImage={uploadImage}
          uploadFile={uploadFile}
          onRetry={retryAttachmentUpload}
        />
        <QueuedComposerMessages
          items={queuedMessages}
          onSteer={canSteerQueued ? steerQueued : undefined}
          steerInterrupts={!canSteer}
          steerMode={group ? "next" : "all"}
          steering={steering}
          onCancel={(queueId: string) => {
            if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId });
            else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId });
          }}
          onEdit={locked ? undefined : editQueued}
        />
        {sendBlock && !locked && (
          <ComposerSendBlock
            block={sendBlock}
            onConnect={() => dispatch({ type: "toggleAppSettings", open: true, section: "providers" })}
            onRetry={sendState.recheck}
            onResend={onRetryLast ? () => { onRetryLast(); sendState.recheck(); } : sendState.recheck}
            onFix={bot && sendBlock.action.kind === "fix" ? async () => {
              const fix = sendBlock.action.kind === "fix" ? sendBlock.action.fix : "";
              await fixSendBlock(bot.id, bot.threadId, fix);
              onRetryLast?.();
              sendState.recheck();
            } : undefined}
          />
        )}
        <ComposerCustomizeChrome customizing={customize.customizing} onReset={customize.reset} onDone={customize.end}>
          {customize.customizing && !aboveMeter ? (
            <div className="mb-1 flex min-h-7 items-center justify-end rounded-xl border border-dashed border-hairline px-2" {...customize.dropZoneProps("above")}>
              <span className="text-[11px] text-ink-tertiary">{t("composer.customize.dropAbove")}</span>
            </div>
          ) : null}
          <ComposerEditor
            bot={bot}
            group={group}
            members={members}
            storeBots={storeBots}
            roomPeople={roomPeople}
            locked={locked}
            replyTo={replyTo}
            onClearReply={onClearReply}
            pageCite={pageCite}
            onClearPageCite={pageCite ? () => clearPageCiteDraft(threadId) : undefined}
            composerRowRef={composerRowRef}
            fileInput={fileInput}
            onPickFiles={(files) => { void pickFiles(files); }}
            onSendMeme={locked ? undefined : sendMeme}
            plusItems={plusItems}
            plusRows={bot && !group && !remoteClient
              ? (close) => <ComposerFoldedModelRow bot={bot} modelMenu={modelMenu} close={close} />
              : undefined}
            teachChooser={teachChooser}
            setTeachChooser={setTeachChooser}
            browserTeach={browserTeach}
            showInBrowser={showInBrowser}
            myChromeOffered={myChromeOffered}
            myChromeRecord={myChromeRecord}
            setMyChromeRecord={setMyChromeRecord}
            myChromeTaught={myChromeTaught}
            setMyChromeTaught={setMyChromeTaught}
            learnAvailable={learnAvailable}
            startDraftWith={startDraftWith}
            engine={engine}
            goalModeOn={goalModeOn}
            leaveGoalMode={leaveGoalMode}
            inputRef={inputRef}
            text={text}
            onEditText={editText}
            setCaret={setCaret}
            setDismissedAt={setDismissedAt}
            setDismissedSlashAt={setDismissedSlashAt}
            handlePaste={handlePaste}
            onKeyDown={onKeyDown}
            micHold={voice.micHold}
            dictation={dictation}
            approval={pinnedApproval}
            openQuestions={pinnedQuestions}
            attachmentPending={attachmentPending}
            recording={recording}
            busy={busy}
            channelMode={channelMode}
            config={config}
            composerAria={composerAria}
            leading={leading}
            above={aboveMeter}
            below={!customize.customizing ? belowRow ?? undefined : undefined}
          >
            <ComposerActionBar
              bot={bot}
              group={group}
              remoteClient={remoteClient}
              locked={locked}
              threadId={threadId}
              modelMenu={modelMenu}
              composerRowRef={composerRowRef}
              dictating={dictating}
              voiceNoting={voiceNoting}
              recording={recording}
              engine={engine}
              dictationShortcut={dictationShortcut}
              clickMic={clickMic}
              pressMic={pressMic}
              releaseMic={releaseMic}
              dictation={dictation}
              voiceNote={voiceNote}
              sendAfterDictation={sendAfterDictation}
              ctaTone={ctaTone}
              retroSkin={retroSkin}
              send={send}
              attachmentPending={attachmentPending}
              hasContent={hasContent}
              sendBlock={sendBlock}
              busy={busy}
              canSteer={canSteer}
              interruptTurn={interruptTurn}
              sendLabelFor={sendLabelFor}
              sendTitleFor={sendTitleFor}
              nudgePeer={nudgePeer}
              nudgeGroup={nudgeGroup}
              meter={placement === "inBar" ? meter : undefined}
              trailingOrder={slots.right}
              plusSlot={plusOnTrailing ? plusCluster : undefined}
              customize={customize}
            />
          </ComposerEditor>
          {customize.customizing ? (
            <ComposerBelowDropZone customizing api={customize}>
              {belowRow}
            </ComposerBelowDropZone>
          ) : null}
          <ComposerBarContextMenu anchorRef={composerRowRef} onCustomize={customize.begin} />
        </ComposerCustomizeChrome>
      </div>
      <ComposerWarningDialogs
        dispatch={dispatch}
        perspicaxOrg={perspicaxOrg}
        fullAccessAvailable={fullAccessAvailable}
      />
    </div>
  );
}
