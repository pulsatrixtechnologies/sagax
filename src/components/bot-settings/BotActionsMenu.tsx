// The bot's one "..." menu in the bot panel (JC 2026-10-14). It replaced
// the mascot's right-click menu, the five quick actions of the editor's
// Overview, the header's Export and Inspector buttons and the Primary bot
// button of Permissions: Edit bot, Rename, Put on the desktop, Make primary
// bot, Export the conversation (copy or download), Export the bot (.zip),
// Archive and, in Advanced mode, the Inspector. A right click on the mascot
// or the name opens the same menu where the pointer is. 2026-10-21 (parity
// with Grok Bot): Copy link to this bot (openmausbot://bot/<id>) and Reset
// the history (src/lib/bot-history-reset.ts: a new conversation, the open
// ones archived; memory, files and routines kept; routine runs,
// confidential threads, hidden client threads and bot-to-bot threads stay).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, Bug, Check, Copy, Database, Download, FileArchive, Link2, MoreHorizontal, Pencil, PictureInPicture2, RotateCcw, Star, UserRoundPen } from "lucide-react";

import { useStore, visibleMessages, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { showBotArchive, showBotRename } from "@/lib/bot-capabilities";
import { historyResetThreads } from "@/lib/bot-history-reset";
import { copyText } from "@/lib/copy-text";
import { botRefUrl } from "@/lib/thread-refs";
import { archiveBlockReason, primaryBotOffer, requestBotHidden, requestPrimaryBot } from "@/lib/bot-quick-actions";
import { viewerOwnsBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { downloadBotZip, showBotZipExport } from "@/lib/bot-zip";
import { isBotFloating, subscribeFloatingBots, toggleFloatingBot } from "@/lib/floating-bots";
import {
  copyTranscriptToClipboard,
  downloadMarkdownTranscript,
  formatTranscriptMarkdown,
  slugifyTranscriptFilename,
} from "@/lib/export-transcript";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useHeldMenuMotion } from "../MenuMotion";
import { navigateThreadMenu } from "../BotProjects";
import { ConfirmDialog } from "../ConfirmDialog";
import { Switch } from "../SettingsPrimitives";

/** Where the menu opens: under the "..." button, or at a right click. */
export interface BotActionsMenuAnchor {
  x: number;
  y: number;
  /** Opened from the button: the menu's right edge lines up with it. */
  alignRight?: boolean;
}

export function BotActionsMenu({ bot, anchor, onAnchor, onRename, data }: {
  bot: Bot;
  /** The open menu's position, or null when it is closed. */
  anchor: BotActionsMenuAnchor | null;
  onAnchor: (anchor: BotActionsMenuAnchor | null) => void;
  /** Start editing the name where the panel shows it. */
  onRename: () => void;
  /** The bot's Data window entry, or null where Data is off. */
  data?: { label: string; onOpen: () => void } | null;
}) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const motion = useHeldMenuMotion(anchor);
  const shown = motion.value;
  const floating = useSyncExternalStore(subscribeFloatingBots, () => isBotFloating(bot.id), () => false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => onAnchor(null);

  const viewerId = viewerActorId(state.config);
  const canRename = showBotRename(state.config, bot);
  const primary = primaryBotOffer(state.config, bot);
  const owns = viewerOwnsBot(bot, viewerId);
  const archiveAllowed = showBotArchive(state.config);
  const archiveBlocked = archiveBlockReason(state.bots, bot);
  const zipAllowed = showBotZipExport(state.config, bot);
  const messages = visibleMessages(bot);
  const fail = (cause: unknown) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });

  // Kept inside the window, measured after every render (labels change
  // with the locale and the bot's state).
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !shown) return;
    const { width, height } = element.getBoundingClientRect();
    const left = shown.alignRight ? shown.x - width : shown.x;
    element.style.top = `${Math.max(8, Math.min(shown.y, window.innerHeight - height - 8))}px`;
    element.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  });

  useEffect(() => {
    if (!anchor) return;
    setCopied(false);
    setCopyFailed(false);
    setLinkCopied(false);
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-bot-actions-menu], [data-bot-actions-button]")) onAnchor(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape closes the menu only, not the panel under it.
      event.preventDefault();
      event.stopPropagation();
      onAnchor(null);
      buttonRef.current?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  const markdown = () => formatTranscriptMarkdown({ title: bot.name, messages, botName: bot.name, isGroup: false });
  const copy = async () => {
    const success = await copyTranscriptToClipboard(markdown());
    setCopyFailed(!success);
    setCopied(success);
  };
  const makePrimary = () => {
    if (!primary.allowed || busy) return;
    setBusy(true);
    void requestPrimaryBot(bot.id)
      .then((next) => dispatch({ type: "botPatched", bot: next }))
      .catch(fail)
      .finally(() => setBusy(false));
  };
  const archive = () => {
    if (busy || archiveBlocked) return;
    setBusy(true);
    const next = state.bots.find((candidate) => !candidate.hidden && candidate.id !== bot.id);
    void requestBotHidden(bot.id, true)
      .then((archived) => {
        setArchiveOpen(false);
        dispatch({ type: "botPatched", bot: archived });
        if (state.selectedId === bot.id && next) dispatch({ type: "select", id: next.id });
        dispatch({ type: "toggleSettings", open: false });
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const copyBotLink = async () => {
    setLinkCopied((await copyText(botRefUrl(bot.id))) === "copied");
  };
  const resetHistory = () => {
    if (busy) return;
    setBusy(true);
    const previous = historyResetThreads(bot);
    dispatch({
      type: "newTask",
      botId: bot.id,
      onCreated: () => {
        const at = Date.now();
        for (const threadId of previous) dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { archivedAt: at } });
        setBusy(false);
        setResetOpen(false);
      },
      onError: (message) => {
        setBusy(false);
        setResetOpen(false);
        dispatch({ type: "error", message });
      },
    });
  };

  const item = (id: string, icon: ReactNode, label: string, onClick: () => void, opts?: { disabled?: boolean; hint?: string; keepOpen?: boolean }) => (
    <button
      key={id}
      type="button"
      role="menuitem"
      data-menu-item={id}
      disabled={opts?.disabled}
      title={opts?.hint}
      onClick={() => {
        onClick();
        if (!opts?.keepOpen) close();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink",
        opts?.disabled ? "cursor-default opacity-40" : "hover:bg-hover",
      )}
    >
      <span className="shrink-0 text-ink [&>svg]:size-4">{icon}</span>
      {opts?.hint ? (
        <span className="flex min-w-0 flex-col">
          <span>{label}</span>
          <span data-menu-item-reason="" className="text-[11.5px] leading-4 text-ink-secondary">{opts.hint}</span>
        </span>
      ) : <span className="min-w-0 flex-1 truncate">{label}</span>}
    </button>
  );
  const divider = (key: string) => <div key={key} className="mx-2 my-1 h-[0.5px] bg-border" aria-hidden="true" />;
  const heading = (key: string, label: string) => (
    <div key={key} className="px-2 py-1 text-[12px] leading-4 text-ink-secondary">{label}</div>
  );

  const entries: ReactNode[] = [
    item("edit-bot", <UserRoundPen />, t("botPanel.editBot"), () => dispatch({ type: "openPersonaEditor", botId: bot.id, section: "overview" })),
    canRename && item("rename", <Pencil />, t("persona.menu.rename"), onRename),
    item(floating ? "remove-from-desktop" : "put-on-desktop", <PictureInPicture2 />, floating ? t("floatingBots.menu.unfloat") : t("floatingBots.menu.float"), () => toggleFloatingBot(bot.id)),
    owns && item("make-primary", <Star />, t("sidebar.bot.makePrimary"), makePrimary, {
      disabled: !primary.allowed || busy,
      hint: primary.allowed ? undefined : t(primary.reason),
    }),
    item("copy-bot-link", linkCopied ? <Check className="text-success" /> : <Link2 />, linkCopied ? t("botPanel.linkCopied") : t("botPanel.copyLink"), () => void copyBotLink(), { keepOpen: true }),
    canRename && item("reset-history", <RotateCcw />, `${t("botPanel.resetHistory")}…`, () => setResetOpen(true), { disabled: busy }),
    divider("export"),
    heading("export-heading", t("chat.export.conversationHeading")),
    ...(messages.length === 0
      ? [<div key="export-empty" className="px-2 py-1.5 text-[12px] text-ink-secondary">{t("chat.export.empty")}</div>]
      : [
        item("copy-markdown", copied ? <Check className="text-success" /> : <Copy />, copied ? t("chat.export.copied") : t("chat.export.copy"), () => void copy(), { keepOpen: true }),
        copyFailed && <div key="copy-failed" role="status" className="px-2 py-1.5 text-[12px] text-ink-secondary">{t("chat.export.copyFailed")}</div>,
        item("download-markdown", <Download />, t("chat.export.download"), () => downloadMarkdownTranscript(slugifyTranscriptFilename(bot.name), markdown())),
      ]),
    zipAllowed && item("export-zip", <FileArchive />, t("chat.export.botZip"), () => setZipOpen(true)),
    (archiveAllowed || advanced || data) && divider("more"),
    archiveAllowed && item("archive", <Archive />, `${t("sidebar.bot.archive")}…`, () => setArchiveOpen(true), {
      disabled: archiveBlocked !== null || busy,
      hint: archiveBlocked ? t(archiveBlocked) : undefined,
    }),
    advanced && item("inspector", <Bug />, t("chat.inspector"), () => dispatch({ type: "toggleInspector", open: true })),
    data && item("data-window", <Database />, data.label, data.onOpen),
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-bot-actions-button=""
        aria-label={t("persona.menu.open")}
        title={t("persona.menu.open")}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          if (anchor) { close(); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          onAnchor({ x: rect.right, y: rect.bottom + 4, alignRight: true });
        }}
        className={cn(CIRCLE_BUTTON, anchor && "bg-elevated-hover")}
      >
        <MoreHorizontal size={18} strokeWidth={1.75} />
      </button>
      {motion.shown && shown && createPortal(
        <div
          ref={menuRef}
          data-bot-actions-menu=""
          role="menu"
          aria-label={t("sidebar.bot.actions", { name: bot.name })}
          onKeyDown={navigateThreadMenu}
          style={{ top: shown.y, left: shown.x }}
          className={cn("fixed z-[60] flex max-h-[calc(100dvh-16px)] w-[248px] min-w-[200px] max-w-[calc(100vw-16px)] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 text-[13px] leading-[18px]", motion.className)}
          {...motion.exitProps}
        >
          {entries.filter(Boolean)}
        </div>,
        document.body,
      )}
      {zipOpen && <BotZipExportDialog bot={bot} onClose={() => { setZipOpen(false); buttonRef.current?.focus(); }} />}
      <ConfirmDialog
        open={archiveOpen}
        title={t("sidebar.confirm.archiveTitle", { name: bot.name })}
        body={t("sidebar.confirm.archiveBody", { name: bot.name })}
        confirmLabel={t("sidebar.bot.archive")}
        tone="neutral"
        pending={busy}
        returnFocusRef={buttonRef}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={archive}
      />
      <ConfirmDialog
        open={resetOpen}
        title={t("botPanel.resetHistoryTitle", { name: bot.name })}
        body={t("botPanel.resetHistoryBody", { name: bot.name })}
        confirmLabel={t("botPanel.resetHistory")}
        tone="neutral"
        pending={busy}
        returnFocusRef={buttonRef}
        onCancel={() => setResetOpen(false)}
        onConfirm={resetHistory}
      />
    </>
  );
}

