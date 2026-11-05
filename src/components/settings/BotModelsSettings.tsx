// Settings > Models > Bot models (#1675, redesigned #2050 "option B"): one
// page for the person's bots' models. Works without a model turn. Own bots
// only; org allowed-engines rules still apply through the same setModel /
// ModelPicker path.
// Layout: a table like Grok Bot / Cursor model settings, one row per bot
// grouped by sidebar section: Bot / Model · effort / Backup. The Model cell
// is the two-pane model selector (ModelPicker `panes`), the same one the
// "Set model for n bots" button and Bot > Model open. "All bots" and the
// per-bot checkboxes feed that button; the backup column keeps its editor.
// "Defaults for new bots" is read-only with a Perspicax link in an
// organization (set there), editable solo. Under the table, the "n turned
// off · Active models" link opens the Advanced fold of this page.
import { Fragment, useMemo, useRef, useState, useId, type ReactNode } from "react";
import { ChevronDown, ExternalLink, TriangleAlert, X } from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { canEditBotField, viewerOwnsBot } from "@/lib/bot-capabilities";
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
import { engineOfferContext, modelSwitches, useOfferedInstances } from "@/lib/offered-instances";
import { useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { usePersonalSections } from "@/lib/personal-sections";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { useStore, type Bot } from "@/state/store";
import { fallbackWithModel } from "../../../shared/handoff-model";
import { engineOffer } from "../../../shared/offered-engines";
import { AnchoredPopover, enclosingWindowBounds, useAnchoredDismissRoot } from "../AnchoredPopover";
import { ModelPicker, turnedOffCount, type ComposerModelMenuControl } from "../ModelPicker";
import { DefaultBotSettings, newBotDefaultsSummary } from "../NewBotDialog";
import { perspicaxConsoleUrl } from "../PerspicaxOrgSettings";
import { DescribedRow, DialogFrame, DialogLayer, HelpTip, LinkRow, PILL, PRIMARY_PILL, PillSelect, SettingsGroup, TABLE_CELL_CONTROL, requestSettingsCard } from "../SettingsPrimitives";

// One grid for the column headers, the section headers and every row, so
// the checkbox, Model · effort and Backup line up down the table. Under
// 36rem of table width the row stacks: name on top, then the two controls
// side by side, each with its column name above it.
// (Class names spelled out whole: Tailwind finds them in the source.)
const ROW_GRID = "grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2.5 px-3 @min-[36rem]:grid-cols-[1.25rem_minmax(8rem,1fr)_minmax(12rem,2fr)_minmax(7rem,1fr)]";
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
  const org = usePerspicaxOrg();
  const mine = useMyEngines();
  const offerContext = engineOfferContext(state.config, org !== null, mine);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const listId = useId();
  const dismissRoot = useAnchoredDismissRoot(rootRef, panelRef);
  usePopoverDismiss(open, dismissRoot, () => setOpen(false));

  const chain = (bot.fallback ?? []).filter((entry) => {
    const offer = engineOffer(offerContext, entry.instanceId);
    return offer === "offered" || (offer === "notGiven" && mine?.find((row) => row.instanceId === entry.instanceId)?.orgNotAllowed !== true);
  });
  const available = offered.filter(
    (instance) =>
      instance.snapshot.state === "available" &&
      Boolean(instance.models.default.trim()) &&
      instance.instanceId !== bot.modelSelection.instanceId &&
      !chain.some((entry) => entry.instanceId === instance.instanceId),
  );
  const label = formatBotBackups(chain, state.instances) || t("botModels.backup.none");
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
          className="popover-surface flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-1.5 overflow-y-auto rounded-xl border-[0.5px] border-border bg-elevated p-2"
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
 * here with the current choice and the link), editable solo. */
