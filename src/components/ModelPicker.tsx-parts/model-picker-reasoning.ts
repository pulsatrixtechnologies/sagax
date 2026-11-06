// Busy-menu helpers for ModelPicker (omb #4395): reasoning may change mid-turn.
import type { AppState, Bot, InstanceInfo, ModelSelection } from "@/state/store";
import { modelEffortLevels } from "../../../shared/model-capabilities";

/** ACP variant ids are opaque; their model/session declares the available choices. */
export function variantChoices(
  state: Pick<AppState, "instances" | "modelVariantSessions">,
  selection: ModelSelection,
  threadId: string | undefined,
) {
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!instance?.capabilities?.modelVariants) return null;
  const session = threadId === undefined ? undefined : state.modelVariantSessions[threadId];
  const reported = session?.instanceId === selection.instanceId && session.model === selection.model
    ? session.variants
    : undefined;
  const options = reported?.options
    ?? instance.models.options.find((option) => option.id === selection.model)?.variants
    ?? [];
  if (!options.length && selection.variant === undefined) return null;
  return { instance, reported, options };
}

/** Whether the menu can show a reasoning row (effort levels or model variants). */
export function offersReasoning(
  state: Pick<AppState, "instances" | "modelVariantSessions">,
  instance: InstanceInfo,
  next: ModelSelection,
  threadId: string | undefined,
): boolean {
  if (instance.capabilities?.modelVariants) return Boolean(variantChoices(state, next, threadId));
  const option = instance.models.options.find((candidate) => candidate.id === next.model);
  return modelEffortLevels(option, instance.capabilities?.effortLevels).length > 0;
}

/**
 * While a bot works its menu stays locked, unless it offers a reasoning row:
 * the reasoning level is the one change allowed mid-turn, and it applies from
 * the next turn. Contained pickers (settings) stay locked while busy.
 */
export function lockedWhileBusy(
  state: Pick<AppState, "instances" | "modelVariantSessions">,
  bot: Pick<Bot, "busy" | "modelSelection" | "threadId">,
  contained: boolean | undefined,
  threadId: string | undefined,
): boolean {
  if (!bot.busy) return false;
  const instance = contained
    ? undefined
    : state.instances.find((candidate) => candidate.instanceId === bot.modelSelection.instanceId);
  return !(instance && offersReasoning(state, instance, bot.modelSelection, threadId ?? bot.threadId));
}
