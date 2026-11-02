// Model picker: active models in one flat list, grouped by provider. A choice
// applies to every thread of the bot. Connection controls live in Providers;
// the window previews the payer, Auto chain and configured recovery choices.
// Model and effort travel through the same action in the window and composer.
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore, type Bot, type ModelSelection } from "@/state/store";
import { isDesktopModelId, localModelRows, localRowUnavailable } from "@/lib/local-models";
import { engineOffer } from "../../shared/offered-engines";
import { engineOfferContext, modelSwitches } from "@/lib/offered-instances";
import { configuredModelInstances, isClaudeAccount } from "@/lib/engine-rail";
import { needsCli } from "./EngineSetup";
import type { ModelMenuRow } from "./ModelMenu";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { useAdvancedMode } from "@/lib/interface-mode";
import { t } from "@/lib/i18n";
import { useMyEngineModels, useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { orgRefusesEngine } from "./OrgHostToolsNote";
import { useAutoModelStatus } from "@/lib/auto-model-preview";
import { ModelNoEngineNotice } from "./ModelNoEngineNotice";
import { effortLabel } from "@/lib/effort-label";
import { isUltracodeEffort } from "../../shared/ultracode-effort";
import { batchModelActions } from "@/lib/batch-bot-model";
import { useModelFavorites } from "@/lib/model-favorites";
import { modelOn } from "../../shared/offered-models";
import type { EffortLevel } from "../../shared/wire";

import {
  COMPOSER_MODEL_EVENT,
  MENU_WIDTH,
  composerModelLabel,
  engineStatus,
  isDesktopLocalModel,
  modelLabel,
  modelSelectionForPick,
  providerRailUnready,
  removableKeySection,
  saveViewerChoice,
  type ComposerModelChip,
  type ComposerModelMenuControl,
  type RailRowAction,
} from "./ModelPicker.tsx-parts/helpers";
import { EffortRow, ModelVariantRow, variantLabel } from "./ModelPicker.tsx-parts/EffortControls";
import { ClaudeAccountSelect, ModelEngineRail } from "./ModelPicker.tsx-parts/ModelEngineRail";
import { buildModelPickerSections } from "./ModelPicker.tsx-parts/buildSections";
import { ModelPickerTrigger } from "./ModelPicker.tsx-parts/ModelPickerTrigger";
import { ModelPickerWindow } from "./ModelPicker.tsx-parts/ModelPickerWindow";
import { ModelPickerMenu } from "./ModelPicker.tsx-parts/ModelPickerMenu";
import { useModelPickerEffects } from "./ModelPicker.tsx-parts/useModelPickerEffects";
import { modelPickerComposerLabel, modelPickerEffectLine, modelPickerFollowLine, modelPickerSummary } from "./ModelPicker.tsx-parts/labels";

export {
  COMPOSER_MODEL_EVENT,
  composerModelLabel,
  engineStatus,
  providerRailUnready,
  isDesktopLocalModel,
  EffortRow,
  ModelVariantRow,
  modelSelectionForPick,
  removableKeySection,
  ModelEngineRail,
  ClaudeAccountSelect,
};
export type { ComposerModelChip, ComposerModelMenuControl, RailRowAction };
export { effortLabel };

function variantLabelForSelection(
  active: import("@/state/store").InstanceInfo | undefined,
  selection: ModelSelection,
): string | undefined {
  if (selection.variant === undefined) return undefined;
  return variantLabel(
    active?.models.options.find((option) => option.id === selection.model)?.variants?.find((option) => option.id === selection.variant)
      ?? { id: selection.variant, label: selection.variant },
  );
}

export function ModelPicker({
  bot,
  threadId,
  className,
  contained = false,
  inComposer = false,
  viewerLocal = false,
  label,
  windowOnly = false,
  onWindowClose,
  headless = false,
  menuControl,
  onChip,
  fallbackAnchor,
  /** Other selected bots that receive the same model and effort. */
  alsoApplyTo,
}: {
  bot: Bot;
  threadId?: string;
  className?: string;
  /** Profile row: the label sits above the pill, which opens the model
   * window. The profile card already has Effort, so the window does not
   * repeat it. */
  contained?: boolean;
  /** Sit in the composer as a text row that opens the model menu. */
  inComposer?: boolean;
  /** Settings of a shared bot: save this person's model, not the owner's. */
  viewerLocal?: boolean;
  label?: ReactNode;
  /** No chip: the model window, open from the start (the sidebar's bot
   * menu opens it through ModelWindowHost). */
  windowOnly?: boolean;
  onWindowClose?: () => void;
  /** With `inComposer`: no chip. The composer's + menu has a Model row
   * that opens this menu through `menuControl` (2026-10-18). */
  headless?: boolean;
  menuControl?: { current: ComposerModelMenuControl | null };
  /** The chip's label and state, for the + menu's Model row (null once unmounted). */
  onChip?: (chip: ComposerModelChip | null) => void;
  /** Headless: what the menu opens above when no row asked (the mascot). */
  fallbackAnchor?: () => HTMLElement | null;
  alsoApplyTo?: readonly string[];
}) {
  const { state, dispatch, refreshInstances, refreshModels: refreshInstanceModels } = useStore();
  const applyToOthers = (next: ModelSelection) => {
    if (!alsoApplyTo?.length) return;
    const others = alsoApplyTo.flatMap((id) => {
      if (id === bot.id) return [];
      const candidate = state.bots.find((item) => item.id === id);
      return candidate ? [{ id: candidate.id, threadId: candidate.threadId, busy: candidate.busy }] : [];
    });
    for (const action of batchModelActions(others, next)) dispatch(action);
  };
  const [open, setOpen] = useState(windowOnly);
  const [menu, setMenu] = useState(false);
  const motion = useMenuMotion(open && !bot.busy);
  const menuMotion = useMenuMotion(menu && !bot.busy);
  const [menuAt, setMenuAt] = useState<{ left?: number; right?: number; bottom: number } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [menuDoneCall, setMenuDoneCall] = useState<{ call: () => void } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const org = usePerspicaxOrg();
  const advanced = useAdvancedMode();
  const favoriteKeys = useModelFavorites();
  const myEngines = useMyEngines();
  const orgMode = org !== null;
  const health = { orgMode, myEngines };
  const anyOpen = open || menu;
  const accountModels = useMyEngineModels(myEngines, anyOpen);

  const selection = bot.modelSelection;
  const autoOn = selection.auto === true && !viewerLocal;
  const autoTask = state.bots?.find((candidate) => candidate.id === bot.id)?.tasks
    ?.find((task) => task.threadId === (threadId ?? bot.threadId));
  const autoStatus = useAutoModelStatus(bot.id, threadId, autoOn || anyOpen, JSON.stringify([selection, state.config?.disabledModels, state.config?.myDisabledModels, state.instances]));
  const autoPreview = autoStatus?.auto ? autoStatus.pick : null;
  const autoRecord = autoOn ? autoTask?.autoModel ?? autoPreview : null;
  const active = state.instances.find((instance) => instance.instanceId === selection.instanceId);
  const autoInstance = autoRecord ? state.instances.find((instance) => instance.instanceId === autoRecord.instanceId) ?? active : active;
  const configured = configuredModelInstances(state.instances, selection.instanceId);
  const offerContext = engineOfferContext(state.config, orgMode, myEngines);
  const switches = modelSwitches(state.config);
  const notAllowed = (instance: typeof state.instances[number]) => engineOffer(offerContext, instance.instanceId) === "notAllowed";
  const notGiven = (instance: typeof state.instances[number]) => engineOffer(offerContext, instance.instanceId) === "notGiven";
  const pickerInstances = offerContext.organization
    ? configured.filter((instance) => !notAllowed(instance) &&
      (instance.instanceId === selection.instanceId || (!orgRefusesEngine(instance) && !notGiven(instance))))
    : configured;
  const selectable = pickerInstances.filter((instance) => !notAllowed(instance));
  const selectedVariantLabel = variantLabelForSelection(active, selection);
  const multipleClaudeAccounts = state.instances.filter(isClaudeAccount).length > 1;
  const showActiveAccount = (multipleClaudeAccounts && isClaudeAccount(active)) || Boolean(active?.snapshot.chatgptPlan);
  const railInstance = active;
  const displayedInstanceId = active?.instanceId;
  const closeWindow = () => {
    setOpen(false);
    if (windowOnly) onWindowClose?.();
  };
  const closeMenu = (refocus = false) => {
    setMenu(false);
    if (refocus) (anchorRef.current?.isConnected ? anchorRef.current : triggerRef.current ?? (headless ? fallbackAnchor?.() : null))?.focus();
  };
  const menuDone = () => {
    setMenuDoneCall(null);
    menuDoneCall?.call();
  };

  const railDriverKind = railInstance?.driverKind;
  const railNeedsSetup = Boolean(railInstance && (needsCli(railInstance) || railInstance.policy));

  const openProviders = () => {
    closeAll();
    dispatch({ type: "toggleAppSettings", open: true, section: "providers" });
  };

  const profile = state.bots.find((candidate) => candidate.id === bot.id) ?? bot;
  const follows = threadId ? profile.tasks?.find((task) => task.threadId === threadId)?.followsBotModel : undefined;
  const botModelInstance = state.instances.find((instance) => instance.instanceId === profile.modelSelection.instanceId);
  const botModelName = botModelInstance
    ? `${botModelInstance.displayName} · ${modelLabel(botModelInstance, profile.modelSelection.model)}`
    : profile.modelSelection.model;

  const fallback = state.modelFallbacks?.[threadId ?? bot.threadId];
  const fallbackNow = fallback && fallback.instanceId === selection.instanceId && fallback.requested === selection.model ? fallback : undefined;
  const ranOnName = (ran: { instanceId: string; actual: string; actualInstanceId?: string }): string => {
    const engine = state.instances.find((candidate) => candidate.instanceId === (ran.actualInstanceId ?? ran.instanceId));
    const labelText = engine?.models.options.find((o) => o.id === ran.actual)?.label ?? ran.actual;
    return ran.actualInstanceId && engine ? `${engine.displayName} · ${labelText}` : labelText;
  };
  const fallbackLine = fallbackNow
    ? `\n${t("model.ranOn", { model: ranOnName(fallbackNow) })}`
    : "";

  const closeAll = () => {
    setMenu(false);
    closeWindow();
    menuDone();
  };

  const pickBotModel = () => {
    if (bot.busy) return;
    closeAll();
    if (follows !== false) return;
    dispatch({ type: "setModel", botId: bot.id, threadId: threadId ?? bot.threadId, updateBotDefault: true, selection: profile.modelSelection });
  };

  const pick = (instance: typeof state.instances[number], model: string, keepOpen = false) => {
    if ((bot.busy && !alsoApplyTo?.length) || instance.policy || notAllowed(instance)) return;
    const localRow = instance.models.options.find((option) => option.id === model && (option.local || isDesktopModelId(option.id)));
    if (localRow && localRowUnavailable(instance.driverKind, model, localRow.anthropic)) return;
    if (viewerLocal && !alsoApplyTo?.length) {
      saveViewerChoice(dispatch, bot.id, { model: { instanceId: instance.instanceId, model } });
      closeAll();
      return;
    }
    const next = modelSelectionForPick(selection, instance, model);
    if (!bot.busy && !viewerLocal) {
      dispatch({
        type: "setModel",
        botId: bot.id,
        threadId: threadId ?? bot.threadId,
        updateBotDefault: true,
        selection: next,
      });
    }
    applyToOthers(next);
    if (!keepOpen) closeAll();
  };

  const setEffort = (effort: EffortLevel | undefined) => {
    if (bot.busy && !alsoApplyTo?.length) return;
    if (viewerLocal && !alsoApplyTo?.length) {
      saveViewerChoice(dispatch, bot.id, { effort: effort ?? null });
      return;
    }
    const { variant: _variant, ...rest } = selection;
    const next = { ...rest, ...(effort ? { effort } : { effort: undefined }) };
    if (!viewerLocal) {
      dispatch({ type: "setModel", botId: bot.id, threadId, ...(threadId ? { updateBotDefault: true } : {}), selection: next });
    }
    applyToOthers(next);
  };

  const chooseAuto = () => {
    if ((bot.busy && !alsoApplyTo?.length) || (viewerLocal && !alsoApplyTo?.length)) return;
    closeAll();
    if (autoOn && !alsoApplyTo?.length) return;
    const next = { ...selection, auto: true as const };
    if (!bot.busy && !viewerLocal && !autoOn) {
      dispatch({
        type: "setModel",
        botId: bot.id,
        threadId: threadId ?? bot.threadId,
        updateBotDefault: true,
        selection: next,
      });
    }
    applyToOthers(next);
  };

  const fastKey = (instanceId: string, model: string) => `${instanceId}\u0000${model}`;
  const fastChoices = autoOn
    ? selectable.flatMap((instance) => localModelRows(instance.models.options, orgMode)
      .filter((option) => modelOn(switches, instance.instanceId, option.id) && !localRowUnavailable(instance.driverKind, option.id, option.anthropic))
      .map((option) => ({ key: fastKey(instance.instanceId, option.id), label: `${instance.displayName} · ${option.label || option.id}` })))
    : [];
  const chooseFast = (key: string) => {
    if (bot.busy || viewerLocal) return;
    const [instanceId, model] = key.split("\u0000");
    const { fast: _fast, ...rest } = selection;
    const next = instanceId && model ? { ...rest, fast: { instanceId, model } } : rest;
    dispatch({ type: "setModel", botId: bot.id, threadId: threadId ?? bot.threadId, updateBotDefault: true, selection: next });
  };

  const { flatSections, menuSections } = buildModelPickerSections({
    orgMode,
    accountModels,
    selection,
    switches,
    autoOn,
    follows,
    selectedVariantLabel,
    fallback,
    instances: state.instances,
    selectable,
    viewerLocal,
    autoPreview,
    autoRecord,
    profile,
    botModelInstance,
    botModelName,
    health,
    myEngines,
    ranOnName,
  });
  const [previewRow, setPreviewRow] = useState<ModelMenuRow | null>(null);
  const effectInstance = state.instances.find((instance) => instance.instanceId === previewRow?.instanceId) ?? active;
  const effectName = previewRow?.kind === "model" ? previewRow.label : modelLabel(active, selection.model);
  const effectAuto = previewRow?.kind === "auto" || (!previewRow && autoOn);
  const effectLine = modelPickerEffectLine({
    effectAuto, orgMode,
    personalSettings: state.config?.personalSettings,
    allowedEngines: state.config?.allowedEngines,
    effectName,
    provider: effectInstance?.displayName ?? selection.instanceId,
  });

  const onRow = (row: ModelMenuRow) => {
    if (row.kind === "auto") return chooseAuto();
    if (row.kind === "follow") return pickBotModel();
    const instance = state.instances.find((candidate) => candidate.instanceId === row.instanceId);
    if (instance && row.modelId !== undefined) pick(instance, row.modelId);
  };

  const summary = modelPickerSummary({ autoOn, autoRecord, active, selection, selectedVariantLabel, advanced });
  const followLine = modelPickerFollowLine({ follows, profileName: profile.name, fallbackLine });
  const composerLabel = modelPickerComposerLabel({ autoOn, autoRecord, active, selection, selectedVariantLabel });

  const openWindow = () => {
    if (bot.busy) return;
    setMenu(false);
    setOpen(true);
    menuDone();
  };
  const toggleWindow = () => (open ? closeWindow() : openWindow());

  const toggleMenu = (anchor: HTMLElement | null = null, onDone?: () => void) => {
    if (bot.busy) return;
    if (menu) {
      setMenu(false);
      return;
    }
    anchorRef.current = anchor;
    setMenuDoneCall(onDone ? { call: onDone } : null);
    const box = anchor ? (anchor.closest<HTMLElement>('[role="menu"]') ?? anchor) : null;
    const rect = (anchor ?? (headless ? fallbackAnchor?.() : triggerRef.current))?.getBoundingClientRect();
    if (rect && typeof window.innerWidth === "number") {
      if (anchor && box) {
        const left = Math.max(8, Math.min(box.getBoundingClientRect().right + 6, window.innerWidth - MENU_WIDTH - 8));
        setMenuAt({ left, bottom: Math.max(8, window.innerHeight - rect.bottom - 6) });
      } else if (headless) {
        setMenuAt({ left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)), bottom: window.innerHeight - rect.top + 6 });
      } else {
        const right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - MENU_WIDTH - 8));
        setMenuAt({ right, bottom: window.innerHeight - rect.top + 6 });
      }
    } else setMenuAt(null);
    setMenu(true);
  };
  if (menuControl) menuControl.current = { toggle: (anchor, onDone) => toggleMenu(anchor, onDone), close: () => setMenu(false) };

  const composerTitle = bot.busy ? `${composerLabel}${followLine}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : `${composerLabel}${followLine}`;
  const ultracodeChip = isUltracodeEffort(selection.effort);
  const menuShownOpen = menu && !bot.busy;

  useModelPickerEffects({
    anyOpen, orgMode, refreshInstances, refreshInstanceModels, displayedInstanceId,
    railDriverKind, railNeedsSetup, botBusy: Boolean(bot.busy), windowOnly, open, menu, setMenu, setOpen,
    closeWindow, closeMenu, dialogRef, menuRef, triggerRef, anchorRef, headless, fallbackAnchor,
    inComposer, botId: bot.id, toggleMenu, onChip, composerLabel, composerTitle, ultracodeChip, menuShownOpen,
  });

  const effortTitle = active?.capabilities?.modelVariants ? t("model.reasoning") : t("model.effort");

  const trigger = ModelPickerTrigger({
    windowOnly,
    inComposer,
    headless,
    contained,
    bot,
    threadId,
    triggerRef,
    menu,
    open,
    toggleMenu: () => toggleMenu(),
    toggleWindow,
    composerLabel,
    followLine,
    summary,
    selection,
    autoOn,
    autoRecord,
    autoInstance,
    active,
    showActiveAccount,
    selectedVariantLabel,
    advanced,
  });

  const portal = (node: ReactNode) => (typeof document === "undefined" ? node : createPortal(node, document.body));
  return (
    <div ref={rootRef} className={cn(contained ? "w-full" : "relative", className)}>
      {contained ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <div className="min-w-0 flex-1 basis-[200px]">{label}</div>
          <div className="ml-auto shrink-0">{trigger}</div>
          {!viewerLocal && <ModelNoEngineNotice className="w-full" />}
        </div>
      ) : (
        trigger
      )}

      {menuMotion.shown && portal(ModelPickerMenu({
        menuRef,
        menuAt,
        menuMotion,
        headless,
        closeMenu,
        menuSections,
        onRow,
        bot,
        favoriteKeys,
        viewerLocal,
        openWindow,
        advanced,
        threadId,
        selection,
        active,
        autoOn,
        setEffort,
        pick,
        effortTitle,
      }))}
      {motion.shown && portal(ModelPickerWindow({
        dialogRef,
        motion,
        closeWindow,
        openProviders,
        flatSections,
        onRow,
        setPreviewRow,
        bot,
        favoriteKeys,
        effectLine,
        autoOn,
        viewerLocal,
        fastChoices,
        selection,
        fastKey,
        chooseFast,
        autoStatus,
        previewRow,
      }))}

    </div>
  );
}
