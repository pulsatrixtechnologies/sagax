// The memory's own settings inside the Bot folder (2026-10-15: one
// interface for the bot's files and its memory). What used to be the Memory
// section's "More options" lives in the folder's "..." menu: automatic
// tidying (and Tidy now), and the memory's change log with one-click undo.
// The memory files themselves (MEMORY.md, the topics in memory/, the daily
// logs) are rows of the folder, with their budget on the row.
//
// On an OMB Cloud home, the notice that memory changed where the owner did
// not write shows above the folder whenever there is one.
//
// On the bot's profile page (plain surface, #2313) the folder lays these out
// itself through `children`: the notice and the status lines are rows of the
// Bot folder's card, tidying and the change log two labelled cards under it.
import { useEffect, useState, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import {
  fetchMemoryJournal,
  fetchMemoryOverview,
  fetchUpkeepStatus,
  markMemoryReviewed,
  revertMemoryChange,
  tidyMemoryNow,
  tidySummary,
  type LendingReview,
  type MemoryJournalRow,
  type UpkeepStatus,
} from "@/lib/memory";
import { ApiError, useStore, type Bot } from "@/state/store";
import { LendingReviewNotice, MemoryJournalList, MemoryUpkeepCard } from "./MemorySection";
import { PaneSection } from "./PaneSection";
import { useSettingsSurface } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

const errorText = (e: unknown) => (readableError(e));

/** What the profile page's Bot folder places itself (plain surface). */
export interface MemoryFolderParts {
  /** The lending notice: a row of the folder's card, or null. */
  notice: ReactNode;
  /** Tidied / restored / failed: rows of the folder's card, or null. */
  status: ReactNode;
  /** Tidying and the change log, two labelled cards: null while the "..."
   * menu is closed. */
  options: ReactNode;
}

export function MemoryFolderOptions({ bot, active, showOptions, onChanged, children }: {
  bot: Bot;
  /** The folder is on screen: the lending notice is read then. */
  active: boolean;
  /** The "..." menu is open: tidying and the change log are read then. */
  showOptions: boolean;
  /** A file changed (undo, tidy): the folder re-reads its list. */
  onChanged: () => void;
  /** The plain surface: the folder lays out the parts. */
  children?: (parts: MemoryFolderParts) => ReactNode;
}) {
  const plain = useSettingsSurface() === "plain";
  const { dispatch } = useStore();
  const [journal, setJournal] = useState<MemoryJournalRow[] | null>(null);
  const [upkeep, setUpkeep] = useState<UpkeepStatus | null>(null);
  const [lendingReview, setLendingReview] = useState<LendingReview | null>(null);
  const [lendingStale, setLendingStale] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readLending = () => fetchMemoryOverview(bot.id).then((overview) => setLendingReview(overview.lendingReview ?? null));
  const readOptions = () => Promise.all([
    fetchMemoryJournal(bot.id).then(setJournal),
    fetchUpkeepStatus(bot.id).then(setUpkeep, () => setUpkeep(null)),
  ]);

  useEffect(() => {
    if (!active) return;
    readLending().catch(() => { /* the folder says what failed */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bot.id]);

  useEffect(() => {
    if (!active || !showOptions) return;
    setError(null);
    readOptions().catch((e: unknown) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, showOptions, bot.id]);

  const revert = async (row: MemoryJournalRow) => {
    setReverting(row.id);
    setError(null);
    try {
      await revertMemoryChange(bot.id, row.id);
      setJournal(await fetchMemoryJournal(bot.id));
      setNotice(t("botPanel.memory.restored", { path: row.path }));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReverting(null);
    }
  };

  const tidyNow = async () => {
    setTidying(true);
    setError(null);
    setNotice(null);
    try {
      const { report } = await tidyMemoryNow(bot.id);
      await readOptions();
      setNotice(`${tidySummary(report)}.${report.note ? ` ${report.note}` : ""}`);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTidying(false);
    }
  };

  const toggleUpkeep = () => {
    const enabled = bot.memoryUpkeep === false;
    dispatch({ type: "updateBot", botId: bot.id, patch: { memoryUpkeep: enabled } });
    setUpkeep((current) => (current ? { ...current, enabled } : current));
  };

  const lendingNotice = lendingReview && (
    <LendingReviewNotice
      changed={lendingReview.changed}
      stale={lendingStale}
      busy={reviewing}
      plain={plain}
      onReviewed={() => {
        setReviewing(true);
        markMemoryReviewed(bot.id, lendingReview.token)
          .then(() => { setLendingReview(null); setLendingStale(false); })
          .catch((e: unknown) => {
            if (e instanceof ApiError && e.status === 409) {
              setLendingStale(true);
              return readLending();
            }
            setError(errorText(e));
          })
          .finally(() => setReviewing(false));
      }}
    />
  );
  const cards = (
    <>
      {bot.memoryEnabled !== false && (
        <MemoryUpkeepCard
          enabled={bot.memoryUpkeep !== false}
          status={upkeep}
          tidying={tidying}
          onToggle={toggleUpkeep}
          onTidy={() => void tidyNow()}
        />
      )}
      <PaneSection title={t("botPanel.memory.changes")} help={t("botPanel.memory.changesHelp")} data-memory-changes="">
        <MemoryJournalList rows={journal} botName={bot.name} reverting={reverting} onRevert={(row) => void revert(row)} />
      </PaneSection>
    </>
  );

  if (plain && children) {
    return children({
      notice: lendingNotice || null,
      status: notice || error ? (
        <>
          {notice && <div role="status" className="px-4 py-2.5 text-[12.5px] text-ink-secondary">{notice}</div>}
          {error && <div role="alert" className="px-4 py-2.5 text-[12.5px] text-danger">{error}</div>}
        </>
      ) : null,
      options: showOptions ? <div className="flex flex-col gap-5" data-folder-options="">{cards}</div> : null,
    });
  }

  return (
    <>
      {lendingNotice}
      {showOptions && (
        <div className="flex flex-col gap-4 rounded-xl border-[0.5px] border-border bg-elevated p-3" data-folder-options="">
          {cards}
        </div>
      )}
      {notice && <div role="status" className="text-[12.5px] text-ink-secondary">{notice}</div>}
      {error && <div role="alert" className="text-[12.5px] text-danger">{error}</div>}
    </>
  );
}
