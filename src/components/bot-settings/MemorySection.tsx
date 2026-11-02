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
import { FileText, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { discardConfirmRequest, useConfirm } from "@/components/ConfirmProvider";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PanelPage } from "./PanelPage";
import {
  MEMORY_INDEX,
  capacityStatus,
  deleteMemoryDoc,
  fetchMemoryDoc,
  fetchMemoryJournal,
  fetchMemoryOverview,
  formatBytes,
  journalSource,
  journalSummary,
  relativeTime,
  revertMemoryChange,
  saveMemoryDoc,
  fetchUpkeepStatus,
  fetchSemanticRecallStatus,
  semanticRecallConfig,
  type SemanticRecallConfig,
  type SemanticRecallStatus,
  tidyMemoryNow,
  tidySummary,
  noticedCount,
  topicFileName,
  type UpkeepStatus,
  type MemoryCapacity,
  type MemoryFileInfo,
  type MemoryJournalRow,
  type MemoryOverview,
  type LendingReview,
  markMemoryReviewed,
} from "@/lib/memory";
import { canEditBotField } from "@/lib/bot-capabilities";
import { teamMemorySharingOf } from "../../../shared/team-memory-sharing";
import { ApiError, api, useStore, type Bot, type ConfigStatus } from "@/state/store";
import { canEditConfig } from "@/lib/viewer";
import { HelpTip, PILL, PillSelect, SettingRow, SwitchRow } from "../SettingsPrimitives";
import { AdvancedFold } from "./AdvancedFold";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { inputCls } from "./field";
import { PaneEmpty, PaneSection } from "./PaneSection";
import { readableError } from "@/lib/plain-error";

// Settings' grey pill (2026-10-16).
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
export function LendingReviewNotice({ changed, stale, busy, onReviewed }: { changed: readonly string[]; stale: boolean; busy: boolean; onReviewed: () => void }) {
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
  const [semantic, setSemantic] = useState<SemanticRecallStatus | null>(null);
  const [tidying, setTidying] = useState(false);
  // OMB Cloud home: memory changed where the owner did not write.
  const [lendingReview, setLendingReview] = useState<LendingReview | null>(null);
  const [lendingReviewStale, setLendingReviewStale] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const { state, dispatch } = useStore();

  const refresh = async (openPath?: string) => {
    const [nextOverview, nextJournal, nextUpkeep, nextSemantic] = await Promise.all([
      fetchMemoryOverview(bot.id),
      fetchMemoryJournal(bot.id),
      fetchUpkeepStatus(bot.id).catch(() => null),
      // an older server has no semantic recall: no card
      fetchSemanticRecallStatus(bot.id).catch(() => null),
    ]);
    setOverview(nextOverview);
    setLendingReview(nextOverview.lendingReview ?? null);
    setJournal(nextJournal);
    setUpkeep(nextUpkeep);
    setSemantic(nextSemantic);
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

      {/* The size gauges, the upkeep, the daily logs and the change log:
          folded, one click away. */}
      <AdvancedFold id="memory">
        {overview && <MemoryGauge index={overview.index} />}
        {bot.memoryEnabled !== false && <MemoryUpkeepCard
          enabled={bot.memoryUpkeep !== false}
          status={upkeep}
          tidying={tidying}
          onToggle={toggleUpkeep}
          onTidy={() => void tidyNow()}
        />}
        {bot.memoryEnabled !== false && semantic && <SemanticRecallCard
          status={semantic}
          config={semanticRecallConfig(state.config)}
          editable={canEditConfig(state.config)}
          onSave={async (patch) => {
            const config = await api<ConfigStatus>("/api/config", { method: "PATCH", body: JSON.stringify({ memory: patch }) });
            dispatch({ type: "configStatus", config });
            setSemantic(await fetchSemanticRecallStatus(bot.id).catch(() => null));
          }}
        />}
        {overview && overview.logs.length > 0 && (
          <PaneSection title={t("botPanel.memory.logs")} help={t("botPanel.memory.logsHint")}>
            <MemoryFileRows
              files={overview.logs}
              empty={t("botPanel.memory.noneYet")}
              selected={editing?.path}
              onOpen={(file) => void open(file.path)}
              onDelete={(file) => void remove(file)}
            />
          </PaneSection>
        )}

        <PaneSection title={t("botPanel.memory.changes")} help={t("botPanel.memory.changesHelp")}>
          <MemoryJournalList rows={journal} botName={bot.name} reverting={reverting} onRevert={(row) => void revert(row)} />
        </PaneSection>
      </AdvancedFold>

      {notice && <div role="status" className="text-[12.5px] text-ink-secondary">{notice}</div>}
      {error && <div role="alert" className="text-[12.5px] text-danger">{error}</div>}
    </div>
  );
}

