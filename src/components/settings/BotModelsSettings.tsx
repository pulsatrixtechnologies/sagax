// Settings > Models > Bot models (#1675): one page for the person's bots'
// models. Works without a model turn. Own bots only; org allowed-engines
// rules still apply through the same setModel / ModelPicker path.
// Layout: a dense two-line list (Grok Bot / Cursor settings density), not a
// fixed multi-column table that squeezes at the Settings pane width.
import { Fragment, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, TriangleAlert, X } from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { canEditBotField, viewerOwnsBot } from "@/lib/bot-capabilities";
import { batchModelActions } from "@/lib/batch-bot-model";
import {
  botModelWarning,
  botsWithSidebarSections,
  bulkModelChangeSummary,
  formatBotBackups,
  formatBotModelSelection,
  groupBotsBySidebarSection,
  ownBotsForModelsPage,
  setSectionSelection,
  toggleBotSelection,
  type BotModelWarningKind,
  type BotModelsRow,
} from "@/lib/bot-models-page";
import { botRuntimeSettingsPath, botTurnPayer } from "@/lib/bot-runtime-settings";
import { cn } from "@/lib/cn";
import { effortLabel } from "@/lib/effort-label";
import { t } from "@/lib/i18n";
import { engineOfferContext, useOfferedInstances } from "@/lib/offered-instances";
import { useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { usePersonalSections } from "@/lib/personal-sections";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { api, useStore, type Bot, type ModelSelection } from "@/state/store";
import { fallbackWithModel } from "../../../shared/handoff-model";
import { modelEffortLevels } from "../../../shared/model-capabilities";
import { engineOffer } from "../../../shared/offered-engines";
import type { EffortLevel } from "../../../shared/wire";
import type { TurnPayerMode } from "../../../shared/turn-payer";
import { AnchoredPopover, useAnchoredDismissRoot } from "../AnchoredPopover";
import { payerLabel } from "../bot-settings/BotPayerSettings";
import { EffortRow, ModelPicker } from "../ModelPicker";
import { DefaultBotSettings } from "../NewBotDialog";
import { ConfirmDialog } from "../ConfirmDialog";
import { DialogFrame, DialogLayer, HelpTip, PILL, PRIMARY_PILL, PillSelect, SettingsGroup } from "../SettingsPrimitives";

function warningText(kind: BotModelWarningKind): string {
  if (kind === "signedOut") return t("botModels.warning.signedOut");
  if (kind === "expired") return t("botModels.warning.expired");
  if (kind === "noAccess") return t("botModels.warning.noAccess");
  return t("botModels.warning.notResponding");
}

function sectionTitle(section: string): string {
  return section ? section : t("sidebar.section.general");
}

function BotPayerCell({ bot, disabled }: { bot: Bot; disabled: boolean }) {
  const current = botTurnPayer(bot);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!current || !bot.turnPayerDefault) {
    return <span className="text-[12px] text-ink-secondary" data-bot-models-payer={bot.id} data-bot-models-payer-empty="">—</span>;
  }
  const fallback = bot.turnPayerDefault;
  const value: TurnPayerMode | "default" = bot.turnPayer ?? "default";
  return (
    <div data-bot-models-payer={bot.id} className="min-w-0 shrink-0">
      <PillSelect<TurnPayerMode | "default">
        value={value}
        ariaLabel={t("botPayer.title")}
        disabled={disabled || saving}
        onChange={(next) => {
          setSaving(true);
          setError(null);
          void api(botRuntimeSettingsPath(bot.id), {
            method: "PATCH",
            body: JSON.stringify({ turnPayer: next === "default" ? null : next }),
          })
            .catch((cause: Error) => setError(cause.message || t("botPayer.error")))
            .finally(() => setSaving(false));
        }}
        options={[
          { value: "default", label: t("botPayer.default", { value: payerLabel(fallback) }) },
          { value: "owner", label: payerLabel("owner") },
          { value: "speaker", label: payerLabel("speaker") },
        ]}
      />
      {error && <p role="alert" className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

/** Backup value that opens a popover to add, change or remove backups. */
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
    <div ref={rootRef} data-bot-models-backup={bot.id} className="relative min-w-0 shrink-0">
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
        className="inline-flex h-7 max-w-[240px] items-center gap-1 rounded-full px-2.5 text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-hover"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      </button>
      {open && (
        <AnchoredPopover
          as="div"
          anchorRef={triggerRef}
          popoverRef={panelRef}
          align="end"
          maxHeight={320}
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

function BulkConfirmDialog({
  lines,
  selection,
  onCancel,
  onConfirm,
  busy,
}: {
  lines: ReturnType<typeof bulkModelChangeSummary>;
  selection: ModelSelection;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const auto = selection.auto === true;
  return (
    <div data-bot-models-bulk-confirm="">
    <ConfirmDialog
      open
      tone="neutral"
      title={t("botModels.bulk.title")}
      body={auto ? t("botModels.bulk.autoIntro", { count: lines.length }) : t("botModels.bulk.intro", { count: lines.length })}
      confirmLabel={busy ? t("botModels.bulk.applying") : t("botModels.bulk.apply")}
      pending={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
      extra={
        <ul
          className="max-h-64 overflow-auto rounded-xl border border-hairline/40 bg-inset/40 px-3 py-2 text-[12.5px]"
          data-bot-models-bulk-summary=""
        >
          {lines.map((line) => (
            <li key={line.botId} data-bot-models-bulk-line={line.botId} className="flex flex-col gap-0.5 border-b border-hairline/30 py-2 last:border-0">
              <span className="font-medium text-ink">{line.name}</span>
              <span className="text-ink-secondary">{t("botModels.bulk.change", { from: line.from, to: line.to })}</span>
            </li>
          ))}
        </ul>
      }
    />
    </div>
  );
}

/** Engine and model choice for bulk, without writing until confirmation. */
function BulkModelChoice({
  bots,
  onCancel,
  onChosen,
}: {
  bots: Bot[];
  onCancel: () => void;
  onChosen: (selection: ModelSelection) => void;
}) {
  const { state } = useStore();
  const sample = bots[0];
  const instances = state.instances.filter((instance) => instance.snapshot.state === "available" && instance.models.options.length > 0);
  const [instanceId, setInstanceId] = useState(sample?.modelSelection.instanceId ?? instances[0]?.instanceId ?? "");
  const active = instances.find((instance) => instance.instanceId === instanceId) ?? instances[0];
  const [model, setModel] = useState(sample?.modelSelection.model ?? active?.models.default ?? "");
  const models = active?.models.options ?? [];

  return (
    <DialogLayer onBackdropMouseDown={onCancel}>
      <DialogFrame
        titleId="bot-models-bulk-pick-title"
        title={t("botModels.bulk.pickTitle")}
        closeLabel={t("common.close")}
        onClose={onCancel}
        frameProps={{ "data-bot-models-bulk-picker": "" }}
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">
          {t("botModels.bulk.pickHelp", { count: bots.length })}
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={PILL}
            data-bot-models-bulk-pick-auto=""
            onClick={() => onChosen({ instanceId: active?.instanceId ?? sample?.modelSelection.instanceId ?? "", model: model || sample?.modelSelection.model || "", auto: true })}
          >
            {t("botModels.bulk.setAuto")}
          </button>
        </div>
        <div className="flex flex-col gap-3" data-bot-models-bulk-capture="">
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-ink-secondary">{t("botModels.bulk.engine")}</span>
            <PillSelect
              value={active?.instanceId ?? ""}
              ariaLabel={t("botModels.bulk.engine")}
              onChange={(next) => {
                setInstanceId(next);
                const instance = instances.find((candidate) => candidate.instanceId === next);
                setModel(instance?.models.default || instance?.models.options[0]?.id || "");
              }}
              options={instances.map((instance) => ({ value: instance.instanceId, label: instance.displayName }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-ink-secondary">{t("bulkEdit.field.model")}</span>
            <PillSelect
              value={model}
              ariaLabel={t("bulkEdit.field.model")}
              onChange={setModel}
              options={models.map((option) => ({ value: option.id, label: option.label || option.id }))}
            />
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              className={PRIMARY_PILL}
              data-bot-models-bulk-pick=""
              disabled={!active || !model}
              onClick={() => {
                if (!active || !model) return;
                onChosen({ instanceId: active.instanceId, model });
              }}
            >
              {t("botModels.bulk.continue")}
            </button>
          </div>
        </div>
      </DialogFrame>
    </DialogLayer>
  );
}

function BulkEffortChoice({
  bots,
  onCancel,
  onChosen,
}: {
  bots: Bot[];
  onCancel: () => void;
  onChosen: (effort: EffortLevel | undefined) => void;
}) {
  const { state } = useStore();
  // Union of effort levels across the selected bots' current models.
  const levels = useMemo(() => {
    const set = new Set<EffortLevel>();
    for (const bot of bots) {
      const instance = state.instances.find((candidate) => candidate.instanceId === bot.modelSelection.instanceId);
      const option = instance?.models.options.find((candidate) => candidate.id === bot.modelSelection.model);
      for (const level of modelEffortLevels(option, instance?.capabilities?.effortLevels)) set.add(level);
    }
    return [...set];
  }, [bots, state.instances]);

  return (
    <DialogLayer onBackdropMouseDown={onCancel}>
      <DialogFrame
        titleId="bot-models-bulk-effort-title"
        title={t("botModels.bulk.effortTitle")}
        closeLabel={t("common.close")}
        onClose={onCancel}
        frameProps={{ "data-bot-models-bulk-effort-picker": "" }}
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">
          {t("botModels.bulk.effortHelp", { count: bots.length })}
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("botModels.col.effort")}>
          <button type="button" className={PILL} data-bot-models-bulk-effort-default="" onClick={() => onChosen(undefined)}>
            {t("model.defaultTag")}
          </button>
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              className={PILL}
              data-bot-models-bulk-effort-level={level}
              onClick={() => onChosen(level)}
            >
              {effortLabel(level)}
            </button>
          ))}
        </div>
      </DialogFrame>
    </DialogLayer>
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

export function BotModelsSettings() {
  const { state, dispatch } = useStore();
  const org = usePerspicaxOrg();
  const myEngines = useMyEngines();
  const personal = usePersonalSections();
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

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickingEffort, setPickingEffort] = useState(false);
  const [pickingBackup, setPickingBackup] = useState(false);
  const [draft, setDraft] = useState<ModelSelection | null>(null);

  const selectedBots = useMemo(
    () => sectioned.filter((bot) => selected.has(bot.id)),
    [sectioned, selected],
  );
  const selectedFull = useMemo(
    () => selectedBots.flatMap((row) => {
      const full = state.bots.find((bot) => bot.id === row.id);
      return full ? [full] : [];
    }),
    [selectedBots, state.bots],
  );

  const confirmLines = draft
    ? bulkModelChangeSummary(selectedBots, draft, state.instances)
    : [];

  const applyBulk = () => {
    if (!draft || selectedFull.length === 0) return;
    setBulkBusy(true);
    const actions = batchModelActions(
      selectedFull.map((bot) => ({ id: bot.id, threadId: bot.threadId, busy: bot.busy })),
      draft,
    );
    for (const action of actions) dispatch(action);
    setBulkBusy(false);
    setDraft(null);
    setPicking(false);
    setSelected(new Set());
  };

  const applyBulkEffort = (effort: EffortLevel | undefined) => {
    setBulkBusy(true);
    for (const bot of selectedFull) {
      if (bot.busy || !bot.threadId) continue;
      dispatch({
        type: "setModel",
        botId: bot.id,
        threadId: bot.threadId,
        updateBotDefault: true,
        selection: { ...bot.modelSelection, effort },
      });
    }
    setBulkBusy(false);
    setPickingEffort(false);
    setSelected(new Set());
  };

  const applyBulkBackup = (fallback: Bot["fallback"]) => {
    setBulkBusy(true);
    for (const bot of selectedFull) {
      if (bot.busy) continue;
      if (!canEditBotField(state.config, bot, "fallback")) continue;
      // Skip a backup that matches the bot's own engine (same as the row editor).
      const next = (fallback ?? []).filter((entry) => entry.instanceId !== bot.modelSelection.instanceId);
      dispatch({ type: "updateBot", botId: bot.id, patch: { fallback: next } });
    }
    setBulkBusy(false);
    setPickingBackup(false);
    setSelected(new Set());
  };

  // Defaults for new bots are an installation setting (solo / operator). An
  // organization member still gets the table of their own bots below.
  const showDefaults = !state.config?.viewer || state.config.viewer.operator !== false;

  return (
    <div data-settings-card="models.bots" data-bot-models-page="" className="flex min-w-0 flex-col gap-6">
      {showDefaults && (
        <SettingsGroup
          title={t("botModels.defaults.title")}
          groupId="bot-models-defaults"
          accessory={<HelpTip label={t("settings.moreAbout", { title: t("botModels.defaults.title") })}>{t("botModels.defaults.help")}</HelpTip>}
        >
          <DefaultBotSettings />
        </SettingsGroup>
      )}

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
            className="flex min-w-0 flex-col px-1 pb-1 pt-0.5"
          >
            {/* Visually hidden column legend for screen readers / tests. */}
            <div className="sr-only" data-bot-models-cols="">
              <span data-bot-models-col="select">{t("botModels.col.select")}</span>
              <span data-bot-models-col="bot">{t("botModels.col.bot")}</span>
              <span data-bot-models-col="model">{t("botModels.col.model")}</span>
              <span data-bot-models-col="effort">{t("botModels.col.effort")}</span>
              <span data-bot-models-col="payer">{t("botModels.col.payer")}</span>
              <span data-bot-models-col="backup">{t("botModels.col.backup")}</span>
            </div>
            {groups.map((group) => {
              const ids = group.bots.map((bot) => bot.id);
              const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
              const someOn = ids.some((id) => selected.has(id));
              const sectionKey = group.section || "unassigned";
              return (
                <Fragment key={sectionKey}>
                  <div
                    data-bot-models-section={sectionKey}
                    className="sticky top-0 z-[1] flex items-center gap-2 border-b border-hairline/40 bg-inset/80 px-2.5 py-2 backdrop-blur"
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--color-accent)]"
                      checked={allOn}
                      ref={(node) => { if (node) node.indeterminate = someOn && !allOn; }}
                      aria-label={t("botModels.selectSection", { section: sectionTitle(group.section) })}
                      data-bot-models-section-select=""
                      onChange={(event) => setSelected(setSectionSelection(selected, ids, event.target.checked))}
                    />
                    <h3 className="text-[12px] font-medium text-ink-secondary">
                      {sectionTitle(group.section)}
                      <span className="ml-1.5 font-normal">({group.bots.length})</span>
                    </h3>
                  </div>
                  {group.bots.map((row) => {
                    const full = state.bots.find((bot) => bot.id === row.id);
                    if (!full) return null;
                    const mayEdit = viewerOwnsBot(state.config, full) && canEditBotField(state.config, full, "modelSelection");
                    const mayBackup = mayEdit && canEditBotField(state.config, full, "fallback");
                    const mayPayer = mayEdit && canEditBotField(state.config, full, "automaticRecovery");
                    const warning = botModelWarning(row, state.instances, { orgMode, myEngines });
                    const backups = formatBotBackups(row.fallback, state.instances);
                    const effort = row.modelSelection.effort;
                    const payer = botTurnPayer(full);
                    return (
                      <div
                        key={row.id}
                        data-bot-models-row={row.id}
                        data-bot-models-section-of={sectionKey}
                        data-bot-models-warning={warning ?? undefined}
                        className="flex min-w-0 flex-col gap-2 border-b border-hairline/30 px-2.5 py-3 last:border-0"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1.5 accent-[var(--color-accent)]"
                            checked={selected.has(row.id)}
                            aria-label={t("botModels.selectBot", { name: row.name })}
                            data-bot-models-select={row.id}
                            onChange={() => setSelected(toggleBotSelection(selected, row.id))}
                          />
                          <BotAvatar bot={full} size={28} animated={false} label="" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-ink" title={row.name}>{row.name}</div>
                            {warning && (
                              <p className="mt-0.5 flex items-start gap-1 text-[11.5px] leading-snug text-warning" data-bot-models-warn={warning}>
                                <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                                <span>{warningText(warning)}</span>
                              </p>
                            )}
                          </div>
                        </div>
                        <div
                          data-bot-models-controls={row.id}
                          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 pl-[2.125rem]"
                        >
                          <div data-bot-models-model={row.id} className="min-w-0 max-w-full grow basis-[12rem]">
                            {mayEdit ? (
                              <ModelPicker bot={full} listChip />
                            ) : (
                              <span className="block truncate text-[13px] text-ink-secondary" title={formatBotModelSelection(row.modelSelection, state.instances)}>
                                {formatBotModelSelection(row.modelSelection, state.instances)}
                              </span>
                            )}
                          </div>
                          <div data-bot-models-effort={row.id} className="min-w-0 shrink-0">
                            {mayEdit ? (
                              <EffortRow bot={full} updateBotDefault menu />
                            ) : (
                              <span className="block truncate text-[12px] text-ink-secondary" title={effort ? effortLabel(effort) : t("chat.turnRun.effortDefault")}>
                                {effort ? effortLabel(effort) : t("chat.turnRun.effortDefault")}
                              </span>
                            )}
                          </div>
                          {mayPayer ? (
                            <BotPayerCell bot={full} disabled={Boolean(full.busy)} />
                          ) : (
                            <span
                              data-bot-models-payer={row.id}
                              className="block max-w-[240px] truncate text-[12px] text-ink-secondary"
                              title={payer ? payerLabel(payer) : undefined}
                            >
                              {payer ? payerLabel(payer) : "—"}
                            </span>
                          )}
                          {mayBackup ? (
                            <BotBackupCell bot={full} disabled={Boolean(full.busy)} />
                          ) : (
                            <span
                              data-bot-models-backup={row.id}
                              className="block max-w-[240px] truncate text-[12px] text-ink-secondary"
                              title={backups || undefined}
                            >
                              {backups || t("botModels.backup.none")}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        )}

        {selected.size > 0 && (
          <div
            data-bot-models-bulk-bar=""
            className={cn(
              "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-hairline/40 bg-app/95 px-3.5 py-2.5 backdrop-blur",
            )}
          >
            <p className="text-[12.5px] text-ink-secondary">{t("botModels.bulk.selected", { count: selected.size })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={PILL} data-bot-models-bulk-clear="" onClick={() => setSelected(new Set())}>
                {t("botModels.bulk.clear")}
              </button>
              <button
                type="button"
                className={PILL}
                data-bot-models-bulk-auto=""
                onClick={() => {
                  const sample = selectedFull[0]?.modelSelection;
                  if (!sample) return;
                  setDraft({ ...sample, auto: true });
                }}
              >
                {t("botModels.bulk.setAuto")}
              </button>
              <button type="button" className={PILL} data-bot-models-bulk-effort="" onClick={() => setPickingEffort(true)}>
                {t("botModels.bulk.setEffort")}
              </button>
              <button type="button" className={PILL} data-bot-models-bulk-backup="" onClick={() => setPickingBackup(true)}>
                {t("botModels.bulk.setBackup")}
              </button>
              <button type="button" className={PRIMARY_PILL} data-bot-models-bulk-change="" onClick={() => setPicking(true)}>
                {t("botModels.bulk.changeModel")}
              </button>
            </div>
          </div>
        )}
      </SettingsGroup>

      {picking && !draft && (
        <BulkModelChoice
          bots={selectedFull}
          onCancel={() => setPicking(false)}
          onChosen={(selection) => {
            setPicking(false);
            setDraft(selection);
          }}
        />
      )}
      {pickingEffort && (
        <BulkEffortChoice
          bots={selectedFull}
          onCancel={() => setPickingEffort(false)}
          onChosen={applyBulkEffort}
        />
      )}
      {pickingBackup && (
        <BulkBackupChoice
          bots={selectedFull}
          onCancel={() => setPickingBackup(false)}
          onChosen={applyBulkBackup}
        />
      )}
      {draft && (
        <BulkConfirmDialog
          lines={confirmLines}
          selection={draft}
          busy={bulkBusy}
          onCancel={() => setDraft(null)}
          onConfirm={applyBulk}
        />
      )}
    </div>
  );
}
