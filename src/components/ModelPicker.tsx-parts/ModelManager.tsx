// #2963: the model window ("Manage models"), a Settings-size window instead
// of the old popover pinned in a corner. Engines at the left (mark, state),
// their models at the right (short detail, the one in use checked, a
// favorite star, an on/off switch), Auto and the effort as segmented
// choices, a search on top. An engine that is not installed or connected is
// not listed: "Connect a provider" opens Settings > Providers.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronRight, Monitor, Search, Sparkles, Star } from "lucide-react";
import { api, useStore, type Bot, type InstanceInfo, type ModelSelection } from "@/state/store";
import { cn } from "@/lib/cn";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { canEditConfig } from "@/lib/viewer";
import { t } from "@/lib/i18n";
import { filterModelSections, type ModelMenuRow, type ModelMenuSection } from "@/lib/model-menu";
import { toggleModelFavorite } from "@/lib/model-favorites";
import { modelKey, modelOffer, type ModelSwitches } from "../../../shared/offered-models";
import { fastBaseOf, fastTwinOf, modelDefaultEffort, modelEffortLevels } from "../../../shared/model-capabilities";
import { AUTO_OPTIMIZE_VALUES, autoOptimizeOf, type AutoOptimize } from "../../../shared/model-auto-optimize";
import type { EffortLevel } from "../../../shared/wire";
import { ActivityWindow, activityChip } from "../bot-settings/ActivityWindow";
import { FIELD, Switch } from "../SettingsPrimitives";
import { EffortSegments } from "../ModelMenuSettings";
import { engineSections } from "../ModelMenu";
import { switchableModels, toggledList } from "../settings/ModelSwitchesSettings";
import { EffortRow } from "./EffortControls";

/** The engine groups the window lists: each engine's models in use, plus the
 * ones this person turned off (switch off, not pickable). What the
 * organization turned off stays out of sight. */
export function managerSections(
  sections: readonly ModelMenuSection[],
  instances: readonly InstanceInfo[],
  switches: ModelSwitches,
): ModelMenuSection[] {
  return engineSections(sections).map((section) => {
    const instance = instances.find((candidate) => candidate.instanceId === section.key);
    const seen = new Set(section.rows.map((row) => row.modelId));
    const off: ModelMenuRow[] = instance
      ? switchableModels(instance)
        .filter((model) => !seen.has(model.id) && modelOffer(switches, instance.instanceId, model.id) === "personOff")
        .map((model) => ({ key: modelKey(instance.instanceId, model.id), kind: "model", instanceId: instance.instanceId, modelId: model.id, label: model.label, current: false }))
      : [];
    return { ...section, rows: [...section.rows.filter((row) => row.kind === "model"), ...off] };
  });
}

