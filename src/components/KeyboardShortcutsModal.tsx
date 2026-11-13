// The keyboard shortcuts sheet, the reference's way (#4097, measured on the
// reference app, docs/design/ux-reference-grokbot-cursor.md 8.9): a wide
// dialog (900px), the title, then TWO columns of groups (one when narrow),
// each a plain title over borderless rows with a hairline under each: a
// short label with a grey hint beside it, the keys at the right as small
// separate caps. No search field and no footer: the list is generated from
// the one registry (lib/keyboard-shortcuts.ts) and scrolls when it is longer
// than the window.
import { Fragment, useLayoutEffect, useRef } from "react";

import {
  isMacPlatform,
  shortcutGroupsFor,
  shortcutKeysForPlatform,
  type ShortcutGroup,
  type ShortcutItem,
} from "@/lib/keyboard-shortcuts";
import { t } from "@/lib/i18n";
import { useSendKey } from "@/lib/send-key";
import { DIALOG, DialogCloseButton } from "./SettingsPrimitives";

/** Props for the KeyboardShortcutsModal component. */
export interface KeyboardShortcutsModalProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Callback fired when the user requests closing the dialog. */
  onClose: () => void;
}

/** One row of the sheet: the label, its grey hint, the caps. */
export interface ShortcutRowModel {
  id: string;
  label: string;
  hint?: string;
  keys: string[];
}

/** The groups as the sheet shows them: the new-line row becomes the Send
 * row's grey hint ("⇧ Return for new line"), as the reference's Send row;
 * every other row keeps its own line. */
export function shortcutSheetGroups(groups: readonly ShortcutGroup[], isMac: boolean): Array<{ id: string; title: string; rows: ShortcutRowModel[] }> {
  const items = groups.flatMap((group) => group.items);
  const newLine = items.find((item) => item.id === "new-line");
  const toRow = (item: ShortcutItem): ShortcutRowModel => ({
    id: item.id,
    label: item.description,
    hint: item.id === "send-message" && newLine
      ? t("shortcuts.hint.sendNewLine", { keys: shortcutKeysForPlatform(newLine, isMac).join(" ") })
      : item.hint,
    keys: shortcutKeysForPlatform(item, isMac),
  });
  return groups
    .map((group) => ({
      id: group.id ?? group.category,
      title: group.category,
      rows: group.items
        .filter((item) => !(item.id === "new-line" && newLine))
        // a shortcut this platform does not have (Settings is macOS's ⌘,)
        .filter((item) => shortcutKeysForPlatform(item, isMac).length > 0)
        .map(toRow),
    }))
    .filter((group) => group.rows.length > 0);
}

/** The reference's split: groups fill the first column until it holds at
 * least half of the rows, the rest go to the second. */
export function splitShortcutColumns<T extends { rows: unknown[] }>(groups: readonly T[]): [T[], T[]] {
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  let count = 0;
  let index = 0;
  while (index < groups.length && count < total / 2) {
    count += groups[index]!.rows.length;
    index += 1;
  }
  return [groups.slice(0, index), groups.slice(index)];
}

/** One key cap: 20px tall, at least 20px wide, 4px corners, a hairline. */
function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 shrink-0 select-none items-center justify-center rounded border-[0.5px] border-ink/[0.12] bg-ink/[0.04] px-1 py-px font-sans text-[11px] leading-4 tabular-nums text-ink-secondary">
      {children}
    </kbd>
  );
}

/** The caps of a row; "[ / ]" is two caps with a grey "/" between them. */
function KeyCaps({ keys }: { keys: string[] }) {
  return (
    <span dir="ltr" className="inline-flex shrink-0 items-center gap-1" data-shortcut-keys="">
      {keys.map((key, index) => {
        const parts = key.includes(" / ") ? key.split(" / ") : [key];
        return (
          <Fragment key={index}>
            {parts.map((part, at) => (
              <Fragment key={at}>
                {at > 0 && <span className="text-[11px] leading-4 text-ink-tertiary">/</span>}
                <KeyCap>{part}</KeyCap>
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </span>
  );
}

/** A row: borderless, 34px high, a hairline under it but the last; on a
 * narrow window the hint wraps under the label instead of being cut. */
function ShortcutRow({ row }: { row: ShortcutRowModel }) {
  return (
    <li className="flex min-h-[34px] items-center justify-between gap-3 border-b-[0.5px] border-ink/[0.08] text-[14px] leading-5 text-ink last:border-transparent" data-shortcut={row.id}>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 py-1.5 md:flex-nowrap md:overflow-hidden md:whitespace-nowrap md:py-0">
        <span className="shrink-0">{row.label}</span>
        {row.hint && <span className="min-w-0 text-[13px] leading-[18px] text-ink-tertiary md:truncate" data-shortcut-hint="">{row.hint}</span>}
      </span>
      <KeyCaps keys={row.keys} />
    </li>
  );
}

function ShortcutColumn({ groups }: { groups: ReturnType<typeof shortcutSheetGroups> }) {
  return (
    <div className="flex min-w-0 flex-1 basis-0 flex-col gap-5" data-shortcut-column="">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`shortcuts-group-${group.id}`} data-shortcut-group={group.id}>
          <h3 id={`shortcuts-group-${group.id}`} className="pb-1 text-[13px] font-medium leading-[18px] text-ink">{group.title}</h3>
          <ul className="m-0 list-none p-0">
            {group.rows.map((row) => <ShortcutRow key={row.id} row={row} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The keyboard shortcuts sheet: every shortcut of the registry, in the
 * reference's groups and columns.
 */
export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const isMac = isMacPlatform();
  const sendKey = useSendKey();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    bodyRef.current?.focus();
    // Close before unmount so the browser restores focus to the opener.
    return () => dialog.close();
  }, [open]);

  if (!open) return null;

  const [left, right] = splitShortcutColumns(shortcutSheetGroups(shortcutGroupsFor(sendKey), isMac));

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="shortcuts-dialog-title"
      className={`m-auto h-fit max-h-[min(700px,calc(100dvh-48px))] w-[calc(100%-32px)] ${DIALOG.width.xxl} overflow-hidden rounded-[14px] border border-border bg-app p-0 text-ink backdrop:bg-black/50`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[min(700px,calc(100dvh-48px))] flex-col">
        <DialogCloseButton label={t("shortcuts.close")} onClick={onClose} />
        <div className="flex shrink-0 items-center gap-2 pb-2 pl-5 pr-12 pt-4 md:pl-8">
          <h2 id="shortcuts-dialog-title" className="text-[15px] font-semibold leading-[22px] text-ink">
            {t("shortcuts.title")}
          </h2>
        </div>
        <div
          ref={bodyRef}
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-4 pt-2 outline-none md:flex-row md:gap-16 md:px-8"
          data-shortcut-columns=""
        >
          <ShortcutColumn groups={left} />
          {right.length > 0 && <ShortcutColumn groups={right} />}
        </div>
      </div>
    </dialog>
  );
}
