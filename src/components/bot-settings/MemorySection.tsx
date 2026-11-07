// Memory: what this bot believes, as a panel a person can read, fix, and
// audit. The switch turns memory on or off. A gauge says what loadMemory()
// cuts. Clicking a file opens it in an editor dialog that refuses to
// overwrite what the bot wrote while the person was typing. The journal
// lists every change with one-click undo.
//
// Fetched when the section becomes active, not on mount: settings opens
// for every bot and most visits never look at memory. A re-activation
// re-reads, so notes the bot wrote mid-session show up on the next look.
// The dialog keeps this mounted while hidden so an unsaved draft survives
// a visit to another section. A file opens only when the person clicks it.
import { FileText, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { discardConfirmRequest, useConfirm } from "@/components/ConfirmProvider";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PanelPage } from "./PanelPage";
import {
  MEMORY_INDEX,
  deleteMemoryDoc,
  fetchMemoryDoc,
  fetchMemoryJournal,
  fetchMemoryOverview,
  revertMemoryChange,
  saveMemoryDoc,
  fetchUpkeepStatus,
  tidyMemoryNow,
  tidySummary,
  topicFileName,
  type UpkeepStatus,
  type MemoryFileInfo,
  type MemoryJournalRow,
  type MemoryOverview,
  type LendingReview,
  markMemoryReviewed,
} from "@/lib/memory";
import { roomMemoryCaptureEnabled } from "@/lib/feature-flags";
import { canEditConfig } from "@/lib/viewer";
import { canEditBotField } from "@/lib/bot-capabilities";
import { teamMemorySharingOf } from "../../../shared/team-memory-sharing";
import { ApiError, api, useStore, type Bot, type ConfigStatus } from "@/state/store";
import { PILL, PillSelect, SettingRow, SwitchRow } from "../SettingsPrimitives";
import { AdvancedFold } from "./AdvancedFold";
import { DeveloperLink } from "../settings/DeveloperLink";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { inputCls } from "./field";
import { PaneSection } from "./PaneSection";
import { readableError } from "@/lib/plain-error";

// Settings' grey pill (2026-10-16).
import { topicTemplate, MemoryUpkeepCard, MemoryGauge, ConflictNotice, MemoryFileRows, MemoryJournalList } from "./MemorySectionParts";

const buttonCls = PILL;
const quietButtonCls = "rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50";

interface Editing {
  path: string;
  text: string;
  /** sha256 the server reported when the text was loaded; sent back on save. */
  hash: string;
  dirty: boolean;
  readOnly: boolean;
}

interface Conflict {
  path: string;
  /** What is on disk now: the bot's version. */
  current: string;
  currentHash: string;
}

/** The on/off switch at the top of the Memory section: the standard switch
 * row, the detail behind its info button. */
export function MemoryToggleCard({ enabled, busy, onToggle }: { enabled: boolean; busy: boolean; onToggle: (next: boolean) => void }) {
  return (
    <PaneSection>
      <SwitchRow
        label={t("botPanel.memory.let")}
        help={t("botPanel.memory.off")}
        description={busy ? t("botPanel.memory.busy").trim() : undefined}
        checked={enabled}
        disabled={busy}
        onChange={onToggle}
      />
    </PaneSection>
  );
}

/** Team memory, apart from this bot's own memory and anyone's personal
 * memory: who gets the "Remember this for the team?" cards this bot
 * proposes. Shared (the default): every member of its section. Private:
 * only the people who see this bot and the conversation. */
export function TeamMemorySharingCard({ value, disabled, onChange }: { value: "shared" | "private"; disabled?: boolean; onChange: (next: "shared" | "private") => void }) {
  return (
    <PaneSection>
      <SettingRow title={t("botPanel.teamMemorySharing")} subtitle={t("botPanel.teamMemorySharing.help")} className="px-0 py-0">
        <PillSelect<"shared" | "private">
          ariaLabel={t("botPanel.teamMemorySharing")}
          value={value}
          disabled={disabled}
          onChange={onChange}
          options={[
            { value: "shared", label: t("botPanel.teamMemorySharing.shared") },
            { value: "private", label: t("botPanel.teamMemorySharing.private") },
          ]}
        />
      </SettingRow>
    </PaneSection>
  );
}