function NewBotDefaultsCard() {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const issuer = org?.org.identity.issuer;
  const title = t("botModels.defaults.title");
  return (
    <SettingsGroup
      title={title}
      groupId="bot-models-defaults"
      accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botModels.defaults.help")}</HelpTip>}
    >
      {org ? (
        <DescribedRow
          label={newBotDefaultsSummary(state.config) || t("botModels.defaults.perspicax")}
          description={t("providers.chosenInPerspicax")}
          rowId="models.newBotDefaults"
        >
          {issuer && (
            <a href={perspicaxConsoleUrl(issuer)} target="_blank" rel="noreferrer noopener" data-perspicax-link="newBotDefaults"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-text hover:underline">
              {t("providers.change")}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </DescribedRow>
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
  const offered = useOfferedInstances();
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

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pickingBackup, setPickingBackup] = useState(false);
  const bulkMenu = useRef<ComposerModelMenuControl | null>(null);
  const bulkButton = useRef<HTMLButtonElement>(null);

  const selectedFull = useMemo(
    () => sectioned.flatMap((row) => {
      if (!selected.has(row.id)) return [];
      const full = state.bots.find((bot) => bot.id === row.id);
      return full ? [full] : [];
    }),
    [sectioned, selected, state.bots],
  );
  // The shared selector applies the pick to the first selected bot and,
  // through `alsoApplyTo`, to the others (batchModelActions). It stays
  // mounted while there is a selection so its menu can open.
  const bulkLead = selectedFull.find((bot) => !bot.busy) ?? selectedFull[0];
  const bulkIds = useMemo(() => selectedFull.map((bot) => bot.id), [selectedFull]);
  const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const anyOn = allIds.some((id) => selected.has(id));

  const applyBulkBackup = (fallback: Bot["fallback"]) => {
    for (const bot of selectedFull) {
      if (bot.busy) continue;
      if (!canEditBotField(state.config, bot, "fallback")) continue;
      // Skip a backup that matches the bot's own engine (same as the row editor).
      const next = (fallback ?? []).filter((entry) => entry.instanceId !== bot.modelSelection.instanceId);
      dispatch({ type: "updateBot", botId: bot.id, patch: { fallback: next } });
    }
    setPickingBackup(false);
    setSelected(new Set());
  };

  const turnedOff = turnedOffCount(offered, modelSwitches(state.config));
  const openActiveModels = () => requestSettingsCard("models.advanced");

  return (
    <div data-settings-card="models.bots" data-bot-models-page="" className="flex min-w-0 flex-col gap-6">
      <SettingsGroup
        title={t("botModels.title")}
        groupId="bot-models-table"
        accessory={<HelpTip label={t("settings.moreAbout", { title: t("botModels.title") })}>{t("botModels.help")}</HelpTip>}
      >
        {groups.length === 0 ? (
          <p className="px-3.5 py-3 text-[13px] text-ink-secondary" data-bot-models-empty="">{t("botModels.empty")}</p>
        ) : (
          <div
            data-bot-models-table=""
            data-bot-models-list=""
            className="@container flex min-w-0 flex-col"
          >
            {/* Column headers; the "All bots" checkbox selects every bot.
                The stacked layout names each control above it instead. */}
            <div data-bot-models-cols="" className={cn(ROW_GRID, "border-b border-hairline/40 pb-2 pt-1 text-[12px] leading-4 text-ink-secondary")}>
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
              <span data-bot-models-col="bot" className="truncate">{t("botModels.selectAll")}</span>
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
                    className={cn(ROW_GRID, "pb-1.5 pt-3.5")}
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 justify-self-center accent-[var(--color-accent)]"
                      checked={sectionOn}
                      ref={(node) => { if (node) node.indeterminate = sectionSome && !sectionOn; }}
                      aria-label={t("botModels.selectSection", { section: sectionTitle(group.section) })}
                      data-bot-models-section-select=""
                      onChange={(event) => setSelected(setSectionSelection(selected, ids, event.target.checked))}
                    />
                    {/* Same type as the Settings group headings. */}
                    <h3 className="truncate text-[13px] font-normal leading-[18px] text-ink-secondary @min-[36rem]:col-span-3">
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
                    const backups = formatBotBackups(row.fallback, state.instances);
                    const modelName = botModelEffortText(row, state.instances);
                    return (
                      <div
                        key={row.id}
                        data-bot-models-row={row.id}
                        data-bot-models-section-of={sectionKey}
                        data-bot-models-warning={warning ?? undefined}
                        className={cn(ROW_GRID, "gap-y-2 border-t border-hairline/30 py-2")}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 justify-self-center accent-[var(--color-accent)]"
                          checked={selected.has(row.id)}
                          aria-label={t("botModels.selectBot", { name: row.name })}
                          data-bot-models-select={row.id}
                          onChange={() => setSelected(toggleBotSelection(selected, row.id))}
                        />
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
                          className="col-start-2 grid min-w-0 grid-cols-2 gap-x-2 gap-y-2 @min-[36rem]:contents"
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
        {/* The models this person or the organization turned off: the
            Advanced fold of this page holds the switches. */}
        <LinkRow
          rowId="models.activeModels"
          label={turnedOff > 0 ? t("botModels.activeModels", { count: turnedOff }) : t("botModels.activeModelsNone")}
          onClick={openActiveModels}
        />
      </SettingsGroup>

      <NewBotDefaultsCard />

      {/* The bulk bar sticks to the bottom of the Settings scroll area while
          the table is in view; at the end of the table it sits under the
          last row, never over it. */}
      {selected.size > 0 && bulkLead && (
        <div data-bot-models-bulk-dock="" className="sticky bottom-0 z-10 -mt-4 bg-app pb-3 pt-2">
          <div
            data-bot-models-bulk-bar=""
            role="toolbar"
            aria-label={t("botModels.bulk.selected", { count: selected.size })}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-[0.5px] border-border bg-elevated px-3 py-2 shadow-lg shadow-black/10"
          >
            <p className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
              <span>{t("botModels.bulk.selected", { count: selected.size })}</span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                className="rounded-md px-1 text-ink-secondary underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                data-bot-models-bulk-clear=""
                onClick={() => setSelected(new Set())}
              >
                {t("botModels.bulk.clear")}
              </button>
            </p>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <button type="button" className={PILL} data-bot-models-bulk-backup="" onClick={() => setPickingBackup(true)}>
                {t("botModels.bulk.setBackup")}
              </button>
              <button
                ref={bulkButton}
                type="button"
                className={PRIMARY_PILL}
                data-bot-models-bulk-change=""
                aria-haspopup="dialog"
                onClick={() => bulkMenu.current?.toggle(null)}
              >
                {selected.size === 1 ? t("botModels.bulk.setModelForOne") : t("botModels.bulk.setModelFor", { count: selected.size })}
                <ChevronDown size={13} aria-hidden="true" className="ml-1 inline-block" />
              </button>
            </div>
          </div>
          {/* The same selector as the rows, with no chip: the button above
              opens it; the pick lands on every selected bot. */}
          <ModelPicker
            key={bulkLead.id}
            bot={bulkLead}
            headless
            panes
            alsoApplyTo={bulkIds}
            menuControl={bulkMenu}
            fallbackAnchor={() => bulkButton.current}
          />
        </div>
      )}

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
