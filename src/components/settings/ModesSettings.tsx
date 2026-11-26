// Settings > Providers > Models > Modes (owner 2026-11-25, M-20261125-074,
// M-20261125-075, #5372): the person chooses the model (and the reasoning)
// Fast and Expert use, and Heavy's experts. Per person, never per
// organization, and without an admin: the person's own setting for every one
// of their bots (GET/PUT /api/me/models `modeModels`, shared/mode-models.ts).
// Each list offers the favorites first. One button puts the defaults back:
// what Sagax resolves by itself. Auto has no setting, one sentence says how
// it chooses. Build is not a mode of the chat bar any more.
import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { effortLabel } from "@/lib/effort-label";
import { t } from "@/lib/i18n";
import { favoriteKey, useModelFavorites } from "@/lib/model-favorites";
import { readableError } from "@/lib/plain-error";
import { engineLabel } from "@/lib/human-label";
import { api } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";
import { MODE_MAX_EXPERTS, cleanModeModels, modeModelsEmpty, type ModeModels, type SettableMode } from "../../../shared/mode-models";
import type { EffortLevel } from "../../../shared/model-selection";
import { DescribedRow, PILL, PillSelect, SettingsGroup, SettingsTextRow, type PillOption } from "../SettingsPrimitives";

/** An engine (an account) the person can run a model on, as the lists name it. */
export interface ModeEngine {
  instanceId: string;
  /** "Claude · ada@acme.example". */
  name: string;
  models: Array<{ id: string; label: string; effortLevels: readonly EffortLevel[] }>;
}

export interface ModeModelOption {
  /** favoriteKey(instanceId, model): the list's value. */
  key: string;
  instanceId: string;
  model: string;
  label: string;
  favorite: boolean;
  effortLevels: readonly EffortLevel[];
}

/** Every model the person can use, the favorites first (in star order). */
export function modeModelOptions(engines: readonly ModeEngine[], favorites: readonly string[]): ModeModelOption[] {
  const all = engines.flatMap((engine) => engine.models.map((model): ModeModelOption => {
    const key = favoriteKey(engine.instanceId, model.id);
    return { key, instanceId: engine.instanceId, model: model.id, label: `${model.label} · ${engine.name}`, favorite: favorites.includes(key), effortLevels: model.effortLevels };
  }));
  const starred = favorites.map((key) => all.find((option) => option.key === key)).filter((option): option is ModeModelOption => Boolean(option));
  return [...starred, ...all.filter((option) => !option.favorite)];
}

const DEFAULT = "";
const OWN_LEVEL = "";

export interface ModesSettingsViewProps {
  value: ModeModels;
  engines: readonly ModeEngine[];
  favorites: readonly string[];
  /** The whole setting, as it should be kept. */
  onChange: (next: ModeModels) => void;
  onReset: () => void;
  busy: boolean;
  error: string | null;
}

