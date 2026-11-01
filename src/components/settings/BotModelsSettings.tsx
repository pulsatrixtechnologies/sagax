// Settings > Models > Bot models (#1675): one page for the person's bots'
// models. Works without a model turn. Own bots only; org allowed-engines
// rules still apply through the same setModel / ModelPicker path.
import { Fragment, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";

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
import { useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { usePersonalSections } from "@/lib/personal-sections";
import { api, useStore, type Bot, type ModelSelection } from "@/state/store";
import type { TurnPayerMode } from "../../../shared/turn-payer";
import { payerLabel } from "../bot-settings/BotPayerSettings";
import { EffortRow, ModelPicker } from "../ModelPicker";
import { DefaultBotSettings } from "../NewBotDialog";
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
    return <span className="text-[12px] text-ink-secondary" data-bot-models-payer-empty="">—</span>;
  }
  const fallback = bot.turnPayerDefault;
  const value: TurnPayerMode | "default" = bot.turnPayer ?? "default";
  return (
    <div data-bot-models-payer={bot.id} className="min-w-0">
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
    <DialogLayer onBackdropMouseDown={busy ? undefined : onCancel}>
      <DialogFrame
        titleId="bot-models-bulk-confirm-title"
        title={t("botModels.bulk.title")}
        closeLabel={t("common.close")}
        onClose={busy ? undefined : onCancel}
        frameProps={{ "data-bot-models-bulk-confirm": "" }}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={PILL} disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
            <button type="button" className={PRIMARY_PILL} disabled={busy} data-bot-models-bulk-apply="" onClick={onConfirm}>
              {busy ? t("botModels.bulk.applying") : t("botModels.bulk.apply")}
            </button>
          </div>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          {auto ? t("botModels.bulk.autoIntro", { count: lines.length }) : t("botModels.bulk.intro", { count: lines.length })}
        </p>
        <ul className="mt-3 max-h-64 overflow-auto rounded-xl border border-hairline/40 bg-inset/40 px-3 py-2 text-[12.5px]" data-bot-models-bulk-summary="">
          {lines.map((line) => (
            <li key={line.botId} data-bot-models-bulk-line={line.botId} className="flex flex-col gap-0.5 border-b border-hairline/30 py-2 last:border-0">
              <span className="font-medium text-ink">{line.name}</span>
              <span className="text-ink-secondary">{t("botModels.bulk.change", { from: line.from, to: line.to })}</span>
            </li>
          ))}
        </ul>
      </DialogFrame>
    </DialogLayer>
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
          // One table for every section so Engine / Effort / Who pays / Backup
          // share the same column widths (table-layout: fixed + colgroup).
          <div className="overflow-x-auto px-2 pb-2 pt-1">
            <table
              data-bot-models-table=""
              className="w-full min-w-[640px] table-fixed border-collapse text-left text-[13px]"
            >
              <colgroup>
                <col data-bot-models-col="select" className="w-10" />
                <col data-bot-models-col="bot" className="w-[18%]" />
                <col data-bot-models-col="model" className="w-[28%]" />
                <col data-bot-models-col="effort" className="w-[14%]" />
                <col data-bot-models-col="payer" className="w-[16%]" />
                <col data-bot-models-col="backup" className="w-[24%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-hairline/40 bg-control/30 text-[11px] uppercase tracking-[0.06em] text-ink-secondary">
                  <th className="px-2 py-2 font-medium" scope="col">
                    <span className="sr-only">{t("botModels.col.select")}</span>
                  </th>
                  <th className="px-2 py-2 font-medium" scope="col">{t("botModels.col.bot")}</th>
                  <th className="px-2 py-2 font-medium" scope="col">{t("botModels.col.model")}</th>
                  <th className="px-2 py-2 font-medium" scope="col">{t("botModels.col.effort")}</th>
                  <th className="px-2 py-2 font-medium" scope="col">{t("botModels.col.payer")}</th>
                  <th className="px-2 py-2 font-medium" scope="col">{t("botModels.col.backup")}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const ids = group.bots.map((bot) => bot.id);
                  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
                  const someOn = ids.some((id) => selected.has(id));
                  const sectionKey = group.section || "unassigned";
                  return (
                    <Fragment key={sectionKey}>
                      <tr data-bot-models-section={sectionKey} className="border-b border-hairline/40 bg-inset/40">
                        <td className="px-2 py-2 align-middle">
                          <input
                            type="checkbox"
                            className="accent-[var(--color-accent)]"
                            checked={allOn}
                            ref={(node) => { if (node) node.indeterminate = someOn && !allOn; }}
                            aria-label={t("botModels.selectSection", { section: sectionTitle(group.section) })}
                            data-bot-models-section-select=""
                            onChange={(event) => setSelected(setSectionSelection(selected, ids, event.target.checked))}
                          />
                        </td>
                        <td colSpan={5} className="px-2 py-2 align-middle">
                          <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-secondary">
                            {sectionTitle(group.section)}
                            <span className="ml-1.5 font-normal normal-case tracking-normal">({group.bots.length})</span>
                          </h3>
                        </td>
                      </tr>
                      {group.bots.map((row) => {
                        const full = state.bots.find((bot) => bot.id === row.id);
                        if (!full) return null;
                        const mayEdit = viewerOwnsBot(state.config, full) && canEditBotField(state.config, full, "modelSelection");
                        const warning = botModelWarning(row, state.instances, { orgMode, myEngines });
                        const backups = formatBotBackups(row.fallback, state.instances);
                        const effort = row.modelSelection.effort;
                        const payer = botTurnPayer(full);
                        return (
                          <tr
                            key={row.id}
                            data-bot-models-row={row.id}
                            data-bot-models-section-of={sectionKey}
                            data-bot-models-warning={warning ?? undefined}
                            className="border-b border-hairline/30 last:border-0"
                          >
                            <td className="px-2 py-2 align-middle">
                              <input
                                type="checkbox"
                                className="accent-[var(--color-accent)]"
                                checked={selected.has(row.id)}
                                aria-label={t("botModels.selectBot", { name: row.name })}
                                data-bot-models-select={row.id}
                                onChange={() => setSelected(toggleBotSelection(selected, row.id))}
                              />
                            </td>
                            <td className="min-w-0 px-2 py-2 align-middle">
                              <div className="truncate font-medium text-ink">{row.name}</div>
                              {warning && (
                                <p className="mt-0.5 flex items-start gap-1 text-[11.5px] leading-snug text-warning" data-bot-models-warn={warning}>
                                  <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                                  <span>{warningText(warning)}</span>
                                </p>
                              )}
                            </td>
                            <td className="min-w-0 px-2 py-2 align-middle">
                              {mayEdit ? (
                                <div data-bot-models-model={row.id} className="min-w-0 max-w-full">
                                  <ModelPicker bot={full} contained />
                                </div>
                              ) : (
                                <span className="block truncate text-ink-secondary">{formatBotModelSelection(row.modelSelection, state.instances)}</span>
                              )}
                            </td>
                            <td className="min-w-0 px-2 py-2 align-middle">
                              {mayEdit ? (
                                <div data-bot-models-effort={row.id} className="min-w-0 max-w-full">
                                  <EffortRow bot={full} updateBotDefault compact
                                    label={<span className="sr-only">{t("botModels.col.effort")}</span>} />
                                </div>
                              ) : (
                                <span className="block truncate text-ink-secondary">{effort ? effortLabel(effort) : t("chat.turnRun.effortDefault")}</span>
                              )}
                            </td>
                            <td className="min-w-0 px-2 py-2 align-middle">
                              {mayEdit && canEditBotField(state.config, full, "automaticRecovery")
                                ? <BotPayerCell bot={full} disabled={Boolean(full.busy)} />
                                : <span className="block truncate text-[12px] text-ink-secondary">
                                    {payer ? payerLabel(payer) : "—"}
                                  </span>}
                            </td>
                            <td className="min-w-0 truncate px-2 py-2 align-middle text-[12px] text-ink-secondary" title={backups || undefined} data-bot-models-backup={row.id}>
                              {backups || t("botModels.backup.none")}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
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
