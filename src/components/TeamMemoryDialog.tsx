// Team memory: the people, places, decisions and terms every bot in a
// section shares. Bots propose them from conversations for review; this is where the
// person sees the whole of it, answers what is waiting, and fixes or
// removes anything. Sits beside the section's shared context, which only
// the person writes.
import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, Loader2, Plus, Trash2 } from "lucide-react";

import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t, activeLocale } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { DetailPanel } from "./DetailPanel";
import { CompactRow, ConfirmPill, FIELD, FieldRow, FoldRow, HelpTip, PillSelect, PILL, PRIMARY_PILL, SettingsGroup } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

type Kind = "person" | "place" | "decision" | "term";

interface Entry {
  id: string;
  kind: Kind;
  name: string;
  detail: string;
  aliases: string[];
  status: "accepted" | "proposed";
  source: { botId: string; botName: string; threadId: string; at: number };
  updatedAt: number;
}

const KINDS: readonly Kind[] = ["person", "place", "decision", "term"];
const kindTitle = (kind: Kind) => t(`teamMemory.kind.${kind}` as LocaleKey);
const kindOne = (kind: Kind) => t(`teamMemory.kindOne.${kind}` as LocaleKey);
const kindHint = (kind: Kind) => t(`teamMemory.hint.${kind}` as LocaleKey);