const errorText = (e: unknown) => (readableError(e));

/** The file body as a pushed page in the bot panel. Escape and Back ask
 * before dropping a dirty draft (requestClose). Conflict notice kept. */
export function MemoryEditorDialog({
  editing,
  botName,
  conflict,
  saving,
  savedDraft,
  onChange,
  onSave,
  onDiscard,
  onClose,
  onReload,
  onOverwrite,
  onDismissDraft,
  onOpenIndex,
  onPanelClose,
}: {
  editing: Editing;
  botName: string;
  conflict: Conflict | null;
  saving: boolean;
  savedDraft: string | null;
  onChange: (text: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  onReload: () => void;
  onOverwrite: () => void;
  onDismissDraft: () => void;
  onOpenIndex: () => void;
  /** Closes the whole bot panel. Defaults to onClose. */
  onPanelClose?: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = bodyRef.current;
    const area = root?.querySelector<HTMLElement>('textarea, [contenteditable="true"]');
    if (area && !(area instanceof HTMLTextAreaElement && area.readOnly)) area.focus();
  }, [editing.path]);

  return (
    <PanelPage
      name={editing.path}
      onBack={onClose}
      onClose={onPanelClose ?? onClose}
      closeLabel={t("botPanel.memory.closeEditor")}
      data-memory-editor-page=""
      autoFocus={false}
      bodyClassName="flex flex-col px-4 py-4"
      footer={
        editing.readOnly ? (
          <p className="mr-auto text-[12px] text-ink-secondary">{t("botPanel.memory.logsReadOnly")}</p>
        ) : (
          <>
            {editing.path !== MEMORY_INDEX && (
              <button type="button" className={quietButtonCls} onClick={onOpenIndex}>
                {t("botPanel.memory.back")}
              </button>
            )}
            <span className="flex-1" />
            {editing.dirty && (
              <button type="button" className={quietButtonCls} disabled={saving} onClick={onDiscard}>
                {t("botPanel.memory.discard")}
              </button>
            )}
            <button type="button" onClick={onSave} disabled={saving || !editing.dirty} className={buttonCls}>
              {saving ? t("botPanel.memory.saving") : t("common.save")}
            </button>
          </>
        )
      }
    >
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        {conflict && (
          <ConflictNotice botName={botName} busy={saving} onReload={onReload} onOverwrite={onOverwrite} />
        )}
        <MarkdownEditor
          className={cn("min-h-[320px] flex-1", conflict && "mt-2")}
          minHeight={300}
          maxHeight="none"
          dataField="memory"
          value={editing.text}
          readOnly={editing.readOnly}
          autoFocus={!editing.readOnly}
          placeholder={editing.path === MEMORY_INDEX ? t("botPanel.memory.indexPlaceholder") : t("botPanel.memory.write")}
          ariaLabel={editing.path === MEMORY_INDEX ? t("botPanel.memory.aria") : t("botPanel.memory.fileAria", { path: editing.path })}
          onChange={onChange}
        />
        {savedDraft !== null && (
          <div className="mt-3">
            <div className="mb-1 text-[12px] text-ink-secondary">{t("botPanel.memory.draft")}</div>
            <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg border border-hairline/40 bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink">
              {savedDraft}
            </pre>
            <button type="button" className={cn(quietButtonCls, "mt-1")} onClick={onDismissDraft}>
              {t("botPanel.memory.dismiss")}
            </button>
          </div>
        )}
      </div>
    </PanelPage>
  );
}

/** On an OMB Cloud home: this bot's memory changed in a conversation the
 * owner did not write, so its turns cannot use the owner's lent Mac until
 * the owner has looked. It names the files that changed; one click accepts
 * them as shown (no confirmation), and the server refuses it if anything
 * changed since. */
