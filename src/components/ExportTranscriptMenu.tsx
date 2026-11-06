import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bug, Check, ChevronRight, Columns2, Copy, Database, Download, LogOut, MoreHorizontal, Package, Rows2, SquarePen, Upload } from "lucide-react";

import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useMenuMotion } from "./MenuMotion";
import { navigateThreadMenu } from "./BotProjects";
import {
  copyTranscriptToClipboard,
  downloadMarkdownTranscript,
  formatTranscriptMarkdown,
  slugifyTranscriptFilename,
} from "@/lib/export-transcript";
import type { Message } from "@/state/store";

/** A row of the menu: the chrome of the sidebar's popover menus. */
const ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover disabled:opacity-60";
/** The submenu opens on a short hover and forgives a diagonal path out. */
const SUB_OPEN_MS = 80;
const SUB_CLOSE_MS = 250;

export interface ExportTranscriptMenuProps {
  /** Title of the conversation (bot name or channel name). */
  title: string;
  /** Messages to export. */
  messages: readonly Message[];
  /** Optional fallback bot name for 1:1 chats. */
  botName?: string;
  /** Whether this is a group room / channel. */
  isGroup?: boolean;
  /** Optional custom CSS classes for the trigger button. */
  className?: string;
  /** Download the bot as its `.sagaxbot.zip` (shown only when given: the
   * viewer may export this bot, src/lib/bot-zip.ts). */
  onExportBot?: () => void;
  /** Open or close the Inspector (Advanced mode; shown only when given). */
  onToggleInspector?: () => void;
  inspectorOpen?: boolean;
  /** The bot's Data window (Experimental; shown only when given). */
  data?: { label: string; onOpen: () => void };
  /** A confidential thread: the copy and the download carry its mark. */
  confidential?: boolean;
  /** A group the viewer may leave (#1480): Leave group, the red last
   * section. The caller asks for confirmation. */
  onLeave?: () => void;
  /** Split right / Split down (#1504): this conversation in a new section
   * of the split view, beside the main chat (src/lib/split-view.ts). */
  onSplit?: (edge: "right" | "bottom") => void;
  /** Clear chat (JC 2026-11-06): a fresh, empty topic with the bot; the
   * earlier ones stay in the history. The first entry of this menu, never a
   * separate header button. `clearChatKey` marks it (the bot's id). */
  onClearChat?: () => void;
  clearChatKey?: string;
}

/**
 * The conversation's one "..." button (2026-10-14): Copy as Markdown,
 * then Export (download the transcript, export the bot as a .zip; a
 * submenu once there are both, 2026-10-16), then the Inspector and the
 * Data window when they are on. It replaces the separate Share, Inspector
 * and Data buttons of the chat header and the bot panel.
 */