/** Export the bot as a .sagaxbot.zip: what to include, then the download
 * (GET /api/bots/:id/export.zip, src/lib/bot-zip.ts). */
function BotZipExportDialog({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [withConversations, setWithConversations] = useState(false);
  const [withSharing, setWithSharing] = useState(false);
  const [exported, setExported] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const shared = (bot.grants?.length ?? 0) > 0 || bot.visibility !== undefined;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-zip-export-title"
        data-bot-zip-export=""
        className="flex w-[min(420px,calc(100vw-32px))] flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-elevated p-5 text-[13px] text-ink shadow-xl"
      >
        <h2 id="bot-zip-export-title" className="text-[15px] font-semibold">{t("chat.export.botZip")}</h2>
        <p className="text-ink-secondary">{t("botZip.exportBody", { name: bot.name })}</p>
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0"><span className="block">{t("botZip.includeConversations")}</span><span className="block text-[12px] text-ink-secondary">{t("botZip.includeConversationsHint")}</span></span>
          <Switch checked={withConversations} onClick={() => setWithConversations((value) => !value)} aria-label={t("botZip.includeConversations")} data-bot-zip-conversations="" />
        </label>
        {shared && (
          <label className="flex items-center justify-between gap-3">
            <span>{t("botZip.includeSharing")}</span>
            <Switch checked={withSharing} onClick={() => setWithSharing((value) => !value)} aria-label={t("botZip.includeSharing")} data-bot-zip-sharing="" />
          </label>
        )}
        {exported && <span role="status" className="text-[12px] text-ink-secondary">{t("botZip.exportStarted")}</span>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-ink-secondary hover:bg-control hover:text-ink">
            {exported ? t("common.close") : t("common.cancel")}
          </button>
          <button
            type="button"
            data-bot-zip-download=""
            onClick={() => { downloadBotZip(bot.id, { conversations: withConversations, sharing: shared && withSharing }); setExported(true); }}
            className="rounded-lg bg-control px-3 py-1.5 text-ink hover:bg-raised-hover"
          >
            {t("botZip.download")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
