// Rules: the bot's rule sets, hard constraints it checks every turn, loaded
// right after the Soul and before memory (docs/bot-workspace.md). RULES.md
// is the first set ("Rules"); every other set is rules/<id>.md. Each set has
// a name, a place in the order and an on/off switch; the ones that are on
// load in order, each under its own budget and all of them under a total
// (server/rules/rule-sets.ts). Everything goes through /api/bots/:id/rules (the
// Soul's gate: owner or admin), so a save refuses to overwrite a rule the
// bot added meanwhile (rules_update) and every change lands in the journal.
//
// Fetched when the category becomes active; kept mounted by the persona
// editor so unsaved drafts (one per set) survive a look at another
// category. A set whose file does not exist yet opens on the starter
// template (three example rules in a comment, which never loads); nothing
// is written until the person saves.
import { ConfirmDialog } from "../ConfirmDialog";
import { ArrowDown, ArrowUp, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatMemoryBytes } from "@/lib/memory";
import {
  DEFAULT_RULE_SET_ID,
  RULE_SET_MAX_BYTES,
  RULE_SET_MAX_LINES,
  RULE_SET_NAME_MAX,
  RULE_SETS_MAX,
  RULES_TOTAL_MAX_BYTES,
  RULES_TOTAL_MAX_LINES,
  createRuleSet,
  deleteRuleSet,
  fetchRules,
  moved,
  reorderRuleSets,
  saveRuleSetText,
  totalWithDrafts,
  updateRuleSet,
  type RuleSetWire,
  type RulesListing,
} from "@/lib/rule-sets";
import { rulesCount } from "@/lib/workspace-files";
import type { Bot } from "@/state/store";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { HelpTip, PILL, PLAIN_CARD, PLAIN_FIELD, Switch, useSettingsSurface } from "../SettingsPrimitives";
import { PaneSection } from "./PaneSection";
import { inputCls } from "./field";
import { readableError } from "@/lib/plain-error";

/** The starter template. Mirrors server/rules/rule-sets.ts RULES_TEMPLATE (a test
 * keeps them equal). */
export const RULES_TEMPLATE = `# Rules

<!--
Hard constraints this bot checks every turn. One rule per line.
Identity goes in Soul; facts go in Memory. Text inside this comment is not loaded.

Examples (copy a line below the comment to use it):
- Never send an email to a client without showing me the draft first.
- Always answer in the language the person writes in.
- Never quote a price; send pricing questions to the sales team.
-->
`;

// Settings' grey pill (2026-10-16).
const buttonCls = PILL;
const iconButtonCls = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-30";

const FALLBACK_BUDGETS: RulesListing["budgets"] = {
  set: { maxLines: RULE_SET_MAX_LINES, maxBytes: RULE_SET_MAX_BYTES },
  total: { maxLines: RULES_TOTAL_MAX_LINES, maxBytes: RULES_TOTAL_MAX_BYTES },
};

/** A set's name as shown: the default set is "Rules" in the person's language. */
export function ruleSetLabel(set: Pick<RuleSetWire, "id" | "name">): string {
  return set.name ?? (set.id === DEFAULT_RULE_SET_ID ? t("persona.rules.sets.defaultName") : set.id);
}

/** What the editor starts from for a set: its text, or the template for a
 * set with no file yet. */
function startText(set: RuleSetWire): string {
  return set.exists ? set.text : RULES_TEMPLATE;
}

export function RulesCounter({ text, maxLines = RULE_SET_MAX_LINES, maxBytes = RULE_SET_MAX_BYTES }: { text: string; maxLines?: number; maxBytes?: number }) {
  const count = rulesCount(text, maxLines, maxBytes);
  return (
    <span data-rules-counter="" className={cn(count.over && "text-danger")}>
      {t("persona.rules.counter", {
        lines: count.lines,
        maxLines: count.maxLines,
        bytes: formatMemoryBytes(count.bytes),
        maxBytes: formatMemoryBytes(count.maxBytes),
      })}
    </span>
  );
}

/** A thin bar: how full a budget is (the fuller of lines and bytes), red
 * past it. */