export function ModelManager({
  bot,
  threadId,
  sections,
  favoriteKeys,
  selection,
  active,
  autoOn,
  advanced,
  effortTitle,
  onRow,
  pick,
  setEffort,
  setAutoOptimize,
  openProviders,
  onClose,
  engineMark,
  frameRef,
}: {
  bot: Bot;
  threadId?: string;
  sections: ModelMenuSection[];
  favoriteKeys: readonly string[];
  selection: ModelSelection;
  active: InstanceInfo | undefined;
  autoOn: boolean;
  /** Simple mode keeps the effort out of sight, as in the composer's menu. */
  advanced: boolean;
  effortTitle: string;
  onRow: (row: ModelMenuRow) => void;
  pick: (instance: InstanceInfo, model: string, keepOpen?: boolean) => void;
  setEffort: (effort: EffortLevel | undefined) => void;
  setAutoOptimize?: (value: AutoOptimize) => void;
  openProviders: () => void;
  onClose: () => void;
  engineMark: (sectionKey: string) => ReactNode;
  /** The picker's menu ref: its click-outside guard must see the window as inside. */
  frameRef?: React.Ref<HTMLDivElement>;
}) {
  const { state } = useStore();
  const titleId = useId();
  const [engine, setEngine] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configMine = state.config?.myDisabledModels;
  useEffect(() => { setMine(configMine ? [...configMine] : null); }, [configMine]);
  const switches = useMemo<ModelSwitches>(() => ({ org: state.config?.disabledModels ?? null, mine: mine ?? configMine ?? null }),
    [state.config?.disabledModels, mine, configMine]);
  const busy = Boolean(bot.busy);
  const org = usePerspicaxOrg();
  const mayEdit = org !== null || canEditConfig(state.config);

  const engines = managerSections(sections, state.instances, switches);
  const shown = filterModelSections(engine ? engines.filter((section) => section.key === engine) : engines, query);
  const top = (sections.find((section) => section.key === "top")?.rows ?? []).filter((row) => row.kind === "auto" || row.kind === "follow");

  const toggle = (row: ModelMenuRow, on: boolean) => {
    const next = toggledList(switches.mine ?? [], row.key, on);
    setMine(next);
    setError(null);
    api<{ mine: string[] }>("/api/me/models", { method: "PUT", body: JSON.stringify({ disabledModels: next }) })
      .then((answer) => setMine(answer.mine))
      .catch((failure: Error) => { setError(failure.message); setMine(configMine ? [...configMine] : null); });
  };
  const choose = (row: ModelMenuRow) => {
    if (busy || row.unavailable) return;
    if (row.kind !== "model") return onRow(row);
    const instance = state.instances.find((candidate) => candidate.instanceId === row.instanceId);
    // the window stays open: the check moves, the person keeps going
    if (instance && row.modelId !== undefined) pick(instance, row.modelId, true);
  };

  const activeOptions = active?.models.options ?? [];
  const activeOption = activeOptions.find((option) => option.id === selection.model);
  const fastBase = active && !autoOn ? fastBaseOf(activeOptions, selection.model) : undefined;
  const fastTwin = active && !autoOn ? fastTwinOf(activeOptions, selection.model) : undefined;
  const engineEfforts = active?.capabilities?.effortLevels;
  const efforts = active?.capabilities?.modelVariants ? [] : modelEffortLevels(activeOption, engineEfforts);
  const optimize = autoOptimizeOf(selection.autoOptimize);

  return (
    <ActivityWindow labelledBy={titleId} onClose={onClose} frameRef={frameRef} frameProps={{ "data-model-manager": "", "data-model-menu": "" }}>
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-border sm:flex" data-model-manager-engines="">
        <div className="px-4 pb-2 pt-5">
          <h2 id={titleId} className="text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink">{t("model.manager.title")}</h2>
          <p className="mt-0.5 text-[12px] leading-[17px] text-ink-secondary">{t("model.manager.subtitle")}</p>
        </div>
        <div role="radiogroup" aria-label={t("model.engines.aria")} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1">
          <EngineButton selected={engine === null} onClick={() => setEngine(null)} mark={<Sparkles size={15} aria-hidden="true" />}
            label={t("model.engines.all")} engineKey="all" />
          {engines.map((section) => (
            <EngineButton key={section.key} selected={engine === section.key} onClick={() => setEngine(section.key)}
              mark={engineMark(section.key) ?? <Monitor size={15} aria-hidden="true" />}
              label={section.label ?? section.key} note={section.note} engineKey={section.key} />
          ))}
        </div>
        <button type="button" data-model-manager-connect="" onClick={openProviders}
          className="mx-2 mb-3 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
          <span>{t("model.manager.connect")}</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-5 pb-3 pr-14 pt-4">
          <label className="relative block">
            <span className="sr-only">{t("model.search")}</span>
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-secondary" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("model.search")}
              data-model-manager-search="" className={cn(FIELD, "pl-8")} />
          </label>
          {/* the engine choice on a narrow window, where the column is hidden */}
          <div className="mt-2 flex flex-wrap gap-1 sm:hidden">
            <button type="button" className={activityChip(engine === null)} onClick={() => setEngine(null)}>{t("model.engines.all")}</button>
            {engines.map((section) => (
              <button key={section.key} type="button" className={activityChip(engine === section.key)} onClick={() => setEngine(section.key)}>
                {section.label ?? section.key}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4" data-model-manager-list="">
          {engine === null && !query && top.length > 0 && (
            <div role="group" aria-label={t("model.manager.mode")} className="mb-4 overflow-hidden rounded-xl border border-border">
              {top.map((row) => (
                <div key={row.key} className="border-b border-border last:border-b-0">
                  <ModelRowButton row={row} disabled={busy} onChoose={() => choose(row)} mark={row.kind === "auto" ? <Sparkles size={15} aria-hidden="true" /> : undefined} />
                  {row.kind === "auto" && row.current && setAutoOptimize && (
                    <div role="radiogroup" aria-label={t("model.auto.optimizeTitle")} data-model-auto-optimize=""
                      className="flex flex-wrap items-center gap-2 px-3.5 pb-2.5">
                      <span className="text-[12px] text-ink-secondary">{t("model.auto.optimizeTitle")}</span>
                      <div className="inline-flex rounded-lg bg-inset p-0.5">
                        {AUTO_OPTIMIZE_VALUES.map((value) => (
                          <button key={value} type="button" role="radio" aria-checked={optimize === value} disabled={busy}
                            data-model-auto-optimize-option={value} onClick={() => setAutoOptimize(value)}
                            className={cn("rounded-md px-2.5 py-1 text-[12.5px] transition-colors disabled:opacity-50",
                              optimize === value ? "bg-elevated text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}>
                            {t(`model.auto.optimize.${value}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {shown.length === 0 && <p className="py-6 text-center text-[13px] text-ink-secondary">{t("model.noMatch")}</p>}
          {shown.map((section) => (
            <div key={section.key} role="group" aria-label={section.label} data-model-manager-section={section.key} className="mb-4">
              <div className="flex items-center gap-2 px-1 pb-1.5 text-[12px] font-medium text-ink-secondary">
                <span className="flex size-4 items-center justify-center">{engineMark(section.key) ?? <Monitor size={14} aria-hidden="true" />}</span>
                <span className="truncate">{section.label}</span>
                {section.note && <span className="truncate font-normal text-ink-tertiary">{section.note}</span>}
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                {section.rows.map((row) => {
                  const offer = row.instanceId && row.modelId ? modelOffer(switches, row.instanceId, row.modelId) : "on";
                  const on = offer === "on";
                  const starred = favoriteKeys.includes(row.key);
                  return (
                    <div key={row.key} data-model-manager-row={row.key} data-model-off={on ? undefined : ""}
                      className="flex items-center gap-1 border-b border-border pr-3 last:border-b-0">
                      <ModelRowButton row={row} disabled={busy || !on} onChoose={() => choose(row)} />
                      <button type="button" data-model-favorite={row.key} aria-pressed={starred}
                        aria-label={t(starred ? "model.favorite.remove" : "model.favorite.add", { name: row.label })}
                        onClick={() => toggleModelFavorite(row.key)}
                        className={cn("flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                          starred ? "text-accent" : "text-ink-tertiary hover:text-ink-secondary")}>
                        <Star size={15} aria-hidden="true" fill={starred ? "currentColor" : "none"} />
                      </button>
                      {/* the model in use stays on: turning it off would leave the bot without one */}
                      {!row.current && (
                        <Switch checked={on} data-model-switch={row.key} disabled={!mayEdit}
                          aria-label={t("model.manager.toggle", { name: row.label })}
                          onClick={() => toggle(row, !on)} />
                      )}
                      {row.current && <span className="w-8 shrink-0" aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {error && <p role="alert" className="px-1 text-[12px] text-danger">{error}</p>}
        </div>

        {advanced && active && (fastBase || fastTwin || efforts.length > 0 || active.capabilities?.modelVariants) && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-5 py-3" data-model-manager-settings="">
            {active.capabilities?.modelVariants ? (
              <EffortRow bot={bot} threadId={threadId} updateBotDefault={Boolean(threadId)} compact
                label={<span className="shrink-0 text-[12.5px] text-ink-secondary">{effortTitle}</span>} />
            ) : efforts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" data-model-settings-effort="">
                <span className="text-[12.5px] text-ink-secondary">{effortTitle}</span>
                <EffortSegments tone="panel" title={effortTitle} levels={efforts} disabled={busy}
                  value={selection.effort && efforts.includes(selection.effort) ? selection.effort : undefined}
                  modelDefault={modelDefaultEffort(activeOption, engineEfforts)} onPick={setEffort} />
              </div>
            )}
            {(fastBase || fastTwin) && (
              <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
                <span>{t("model.fastTag")}</span>
                <Switch checked={Boolean(fastBase)} disabled={busy} data-model-settings-fast=""
                  onClick={() => pick(active, (fastBase ?? fastTwin)!, true)} />
              </label>
            )}
          </div>
        )}
      </section>
    </ActivityWindow>
  );
}

function EngineButton({ selected, onClick, mark, label, note, engineKey }: {
  selected: boolean;
  onClick: () => void;
  mark: ReactNode;
  label: string;
  note?: string;
  engineKey: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} data-model-manager-engine={engineKey} onClick={onClick}
      className={cn("flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
        selected ? "bg-selected text-ink" : "text-ink hover:bg-hover")}>
      <span className="flex size-5 shrink-0 items-center justify-center">{mark}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[18px]">{label}</span>
        {note && <span className="block truncate text-[11.5px] leading-4 text-ink-secondary">{note}</span>}
      </span>
    </button>
  );
}

function ModelRowButton({ row, disabled, onChoose, mark }: { row: ModelMenuRow; disabled: boolean; onChoose: () => void; mark?: ReactNode }) {
  return (
    <button type="button" disabled={disabled || Boolean(row.unavailable)} onClick={onChoose} aria-current={row.current || undefined}
      data-model-manager-pick={row.key} title={row.title}
      className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 disabled:cursor-default">
      {mark && <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary">{mark}</span>}
      <span className={cn("min-w-0 flex-1", disabled && !row.current && "opacity-60")}>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] leading-[18px] text-ink">{row.label}</span>
          {row.detail && <span className="truncate text-[12px] text-ink-secondary">{row.detail}</span>}
          {row.tags?.map((tag) => <span key={tag} className="shrink-0 rounded bg-inset px-1.5 text-[11px] text-ink-secondary">{tag}</span>)}
        </span>
        {row.subtext && <span className="block text-[12px] leading-4 text-ink-secondary">{row.subtext}</span>}
      </span>
      {row.current && <Check size={15} aria-hidden="true" className="shrink-0 text-accent" />}
    </button>
  );
}
