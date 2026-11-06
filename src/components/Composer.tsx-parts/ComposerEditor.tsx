import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { DictationEngine } from "@/lib/composer-dictation";
import type { ConfigStatus } from "@/state/store";
import { Target } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { composerPlaceholder } from "@/lib/composer-placeholder";
import { ultracodeFromSelection } from "@/lib/ultracode-chrome";
import { isDictationHold } from "@/lib/composer-dictation";
import type { Bot, Group } from "@/state/store";
import type { RoomMentionPerson } from "@/lib/person-mentions";
import { MentionTextarea } from "../MentionTextarea";
import { ComposerReplyStrip } from "../ReplyQuote";
import { ComposerPlusMenu, type PlusMenuItem } from "../ComposerControls";
import { MemePicker, MemePickerButton, type MemeAttachmentPick } from "../MemePicker";
import { TeachChooserDialog, TeachStepsDialog } from "../TeachStepsDialog";
import { MyChromeRecordDialog } from "../MyChromeRecordDialog";
import type { MyChromeRecordingResult } from "@/lib/my-chrome";
import { groupComposerHint, jevRoomRoutingOn } from "@/lib/group-routing";
import type { Message } from "@/state/store";

export function ComposerEditor({
  bot,
  group,
  members,
  storeBots,
  roomPeople,
  locked,
  replyTo,
  onClearReply,
  composerRowRef,
  fileInput,
  onPickFiles,
  plusItems,
  teachChooser,
  setTeachChooser,
  browserTeach,
  showInBrowser,
  myChromeOffered,
  myChromeRecord,
  setMyChromeRecord,
  myChromeTaught,
  setMyChromeTaught,
  learnAvailable,
  startDraftWith,
  engine,
  goalModeOn,
  leaveGoalMode,
  inputRef,
  text,
  onEditText,
  setCaret,
  setDismissedAt,
  setDismissedSlashAt,
  handlePaste,
  onKeyDown,
  micHold,
  dictation,
  approval,
  openQuestions,
  attachmentPending,
  recording,
  busy,
  channelMode,
  config,
  composerAria,
  onSendMeme,
  children,
}: {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  storeBots: Bot[];
  roomPeople: RoomMentionPerson[];
  locked: boolean;
  replyTo?: Message | null;
  onClearReply?: () => void;
  composerRowRef: RefObject<HTMLDivElement | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  onPickFiles: (files: FileList | null) => void;
  plusItems: PlusMenuItem[];
  teachChooser: boolean;
  setTeachChooser: (v: boolean) => void;
  browserTeach: boolean;
  showInBrowser: () => void;
  myChromeOffered: boolean;
  myChromeRecord: boolean;
  setMyChromeRecord: (v: boolean) => void;
  myChromeTaught: MyChromeRecordingResult | null;
  setMyChromeTaught: (v: MyChromeRecordingResult | null) => void;
  learnAvailable: boolean;
  startDraftWith: (command: "/learn " | "/setup ") => void;
  engine: DictationEngine | null;
  goalModeOn: boolean;
  leaveGoalMode: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onEditText: (next: string) => void;
  setCaret: (n: number | ((prev: number) => number)) => void;
  setDismissedAt: (v: number | null) => void;
  setDismissedSlashAt: (v: number | null) => void;
  handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  micHold: { current: { at: number; started: boolean } | null };
  dictation: { stop: () => void };
  approval: unknown;
  openQuestions: { id?: string }[];
  attachmentPending: boolean;
  recording: boolean;
  busy: boolean;
  channelMode: "chat" | "goal";
  config: ConfigStatus | null | undefined;
  composerAria: string;
  /** #2121: pick a meme and send it now. */
  onSendMeme?: (attachment: MemeAttachmentPick) => void;
  children?: ReactNode;
}) {
  const [memesOpen, setMemesOpen] = useState(false);
  const memesBtnRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      {/* App-ground from the pill midline down, full-bleed. Bubbles may
          tuck into the top half of the radius; they must not show below
          center. End at the dock's pb-4 padding: a viewport-height
          backdrop extends the document and lets focus scroll the header
          away. Only the decoration is bounded; upward menus stay free. */}
      <div
        aria-hidden
        data-composer-backdrop
        className="pointer-events-none absolute -left-[50vw] -right-[50vw] -bottom-4 top-1/2 bg-app [[data-page-stage-chat]_&]:hidden"
      />
    {/* One row while it fits: chips, editor, mic. Below the container
        width where the chips and the placeholder cannot share a line,
        the editor takes a full line of its own above the chips.
        The same row in Simple and Advanced mode. */}
    <div
      data-tour="composer"
      data-ultracode={bot && ultracodeFromSelection(bot.modelSelection) ? "" : undefined}
      className={cn(
        "@container/composer relative z-[1] min-h-11 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5 shadow-[0_2px_8px_-1px_#0000000d,0_1px_2px_#00000008,0_0_0_1px_#e4e4e40a] transition-colors hover:border-border-strong focus-within:border-border-strong",
        bot && ultracodeFromSelection(bot.modelSelection) && "ultracode-chrome",
      )}
    >
    {replyTo && <ComposerReplyStrip message={replyTo} fallbackName={bot?.name} onClear={onClearReply} />}
    <div ref={composerRowRef} data-composer-row className="flex items-end gap-1 @max-[30rem]/composer:flex-wrap">
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void onPickFiles(e.target.files);
          // same file twice in a row still fires onChange
          e.target.value = "";
        }}
      />
      {!locked && (
        <div className="composer-band flex flex-wrap items-center gap-2">
          {/* One + (Grok Bot's): attach and teach a task, the modes
              (goal, setup), then this conversation's model and approval
              level as rows that open beside it (2026-10-15/16; the
              model since 2026-10-18, no workspace row since #743). */}
          <ComposerPlusMenu items={plusItems} />
          {onSendMeme && (
            <>
              <MemePickerButton
                open={memesOpen}
                onToggle={() => setMemesOpen((v) => !v)}
                buttonRef={memesBtnRef}
                disabled={attachmentPending || locked}
              />
              <MemePicker
                open={memesOpen}
                onClose={() => setMemesOpen(false)}
                anchorRef={memesBtnRef}
                onPick={onSendMeme}
                onUploadLocal={() => fileInput.current?.click()}
              />
            </>
          )}
          {teachChooser && bot && <TeachChooserDialog botName={bot.name}
            anchorRef={{ get current() { return composerRowRef.current?.querySelector<HTMLElement>("[data-composer-plus]") ?? null; } }}
            onShow={browserTeach ? showInBrowser : undefined}
            onShowInMyChrome={myChromeOffered ? () => setMyChromeRecord(true) : undefined}
            onDescribe={learnAvailable ? () => startDraftWith("/learn ") : undefined} onClose={() => setTeachChooser(false)} />}
          {myChromeRecord && bot && <MyChromeRecordDialog botId={bot.id} botName={bot.name} dictationEngine={engine}
            anchorRef={{ get current() { return composerRowRef.current?.querySelector<HTMLElement>("[data-composer-plus]") ?? null; } }}
            onDone={(result) => { setMyChromeTaught(result); setMyChromeRecord(false); }} onClose={() => setMyChromeRecord(false)} />}
          {myChromeTaught && bot && <TeachStepsDialog botId={bot.id} botName={bot.name} steps={myChromeTaught.steps} recordedAt={myChromeTaught.recordedAt}
            replay={myChromeTaught.replay} onClose={() => setMyChromeTaught(null)} />}
          {/* /goal or the + menu's Goal mode starts it; the chip appears
              only while it is on, says so, and turns it off
              (2026-10-14: the chip only when it shows the current goal). */}
          {((group && !group.dm) || !group) && goalModeOn && (
            <button
              type="button"
              data-composer-goal
              aria-pressed
              aria-label={t("composer.goal.aria")}
              title={t("composer.goal.title")}
              onClick={leaveGoalMode}
              className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/35 bg-accent/10 px-3 text-[13px] text-accent transition-colors"
            >
              <Target size={14} aria-hidden="true" />
              /goal
            </button>
          )}
        </div>
      )}
      <MentionTextarea
      wrapperClassName="@max-[30rem]/composer:order-first @max-[30rem]/composer:basis-full"
      inputRef={inputRef}
      peers={group ? [...(members ?? []), ...roomPeople.map((person) => ({ name: person.name, person: true as const }))] : storeBots.filter((member) => member.id !== bot?.id)}
      everyone={Boolean(group && !group.dm)}
      // the message is composed in the writer's language, not the UI's
      dir="auto"
      rows={1}
      value={text}
      onChange={(e) => {
        onEditText(e.target.value);
        setCaret(e.target.selectionStart ?? e.target.value.length);
        setDismissedAt(null);
        setDismissedSlashAt(null);
      }}
      onPaste={handlePaste}
      onKeyUp={(e) => {
        setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0);
        // letting go of the shortcut after a hold ends the dictation
        if (e.key.toLowerCase() === "d" || e.key === "Meta" || e.key === "Control") {
          const hold = micHold.current;
          micHold.current = null;
          if (hold?.started && isDictationHold(hold.at, Date.now())) dictation.stop();
        }
      }}
      onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
      onKeyDown={onKeyDown}
      // an upload in flight must not disable the box: a disabled element
      // drops keyboard focus and never gets it back, so the writer had to
      // click the input again after every pasted image (#1014). send()
      // already refuses while an attachment is pending. A pending
      // approval does not disable it either (2026-10-29).
      disabled={locked}
      aria-busy={bot?.awaitingThreadSnapshot || undefined}
      placeholder={composerPlaceholder({
        approval: Boolean(approval),
        question: openQuestions.length > 0,
        attachmentPending,
        recording,
        busy,
        groupName: group?.name,
        goalMode: channelMode === "goal",
        groupHint: () => groupComposerHint(group!, members ?? [], { jevOn: jevRoomRoutingOn(config) }),
        botName: bot?.name ?? "",
      })}
      aria-label={composerAria}
        className="block max-h-[7.5rem] min-h-6 w-full resize-none overflow-y-auto bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none"
      />
      {children}
    </div>
    </div>
    </div>
  );
}