export function LendingReviewNotice({ changed, stale, busy, onReviewed, plain = false }: {
  changed: readonly string[];
  stale: boolean;
  busy: boolean;
  onReviewed: () => void;
  /** The bot's profile page (#2313): a row of the Bot folder's card, its
   * warning icon in place of the red outline. */
  plain?: boolean;
}) {
  if (plain) {
    return (
      <div role="status" className="flex items-start gap-3 px-4 py-2.5" data-lending-review="">
        <span className="flex size-5 shrink-0 items-center justify-center pt-0.5 text-danger [&>svg]:size-5" aria-hidden="true"><TriangleAlert /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-[14px] leading-5 text-ink">{t(stale ? "memory.lendingReviewStale" : "memory.lendingReview")}</p>
          {changed.length > 0 && (
            <>
              <p className="text-[12px] leading-4 text-ink-secondary">{t("memory.lendingReviewChanged")}</p>
              <ul className="space-y-0.5">
                {changed.map((file) => (
                  <li key={file} className="break-all text-[12px] leading-4 text-ink-secondary">{file}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <button type="button" className={cn(buttonCls, "shrink-0")} disabled={busy} onClick={onReviewed}>
          {t("memory.lendingReviewed")}
        </button>
      </div>
    );
  }
  return (
    <div role="status" className="rounded-xl border border-danger/40 bg-card p-4">
      <p className="text-[13px] leading-relaxed text-ink">{t(stale ? "memory.lendingReviewStale" : "memory.lendingReview")}</p>
      {changed.length > 0 && (
        <>
          <p className="mt-2 text-[12px] text-ink-secondary">{t("memory.lendingReviewChanged")}</p>
          <ul className="mt-1 space-y-0.5">
            {changed.map((file) => (
              <li key={file} className="break-all font-mono text-[12px] text-ink">{file}</li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className={cn(buttonCls, "mt-3")} disabled={busy} onClick={onReviewed}>
        {t("memory.lendingReviewed")}
      </button>
    </div>
  );
}

export function MemorySection({ bot, active = true, onToggle }: { bot: Bot; active?: boolean; onToggle: (enabled: boolean) => void }) {
  const confirm = useConfirm();
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [journal, setJournal] = useState<MemoryJournalRow[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState("");
  const [upkeep, setUpkeep] = useState<UpkeepStatus | null>(null);
  const [tidying, setTidying] = useState(false);
  // OMB Cloud home: memory changed where the owner did not write.
  const [lendingReview, setLendingReview] = useState<LendingReview | null>(null);
  const [lendingReviewStale, setLendingReviewStale] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const { state, dispatch } = useStore();
  const learnFromRooms = roomMemoryCaptureEnabled(state.config);
  const [roomsSaving, setRoomsSaving] = useState(false);
  const [roomsError, setRoomsError] = useState("");

  const refresh = async (openPath?: string) => {
    const [nextOverview, nextJournal, nextUpkeep] = await Promise.all([
      fetchMemoryOverview(bot.id),
      fetchMemoryJournal(bot.id),
      fetchUpkeepStatus(bot.id).catch(() => null),
    ]);
    setOverview(nextOverview);
    setLendingReview(nextOverview.lendingReview ?? null);
    setJournal(nextJournal);
    setUpkeep(nextUpkeep);
    if (openPath) {
      const doc = await fetchMemoryDoc(bot.id, openPath);
      setEditing({ path: doc.path, text: doc.text, hash: doc.hash, dirty: false, readOnly: openPath.startsWith("memory/log/") });
    }
  };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError(null);
    // a dirty draft survives a re-activation; everything else re-reads
    const keepDraft = editing?.dirty === true;
    refresh(keepDraft ? undefined : editing?.path).catch((e: unknown) => {
      if (!cancelled) setError(errorText(e));
    });
    return () => {
      cancelled = true;
    };
  }, [active, bot.id]);

  const open = async (path: string): Promise<boolean> => {
    if (editing?.dirty && editing.path !== path && !(await confirm(discardConfirmRequest(t("botPanel.memory.closeDirty"))))) return false;
    setError(null);
    setConflict(null);
    if (editing?.path !== path) setSavedDraft(null);
    try {
      const doc = await fetchMemoryDoc(bot.id, path);
      setEditing({ path: doc.path, text: doc.text, hash: doc.hash, dirty: false, readOnly: path.startsWith("memory/log/") });
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };

  const requestClose = async () => {
    if (editing?.dirty && !(await confirm(discardConfirmRequest(t("botPanel.memory.closeDirty"))))) return;
    setEditing(null);
    setConflict(null);
    setSavedDraft(null);
  };

  const save = async (expectedHash: string | undefined) => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveMemoryDoc(bot.id, editing.path, editing.text, expectedHash);
      if (!result.ok) {
        setConflict({ path: editing.path, current: result.current, currentHash: result.currentHash });
        return;
      }
      setConflict(null);
      setSavedDraft(null);
      setEditing({ ...editing, text: result.doc.text, hash: result.doc.hash, dirty: false });
      setOverview(result.overview);
      setJournal(await fetchMemoryJournal(bot.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  /** Reload keeps the person's words: the draft moves under the editor
   * as read-only text so nothing typed is lost, and the editor shows the
   * bot's version. */
  const reloadFromConflict = () => {
    if (!conflict || !editing) return;
    setSavedDraft(editing.text);
    setEditing({ ...editing, text: conflict.current, hash: conflict.currentHash, dirty: false });
    setConflict(null);
  };

  const remove = async (file: MemoryFileInfo) => {
    if (!(await confirm({
      title: t("botPanel.memory.confirmDelete", { name: file.name }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    }))) return;
    setError(null);
    try {
      const { overview: next } = await deleteMemoryDoc(bot.id, file.path);
      setOverview(next);
      setJournal(await fetchMemoryJournal(bot.id));
      if (editing?.path === file.path) setEditing(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const createTopic = async () => {
    const name = topicFileName(newTopic);
    if (!name) {
      setError(t("botPanel.memory.badTopic"));
      return;
    }
    const opened = await open(`memory/${name}`);
    if (!opened) return;
    setNewTopic("");
    setEditing((current) => (current ? { ...current, dirty: true, text: current.text || topicTemplate(name) } : current));
  };

  const revert = async (row: MemoryJournalRow) => {
    setReverting(row.id);
    setError(null);
    try {
      const result = await revertMemoryChange(bot.id, row.id);
      setOverview(result.overview);
      setJournal(await fetchMemoryJournal(bot.id));
      if (editing?.path === row.path && !editing.dirty) {
        setEditing({ ...editing, text: result.text, hash: result.hash });
      }
      setNotice(t("botPanel.memory.restored", { path: row.path }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReverting(null);
    }
  };

  const toggleUpkeep = () => {
    const enabled = bot.memoryUpkeep === false;
    dispatch({ type: "updateBot", botId: bot.id, patch: { memoryUpkeep: enabled } });
    setUpkeep((current) => (current ? { ...current, enabled } : current));
  };

  // Learn from group chats is one switch for every bot on this server, shown
  // here beside the upkeep it feeds.
  const toggleRooms = async () => {
    if (roomsSaving) return;
    setRoomsSaving(true);
    setRoomsError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { roomMemoryCapture: !learnFromRooms } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setRoomsError(cause instanceof Error ? cause.message : t("memory.learnFromRooms.error"));
    } finally {
      setRoomsSaving(false);
    }
  };

  const tidyNow = async () => {
    setTidying(true);
    setError(null);
    setNotice(null);
    try {
      const { report, overview: next } = await tidyMemoryNow(bot.id);
      setOverview(next);
      setJournal(await fetchMemoryJournal(bot.id));
      setUpkeep(await fetchUpkeepStatus(bot.id));
      if (editing && !editing.dirty) await open(editing.path);
      setNotice(`${tidySummary(report)}.${report.note ? ` ${report.note}` : ""}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTidying(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <MemoryToggleCard enabled={bot.memoryEnabled !== false} busy={Boolean(bot.busy)} onToggle={onToggle} />
      <TeamMemorySharingCard
        value={teamMemorySharingOf(bot)}
        disabled={!canEditBotField(state.config, bot, "teamMemorySharing")}
        onChange={(next) => dispatch({ type: "updateBot", botId: bot.id, patch: { teamMemorySharing: next } })}
      />

      {lendingReview && (
        <LendingReviewNotice
          changed={lendingReview.changed}
          stale={lendingReviewStale}
          busy={reviewing}
          onReviewed={() => {
            setReviewing(true);
            markMemoryReviewed(bot.id, lendingReview.token)
              .then(() => { setLendingReview(null); setLendingReviewStale(false); })
              // Changed again since it was shown: show what is there now.
              .catch((e: unknown) => {
                if (e instanceof ApiError && e.status === 409) {
                  setLendingReviewStale(true);
                  return refresh();
                }
                setError(errorText(e));
              })
              .finally(() => setReviewing(false));
          }}
        />
      )}

      {overview && (
        <PaneSection title="MEMORY.md" help={t("botPanel.memory.indexHelp")}>
          <button
            type="button"
            onClick={() => void open(MEMORY_INDEX)}
            aria-label={t("botPanel.memory.aria")}
            className={cn(
              "mb-3 flex w-full items-center gap-2 rounded-lg border border-hairline/40 px-3 py-2 text-left hover:bg-control/40",
              editing?.path === MEMORY_INDEX && "bg-control/60",
            )}
          >
            <FileText size={14} className="shrink-0 text-ink-secondary" />
            <span className="truncate font-mono text-[12.5px] text-ink">MEMORY.md</span>
            <span className="ml-auto shrink-0 text-[12px] text-ink-secondary">{t("botPanel.memory.open")}</span>
          </button>
        </PaneSection>
      )}

      {editing && (
        <MemoryEditorDialog
          editing={editing}
          botName={bot.name}
          conflict={conflict}
          saving={saving}
          savedDraft={savedDraft}
          onChange={(text) => setEditing({ ...editing, text, dirty: true })}
          onSave={() => void save(editing.hash)}
          onDiscard={() => void open(editing.path)}
          onClose={requestClose}
          onReload={reloadFromConflict}
          onOverwrite={() => { if (conflict) void save(conflict.currentHash); }}
          onDismissDraft={() => setSavedDraft(null)}
          onOpenIndex={() => void open(MEMORY_INDEX)}
        />
      )}

      {overview && (
        <PaneSection title={t("botPanel.memory.topics")} help={t("botPanel.memory.topicsHint")}>
          <MemoryFileRows
            files={overview.topics}
            empty={t("botPanel.memory.noTopics")}
            selected={editing?.path}
            onOpen={(file) => void open(file.path)}
            onDelete={(file) => void remove(file)}
          />
          <div className="mt-3 flex items-center gap-2">
            <input
              className={cn(inputCls, "py-1.5 text-[13px]")}
              value={newTopic}
              placeholder={t("botPanel.memory.topicPlaceholder")}
              aria-label={t("botPanel.memory.topicAria")}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createTopic();
              }}
            />
            <button type="button" className={cn(buttonCls, "shrink-0 whitespace-nowrap")} disabled={!newTopic.trim()} onClick={() => void createTopic()}>
              {t("botPanel.memory.newTopic")}
            </button>
          </div>
        </PaneSection>
      )}

      {/* The size gauge, the upkeep and the change log: folded, one click
          away. #2658: the daily logs and the embeddings endpoint (recall by
          meaning) are on Settings > Developer > Per bot, one link below. */}
      <AdvancedFold id="memory">
        {overview && <MemoryGauge index={overview.index} />}
        {bot.memoryEnabled !== false && <MemoryUpkeepCard
          enabled={bot.memoryUpkeep !== false}
          status={upkeep}
          tidying={tidying}
          onToggle={toggleUpkeep}
          onTidy={() => void tidyNow()}
          rooms={canEditConfig(state.config) ? { enabled: learnFromRooms, saving: roomsSaving, error: roomsError, onToggle: () => void toggleRooms() } : undefined}
        />}
        <PaneSection title={t("botPanel.memory.changes")} help={t("botPanel.memory.changesHelp")}>
          <MemoryJournalList rows={journal} botName={bot.name} reverting={reverting} onRevert={(row) => void revert(row)} />
        </PaneSection>
      </AdvancedFold>
      <DeveloperLink bot={bot} />

      {notice && <div role="status" className="text-[12.5px] text-ink-secondary">{notice}</div>}
      {error && <div role="alert" className="text-[12.5px] text-danger">{error}</div>}
    </div>
  );
}

export { topicTemplate, MemoryUpkeepCard, SemanticRecallCard, MemoryGauge, ConflictNotice, MemoryFileRows, MemoryJournalList } from "./MemorySectionParts";
