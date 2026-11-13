import { t } from "@/lib/i18n";
import { useChatComposerShellClass } from "@/lib/chat-bubble-width";
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
import { ComposerWarningDialogs } from "./ComposerWarningDialogs";
import { composeMessage } from "@/lib/composer-attachments";
import type { MemeAttachmentPick } from "../MemePicker";

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
  return (
    <div className={composerShellClass}>
      {/* No fill or hairline on this wrapper — those were the black frame
          in the pill's top corners. The dock overlays the transcript. */}
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
        <ComposerEditor
          bot={bot}
          group={group}
          members={members}
          storeBots={storeBots}
          roomPeople={roomPeople}
          locked={locked}
          replyTo={replyTo}
          onClearReply={onClearReply}
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
          />
        </ComposerEditor>
      </div>
      <ComposerWarningDialogs
        dispatch={dispatch}
        perspicaxOrg={perspicaxOrg}
        fullAccessAvailable={fullAccessAvailable}
      />
    </div>
  );
}