export function ModesSettingsView({ value, engines, favorites, onChange, onReset, busy, error }: ModesSettingsViewProps) {
  const options = modeModelOptions(engines, favorites);
  const pills = (list: readonly ModeModelOption[]): PillOption<string>[] => list.map((option) => ({
    value: option.key, label: option.label, group: option.favorite ? t("model.favorites") : t("model.auto.rail"),
  }));
  const without = (mode: keyof ModeModels): ModeModels => {
    const { [mode]: _, ...rest } = value;
    return rest;
  };

  const single = (mode: SettableMode) => {
    const choice = value[mode];
    const key = choice ? favoriteKey(choice.instanceId, choice.model) : DEFAULT;
    const found = choice ? options.find((option) => option.key === key) : undefined;
    const levels = found?.effortLevels ?? [];
    return (
      <div data-mode-setting={mode}>
        <DescribedRow label={t(`model.mode.${mode}.name`)} description={t(`model.mode.${mode}.blurb`)} rowId={`modes.${mode}`}
          below={choice && !found ? <p data-mode-unavailable="" className="text-[12px] leading-4 text-ink-secondary">{t("settings.modes.unavailable")}</p> : undefined}>
          <span data-mode-model="" className="flex min-w-0">
            <PillSelect
              value={key}
              ariaLabel={t("settings.modes.modelFor", { mode: t(`model.mode.${mode}.name`) })}
              disabled={busy}
              searchAbove={12}
              options={[
                { value: DEFAULT, label: t("settings.modes.default") },
                // a choice that is not offered now stays in the list under its own name
                ...(choice && !found ? [{ value: key, label: choice.model }] : []),
                ...pills(options),
              ]}
              onChange={(next) => {
                if (next === DEFAULT) return onChange(without(mode));
                const picked = options.find((option) => option.key === next);
                if (picked) onChange({ ...value, [mode]: { instanceId: picked.instanceId, model: picked.model } });
              }}
            />
          </span>
          {choice && levels.length > 0 && (
            <span data-mode-effort="" className="flex min-w-0">
              <PillSelect
                value={choice.effort && levels.includes(choice.effort) ? choice.effort : OWN_LEVEL}
                ariaLabel={t("settings.modes.reasoningFor", { mode: t(`model.mode.${mode}.name`) })}
                disabled={busy}
                options={[{ value: OWN_LEVEL, label: t("settings.modes.ownLevel") }, ...levels.map((level) => ({ value: level as string, label: effortLabel(level) }))]}
                onChange={(next) => onChange({ ...value, [mode]: { instanceId: choice.instanceId, model: choice.model, ...(next === OWN_LEVEL ? {} : { effort: next as EffortLevel }) } })}
              />
            </span>
          )}
        </DescribedRow>
      </div>
    );
  };

  const experts = (value.heavy ?? []).slice(0, MODE_MAX_EXPERTS);
  const seated = new Set(experts.map((seat) => favoriteKey(seat.instanceId, seat.model)));
  const setExperts = (next: NonNullable<ModeModels["heavy"]>) => onChange(next.length ? { ...value, heavy: next } : without("heavy"));
  return (
    <SettingsGroup title={t("settings.modes.title")} groupId="models-modes">
      <div data-mode-setting="auto">
        <DescribedRow label={t("model.mode.auto.name")} description={t("settings.modes.auto")} rowId="modes.auto" />
      </div>
      {single("fast")}
      {single("expert")}
      <div data-mode-setting="heavy">
        <DescribedRow label={t("model.mode.heavy.name")} description={experts.length ? t("settings.modes.heavyChosen") : t("settings.modes.heavyDefault")} rowId="modes.heavy"
          below={experts.length ? (
            <ul className="flex flex-col gap-1">
              {experts.map((seat, index) => {
                const key = favoriteKey(seat.instanceId, seat.model);
                const found = options.find((option) => option.key === key);
                return (
                  <li key={key} data-mode-expert="" className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px]">
                    <span className="w-4 shrink-0 text-right tabular-nums text-ink-tertiary">{index + 1}</span>
                    <span data-mode-expert-name="" className="min-w-0 flex-1 truncate">{found?.label ?? seat.model}</span>
                    {!found && <span data-mode-unavailable="" className="shrink-0 text-[12px] leading-4 text-ink-secondary">{t("settings.modes.unavailableShort")}</span>}
                    <button type="button" data-mode-expert-remove="" disabled={busy} aria-label={t("settings.modes.removeExpert", { name: found?.label ?? seat.model })} title={t("settings.modes.removeExpert", { name: found?.label ?? seat.model })}
                      onClick={() => setExperts(experts.filter((_, at) => at !== index))}
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50">
                      <X size={13} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : undefined}>
          {experts.length < MODE_MAX_EXPERTS && (
            <span data-mode-expert-add="" className="flex min-w-0">
              <PillSelect
                value={undefined}
                placeholder={experts.length ? t("settings.modes.addExpert") : t("settings.modes.default")}
                ariaLabel={t("settings.modes.addExpert")}
                disabled={busy}
                searchAbove={12}
                options={pills(options.filter((option) => !seated.has(option.key)))}
                onChange={(next) => {
                  const picked = options.find((option) => option.key === next);
                  if (picked) setExperts([...experts, { instanceId: picked.instanceId, model: picked.model }]);
                }}
              />
            </span>
          )}
        </DescribedRow>
      </div>
      <div className="flex min-h-[44px] items-center justify-between gap-3 px-3.5 py-1.5">
        <span className="min-w-0 text-[12px] leading-4 text-ink-secondary">{t("settings.modes.resetHint")}</span>
        <button type="button" data-modes-reset="" className={PILL} disabled={busy || modeModelsEmpty(value)} onClick={onReset}>{t("settings.modes.reset")}</button>
      </div>
      {error && <SettingsTextRow tone="danger" live>{error}</SettingsTextRow>}
    </SettingsGroup>
  );
}

type Answer = { modeModels?: unknown };

/** The person's own modes, read and saved beside their model switches. */
export function ModesSettings() {
  const instances = useStoreSelector((state) => state.instances);
  const favorites = useModelFavorites();
  const [value, setValue] = useState<ModeModels | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<Answer>("/api/me/models")
      .then((answer) => { if (live) setValue(cleanModeModels(answer.modeModels)); })
      .catch(() => { if (live) setValue({}); });
    return () => { live = false; };
  }, []);
  if (value === null) return null;
  const save = (next: ModeModels | null) => {
    setBusy(true);
    setError(null);
    api<Answer>("/api/me/models", { method: "PUT", body: JSON.stringify({ modeModels: next }) })
      .then((answer) => setValue(cleanModeModels(answer.modeModels)))
      .catch((failure) => setError(readableError(failure)))
      .finally(() => setBusy(false));
  };
  // only what can run a turn now: an engine signed out or unavailable is absent
  const engines: ModeEngine[] = (instances ?? [])
    .filter((instance) => instance.snapshot.state === "available" && instance.snapshot.authenticated !== false && !instance.policy)
    .map((instance) => ({
      instanceId: instance.instanceId,
      name: [engineLabel(instance.displayName, instance.instanceId), instance.snapshot.account?.email].filter((part, index, parts) => part && parts.indexOf(part) === index).join(" · "),
      models: instance.models.options.map((option) => ({ id: option.id, label: option.label, effortLevels: option.effortLevels ?? instance.capabilities?.effortLevels ?? [] })),
    }));
  return <ModesSettingsView value={value} engines={engines} favorites={favorites} onChange={save} onReset={() => save(null)} busy={busy} error={error} />;
}
