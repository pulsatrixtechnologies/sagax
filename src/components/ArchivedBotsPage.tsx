// Archived bots as a content-frame list (2026-11-01 lot 5): same actions as
// the old modal (restore, restore all, delete, delete all), with a named
// back to chat. Opened from the account menu and the icons rail.
import { useEffect, useRef, useState } from "react";
import { Archive, Loader2, Trash2 } from "lucide-react";

import { isBackShortcut } from "@/lib/back-shortcut";
import { showBotArchive, showBotDelete } from "@/lib/bot-capabilities";
import { readableError } from "@/lib/plain-error";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { api, openBot, useStore, type Bot } from "@/state/store";
import { ConfirmDialog } from "./ConfirmDialog";
import { BackButton } from "./Breadcrumb";
import { PAGE_COLUMN, PAGE_EMPTY, PAGE_SCROLL, PageTopStrip } from "./content-page";
import { useCaptionChrome } from "./DesktopCapabilities";
import { ArchivedBotRow, archivedDeleteAllCopy, botConfirmCopy } from "./Sidebar";

export function ArchivedBotsPage() {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { dragProps, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const mainRef = useRef<HTMLElement>(null);
  const bots = state.bots.filter((bot) => bot.hidden);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoringAll, setRestoringAll] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Bot | "all" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const deleting = bots.some((bot) => Boolean(state.deletingBots[bot.id]));
  const locked = restoringAll || Boolean(busyId) || deleting || Boolean(pendingDelete);
  const allowRestore = (bot: Bot) => showBotArchive(state.config, bot);
  const allowDelete = (bot: Bot) => showBotDelete(state.config, bot);
  const back = () => dispatch({ type: "showChat" });

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (bots.length === 0 && !locked) dispatch({ type: "showChat" });
  }, [bots.length, locked, dispatch]);

  const restore = async (bot: Bot) => {
    setBusyId(bot.id);
    setError("");
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      openBot(dispatch, response.bot, showThreads);
      setNotice(t("sidebar.archived.restored", { name: bot.name }));
      if (bots.length === 1) back();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const restoreAll = async () => {
    setRestoringAll(true);
    setError("");
    try {
      const responses = await Promise.all(
        bots.map((bot) =>
          api(`/api/bots/${bot.id}`, {
            method: "PATCH",
            body: JSON.stringify({ hidden: false }),
          }),
        ),
      );
      for (const response of responses) dispatch({ type: "botPatched", bot: response.bot });
      const first = responses[0]?.bot;
      if (first) openBot(dispatch, first, showThreads);
      setNotice(
        bots.length === 1
          ? t("sidebar.archived.restoredOne")
          : t("sidebar.archived.restoredMany", { count: bots.length }),
      );
      back();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setRestoringAll(false);
    }
  };

  return (
    <main
      ref={mainRef}
      tabIndex={-1}
      data-archived-bots-page=""
      className="flex h-full min-w-0 flex-1 flex-col bg-app outline-none"
      onKeyDown={(event) => {
        if (event.defaultPrevented || locked) return;
        if (event.key === "Escape" || isBackShortcut(event)) {
          event.preventDefault();
          back();
        }
      }}
    >
      <PageTopStrip />
      <header
        data-archived-bots-header=""
        data-page-header=""
        className="content-topbar shrink-0 border-b border-hairline/50 bg-app py-3 pl-5 pr-4"
        {...dragProps}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" style={noDragStyle}>
          <div className="flex min-w-0 items-center gap-2" data-page-title="">
            <BackButton onBack={back} data={{ "data-archived-bots-back": "" }} />
            <Archive size={18} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            <h1 className="text-[15px] font-medium leading-6 text-ink">{t("sidebar.archived.title")}</h1>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5" style={controlsShiftStyle}>
            {bots.length > 1 && bots.every(allowRestore) && (
              <button
                type="button"
                onClick={() => void restoreAll()}
                disabled={locked}
                className="ui-button gap-1.5 disabled:opacity-40"
              >
                {restoringAll && <Loader2 size={13} className="animate-spin" />}
                {t("sidebar.archived.restoreAll")}
              </button>
            )}
            {bots.length > 0 && bots.every(allowDelete) && (
              <button
                type="button"
                onClick={() => setPendingDelete("all")}
                disabled={locked}
                className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] text-danger hover:bg-danger/10 disabled:opacity-40"
              >
                <Trash2 size={13} />
                {t("sidebar.archived.deleteAll")}
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-[13px] text-ink-secondary">{t("sidebar.archived.subtitle")}</p>
        {(error || notice) && (
          <div className="mt-2 space-y-1">
            {error && <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
            {notice && !error && <div role="status" className="rounded-lg bg-ink/[0.05] px-3 py-2 text-[12.5px] text-ink-secondary">{notice}</div>}
          </div>
        )}
      </header>
      <div className={PAGE_SCROLL}>
        <div className={PAGE_COLUMN}>
          {bots.length === 0 ? (
            <div className={PAGE_EMPTY}>{t("sidebar.archived.count", { count: 0 })}</div>
          ) : (
            <>
              <div className="mb-1 text-[12px] font-medium text-ink-secondary">{t("sidebar.archived.count", { count: bots.length })}</div>
              <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
                {bots.map((bot) => (
                  <ArchivedBotRow
                    key={bot.id}
                    bot={bot}
                    restoring={busyId === bot.id}
                    deleting={Boolean(state.deletingBots[bot.id])}
                    disabled={locked}
                    showRestore={allowRestore(bot)}
                    showDelete={allowDelete(bot)}
                    onRestore={() => void restore(bot)}
                    onDelete={() => setPendingDelete(bot)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        {...(pendingDelete === "all"
          ? archivedDeleteAllCopy()
          : botConfirmCopy("delete", pendingDelete?.name ?? ""))}
        icon={<Trash2 size={18} />}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const target = pendingDelete;
          setPendingDelete(null);
          if (target === "all") {
            for (const bot of bots) dispatch({ type: "deleteBot", botId: bot.id });
            return;
          }
          dispatch({ type: "deleteBot", botId: target.id });
        }}
      />
    </main>
  );
}
