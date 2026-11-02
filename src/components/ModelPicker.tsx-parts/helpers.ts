// Model picker shared helpers (extracted from ModelPicker.tsx, #1383).
import { isDesktopModelId } from "@/lib/local-models";
import { t } from "@/lib/i18n";
import { effortLabel } from "@/lib/effort-label";
import { needsCli, needsSignIn, hasSavedApiKey } from "../EngineSetup";
import { saveViewerBotOverride } from "@/lib/viewer-bot-overrides";
import type { ViewerBotOverridePatch } from "../../../shared/viewer-bot-overrides";
import type { Bot, InstanceInfo, ModelSelection } from "@/state/store";
import { effortForModel } from "../../../shared/model-capabilities";

export type ModelOption = InstanceInfo["models"]["options"][number];

export function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  return instance?.models.options.find((option) => option.id === model)?.label ?? model;
}

/** Asked by the desktop mascot's balloon (FloatingBots.tsx): `detail.botId`'s composer chip opens its picker. */
export const COMPOSER_MODEL_EVENT = "omb:composer-model";

/** What the composer's + menu shows on its Model row (2026-10-18): the
 * label the chip read, its tooltip, and whether the menu is open. */
export interface ComposerModelChip {
  label: string;
  title: string;
  busy: boolean;
  ultracode: boolean;
  open: boolean;
}

/** How the + menu's Model row opens the model menu of a `headless` picker:
 * beside `anchor` (the row), and `onDone` once a pick or Edit… closes it. */
export interface ComposerModelMenuControl {
  toggle: (anchor: HTMLElement | null, onDone?: () => void) => void;
  close: () => void;
}

/**
 * What the composer's model chip reads for a bot (its model, and its effort
 * when set), for the desktop mascot's balloon, which shows the same chip.
 */
export function composerModelLabel(instances: readonly InstanceInfo[], selection: Bot["modelSelection"]): string {
  const active = instances.find((instance) => instance.instanceId === selection.instanceId);
  return [modelLabel(active, selection.model), selection.effort ? effortLabel(selection.effort) : ""].filter(Boolean).join(" ");
}

export function modelProvider(instance: InstanceInfo | undefined, model: string): string | undefined {
  return instance?.models.options.find((option) => option.id === model)?.provider;
}

export function saveViewerChoice(
  dispatch: (action: { type: "error"; message: string }) => void,
  botId: string,
  patch: ViewerBotOverridePatch,
): void {
  void saveViewerBotOverride(botId, patch).then((ok) => {
    if (!ok) dispatch({ type: "error", message: t("botPanel.viewerLocal.saveError") });
  });
}

export function engineStatus(instance: InstanceInfo): string {
  if (needsCli(instance)) return t("model.setupRequired");
  if (needsSignIn(instance)) return t("model.signInRequired");
  return instance.snapshot.version ?? t("model.ready");
}

/** Sign-in required, no access yet, or not installed: hidden in the rail unless the person asked to see them. */
export function providerRailUnready(instance: InstanceInfo, status?: { attention: boolean }): boolean {
  if (status) return status.attention;
  return needsCli(instance) || needsSignIn(instance);
}

/** A desktop bridge inject id (desk host, then ::, then the model). Organization mode shows only these in Custom. */
export function isDesktopLocalModel(id: string): boolean {
  return isDesktopModelId(id);
}

export { effortLabel };

/** Switching models must not carry an opaque variant from the previous model,
 * nor a level the new model does not take: then its own default runs
 * (shared/model-capabilities.ts; grok-4.5 has no X-High). */
export function modelSelectionForPick(selection: ModelSelection, instance: InstanceInfo, model: string): ModelSelection {
  const next: ModelSelection = { instanceId: instance.instanceId, model };
  if (instance.instanceId === selection.instanceId) {
    if (instance.capabilities?.modelVariants) {
      if (model === selection.model && selection.variant !== undefined) next.variant = selection.variant;
    } else {
      const option = instance.models.options.find((candidate) => candidate.id === model);
      const effort = effortForModel(selection.effort, option, instance.capabilities?.effortLevels);
      if (effort) next.effort = effort;
    }
  }
  return next;
}

/** The config section of a pasted provider key, for the key engines that run
 * on exactly one (server/config.ts API_KEY_FLEET and the key drivers):
 * removing it is PUT /api/config with an empty key, as Settings does. */
const KEY_SECTION: Record<string, "anthropic" | "openai" | "xai" | "openrouter" | "mistral" | "cerebras" | "groq"> = {
  claudeApi: "anthropic", openai: "openai", xaiApi: "xai", openrouter: "openrouter", mistral: "mistral", cerebras: "cerebras", groq: "groq",
};

export function removableKeySection(instance: InstanceInfo): (typeof KEY_SECTION)[string] | null {
  return hasSavedApiKey(instance) ? KEY_SECTION[instance.instanceId] ?? null : null;
}

/** The small action at the end of a provider's row in the model window:
 * Disconnect a signed-in subscription, or remove a saved key. */
export interface RailRowAction {
  kind: "signOut" | "removeKey";
  /** "Disconnect Grok", "Remove the xAI key": the tooltip and the name. */
  label: string;
  busy: boolean;
  run: () => void;
}

/** What Tab may land on inside the modal, in document order. */
export const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';


/** The window's rail entry that is not an engine: Auto. */

/** The composer's model menu: a popover above the chip, never wider than the window. */
export const MENU_WIDTH = 340;

