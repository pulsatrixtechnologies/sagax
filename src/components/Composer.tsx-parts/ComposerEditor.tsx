import type { ClipboardEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import type { DictationEngine } from "@/lib/composer-dictation";
import type { ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { composerPlaceholder } from "@/lib/composer-placeholder";
import { ultracodeFromSelection } from "@/lib/ultracode-chrome";
import { isDictationHold } from "@/lib/composer-dictation";
import type { Bot, Group } from "@/state/store";
import type { RoomMentionPerson } from "@/lib/person-mentions";
import { MentionTextarea } from "../MentionTextarea";
import { ComposerReplyStrip } from "../ReplyQuote";
import type { PlusMenuItem } from "../ComposerControls";
import type { MemeAttachmentPick } from "../MemePicker";
import type { MyChromeRecordingResult } from "@/lib/my-chrome";
import { groupComposerHint, jevRoomRoutingOn } from "@/lib/group-routing";
import type { Message } from "@/state/store";

/** The composer's field: the menu family's edge (`menu-edge`, the account
 * menu's hairline and shadow), a softer focus step, the raised fill. */
export const COMPOSER_PILL = "@container/composer relative z-[1] min-h-11 rounded-[22px] menu-edge bg-composer px-2 py-[5px] transition-colors focus-within:border-[var(--composer-focus-edge)]";

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
  plusRows,
  below,
  above,
  leading,
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
  /** The + menu's rows that a narrow capsule folds into it (#4093). */
  plusRows?: (close: () => void) => ReactNode;
  /** The quiet row under the box (context / usage when placement is below). */
  below?: ReactNode;
  /** Row above the box (usage when placement is above). */
  above?: ReactNode;
  /** Left-of-field controls (D-20261126-014). Built by ComposerShell. */
  leading?: ReactNode;
  children?: ReactNode;
}) {
  // plusItems and related props stay on the signature so ComposerShell can
  // keep passing them while the + cluster is composed outside; unused here.
  void plusItems; void plusRows; void onSendMeme; void teachChooser; void setTeachChooser;
  void browserTeach; void showInBrowser; void myChromeOffered; void myChromeRecord;
  void setMyChromeRecord; void myChromeTaught; void setMyChromeTaught; void learnAvailable;
  void startDraftWith; void engine; void goalModeOn; void leaveGoalMode;
  return (
    <div className="relative">
      {above}
      {/* App-ground from the pill midline down, full-bleed. Bubbles may
          tuck into the top half of the radius; they must not show below
          center. End at the dock's pb-12 padding: a viewport-height
          backdrop extends the document and lets focus scroll the header
          away. Only the decoration is bounded; upward menus stay free. */}
      <div
        aria-hidden
        data-composer-backdrop
        // from the box's top radius down (22 px, half of a one-line box): the row under the box sits on it too
        className="pointer-events-none absolute -left-[50vw] -right-[50vw] -bottom-4 top-[22px] bg-app [[data-page-stage-chat]_&]:hidden"
      />
    {/* One row while it fits: chips, editor, mic. Below the container
        width where the chips and the placeholder cannot share a line,
        the editor takes a full line of its own above the chips.
        The same row in Simple and Advanced mode. One line is 44 px tall,
        the reference's bar (#4152): the 32 px band, 5 px above and below,
        the hairline. */}
    <div
      data-tour="composer"
      // the message box: a level of the mode menu opened over it stops at the menu's bottom (ModeMenuLevel.tsx)
      data-composer-box=""
      data-ultracode={bot && ultracodeFromSelection(bot.modelSelection) ? "" : undefined}
      className={cn(
        COMPOSER_PILL,
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
      {!locked && leading && (
        <div className="composer-band flex flex-wrap items-center gap-2">
          {leading}
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
        botTitle: bot?.title,
      })}
      aria-label={composerAria}
        className="block max-h-[7.5rem] min-h-6 w-full resize-none overflow-y-auto bg-transparent chat-input-text px-1 py-1.5 focus:outline-none"
      />
      {children}
    </div>
    </div>
    {below}
    </div>
  );
}
