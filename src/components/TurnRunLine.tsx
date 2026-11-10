import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Message } from "@/state/store";
import { effortLabel } from "@/lib/effort-label";

/** The words for what a turn ran on: "Claude Fable 5.2 · effort Medium". The
 * model reads as the picker names it; no recorded effort is "Default". */
export function turnRunText(
  run: NonNullable<Message["turnRun"]>,
  instances: ReadonlyArray<{ instanceId: string; displayName?: string; models: { options: ReadonlyArray<{ id: string; label?: string }> } }>,
): string {
  const option = instances.find((instance) => instance.instanceId === run.instanceId)?.models.options.find((entry) => entry.id === run.model);
  const text = t("chat.turnRun", {
    model: option?.label ?? run.model,
    effort: run.effort ? effortLabel(run.effort) : t("chat.turnRun.effortDefault"),
  });
  return run.requested ? `${text} · ${t("chat.turnRun.instead", { model: requestedName(run.requested, run.instanceId, instances) })}` : text;
}

/** The pick a turn left (#1154), with its engine when the turn ran on another one. */
function requestedName(
  requested: { instanceId: string; model: string },
  ranOn: string,
  instances: ReadonlyArray<{ instanceId: string; displayName?: string; models: { options: ReadonlyArray<{ id: string; label?: string }> } }>,
): string {
  const engine = instances.find((instance) => instance.instanceId === requested.instanceId);
  const label = engine?.models.options.find((entry) => entry.id === requested.model)?.label ?? requested.model;
  return requested.instanceId !== ranOn && engine?.displayName ? `${engine.displayName} · ${label}` : label;
}

/** A quiet line under a bot reply with the model and effort that wrote it.
 * A reply that left the pick (#1154) shows it at all times. Otherwise the
 * caller decides when it shows (a pointer resting on the reply, or
 * keyboard focus inside the message row, a `group`); this only fades. It
 * is always laid out, so showing it never pushes the reply above it
 * (2026-10-15). */
export function TurnRunLine({ run, visible }: { run: NonNullable<Message["turnRun"]>; visible: boolean }) {
  const { state } = useStore();
  // #1154: a reply that did not run on the pick always says so.
  const shown = visible || Boolean(run.requested);
  return (
    <div
      data-turn-run
      aria-hidden={!shown}
      title={run.requested ? t("chat.turnRun.insteadWhy") : undefined}
      className={cn(
        "mt-1 px-1 text-[11px] leading-4 text-ink-tertiary transition-opacity duration-200",
        shown ? "visible opacity-100" : "invisible opacity-0 group-focus-within:visible group-focus-within:opacity-100",
      )}
    >
      {turnRunText(run, state.instances)}
    </div>
  );
}