/** A new topic's starting text: the header the topic index and recall read,
 * so the other words a person would use for it are one line to fill in. */
export function topicTemplate(fileName: string): string {
  const title = fileName.replace(/\.md$/, "");
  return `---\ntitle: ${title}\ndescription: \naliases: []\n---\n\n`;
}

// ── presentational pieces (tested through renderToStaticMarkup) ─────────

export function MemoryUpkeepCard({
  enabled,
  status,
  tidying,
  onToggle,
  onTidy,
}: {
  enabled: boolean;
  status: UpkeepStatus | null;
  tidying: boolean;
  onToggle: () => void;
  onTidy: () => void;
}) {
  const limited = enabled && status !== null && !status.modelSteps;
  const last = status?.lastTidy
    ? t("botPanel.memory.lastTidy", { when: relativeTime(status.lastTidy.at), summary: tidySummary(status.lastTidy).toLowerCase() })
    : t("botPanel.memory.notTidied");
  const noticed = status?.lastCapture ? noticedCount(status.lastCapture) : 0;
  // the receipt's other half (parity M3): what the capture found already there
  const known = status?.lastCapture?.known ?? 0;
  const knownText = known ? t(known === 1 ? "botPanel.memory.knownOne" : "botPanel.memory.knownMany", { count: String(known) }) : "";
  return (
    <PaneSection title={t("botPanel.memory.upkeep")}>
      <SwitchRow
        label={t("botPanel.memory.upkeepSwitch")}
        help={t("botPanel.memory.upkeepHelp")}
        checked={enabled}
        onChange={onToggle}
      />
      {limited && (
        <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
          <span>{t("botPanel.memory.limited")}</span>
          <HelpTip label={t("botPanel.memory.limited")}>{t("botPanel.memory.noSteps")}</HelpTip>
        </div>
      )}
      {enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={buttonCls} disabled={tidying} onClick={onTidy}>
            {tidying ? t("botPanel.memory.tidying") : t("botPanel.memory.tidyNow")}
          </button>
          <span className="text-[12.5px] text-ink-secondary">
            {last}
            {status?.lastCapture && noticed
              ? t(noticed === 1 ? "botPanel.memory.noticedOne" : "botPanel.memory.noticedMany", {
                count: String(noticed),
                when: relativeTime(status.lastCapture.at),
              }) + knownText
              : status?.lastCapture && known
                ? t("botPanel.memory.nothingNew", { when: relativeTime(status.lastCapture.at) }) + knownText
                : ""}
          </span>
        </div>
      )}
    </PaneSection>
  );
}

/** Recall by meaning: the switch (the installation's), what it uses, how
 * much of this bot is indexed, and the embedding endpoint the person may
 * already run. Someone who may not change the installation's settings sees
 * the state only. */