function Gauge({ lines, bytes, maxLines, maxBytes, label }: { lines: number; bytes: number; maxLines: number; maxBytes: number; label: string }) {
  const ratio = Math.max(maxLines > 0 ? lines / maxLines : 0, maxBytes > 0 ? bytes / maxBytes : 0);
  const percent = Math.round(ratio * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 w-full overflow-hidden rounded-full bg-control"
    >
      <div
        className={cn("h-full rounded-full", ratio > 1 ? "bg-danger" : ratio > 0.85 ? "bg-warning" : "bg-accent")}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

export function RulesSection({ bot, active, initial }: { bot: Bot; active: boolean; initial?: RulesListing }) {
  const plain = useSettingsSurface() === "plain";
  const [listing, setListing] = useState<RulesListing | null>(initial ?? null);
  const [selected, setSelected] = useState<string | null>(initial?.sets[0]?.id ?? null);
  // unsaved text per set id; absent means "as saved"
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string; current: string; currentHash: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const apply = (next: RulesListing) => {
    setListing(next);
    setSelected((current) => (current && next.sets.some((set) => set.id === current) ? current : next.sets[0]?.id ?? null));
  };

  const load = () =>
    fetchRules(bot.id).then(
      (next) => {
        apply(next);
        setError(null);
      },
      (reason: unknown) => setError(readableError(reason)),
    );

  // A re-activation re-reads, so a rule the bot added mid-session shows up;
  // drafts the person has not saved stay.
  useEffect(() => {
    if (!active) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bot.id]);

  const run = async (action: () => Promise<RulesListing | void>) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const next = await action();
      if (next) apply(next);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  const sets = listing?.sets ?? [];
  const budgets = listing?.budgets ?? FALLBACK_BUDGETS;
  const maxSets = listing?.maxSets ?? RULE_SETS_MAX;
  const nameMax = listing?.maxNameLength ?? RULE_SET_NAME_MAX;
  const current = sets.find((set) => set.id === selected) ?? null;
  const draftOf = (set: RuleSetWire) => drafts[set.id] ?? startText(set);
  const dirtyOf = (set: RuleSetWire) => drafts[set.id] !== undefined && drafts[set.id] !== startText(set);
  const total = totalWithDrafts(sets, Object.fromEntries(sets.filter(dirtyOf).map((set) => [set.id, drafts[set.id]!])));
  const totalOver = total.lines > budgets.total.maxLines || total.bytes > budgets.total.maxBytes;
  const dropDraft = (id: string) => setDrafts(({ [id]: _dropped, ...rest }) => rest);

  const save = async (set: RuleSetWire, expectedHash: string | undefined) => {
    const text = draftOf(set);
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await saveRuleSetText(bot.id, set.id, text, expectedHash);
      if (!result.ok) {
        setConflict({ id: set.id, current: result.current, currentHash: result.currentHash });
        return;
      }
      setConflict(null);
      dropDraft(set.id);
      apply(result.listing);
      setSaved(set.id);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  const addSet = () => {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      const result = await createRuleSet(bot.id, name);
      setSelected(result.set.id);
      setAdding(false);
      setNewName("");
      return result;
    });
  };

  const rename = () => {
    if (!renaming) return;
    const { id, name } = renaming;
    void run(async () => {
      const result = await updateRuleSet(bot.id, id, { name: name.trim() || null });
      setRenaming(null);
      return result;
    });
  };

  // Deleting a set asks first in the app's dialog, with a red pill
  // (2026-10-16, Settings' rule for what erases).
  const [removing, setRemoving] = useState<RuleSetWire | null>(null);
  const remove = (set: RuleSetWire) => setRemoving(set);
  const deleteSet = (set: RuleSetWire) => {
    void run(async () => {
      const result = await deleteRuleSet(bot.id, set.id);
      dropDraft(set.id);
      return result;
    });
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = moved(sets.map((set) => set.id), index, delta);
    if (ids) void run(() => reorderRuleSets(bot.id, ids));
  };

  const starter = current !== null && !current.exists;
  const draft = current ? draftOf(current) : "";
  const dirty = current ? dirtyOf(current) : false;
  const count = rulesCount(draft, budgets.set.maxLines, budgets.set.maxBytes);
  const totalLabel = t("persona.rules.sets.total", {
    lines: total.lines,
    maxLines: budgets.total.maxLines,
    bytes: formatMemoryBytes(total.bytes),
    maxBytes: formatMemoryBytes(budgets.total.maxBytes),
  });

  const help = (
    <>
      <span className="block">{t("persona.rules.intro")}</span>
      <span className="mt-2 block">{t("persona.rules.sets.order")}</span>
      <span data-rules-inheritance="" className="mt-2 block">{t("persona.rules.inheritance")}</span>
      {starter && !dirty && <span data-rules-starter="" className="mt-2 block">{t("persona.rules.starter")}</span>}
    </>
  );

  const totalBlock = (
    <div data-rules-total="" className={cn("flex flex-col gap-1", plain && "px-4 py-2.5")}>
      <div className={cn("text-[12px] text-ink-secondary", totalOver && "text-danger")}>{totalLabel}</div>
      <Gauge lines={total.lines} bytes={total.bytes} maxLines={budgets.total.maxLines} maxBytes={budgets.total.maxBytes} label={totalLabel} />
      {totalOver && <p role="alert" className="text-[12.5px] text-danger">{t("persona.rules.sets.totalOver")}</p>}
    </div>
  );

  const renameForm = (set: RuleSetWire, label: string, name: string) => (
    <form
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        rename();
      }}
    >
      <input
        autoFocus
        className={plain ? PLAIN_FIELD : inputCls + " h-8 py-1"}
        aria-label={t("persona.rules.sets.renameLabel", { name: label })}
        maxLength={nameMax}
        value={name}
        onChange={(event) => setRenaming({ id: set.id, name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") setRenaming(null);
        }}
      />
      <button type="submit" className={buttonCls} disabled={busy}>{t("persona.rules.sets.saveName")}</button>
      <button type="button" className={buttonCls} disabled={busy} onClick={() => setRenaming(null)}>{t("common.cancel")}</button>
    </form>
  );

  const setBadges = (set: RuleSetWire) => (
    <>
      {!set.enabled && (
        <span className="ml-1.5 rounded bg-control px-1 py-px text-[10px] uppercase tracking-wide text-ink-secondary">{t("persona.rules.sets.off")}</span>
      )}
      {dirtyOf(set) && (
        <span className="ml-1.5 rounded bg-warning/15 px-1 py-px text-[10px] text-warning">{t("persona.rules.sets.unsaved")}</span>
      )}
    </>
  );

  const setControls = (set: RuleSetWire, index: number, label: string) => (
    <>
      <Switch
        checked={set.enabled}
        aria-label={t("persona.rules.sets.toggle", { name: label })}
        disabled={busy}
        onClick={() => void run(() => updateRuleSet(bot.id, set.id, { enabled: !set.enabled }))}
      />
      <button type="button" className={iconButtonCls} aria-label={t("persona.rules.sets.moveUp", { name: label })} title={t("persona.rules.sets.moveUp", { name: label })} disabled={busy || index === 0} onClick={() => move(index, -1)}>
        <ArrowUp size={14} aria-hidden="true" />
      </button>
      <button type="button" className={iconButtonCls} aria-label={t("persona.rules.sets.moveDown", { name: label })} title={t("persona.rules.sets.moveDown", { name: label })} disabled={busy || index === sets.length - 1} onClick={() => move(index, 1)}>
        <ArrowDown size={14} aria-hidden="true" />
      </button>
      <button type="button" className={iconButtonCls} aria-label={t("persona.rules.sets.rename", { name: label })} title={t("persona.rules.sets.rename", { name: label })} disabled={busy} onClick={() => setRenaming({ id: set.id, name: label })}>
        <Pencil size={13} aria-hidden="true" />
      </button>
      <button type="button" className={cn(iconButtonCls, "hover:bg-danger/10 hover:text-danger")} aria-label={t("persona.rules.sets.delete", { name: label })} title={t("persona.rules.sets.delete", { name: label })} disabled={busy} onClick={() => remove(set)}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </>
  );

  const selectSet = (set: RuleSetWire) => {
    setSelected(set.id);
    setSaved(null);
  };

  const addForm = (
    <form
      className={cn("flex items-center gap-2", plain && "px-4 py-2")}
      onSubmit={(event) => {
        event.preventDefault();
        addSet();
      }}
    >
      <input
        autoFocus
        className={plain ? PLAIN_FIELD : inputCls}
        aria-label={t("persona.rules.sets.newName")}
        placeholder={t("persona.rules.sets.newPlaceholder")}
        maxLength={nameMax}
        value={newName}
        onChange={(event) => setNewName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setAdding(false);
        }}
      />
      <button type="submit" className={buttonCls} disabled={busy || !newName.trim()}>{t("common.add")}</button>
      <button type="button" className={buttonCls} disabled={busy} onClick={() => setAdding(false)}>{t("common.cancel")}</button>
    </form>
  );
  const atLimit = listing !== null && sets.length >= maxSets;
  const limitNote = atLimit && <span className={cn("text-[12px] text-ink-secondary", plain && "px-4 py-2.5")}>{t("persona.rules.sets.limit", { count: maxSets })}</span>;

  const editor = current && (
    <div className={cn("flex flex-col gap-3", plain && "px-4 pb-3 pt-1")} data-rule-set-editor={current.id}>
      {!current.enabled && <p className="text-[12.5px] text-ink-secondary">{t("persona.rules.sets.offNote")}</p>}
      <MarkdownEditor
        ariaLabel={t("persona.rules.sets.editorLabel", { name: ruleSetLabel(current), file: current.file })}
        value={draft}
        onChange={(next) => {
          setDrafts((all) => ({ ...all, [current.id]: next }));
          setSaved(null);
        }}
        minHeight={220}
        dataField="rules"
        placeholder={t("persona.rules.placeholder")}
        invalid={count.over}
        footer={<RulesCounter text={draft} maxLines={budgets.set.maxLines} maxBytes={budgets.set.maxBytes} />}
      />
      {count.over && (
        <p role="alert" className="text-[12.5px] text-danger">
          {t("persona.rules.sets.setOver", { maxLines: count.maxLines, maxBytes: formatMemoryBytes(count.maxBytes) })}
        </p>
      )}
      {conflict && conflict.id === current.id && (
        <div role="alert" className={plain ? "rounded-lg bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink" : "rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink"}>
          <div className={plain ? undefined : "font-medium"}>{t("persona.rules.conflict")}</div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={buttonCls}
              disabled={busy}
              onClick={() => {
                dropDraft(current.id);
                setConflict(null);
                void load();
              }}
            >
              {t("persona.rules.reload")}
            </button>
            <button type="button" className={buttonCls} disabled={busy} onClick={() => void save(current, conflict.currentHash)}>
              {t("persona.rules.overwrite")}
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-rules-save=""
          className={buttonCls}
          disabled={busy || (!dirty && !starter)}
          onClick={() => void save(current, current.hash)}
        >
          {busy ? t("persona.rules.saving") : t("persona.rules.save")}
        </button>
        {dirty && (
          <button
            type="button"
            className={plain ? buttonCls : "rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink"}
            disabled={busy}
            onClick={() => dropDraft(current.id)}
          >
            {t("persona.rules.discard")}
          </button>
        )}
        {saved === current.id && !dirty && <span className="text-[12.5px] text-ink-secondary">{t("persona.rules.saved")}</span>}
      </div>
    </div>
  );

  const confirmDelete = (
    <ConfirmDialog
      open={removing !== null}
      title={t("persona.rules.sets.delete", { name: removing ? ruleSetLabel(removing) : "" })}
      body={removing ? t("persona.rules.sets.deleteConfirm", { name: ruleSetLabel(removing) }) : ""}
      confirmLabel={t("common.delete")}
      tone="danger"
      onCancel={() => setRemoving(null)}
      onConfirm={() => {
        const set = removing;
        setRemoving(null);
        if (set) deleteSet(set);
      }}
    />
  );

  // The bot's profile page (plain surface, #2313): one card labelled Rules,
  // "Add a set" a pill at the label's right; the total and each set are rows
  // of it (a line icon, the name, the file and its count grey under it, the
  // switch and the order buttons at the right), the selected set's editor
  // unfolds under its row.
  if (plain) {
    const addButton = !adding && (
      <button
        type="button"
        data-rules-add=""
        className={buttonCls}
        disabled={busy || listing === null || atLimit}
        onClick={() => setAdding(true)}
      >
        <Plus size={14} aria-hidden="true" /> {t("persona.rules.sets.add")}
      </button>
    );
    return (
      <PaneSection title={t("botSettings.nav.rules")} help={help} action={addButton} plain data-rules-section="">
        <div className={PLAIN_CARD} data-settings-surface="">
          {totalBlock}
          <div className="flex flex-col" data-rule-sets="">
            {listing !== null && sets.length === 0 && (
              <div className="px-4 py-2.5 text-[12.5px] text-ink-secondary">{t("persona.rules.sets.empty")}</div>
            )}
            {sets.map((set, index) => {
              const label = ruleSetLabel(set);
              const setCount = rulesCount(draftOf(set), budgets.set.maxLines, budgets.set.maxBytes);
              const counterText = t("persona.rules.sets.rowCounter", { lines: setCount.lines, maxLines: setCount.maxLines, bytes: formatMemoryBytes(setCount.bytes) });
              const isSelected = set.id === selected;
              return (
                <div key={set.id} data-rule-set={set.id} className="flex flex-col">
                  <div className="flex min-h-[56px] items-center gap-3 px-4 pt-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary" aria-hidden="true"><ScrollText className="size-5" /></span>
                    {renaming?.id === set.id ? renameForm(set, label, renaming.name) : (
                      <>
                        <button type="button" aria-pressed={isSelected} onClick={() => selectSet(set)} className="flex min-w-0 flex-1 flex-col text-left">
                          <span className="flex min-w-0 items-center">
                            <span className={cn("truncate text-[14px] leading-5", set.enabled ? "text-ink" : "text-ink-secondary")} data-rule-set-name="">{label}</span>
                            {setBadges(set)}
                          </span>
                          <span className={cn("truncate text-[12px] leading-4 text-ink-secondary", setCount.over && "text-danger")} data-rule-set-counter="">
                            {set.file} · {counterText}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">{setControls(set, index, label)}</div>
                      </>
                    )}
                  </div>
                  <div className="pb-2.5 pl-12 pr-4 pt-1.5">
                    <Gauge lines={setCount.lines} bytes={setCount.bytes} maxLines={setCount.maxLines} maxBytes={setCount.maxBytes} label={`${label}: ${counterText}`} />
                  </div>
                  {isSelected && editor}
                </div>
              );
            })}
          </div>
          {adding && addForm}
          {limitNote}
          {error && <p role="alert" className="px-4 py-2.5 text-[12.5px] text-danger">{error}</p>}
        </div>
        {confirmDelete}
      </PaneSection>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-rules-section="">
      <div className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
        <span>{t("persona.rules.short")}</span>
        <HelpTip label={t("settings.moreAbout", { title: t("botSettings.nav.rules") })}>{help}</HelpTip>
      </div>

      {totalBlock}

      <div className="overflow-clip rounded-xl border-[0.5px] border-border bg-elevated" data-rule-sets="">
        {listing !== null && sets.length === 0 && (
          <div className="px-3 py-3 text-[12.5px] text-ink-secondary">{t("persona.rules.sets.empty")}</div>
        )}
        {sets.map((set, index) => {
          const label = ruleSetLabel(set);
          const setCount = rulesCount(draftOf(set), budgets.set.maxLines, budgets.set.maxBytes);
          const counterText = t("persona.rules.sets.rowCounter", { lines: setCount.lines, maxLines: setCount.maxLines, bytes: formatMemoryBytes(setCount.bytes) });
          const isSelected = set.id === selected;
          return (
            <div
              key={set.id}
              data-rule-set={set.id}
              className={cn("border-b border-hairline/40 px-3 py-2 last:border-b-0", isSelected && "bg-raised/60")}
            >
              <div className="flex items-center gap-2">
                {renaming?.id === set.id ? renameForm(set, label, renaming.name) : (
                  <>
                    <button type="button" aria-pressed={isSelected} onClick={() => selectSet(set)} className="min-w-0 flex-1 text-left">
                      <span className={cn("truncate text-[13px] font-medium", set.enabled ? "text-ink" : "text-ink-secondary")} data-rule-set-name="">{label}</span>
                      {setBadges(set)}
                      <span className={cn("block font-mono text-[10.5px] text-ink-secondary", setCount.over && "text-danger")} data-rule-set-counter="">
                        {set.file} · {counterText}
                      </span>
                    </button>
                    {setControls(set, index, label)}
                  </>
                )}
              </div>
              <div className="mt-1.5">
                <Gauge lines={setCount.lines} bytes={setCount.bytes} maxLines={setCount.maxLines} maxBytes={setCount.maxBytes} label={`${label}: ${counterText}`} />
              </div>
            </div>
          );
        })}
      </div>

      {adding ? addForm : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-rules-add=""
            className="flex items-center gap-1 self-start rounded-lg px-1 py-1 text-[12.5px] font-medium text-accent-text hover:underline disabled:opacity-50"
            disabled={busy || listing === null || atLimit}
            onClick={() => setAdding(true)}
          >
            <Plus size={13} aria-hidden="true" /> {t("persona.rules.sets.add")}
          </button>
          {limitNote}
        </div>
      )}

      {editor}
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {confirmDelete}
    </div>
  );
}
