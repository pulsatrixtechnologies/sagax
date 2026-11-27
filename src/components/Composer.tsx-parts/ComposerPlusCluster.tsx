import type { ReactNode, RefObject } from "react";
import { ImagePlay, Target } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Bot, Group } from "@/state/store";
import type { DictationEngine } from "@/lib/composer-dictation";
import type { MyChromeRecordingResult } from "@/lib/my-chrome";
import { COMPOSER_NARROW_ONLY, ComposerPlusMenu, type PlusMenuItem } from "../ComposerControls";
import { MemePicker, type MemeAttachmentPick } from "../MemePicker";
import { TeachChooserDialog, TeachStepsDialog } from "../TeachStepsDialog";
import { MyChromeRecordDialog } from "../MyChromeRecordDialog";

/** The + control and the dialogs that hang off it (attach, GIF, teach, goal). */
export function ComposerPlusCluster({
  locked,
  bot,
  group,
  composerRowRef,
  fileInput,
  plusItems,
  plusRows,
  onSendMeme,
  memesOpen,
  setMemesOpen,
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
  attachmentPending,
}: {
  locked: boolean;
  bot?: Bot;
  group?: Group;
  composerRowRef: RefObject<HTMLDivElement | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  plusItems: PlusMenuItem[];
  plusRows?: (close: () => void) => ReactNode;
  onSendMeme?: (attachment: MemeAttachmentPick) => void;
  memesOpen: boolean;
  setMemesOpen: (open: boolean) => void;
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
  attachmentPending: boolean;
}) {
  if (locked) return null;
  const plusAnchorRef = {
    get current() { return composerRowRef.current?.querySelector<HTMLElement>("[data-composer-plus]") ?? null; },
  };
  const items: PlusMenuItem[] = onSendMeme
    ? plusItems.flatMap((item) => item.id === "attach"
      ? [item, {
        id: "gif",
        group: "add" as const,
        label: t("composer.plus.gif"),
        icon: <ImagePlay size={16} aria-hidden="true" />,
        disabled: attachmentPending || locked,
        onSelect: () => setMemesOpen(true),
      }]
      : [item])
    : plusItems;
  return (
    <>
      <ComposerPlusMenu items={items} rows={plusRows} rowsClassName={COMPOSER_NARROW_ONLY} />
      {onSendMeme && (
        <MemePicker
          open={memesOpen}
          onClose={() => setMemesOpen(false)}
          anchorRef={plusAnchorRef}
          onPick={onSendMeme}
          onUploadLocal={() => fileInput.current?.click()}
        />
      )}
      {teachChooser && bot && <TeachChooserDialog botName={bot.name}
        anchorRef={plusAnchorRef}
        onShow={browserTeach ? showInBrowser : undefined}
        onShowInMyChrome={myChromeOffered ? () => setMyChromeRecord(true) : undefined}
        onDescribe={learnAvailable ? () => startDraftWith("/learn ") : undefined} onClose={() => setTeachChooser(false)} />}
      {myChromeRecord && bot && <MyChromeRecordDialog botId={bot.id} botName={bot.name} dictationEngine={engine}
        anchorRef={plusAnchorRef}
        onDone={(result) => { setMyChromeTaught(result); setMyChromeRecord(false); }} onClose={() => setMyChromeRecord(false)} />}
      {myChromeTaught && bot && <TeachStepsDialog botId={bot.id} botName={bot.name} steps={myChromeTaught.steps} recordedAt={myChromeTaught.recordedAt}
        replay={myChromeTaught.replay} onClose={() => setMyChromeTaught(null)} />}
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
    </>
  );
}
