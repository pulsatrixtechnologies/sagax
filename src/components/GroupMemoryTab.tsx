// The group panel's Memory tab: the group's shared memory
// (server/memory/group-memory.ts), the bot panel's memory look at group scope.
// Every bot of the group reads it at each turn there and writes it only with
// group_memory_update. The owner edits it and switches it off; the group's
// other people read it.
import { useEffect, useState } from "react";

import { fetchGroupMemory, saveGroupMemory, type GroupMemoryView } from "@/lib/group-memory";
import { t } from "@/lib/i18n";
import { ApiError } from "@/state/store";
import { Switch } from "./SettingsPrimitives";
import { MemoryGauge } from "./bot-settings/MemorySection";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import { readableError } from "@/lib/plain-error";

const buttonCls = "rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50";

export function GroupMemoryTab({ groupId }: { groupId: string }) {
  const [view, setView] = useState<GroupMemoryView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = (keepDraft = false) =>
    fetchGroupMemory(groupId).then((next) => {
      setView(next);
      if (!keepDraft) setDraft(next.text);
      setError(null);
    }, (e: unknown) => setError(readableError(e)));

  useEffect(() => {
    setView(null);
    setConflict(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  if (!view) {
    return <div className="px-4 pb-6 pt-2 text-[13px] text-ink-secondary">{error ?? t("groupMemory.loading")}</div>;
  }

  const save = (body: { text?: string; expectedHash?: string; enabled?: boolean }) => {
    setSaving(true);
    saveGroupMemory(groupId, body)
      .then((next) => {
        setView(next);
        if (body.text !== undefined) setDraft(next.text);
        setConflict(false);
        setError(null);
      }, (e: unknown) => {
        if (e instanceof ApiError && e.status === 409) {
          setConflict(true);
          return;
        }
        setError(readableError(e));
      })
      .finally(() => setSaving(false));
  };
  return (
    <GroupMemoryBody
      view={view}
      draft={draft}
      conflict={conflict}
      error={error}
      saving={saving}
      onDraft={setDraft}
      onReset={() => setDraft(view.text)}
      onSave={() => save({ text: draft, expectedHash: view.hash })}
      onToggle={() => save({ enabled: !view.enabled })}
      onReload={() => { setConflict(false); void load(); }}
      onOverwrite={() => save({ text: draft })}
    />
  );
}

/** What the tab draws, from its state: editable for the owner, read-only
 * for the group's other people. */
export function GroupMemoryBody({ view, draft, conflict, error, saving, onDraft, onReset, onSave, onToggle, onReload, onOverwrite }: {
  view: GroupMemoryView;
  draft: string;
  conflict: boolean;
  error: string | null;
  saving: boolean;
  onDraft: (text: string) => void;
  onReset: () => void;
  onSave: () => void;
  onToggle: () => void;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  const dirty = draft !== view.text;

  return (
    <div data-testid="group-memory" className="flex flex-col gap-4 px-4 pb-6 pt-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink">{t("groupMemory.title")}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("groupMemory.detail")}</p>
        </div>
        {view.canEdit && <Switch
          checked={view.enabled}
          disabled={saving}
          aria-label={t("groupMemory.switch")}
          onClick={onToggle}
        />}
      </div>
      {!view.canEdit && <p className="text-[12px] text-ink-secondary">{t("groupMemory.readOnly")}</p>}
      {!view.enabled && <p className="text-[12px] text-ink-secondary">{t("groupMemory.off")}</p>}
      <MemoryGauge index={view.capacity} />
      <MarkdownEditor
        ariaLabel={t("groupMemory.title")}
        value={draft}
        readOnly={!view.canEdit}
        onChange={onDraft}
        minHeight={240}
        dataField="group-memory"
        placeholder={view.canEdit ? t("groupMemory.placeholder") : t("groupMemory.empty")}
      />
      {conflict && (
        <div role="alert" className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink">
          <div className="font-medium">{t("groupMemory.conflict")}</div>
          <div className="mt-2 flex gap-2">
            <button type="button" className={buttonCls} disabled={saving} onClick={onReload}>{t("groupMemory.reload")}</button>
            {view.canEdit && <button type="button" className={buttonCls} disabled={saving} onClick={onOverwrite}>{t("groupMemory.overwrite")}</button>}
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      {view.canEdit && (
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonCls} disabled={!dirty || saving} onClick={onReset}>{t("common.cancel")}</button>
          <button type="button" className={buttonCls} disabled={!dirty || saving} onClick={onSave}>{t("groupMemory.save")}</button>
        </div>
      )}
    </div>
  );
}