export function ExportTranscriptMenu({
  title,
  messages,
  botName,
  isGroup = false,
  className,
  onExportBot,
  onToggleInspector,
  inspectorOpen = false,
  data,
  confidential = false,
  onLeave,
  onSplit,
  onClearChat,
  clearChatKey,
}: ExportTranscriptMenuProps) {
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [sub, setSub] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const resetTimer = useRef<number | null>(null);
  const hoverTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
  }, []);
  useEffect(() => { if (!open) setSub(false); }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const hasMessages = messages && messages.length > 0;

  /** Copy formatted Markdown transcript to clipboard with visual feedback. */
  const handleCopy = async () => {
    if (!hasMessages) return;
    const markdown = formatTranscriptMarkdown({
      title,
      messages,
      botName,
      isGroup,
      ...(confidential ? { confidentialMark: t("confidential.mark") } : {}),
    });
    const success = await copyTranscriptToClipboard(markdown);
    setCopyFailed(!success);
    if (success) {
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    }
  };

  /** Trigger browser download for the formatted Markdown transcript file. */
  const handleDownload = () => {
    if (!hasMessages) return;
    const markdown = formatTranscriptMarkdown({
      title,
      messages,
      botName,
      isGroup,
      ...(confidential ? { confidentialMark: t("confidential.mark") } : {}),
    });
    const filename = slugifyTranscriptFilename(title);
    downloadMarkdownTranscript(filename, markdown);
    setOpen(false);
  };

  // The reference design's sections, Cursor's rule (2026-10-16): Copy, then the
  // exports (a submenu once there are two), then the tools. Nothing here
  // deletes, so the only red last section is Leave group (#1480).
  const exports: Array<{ key: string; label: string; icon: ReactNode; onSelect: () => void; attr?: Record<string, string> }> = [];
  if (hasMessages) exports.push({ key: "download", label: t("chat.export.download"), icon: <Download size={16} className="shrink-0 text-ink" />, onSelect: handleDownload });
  if (onExportBot) exports.push({ key: "bot-zip", label: t("chat.export.botZip"), icon: <Package size={16} className="shrink-0 text-ink" />, onSelect: () => { setOpen(false); onExportBot(); }, attr: { "data-export-bot-zip": "" } });
  const tools = Boolean(onToggleInspector || data);

  const openSub = (focus: boolean) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    setSub(true);
    if (focus) requestAnimationFrame(() => subRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus());
  };
  const hoverSub = (next: boolean) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setSub(next), next ? SUB_OPEN_MS : SUB_CLOSE_MS);
  };
  const exportRow = (entry: (typeof exports)[number], inSub = false) => (
    <button key={entry.key} type="button" role="menuitem" {...entry.attr} onClick={entry.onSelect} className={ROW}
      onPointerOver={inSub ? undefined : () => hoverSub(false)}>
      {entry.icon}
      <span className="flex-1 truncate">{entry.label}</span>
    </button>
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t("chat.moreMenu.aria")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-conversation-menu=""
        {...(onClearChat ? { "data-clear-chat-menu": clearChatKey ?? "" } : {})}
        className={cn(CIRCLE_BUTTON, open && "bg-elevated-hover", className)}
        title={t("chat.moreMenu.aria")}
      >
        <MoreHorizontal size={18} strokeWidth={1.75} />
      </button>

      {motion.shown && (
        <div
          role="menu"
          aria-label={t("chat.moreMenu.aria")}
          onKeyDown={(event) => {
            if (event.target instanceof Element && subRef.current?.contains(event.target)) return;
            navigateThreadMenu(event);
          }}
          className={cn("absolute right-0 top-full z-40 mt-1 flex w-[240px] min-w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 text-[13px] leading-[18px]", motion.className)} {...motion.exitProps}
        >
          {onClearChat && (
            <>
              <button
                type="button"
                role="menuitem"
                data-chat-clear=""
                data-new-topic={clearChatKey ?? ""}
                onClick={() => { setOpen(false); onClearChat(); }}
                onPointerOver={() => hoverSub(false)}
                className={ROW}
              >
                <SquarePen size={16} className="shrink-0 text-ink" />
                <span className="flex-1 truncate">{t("chat.clearChat")}</span>
              </button>
              <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />
            </>
          )}
          {!hasMessages ? (
            <div className="px-2 py-1.5 text-[12px] text-ink-secondary">
              {t("chat.export.empty")}
            </div>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleCopy()}
                onPointerOver={() => hoverSub(false)}
                className={ROW}
              >
                {copied ? (
                  <Check size={16} className="shrink-0 text-success" />
                ) : (
                  <Copy size={16} className="shrink-0 text-ink" />
                )}
                <span className="flex-1 truncate">
                  {copied ? t("chat.export.copied") : t("chat.export.copy")}
                </span>
              </button>

              {copyFailed && (
                <div role="status" className="px-2 py-1.5 text-[12px] text-ink-secondary">
                  {t("chat.export.copyFailed")}
                </div>
              )}
            </>
          )}

          {exports.length === 1 && exportRow(exports[0]!)}
          {exports.length > 1 && (
            <div className="relative" onPointerOver={() => { if (!sub) hoverSub(true); }}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={sub}
                data-export-submenu=""
                onClick={() => (sub ? setSub(false) : openSub(true))}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  openSub(true);
                }}
                className={cn(ROW, sub && "bg-selected")}
              >
                <Upload size={16} className="shrink-0 text-ink" />
                <span className="flex-1 truncate">{t("chat.export.submenu")}</span>
                <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
              </button>
              {sub && (
                // one level, opened toward the window (the button sits at its right edge)
                <div
                  ref={subRef}
                  role="menu"
                  aria-label={t("chat.export.submenu")}
                  data-export-choices=""
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setSub(false);
                      menuRef.current?.querySelector<HTMLElement>("[data-export-submenu]")?.focus();
                      return;
                    }
                    navigateThreadMenu(event);
                  }}
                  className="absolute right-full top-[-6px] z-50 mr-2 flex w-max min-w-[200px] max-w-[320px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5"
                >
                  {exports.map((entry) => exportRow(entry, true))}
                </div>
              )}
            </div>
          )}

          {onSplit && (
            <>
              <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />
              <button
                type="button"
                role="menuitem"
                data-conversation-split="right"
                onClick={() => { setOpen(false); onSplit("right"); }}
                onPointerOver={() => hoverSub(false)}
                className={ROW}
              >
                <Columns2 size={16} className="shrink-0 text-ink" />
                <span className="flex-1 truncate">{t("splitView.splitRight")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-conversation-split="bottom"
                onClick={() => { setOpen(false); onSplit("bottom"); }}
                onPointerOver={() => hoverSub(false)}
                className={ROW}
              >
                <Rows2 size={16} className="shrink-0 text-ink" />
                <span className="flex-1 truncate">{t("splitView.splitDown")}</span>
              </button>
            </>
          )}
          {tools && <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />}
          {onToggleInspector && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={inspectorOpen}
              data-conversation-inspector=""
              title={t("chat.inspectorHint")}
              onClick={() => { setOpen(false); onToggleInspector(); }}
              onPointerOver={() => hoverSub(false)}
              className={ROW}
            >
              <Bug size={16} className="shrink-0 text-ink" />
              <span className="flex-1 truncate">{t("chat.inspector")}</span>
              {inspectorOpen && <Check size={14} className="shrink-0 text-accent" />}
            </button>
          )}
          {data && (
            <button
              type="button"
              role="menuitem"
              data-data-window-button=""
              title={data.label}
              onClick={() => { setOpen(false); data.onOpen(); }}
              onPointerOver={() => hoverSub(false)}
              className={ROW}
            >
              <Database size={16} className="shrink-0 text-ink" />
              <span className="flex-1 truncate">{t("dataWindow.open")}</span>
            </button>
          )}
          {onLeave && (
            <>
              <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />
              <button
                type="button"
                role="menuitem"
                data-conversation-leave-group=""
                onClick={() => { setOpen(false); onLeave(); }}
                onPointerOver={() => hoverSub(false)}
                className={cn(ROW, "text-danger")}
              >
                <LogOut size={16} className="shrink-0" />
                <span className="flex-1 truncate">{t("groupPanel.leave")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