export function SemanticRecallCard({
  status,
  config,
  editable,
  onSave,
}: {
  status: SemanticRecallStatus;
  config: SemanticRecallConfig | undefined;
  editable: boolean;
  onSave: (patch: { semanticRecall?: boolean; embeddingsUrl?: string; embeddingsModel?: string }) => Promise<void>;
}) {
  const [url, setUrl] = useState(config?.embeddingsUrl ?? "");
  const [model, setModel] = useState(config?.embeddingsModel ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setUrl(config?.embeddingsUrl ?? "");
    setModel(config?.embeddingsModel ?? "");
  }, [config?.embeddingsUrl, config?.embeddingsModel]);
  const save = async (patch: Parameters<typeof onSave>[0]) => {
    setBusy(true);
    setError("");
    try {
      await onSave(patch);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  };
  const counts = t("botPanel.memory.semanticCounts", { notes: String(status.memoryPassages), chats: String(status.conversationPassages) });
  const encoder = status.encoder === "endpoint"
    ? status.endpointOk === false
      ? t("botPanel.memory.semanticEndpointDown", { model: status.model ?? "" })
      : t("botPanel.memory.semanticEndpoint", { model: status.model ?? "" })
    : t("botPanel.memory.semanticBuiltIn");
  const dirty = url.trim() !== (config?.embeddingsUrl ?? "") || model.trim() !== (config?.embeddingsModel ?? "");
  return (
    <PaneSection title={t("botPanel.memory.semantic")}>
      <SwitchRow
        label={t("botPanel.memory.semanticSwitch")}
        help={t("botPanel.memory.semanticHelp")}
        checked={status.enabled}
        disabled={!editable || busy}
        onChange={() => void save({ semanticRecall: !status.enabled })}
      />
      {status.enabled && (
        <p className="mt-2 text-[12.5px] text-ink-secondary" data-semantic-status="">{encoder} · {counts}</p>
      )}
      {status.enabled && editable && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
            <span>{t("botPanel.memory.semanticModel")}</span>
            <HelpTip label={t("botPanel.memory.semanticModel")}>{t("botPanel.memory.semanticModelHelp")}</HelpTip>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              className={cn(inputCls, "min-w-0 flex-[2]")}
              value={url}
              placeholder="http://127.0.0.1:11434/v1"
              aria-label={t("botPanel.memory.semanticUrl")}
              onChange={(event) => setUrl(event.target.value)}
            />
            <input
              className={cn(inputCls, "min-w-0 flex-1")}
              value={model}
              placeholder="nomic-embed-text"
              aria-label={t("botPanel.memory.semanticModelName")}
              onChange={(event) => setModel(event.target.value)}
            />
            <button type="button" className={cn(buttonCls, "shrink-0")} disabled={busy || !dirty} onClick={() => void save({ embeddingsUrl: url.trim(), embeddingsModel: model.trim() })}>
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
      {error && <div role="alert" className="mt-2 text-[12.5px] text-danger">{error}</div>}
    </PaneSection>
  );
}

/** Two small meters with their numbers. The rule they measure (only the
 * first lines load) is the section's info button; a cut that is happening
 * is one line under them. */
export function MemoryGauge({ index }: { index: MemoryCapacity }) {
  const status = capacityStatus(index);
  const fill = status.level === "over" ? "bg-danger" : status.level === "near" ? "bg-warning" : "bg-accent";
  return (
    <div data-memory-gauge={status.level} title={status.sentence}>
      <GaugeBar label={t("botPanel.memory.linesLabel")} value={`${index.lines} / ${index.maxLines}`} share={status.lineShare} fill={fill} />
      <GaugeBar label={t("botPanel.memory.sizeLabel")} value={`${formatBytes(index.bytes)} / ${formatBytes(index.maxBytes)}`} share={status.byteShare} fill={fill} />
      {status.warning && <p role="alert" className="mt-2 text-[12.5px] leading-relaxed text-danger">{status.warning}</p>}
    </div>
  );
}

function GaugeBar({ label, value, share, fill }: { label: string; value: string; share: number; fill: string }) {
  const width = `${Math.min(100, Math.round(share * 100))}%`;
  return (
    <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-secondary first:mt-0">
      <span className="w-12 shrink-0">{label}</span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset"
        role="meter"
        aria-label={t("botPanel.memory.meter", { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(share * 100))}
        aria-valuetext={value}
      >
        <div className={cn("h-full rounded-full", fill)} style={{ width }} />
      </div>
      <span className="w-[120px] shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

export function ConflictNotice({
  botName,
  busy,
  onReload,
  onOverwrite,
}: {
  botName: string;
  busy: boolean;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink">
      <div className="font-medium">{t("botPanel.memory.changed", { name: botName })}</div>
      <div className="mt-0.5 text-ink-secondary">
        {t("botPanel.memory.nothingSaved", { name: botName })}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" className={buttonCls} disabled={busy} onClick={onReload}>
          {t("botPanel.memory.reload")}
        </button>
        <button type="button" className={buttonCls} disabled={busy} onClick={onOverwrite}>
          {t("botPanel.memory.overwrite")}
        </button>
      </div>
    </div>
  );
}

export function MemoryFileRows({
  files,
  empty,
  selected,
  onOpen,
  onDelete,
}: {
  files: MemoryFileInfo[];
  /** The one line shown when there are no files. */
  empty: string;
  selected?: string;
  onOpen: (file: MemoryFileInfo) => void;
  onDelete: (file: MemoryFileInfo) => void;
}) {
  return (
    <div>
      {files.length === 0 ? (
        <PaneEmpty>{empty}</PaneEmpty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline/40">
          {files.map((file) => (
            <div
              key={file.path}
              className={cn(
                "flex items-center gap-2 border-b border-hairline/40 px-3 py-2 last:border-b-0",
                selected === file.path ? "bg-control/60" : "hover:bg-control/40",
              )}
            >
              <button type="button" onClick={() => onOpen(file)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <FileText size={14} className="shrink-0 text-ink-secondary" />
                <span className="truncate font-mono text-[12.5px] text-ink">{file.name}</span>
                <span className="shrink-0 text-[11.5px] text-ink-secondary">
                  {formatBytes(file.bytes)} · {relativeTime(file.modifiedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(file)}
                aria-label={t("botPanel.memory.delete", { name: file.name })}
                title={t("botPanel.memory.deleteTitle")}
                className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-control hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MemoryJournalList({
  rows,
  botName,
  reverting,
  onRevert,
  now = Date.now(),
}: {
  rows: MemoryJournalRow[] | null;
  botName: string;
  reverting: string | null;
  onRevert: (row: MemoryJournalRow) => void;
  now?: number;
}) {
  if (!rows) return <div className="text-[13px] text-ink-secondary">{t("botPanel.loading")}</div>;
  if (rows.length === 0) return <div className="text-[13px] text-ink-secondary">{t("botPanel.history.empty")}</div>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const source = journalSource(row);
        return (
          <div key={row.id} className="rounded-lg bg-inset px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
                <span>{journalSummary(row, botName)}</span>
                {" · "}
                <span className="text-ink-secondary">{relativeTime(row.at, now)}</span>
                {source && (
                  <>
                    {" · "}
                    <span className="text-ink-secondary">{source}</span>
                  </>
                )}
              </div>
              {row.canRevert ? (
                <button
                  type="button"
                  disabled={reverting !== null}
                  onClick={() => onRevert(row)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10 disabled:opacity-50"
                >
                  <RotateCcw size={12} />
                  {reverting === row.id ? t("botPanel.memory.undoing") : t("botPanel.memory.undo")}
                </button>
              ) : (
                <span className="shrink-0 text-[11.5px] text-ink-secondary" title={row.revertUnavailableReason}>
                  {t("botPanel.memory.cantUndo")}
                </span>
              )}
            </div>
            {row.diff && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[12px] text-ink-secondary">
                  {t("botPanel.memory.diff", { added: String(row.added), removed: String(row.removed) })}
                </summary>
                <pre className="mt-1 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-md p-2 font-mono text-[11.5px] leading-relaxed text-ink">
                  {row.diff}
                </pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
