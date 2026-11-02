// Effort and ACP variant controls (extracted from ModelPicker.tsx, #1383).
import { type ReactNode } from "react";
import { useStore, type Bot } from "@/state/store";
import type { ModelVariantOption } from "../../../shared/runtime-events";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { effortLabel } from "@/lib/effort-label";
import { isUltracodeEffort, ULTRACODE_EFFORT } from "../../../shared/ultracode-effort";
import { modelDefaultEffort, modelEffortLevels } from "../../../shared/model-capabilities";
import type { EffortLevel } from "../../../shared/wire";
import { DescribedRow, PillSelect } from "../SettingsPrimitives";
import { saveViewerChoice } from "./helpers";

/** How hard the bot thinks, for the engine it currently runs on. Rendered
 * both in the picker's popover and in the settings dialog's Model section so
 * the two cannot drift: one list of levels, one `setModel` dispatch.
 *
 * `undefined` ("Default") is not the `none` level: Default sends nothing and
 * lets the engine decide, `none` is a level the engine is told to use. Only
 * pi offers both, and dropping either would change what an existing bot
 * sends, so both stay and the tooltips say which is which. */
export function EffortRow({
  bot,
  threadId,
  updateBotDefault,
  viewerLocal = false,
  className,
  label,
  compact = false,
  pill,
}: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  /** Write this person's own effort. Do not patch the bot. */
  viewerLocal?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
  /** A Settings row (the bot editor, 2026-10-16): the label at the left,
   * the levels in a pill menu at the right. */
  pill?: { label: string; help?: ReactNode };
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (instance?.capabilities?.modelVariants) {
    return <ModelVariantRow bot={bot} threadId={threadId} updateBotDefault={updateBotDefault} viewerLocal={viewerLocal} className={className} label={label} compact={compact} />;
  }
  // Only the levels this model takes (shared/model-capabilities.ts): a model
  // with none, or an engine with none, gets no control at all.
  const option = instance?.models.options.find((candidate) => candidate.id === selection.model);
  const levels = modelEffortLevels(option, instance?.capabilities?.effortLevels);
  if (!levels.length) return null;
  const modelDefault = modelDefaultEffort(option, instance?.capabilities?.effortLevels);
  // A level stored before the model changed reads as Default, which is what runs.
  const current = selection.effort && levels.includes(selection.effort) ? selection.effort : undefined;
  const chooseEffort = (effort: EffortLevel | undefined) => {
    if (viewerLocal) {
      saveViewerChoice(dispatch, bot.id, { effort: effort ?? null });
      return;
    }
    dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}), selection: { ...selection, effort } });
  };

  if (pill) return (
    <DescribedRow label={pill.label} help={pill.help} rowId="effort">
      <PillSelect
        value={current ?? ""}
        ariaLabel={t("model.effort.aria")}
        onChange={(next) => chooseEffort(levels.find((level) => level === next))}
        options={[
          { value: "", label: modelDefault ? t("model.effort.defaultWith", { level: effortLabel(modelDefault) }) : t("model.defaultTag") },
          ...levels.map((level) => ({ value: level, label: effortLabel(level) })),
        ]}
      />
    </DescribedRow>
  );

  if (compact) return (
    <label className={cn("flex items-center justify-between gap-3", className)}>
      {label}
      <select aria-label={t("model.effort.aria")} value={current ?? ""}
        onChange={(event) => {
          const effort = levels.find((level) => level === event.target.value);
          if (viewerLocal) {
            saveViewerChoice(dispatch, bot.id, { effort: effort ?? null });
            return;
          }
          dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
            selection: { ...selection, effort } });
        }}
        className="min-w-0 max-w-[65%] rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
        <option value="">{modelDefault ? t("model.effort.defaultWith", { level: effortLabel(modelDefault) }) : t("model.defaultTag")}</option>
        {levels.map((level) => <option key={level} value={level}>{effortLabel(level)}</option>)}
      </select>
    </label>
  );

  return (
    <div className={className}>
      {label}
      {/* wraps rather than dividing a fixed width: pi offers Default plus six
          levels, which a segmented control would squeeze in the popover */}
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("model.effort.aria")}>
        {[undefined, ...levels].map((level) => (
          <button
            key={level ?? "default"}
            type="button"
            aria-pressed={current === level}
            title={
              level === undefined
                ? t("model.effort.defaultTitle")
                : isUltracodeEffort(level)
                  ? t("model.effort.ultracodeHint")
                  : t("model.effort.levelTitle", { level: effortLabel(level) })
            }
            onClick={() => {
              if (viewerLocal) {
                saveViewerChoice(dispatch, bot.id, { effort: level ?? null });
                return;
              }
              dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}), selection: { ...selection, effort: level } });
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              current === level && isUltracodeEffort(level)
                ? "ultracode-effort-chip ultracode-effort-chip-active"
                : current === level
                  ? "border-accent/60 bg-control text-ink"
                  : level === ULTRACODE_EFFORT
                    ? "ultracode-effort-option border-hairline/40 text-ink-secondary"
                    : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
            )}
          >
            {level === undefined
              ? modelDefault ? t("model.effort.defaultWith", { level: effortLabel(modelDefault) }) : t("model.defaultTag")
              : effortLabel(level)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function variantLabel(option: ModelVariantOption): string {
  return option.id === "default" ? t("model.variant.openCodeDefault") : option.label;
}

/** ACP variant ids are opaque; their model/session declares the available choices. */
export function ModelVariantRow({ bot, threadId, updateBotDefault, viewerLocal = false, className, label, compact = false }: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  viewerLocal?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!instance?.capabilities?.modelVariants) return null;
  const session = state.modelVariantSessions[threadId ?? bot.threadId];
  const reported = session?.instanceId === selection.instanceId && session.model === selection.model ? session.variants : undefined;
  const options = reported?.options ?? instance.models.options.find((option) => option.id === selection.model)?.variants ?? [];
  if (!options.length && selection.variant === undefined) return null;
  const missing = selection.variant !== undefined && !options.some((option) => option.id === selection.variant);
  const unavailable = missing && reported !== undefined;
  const current = reported?.currentValue;
  const choose = (variant?: string) => {
    if (viewerLocal) {
      saveViewerChoice(dispatch, bot.id, { variant: variant ?? null });
      return;
    }
    const { effort: _effort, variant: _variant, ...model } = selection;
    dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
      selection: { ...model, ...(variant !== undefined ? { variant } : {}) } });
  };
  if (compact) return (
    <div className={className}>
      <label className="flex items-center justify-between gap-3">
        {label}
        <select aria-label={t("model.variant.aria")} disabled={bot.busy}
          value={selection.variant === undefined ? "unset" : missing ? "missing" : String(options.findIndex((option) => option.id === selection.variant))}
          onChange={(event) => choose(options[Number(event.target.value)]?.id)}
          className="min-w-0 max-w-[65%] rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50">
          <option value="unset">{t("model.variant.session")}</option>
          {missing && <option value="missing" disabled>{selection.variant} ({unavailable ? t("model.variant.unavailableTag") : t("model.variant.unverifiedTag")})</option>}
          {options.map((option, index) => <option key={option.id} value={String(index)}>{variantLabel(option)}</option>)}
        </select>
      </label>
      {missing && <p className="mt-1 text-[11px] text-ink-secondary">{unavailable ? t("model.variant.unavailableShort") : t("model.variant.uncheckedShort")}</p>}
    </div>
  );
  return (
    <div className={className}>
      {label}
      {(selection.variant === undefined || missing) && (
        <p className="mt-2 text-[12px] text-ink-secondary">
          {unavailable ? t("model.variant.unavailable", { variant: selection.variant! })
            : missing ? t("model.variant.unchecked", { variant: selection.variant! }) : t("model.variant.none")}
          {current !== undefined && ` ${t("model.variant.sessionNow", { variant: variantLabel(options.find((option) => option.id === current) ?? { id: current, label: current }) })}`}
        </p>
      )}
      {selection.variant !== undefined && (
        <button type="button" disabled={bot.busy} onClick={() => choose()}
          title={t("model.variant.clearTitle")}
          className="mt-2 block text-[12px] text-ink-secondary underline underline-offset-2 hover:text-ink disabled:opacity-50">
          {t("model.variant.clear")}
        </button>
      )}
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("model.variant.aria")}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={bot.busy}
              aria-pressed={selection.variant === option.id}
              title={t("model.variant.useTitle", { variant: variantLabel(option) })}
              onClick={() => choose(option.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50",
                selection.variant === option.id ? "border-accent/60 bg-control text-ink" : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
              )}
            >
              {variantLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

