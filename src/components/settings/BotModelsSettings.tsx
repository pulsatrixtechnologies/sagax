// Settings > Models > Bot models (#1675, redesigned #2050 "option B"): one
// page for the person's bots' models. Works without a model turn. Own bots
// only; org allowed-engines rules still apply through the same setModel /
// ModelPicker path.
// Layout: a table like Grok Bot / Cursor model settings, one row per bot
// grouped by sidebar section: Bot / Model · effort / Backup. The Model cell
// is the two-pane model selector (ModelPicker `panes`), the same one the
// "Set model for n bots" button and Bot > Model open. #2080: the checkboxes
// show only in "Edit several" mode (SelectionBar); the Backup column always
// shows (effectiveBackups, shared with Bot > Model) so a person can pick the
// engine and the backup model per bot even before any bot has one.
// "Defaults for new bots" is read-only in an organization (set there, folded
// under Advanced; no shortcut to Perspicax since 2026-11-05), editable solo.
import { Fragment, useCallback, useMemo, useRef, useState, useId, type ReactNode } from "react";
import { ChevronDown, TriangleAlert, X } from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { canEditBotField, viewerOwnsBot } from "@/lib/bot-capabilities";
import { effectiveBackups } from "@/lib/bot-runtime-settings";
import {
  botModelWarning,
  botsWithSidebarSections,
  formatBotBackups,
  formatBotModelSelection,
  groupBotsBySidebarSection,
  ownBotsForModelsPage,
  setSectionSelection,
  toggleBotSelection,
  type BotModelWarningKind,
  type BotModelsRow,
} from "@/lib/bot-models-page";
import { cn } from "@/lib/cn";
import { effortLabel } from "@/lib/effort-label";
import { t } from "@/lib/i18n";
import { engineOfferContext, useOfferedInstances } from "@/lib/offered-instances";
import { useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { usePersonalSections } from "@/lib/personal-sections";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { useStore, type Bot } from "@/state/store";
import { fallbackWithModel } from "../../../shared/handoff-model";
import { engineOffer } from "../../../shared/offered-engines";
import { AnchoredPopover, enclosingWindowBounds, useAnchoredDismissRoot } from "../AnchoredPopover";
import { ModelPicker, type ComposerModelMenuControl } from "../ModelPicker";
import { DefaultBotSettings, newBotDefaultsSummary } from "../NewBotDialog";
import { DescribedRow, DialogFrame, DialogLayer, HelpTip, PILL, PillSelect, SettingsGroup, TABLE_CELL_CONTROL } from "../SettingsPrimitives";
import { SelectionBar } from "./SettingsPatterns";

// One grid for the column headers, the section headers and every row, so
// the checkbox (Edit several only), Model · effort and Backup line up down
// the table. Under 36rem of table width the row stacks: name on top, then
// the two controls side by side, each with its column name above it.
// (Class names spelled out whole: Tailwind finds them in the source.)
const ROW_GRIDS = {
  selectBackup: "grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2.5 px-3 @min-[36rem]:grid-cols-[1.25rem_minmax(8rem,1fr)_minmax(12rem,2fr)_minmax(7rem,1fr)]",
  backup: "grid grid-cols-[minmax(0,1fr)] items-center gap-x-2.5 px-3 @min-[36rem]:grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_minmax(7rem,1fr)]",
} as const;
type Backup = NonNullable<Bot["fallback"]>[number];

/** The backups this viewer may still use: an engine the organization no
 * longer offers is dropped (the server skips it too); one the person pays
 * for stays when the organization lets own accounts through (#1098). */
function useBackupFilter(): (entry: Backup) => boolean {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const mine = useMyEngines();
  const offerContext = engineOfferContext(state.config, org !== null, mine);
  return useCallback((entry: Backup) => {
    const offer = engineOffer(offerContext, entry.instanceId);
    return offer === "offered" || (offer === "notGiven" && mine?.find((row) => row.instanceId === entry.instanceId)?.orgNotAllowed !== true);
  }, [offerContext, mine]);
}

/** "Grok 4", or "Grok 4 · default" when it comes from the server default. */
function backupsText(bot: Bot, config: Parameters<typeof effectiveBackups>[1], keep: (entry: Backup) => boolean, instances: Parameters<typeof formatBotBackups>[1]): string {
  const { chain, source } = effectiveBackups(bot, config, keep);
  const text = formatBotBackups(chain, instances);
  return text && source === "org" ? t("botModels.backup.auto", { backups: text }) : text;
}
const READ_ONLY_CELL = "block h-8 truncate px-2 text-[13px] leading-8 text-ink-secondary";

function Cell({ label, children, ...data }: { label: string; children: ReactNode; [marker: `data-${string}`]: string }) {
  return (
    <div {...data} className="flex min-w-0 flex-col gap-0.5">
      <span aria-hidden="true" className="px-2 text-[11.5px] leading-4 text-ink-secondary @min-[36rem]:hidden">{label}</span>
      {children}
    </div>
  );
}

function warningText(kind: BotModelWarningKind): string {
  if (kind === "signedOut") return t("botModels.warning.signedOut");
  if (kind === "expired") return t("botModels.warning.expired");
  if (kind === "noAccess") return t("botModels.warning.noAccess");
  return t("botModels.warning.notResponding");
}

function sectionTitle(section: string): string {
  return section ? section : t("sidebar.section.general");
}

/** The read-only Model · effort text of a bot this person may not edit. */
export function botModelEffortText(row: BotModelsRow, instances: Parameters<typeof formatBotModelSelection>[1]): string {
  const effort = row.modelSelection.effort;
  return [formatBotModelSelection(row.modelSelection, instances), effort ? effortLabel(effort) : undefined].filter(Boolean).join(" · ");
}

function BotBackupCell({ bot, disabled }: { bot: Bot; disabled: boolean }) {
  const { state, dispatch } = useStore();
  const offered = useOfferedInstances();
  const keep = useBackupFilter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const dismissRoot = useAnchoredDismissRoot(rootRef, panelRef);
  usePopoverDismiss(open, dismissRoot, () => setOpen(false));

  // the effective chain (own list, own single backup, else the server
  // default): a change writes it as the bot's own list
  const { chain } = effectiveBackups(bot, state.config, keep);
  const available = offered.filter(
    (instance) =>
      instance.snapshot.state === "available" &&
      Boolean(instance.models.default.trim()) &&
      instance.instanceId !== bot.modelSelection.instanceId &&
      !chain.some((entry) => entry.instanceId === instance.instanceId),
  );
  const label = backupsText(bot, state.config, keep, state.instances) || t("botModels.backup.none");
  const nameOf = (instanceId: string) =>
    state.instances.find((instance) => instance.instanceId === instanceId)?.displayName ?? instanceId;
  const onChange = (fallback: Bot["fallback"]) => {
    dispatch({ type: "updateBot", botId: bot.id, patch: { fallback } });
  };

  return (
    <div ref={rootRef} data-bot-models-backup={bot.id} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={t("botModels.backup.edit", { name: bot.name })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={label}
        data-pill-select=""
        onClick={() => setOpen((next) => !next)}
        className={TABLE_CELL_CONTROL}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      </button>
      {open && (
        <AnchoredPopover
          as="div"
          anchorRef={triggerRef}
          popoverRef={panelRef}
          align="end"
          maxHeight={320}
          bounds={enclosingWindowBounds}
          id={listId}
          role="dialog"
          aria-label={t("botModels.col.backup")}
          className="popover-surface flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-1.5 overflow-y-auto rounded-lg border-[0.5px] border-border bg-elevated p-2"
        >
          {chain.length === 0 && (
            <p className="px-2 py-1 text-[12px] text-ink-secondary">{t("botModels.backup.noneHelp")}</p>
          )}
          {chain.map((entry, index) => {
            const models = state.instances.find((instance) => instance.instanceId === entry.instanceId)?.models.options ?? [];
            const allowed = models.map((model) => model.id);
            return (
              <div key={entry.instanceId} className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-hover/60">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {index + 1}. {nameOf(entry.instanceId)}
                </span>
                <PillSelect
                  value={entry.model}
                  ariaLabel={t("botPanel.model.backupModel")}
                  onChange={(model) => {
                    const next = fallbackWithModel(chain, entry.instanceId, model, allowed.length ? allowed : [model]);
                    if (next) onChange(next);
                  }}
                  options={[
                    ...(allowed.includes(entry.model) ? [] : [{ value: entry.model, label: entry.model }]),
                    ...models.map((model) => ({ value: model.id, label: model.label })),
                  ]}
                />
                <button
                  type="button"
                  className="ui-icon-button shrink-0"
                  aria-label={t("botPanel.model.removeFallback", { name: nameOf(entry.instanceId) })}
                  onClick={() => onChange(chain.filter((candidate) => candidate.instanceId !== entry.instanceId))}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {chain.length < 5 && (
            <div className="border-t border-hairline/40 px-1.5 pt-1.5">
              <PillSelect
                value=""
                ariaLabel={t("botPanel.model.addFallback")}
                disabled={available.length === 0}
                onChange={(instanceId) => {
                  const instance = state.instances.find((candidate) => candidate.instanceId === instanceId);
                  if (!instance || !instance.models.default.trim() || !available.includes(instance)) return;
                  onChange([...chain, { instanceId, model: instance.models.default }]);
                }}
                options={[
                  { value: "", label: available.length === 0 ? t("botPanel.model.noEngine") : t("botPanel.model.addEngine"), disabled: true },
                  ...available.map((instance) => ({ value: instance.instanceId, label: instance.displayName })),
                ]}
              />
            </div>
          )}
        </AnchoredPopover>
      )}
    </div>
  );
}

function BulkBackupChoice({
  bots,
  onCancel,
  onChosen,
}: {
  bots: Bot[];
  onCancel: () => void;
  onChosen: (fallback: Bot["fallback"]) => void;
}) {
  const offered = useOfferedInstances();
  const available = offered.filter(
    (instance) => instance.snapshot.state === "available" && Boolean(instance.models.default.trim()),
  );

  return (
    <DialogLayer onBackdropMouseDown={onCancel}>
      <DialogFrame
        titleId="bot-models-bulk-backup-title"
        title={t("botModels.bulk.backupTitle")}
        closeLabel={t("common.close")}
        onClose={onCancel}
        frameProps={{ "data-bot-models-bulk-backup-picker": "" }}
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">
          {t("botModels.bulk.backupHelp", { count: bots.length })}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={PILL}
            data-bot-models-bulk-backup-clear=""
            onClick={() => onChosen([])}
          >
            {t("botModels.bulk.clearBackup")}
          </button>
          {available.map((instance) => (
            <button
              key={instance.instanceId}
              type="button"
              className={PILL}
              data-bot-models-bulk-backup-engine={instance.instanceId}
              onClick={() => onChosen([{ instanceId: instance.instanceId, model: instance.models.default }])}
            >
              {instance.displayName}
              <span className="text-ink-secondary"> · {instance.models.options.find((model) => model.id === instance.models.default)?.label ?? instance.models.default}</span>
            </button>
          ))}
        </div>
        {available.length === 0 && (
          <p className="text-[12.5px] text-ink-secondary">{t("botPanel.model.noEngine")}</p>
        )}
      </DialogFrame>
    </DialogLayer>
  );
}

/** "Defaults for new bots": set in Perspicax in an organization (read-only
 * here with the current choice), editable solo. */
function NewBotDefaultsCard() {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const title = t("botModels.defaults.title");
  return (
    <SettingsGroup
      title={title}
      groupId="bot-models-defaults"
      advanced={Boolean(org)}
      accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botModels.defaults.help")}</HelpTip>}
    >
      {org ? (
        <DescribedRow
          label={newBotDefaultsSummary(state.config) || t("botModels.defaults.perspicax")}
          description={t("providers.chosenInPerspicax")}
          rowId="models.newBotDefaults"
        />
      ) : (
        <DefaultBotSettings />
      )}
    </SettingsGroup>
  );
}

export function BotModelsSettings() {
  const { state, dispatch } = useStore();
  const org = usePerspicaxOrg();
  const myEngines = useMyEngines();
  const personal = usePersonalSections();
  const keep = useBackupFilter();
  const orgMode = org !== null;

  const owned = useMemo(
    () => ownBotsForModelsPage((state.bots ?? []) as BotModelsRow[], state.config),
    [state.bots, state.config],
  );
  const sectioned = useMemo(
    () => botsWithSidebarSections(owned, orgMode ? personal : null),
    [owned, orgMode, personal],
  );
  const groups = useMemo(() => groupBotsBySidebarSection(sectioned), [sectioned]);
  const allIds = useMemo(() => sectioned.map((bot) => bot.id), [sectioned]);

  // "Edit several" mode: the checkboxes and the selection bar show only
  // while it is on (Escape or Done closes it).
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Bulk "Set backup" from the Edit several bar.
  const [pickingBackup, setPickingBackup] = useState(false);
  const bulkMenu = useRef<ComposerModelMenuControl | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const fullBots = useMemo(
    () => sectioned.flatMap((row) => {
      const full = state.bots.find((bot) => bot.id === row.id);
      return full ? [full] : [];
    }),
    [sectioned, state.bots],
  );
  const selectedFull = useMemo(() => fullBots.filter((bot) => selected.has(bot.id)), [fullBots, selected]);
  // The shared selector applies the pick to the first selected bot and,
  // through `alsoApplyTo`, to the others (batchModelActions). It stays
  // mounted while there is a selection so its menu can open.
  const bulkLead = selectedFull.find((bot) => !bot.busy) ?? selectedFull[0];
  const bulkIds = useMemo(() => selectedFull.map((bot) => bot.id), [selectedFull]);
  const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const anyOn = allIds.some((id) => selected.has(id));
  const grid = ROW_GRIDS[editing ? "selectBackup" : "backup"];
  const headingSpan = editing ? "@min-[36rem]:col-span-3" : "col-span-full";

  const stopEditing = useCallback(() => {
    setEditing(false);
    setSelected(new Set());
  }, []);

  const applyBulkBackup = (fallback: Bot["fallback"]) => {
    for (const bot of selectedFull) {
      if (bot.busy) continue;
      if (!viewerOwnsBot(state.config, bot) || !canEditBotField(state.config, bot, "fallback")) continue;
      // Skip a backup that matches the bot's own engine (same as the row editor).
      const next = (fallback ?? []).filter((entry) => entry.instanceId !== bot.modelSelection.instanceId);
      dispatch({ type: "updateBot", botId: bot.id, patch: { fallback: next } });
    }
    stopEditing();
    setPickingBackup(false);
  };

  const title = t("botModels.title");
  return (
    <div ref={pageRef} data-settings-card="models.bots" data-bot-models-page="" className="flex min-w-0 flex-col gap-6">
      <SettingsGroup
        title={title}
        groupId="bot-models-table"
        accessory={
          <span className="flex items-center gap-2">
            {groups.length > 0 && (
              <button
                type="button"
                className={PILL}
                aria-pressed={editing}
                data-bot-models-edit-several=""
                onClick={() => (editing ? stopEditing() : setEditing(true))}
              >
                {editing ? t("settings.selection.done") : t("botModels.editSeveral")}
              </button>
            )}
            <HelpTip label={t("settings.moreAbout", { title })}>{t("botModels.help")}</HelpTip>
          </span>
        }
      >
        {groups.length === 0 ? (
          <p className="px-3.5 py-3 text-[13px] text-ink-secondary" data-bot-models-empty="">{t("botModels.empty")}</p>
        ) : (
          <div
            data-bot-models-table=""
            data-bot-models-list=""
            data-bot-models-editing={editing ? "" : undefined}
            className="@container flex min-w-0 flex-col"
          >
            {/* Column headers; in Edit several mode the "All bots" checkbox
                selects every bot. The stacked layout names each control
                above it instead. */}
            <div data-bot-models-cols="" className={cn(grid, "border-b border-hairline/40 pb-2 pt-1 text-[12px] leading-4 text-ink-secondary")}>
              {editing && (
                <input
                  type="checkbox"
                  className="size-3.5 justify-self-center accent-[var(--color-accent)]"
                  checked={allOn}
                  ref={(node) => { if (node) node.indeterminate = anyOn && !allOn; }}
                  aria-label={t("botModels.selectAll")}
                  data-bot-models-select-all=""
                  data-bot-models-col="select"
                  onChange={(event) => setSelected(setSectionSelection(selected, allIds, event.target.checked))}
                />
              )}
              <span data-bot-models-col="bot" className="truncate">{editing ? t("botModels.selectAll") : t("botModels.col.bot")}</span>
              <span data-bot-models-col="model" className="hidden truncate px-2 @min-[36rem]:block" title={t("botModels.col.model")}>{t("botModels.col.modelEffort")}</span>
              <span data-bot-models-col="backup" className="hidden truncate px-2 @min-[36rem]:block">{t("botModels.col.backup")}</span>
            </div>
            {groups.map((group) => {
              const ids = group.bots.map((bot) => bot.id);
              const sectionOn = ids.length > 0 && ids.every((id) => selected.has(id));
              const sectionSome = ids.some((id) => selected.has(id));
              const sectionKey = group.section || "unassigned";
              return (
                <Fragment key={sectionKey}>
                  <div
                    data-bot-models-section={sectionKey}
                    className={cn(grid, "pb-1.5 pt-3.5")}
                  >
                    {editing && (
                      <input
                        type="checkbox"
                        className="size-3.5 justify-self-center accent-[var(--color-accent)]"
                        checked={sectionOn}
                        ref={(node) => { if (node) node.indeterminate = sectionSome && !sectionOn; }}
                        aria-label={t("botModels.selectSection", { section: sectionTitle(group.section) })}
                        data-bot-models-section-select=""
                        onChange={(event) => setSelected(setSectionSelection(selected, ids, event.target.checked))}
                      />
                    )}
                    {/* Same type as the Settings group headings. */}
                    <h3 className={cn("truncate text-[13px] font-normal leading-[18px] text-ink-secondary", headingSpan)}>
                      {sectionTitle(group.section)}
                      <span className="ml-1">({group.bots.length})</span>
                    </h3>
                  </div>
                  {group.bots.map((row) => {
                    const full = state.bots.find((bot) => bot.id === row.id);
                    if (!full) return null;
                    const mayEdit = viewerOwnsBot(state.config, full) && canEditBotField(state.config, full, "modelSelection");
                    const mayBackup = mayEdit && canEditBotField(state.config, full, "fallback");
                    const warning = botModelWarning(row, state.instances, { orgMode, myEngines });
                    const backups = backupsText(full, state.config, keep, state.instances);
                    const modelName = botModelEffortText(row, state.instances);
                    return (
                      <div
                        key={row.id}
                        data-bot-models-row={row.id}
                        data-bot-models-section-of={sectionKey}
                        data-bot-models-warning={warning ?? undefined}
                        className={cn(grid, "gap-y-2 border-t border-hairline/30 py-2")}
                      >
                        {editing && (
                          <input
                            type="checkbox"
                            className="size-3.5 justify-self-center accent-[var(--color-accent)]"
                            checked={selected.has(row.id)}
                            aria-label={t("botModels.selectBot", { name: row.name })}
                            data-bot-models-select={row.id}
                            onChange={() => setSelected(toggleBotSelection(selected, row.id))}
                          />
                        )}
                        <div className="flex min-w-0 items-center gap-2" data-bot-models-bot={row.id}>
                          <BotAvatar bot={full} size={24} animated={false} label="" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium leading-[18px] text-ink" title={row.name}>{row.name}</div>
                            {warning && (
                              <p className="flex items-start gap-1 text-[11.5px] leading-4 text-warning" data-bot-models-warn={warning} title={warningText(warning)}>
                                <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                                <span className="min-w-0 truncate">{warningText(warning)}</span>
                              </p>
                            )}
                          </div>
                        </div>
                        <div
                          data-bot-models-controls={row.id}
                          className={cn(
                            "grid min-w-0 grid-cols-2 gap-x-2 gap-y-2 @min-[36rem]:contents",
                            editing ? "col-start-2" : "col-start-1",
                          )}
                        >
                          <Cell label={t("botModels.col.modelEffort")} data-bot-models-model={row.id}>
                            {mayEdit ? (
                              <ModelPicker bot={full} listChip panes />
                            ) : (
                              <span className={READ_ONLY_CELL} title={modelName}>{modelName}</span>
                            )}
                          </Cell>
                          <Cell label={t("botModels.col.backup")} data-bot-models-backup-cell={row.id}>
                            {mayBackup ? (
                              <BotBackupCell bot={full} disabled={Boolean(full.busy)} />
                            ) : (
                              <span data-bot-models-backup={row.id} className={READ_ONLY_CELL} title={backups || undefined}>
                                {backups || t("botModels.backup.none")}
                              </span>
                            )}
                          </Cell>
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        )}
      </SettingsGroup>

      {/* The selection bar sticks to the bottom of the Settings scroll area
          while the table is in view; at the end of the table it sits under
          the last row, never over it. */}
      {editing && (
        <div data-bot-models-bulk-dock="" className="contents">
          <SelectionBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            onDone={stopEditing}
            actions={[
              { label: t("botModels.bulk.setBackup"), onClick: () => setPickingBackup(true) },
              {
                label: selected.size === 1 ? t("botModels.bulk.setModelForOne") : t("botModels.bulk.setModelFor", { count: selected.size }),
                onClick: () => bulkMenu.current?.toggle(null),
              },
            ]}
          />
        </div>
      )}
      {/* The same selector as the rows, with no chip: the bar's primary
          button opens it; the pick lands on every selected bot. */}
      {editing && bulkLead && (
        <ModelPicker
          key={bulkLead.id}
          bot={bulkLead}
          headless
          panes
          alsoApplyTo={bulkIds}
          menuControl={bulkMenu}
          fallbackAnchor={() => pageRef.current?.querySelector<HTMLButtonElement>("[data-selection-bar] button:last-child") ?? null}
        />
      )}

      <NewBotDefaultsCard />

      {pickingBackup && (
        <BulkBackupChoice
          bots={selectedFull}
          onCancel={() => setPickingBackup(false)}
          onChosen={applyBulkBackup}
        />
      )}
    </div>
  );
}