export function TeamMemoryDialog({ section, label, onClose }: { section: string; label: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ kind: Kind; name: string; detail: string }>({ kind: "term", name: "", detail: "" });
  const query = `section=${encodeURIComponent(section)}`;

  const load = useCallback(async () => {
    const requestGeneration = ++generation.current;
    try {
      const result: { entries: Entry[] } = await api(`/api/team-memory?${query}`);
      if (generation.current !== requestGeneration) return;
      setEntries(result.entries);
      setError(null);
    } catch (cause) {
      if (generation.current !== requestGeneration) return;
      setError(readableError(cause));
    }
  }, [query]);

  useEffect(() => {
    setEntries(null);
    setError(null);
    void load();
    return () => { generation.current += 1; };
  }, [load]);


  const run = async (id: string | null, request: () => Promise<{ entries: Entry[] }>) => {
    if (busy.current) return false;
    busy.current = true;
    const requestGeneration = ++generation.current;
    setBusyId(id ?? "new");
    setError(null);
    try {
      const result = await request();
      if (generation.current !== requestGeneration) return false;
      setEntries(result.entries);
      return true;
    } catch (cause) {
      if (generation.current === requestGeneration) setError(readableError(cause));
      return false;
    } finally {
      busy.current = false;
      if (generation.current === requestGeneration) setBusyId(null);
    }
  };

  const accept = (entry: Entry) =>
    run(entry.id, () => api(`/api/team-memory/${entry.id}?${query}`, { method: "PATCH", body: JSON.stringify({ accept: true }) }));
  const remove = (entry: Entry) => run(entry.id, () => api(`/api/team-memory/${entry.id}?${query}`, { method: "DELETE" }));
  const editDetail = (entry: Entry, detail: string) => {
    if (detail.trim() === entry.detail) return;
    void run(entry.id, () => api(`/api/team-memory/${entry.id}?${query}`, { method: "PATCH", body: JSON.stringify({ detail }) }));
  };
  const add = () => {
    if (!draft.name.trim() || !draft.detail.trim()) return;
    void run(null, () => api(`/api/team-memory?${query}`, { method: "POST", body: JSON.stringify(draft) })).then((saved) => {
      if (!saved) return;
      setDraft({ kind: draft.kind, name: "", detail: "" });
      setAdding(false);
    });
  };

  const proposed = (entries ?? []).filter((entry) => entry.status === "proposed");

  const title = t("teamMemory.title", { label });
  return (
    <DetailPanel
      label={title}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <Brain size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <span className="min-w-0 truncate">{title}</span>
          <HelpTip label={t("settings.moreAbout", { title })}>{t("teamMemory.intro")}</HelpTip>
        </span>
      }
      onClose={onClose}
      closeLabel={t("teamMemory.close")}
      data-team-memory-panel=""
      footer={
        <>
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className={cn(PILL, "mr-auto", entries === null && "hidden")}>
              <Plus size={13} aria-hidden="true" /> {t("teamMemory.add")}
            </button>
          )}
          <button type="button" onClick={onClose} className={PRIMARY_PILL}>
            {t("teamShare.done")}
          </button>
        </>
      }
    >
      <div ref={dialogRef} className="flex flex-col gap-5">
          {entries === null && !error && (
            <div role="status" className="flex min-h-[160px] items-center justify-center text-ink-secondary">
              <Loader2 size={20} className="animate-spin" aria-label={t("teamMemory.loading")} />
            </div>
          )}
          {error && <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2 text-[12.5px] text-danger">{error}</p>}

          {proposed.length > 0 && (
            <SettingsGroup
              groupId="team-memory-waiting"
              title={t("teamMemory.waiting")}
              accessory={<span className="ml-auto text-[12.5px] tabular-nums text-ink-secondary">{proposed.length}</span>}
            >
              {proposed.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 basis-[240px]">
                    <span className="text-ink-secondary">{kindOne(entry.kind)} · </span>
                    <span className="text-ink">{entry.name}</span>
                    {entry.aliases.length > 0 && <span className="text-ink-secondary"> ({t("teamMemory.also", { names: entry.aliases.join(", ") })})</span>}
                    <span className="text-ink">: {entry.detail}</span>
                    <span className="mt-0.5 block text-[12px] text-ink-secondary">{t("teamMemory.from", { name: entry.source.botName })}</span>
                  </span>
                  <span className="ml-auto flex shrink-0 gap-2">
                    <button type="button" onClick={() => void remove(entry)} disabled={busyId !== null} className={PILL}>
                      {t("teamMemory.skip")}
                    </button>
                    <button type="button" onClick={() => void accept(entry)} disabled={busyId !== null} className={PRIMARY_PILL}>
                      <Check size={13} aria-hidden="true" /> {t("teamMemory.remember")}
                    </button>
                  </span>
                </div>
              ))}
            </SettingsGroup>
          )}

          {entries !== null && entries.filter((entry) => entry.status === "accepted").length === 0 && proposed.length === 0 && (
            <p className="rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-6 text-center text-[13px] text-ink-secondary">
              {t("teamMemory.empty")}
            </p>
          )}

          {(entries ?? []).some((entry) => entry.status === "accepted") && (
            <SettingsGroup groupId="team-memory-shared" title={t("teamMemory.shared")}>
              {KINDS.map((kind) => {
                const rows = (entries ?? []).filter((entry) => entry.status === "accepted" && entry.kind === kind);
                if (rows.length === 0) return null;
                return (
                  <FoldRow key={kind} cardId={`team-memory.${kind}`} defaultOpen={rows.length <= 5} label={kindTitle(kind)} help={kindHint(kind)} count={rows.length}>
                    <ul className="flex flex-col gap-0.5">
                      {rows.map((entry) => (
                        <li key={entry.id} className="flex items-start gap-3 rounded-lg px-1 py-1.5 text-[13px]">
                          <span className="min-w-0 flex-1">
                            <span className="text-ink">{entry.name}</span>
                            {entry.aliases.length > 0 && <span className="text-ink-secondary"> ({t("teamMemory.also", { names: entry.aliases.join(", ") })})</span>}
                            <input
                              key={entry.updatedAt}
                              defaultValue={entry.detail}
                              disabled={busyId !== null}
                              onBlur={(event) => editDetail(entry, event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                              }}
                              aria-label={t("teamMemory.detailAria", { name: entry.name })}
                              className={`${FIELD} mt-1`}
                            />
                            <span className="mt-0.5 block text-[12px] text-ink-secondary">
                              {entry.source.botName || t("teamMemory.you")} · {new Date(entry.updatedAt).toLocaleDateString(activeLocale())}
                            </span>
                          </span>
                          <ConfirmPill
                            disabled={busyId !== null}
                            onConfirm={() => void remove(entry)}
                            label={t("teamMemory.remove", { name: entry.name })}
                            confirmLabel={t("common.confirmRemove")}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </ConfirmPill>
                        </li>
                      ))}
                    </ul>
                  </FoldRow>
                );
              })}
            </SettingsGroup>
          )}

          {adding && (
            <form onSubmit={(event) => { event.preventDefault(); add(); }}>
              <SettingsGroup groupId="team-memory-add" title={t("teamMemory.add")}>
                <CompactRow label={t("teamMemory.kind")}>
                  <PillSelect
                    value={draft.kind}
                    ariaLabel={t("teamMemory.kind")}
                    options={KINDS.map((kind) => ({ value: kind, label: kindOne(kind) }))}
                    onChange={(kind) => setDraft({ ...draft, kind })}
                  />
                </CompactRow>
                <FieldRow label={t("teamMemory.name")}>
                  <input
                    value={draft.name}
                    autoFocus
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    className={FIELD}
                  />
                </FieldRow>
                <FieldRow label={t("teamMemory.detail")}>
                  <input
                    value={draft.detail}
                    onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
                    placeholder={t("teamMemory.detailPlaceholder")}
                    className={FIELD}
                  />
                </FieldRow>
                <div className="flex justify-end gap-2 px-3.5 pb-1.5 pt-1">
                  <button type="button" onClick={() => setAdding(false)} className={PILL}>
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={busyId !== null || !draft.name.trim() || !draft.detail.trim()}
                    className={PRIMARY_PILL}
                  >
                    {busyId === "new" ? t("teamMemory.adding") : t("common.add")}
                  </button>
                </div>
              </SettingsGroup>
            </form>
          )}
      </div>
    </DetailPanel>
  );
}
