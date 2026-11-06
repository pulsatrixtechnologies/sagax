// Model picker: active models in one menu, grouped by provider. A choice
// applies to every thread of the bot. Connection controls live in Providers
// (lot 7: the full window is gone; Auto chain and recovery live in Settings).
// Model and effort travel through the same action from the chip and composer.
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore, type Bot, type ModelSelection } from "@/state/store";
import { isDesktopModelId, localRowUnavailable } from "@/lib/local-models";
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
import { useModelFavoritesServerSync } from "@/lib/model-favorites-sync";
import { requestSettingsCard } from "./SettingsPrimitives";
import { modelOffer, type ModelSwitches } from "../../shared/offered-models";
import type { EffortLevel } from "../../shared/wire";

import {
  COMPOSER_MODEL_EVENT,
  MENU_WIDTH as BASE_MENU_WIDTH,
  PANES_MENU_WIDTH,
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
import { BusyModelMenu } from "./ModelPicker.tsx-parts/ModelPickerBusyMenu";
import { lockedWhileBusy } from "./ModelPicker.tsx-parts/model-picker-reasoning";
import { ModelPickerMenu, windowOnlyMenuPlace } from "./ModelPicker.tsx-parts/ModelPickerMenu";
import { useModelPickerEffects } from "./ModelPicker.tsx-parts/useModelPickerEffects";
import { modelPickerComposerLabel, modelPickerFollowLine, modelPickerSummary } from "./ModelPicker.tsx-parts/labels";

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

/** How many models of the given engines are off for this person or the
 * organization (shared/offered-models.ts). */
export function turnedOffCount(instances: readonly { instanceId: string; models: { options: readonly { id: string }[] } }[], switches: ModelSwitches): number {
  let count = 0;
  for (const instance of instances) {
    for (const option of instance.models.options) {
      if (modelOffer(switches, instance.instanceId, option.id) !== "on") count += 1;
    }
  }
  return count;
}

export function ModelPicker({
  bot,
  threadId,
  className,
  contained = false,
  listChip = false,
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
  panes = false,
}: {
  bot: Bot;
  threadId?: string;
  className?: string;
  /** Profile row: the label sits above the pill, which opens the model
   * menu. The profile card already has Effort, so the menu does not
   * repeat it. */
  contained?: boolean;
  /** Bot models list: full-width readable pill, no effort on the chip. */
  listChip?: boolean;
  /** Sit in the composer as a text row that opens the model menu. */
  inComposer?: boolean;
  /** Settings of a shared bot: save this person's model, not the owner's. */
  viewerLocal?: boolean;
  label?: ReactNode;
  /** No chip: the model menu, open from the start (the sidebar's bot
   * menu opens it through ModelWindowHost). Lot 7: the full window is gone. */
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
  /** Settings > Models and Bot > Model (#2050): the two-pane menu
   * (providers beside models) with the "n turned off · Active models" link. */
  panes?: boolean;
}) {
  const { state, dispatch, refreshInstances, refreshModels: refreshInstanceModels } = useStore();
  // #2050: the stars follow the person through /api/me/models
  useModelFavoritesServerSync();
  const applyToOthers = (next: ModelSelection) => {
    if (!alsoApplyTo?.length) return;
    const others = alsoApplyTo.flatMap((id) => {
      if (id === bot.id) return [];
      const candidate = state.bots.find((item) => item.id === id);
      return candidate ? [{ id: candidate.id, threadId: candidate.threadId, busy: candidate.busy }] : [];
    });
    for (const action of batchModelActions(others, next)) dispatch(action);
  };
  const [menu, setMenu] = useState(windowOnly);
  /** #2106: Auto Edit panel (Intelligence / Balance / Cost); owned here so
   * ModelPickerMenu stays hook-free for the function-call interaction harness. */
  const [autoEditOpen, setAutoEditOpen] = useState(false);
  // While the bot works the menu still opens to its reasoning level, which
  // applies from the next turn; the model stays locked.
  const locked = lockedWhileBusy(state, bot, contained, threadId);
  const menuMotion = useMenuMotion(menu && !locked);
  const [menuAt, setMenuAt] = useState<{ left?: number; right?: number; top?: number; bottom?: number } | null>(() => (
    windowOnly && typeof window !== "undefined" ? windowOnlyMenuPlace() : null
  ));
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
  const anyOpen = menu;
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
  const closeMenu = (refocus = false) => {
    setMenu(false);
    setAutoEditOpen(false);
    if (windowOnly) onWindowClose?.();
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
  // Settings > Models > Advanced > Active models, from the two-pane menu.
  const openActiveModels = () => {
    closeAll();
    requestSettingsCard("models.advanced");
    dispatch({ type: "toggleAppSettings", open: true, section: "engines" });
  };
  const turnedOff = panes ? turnedOffCount(pickerInstances, switches) : 0;

  const profile = state.bots.find((candidate) => candidate.id === bot.id) ?? bot;
  const follows = threadId ? profile.tasks?.find((task) => task.threadId === threadId)?.followsBotModel : undefined;
  const botModelInstance = state.instances.find((instance) => instance.instanceId === profile.modelSelection.instanceId);
  const botModelName = botModelInstance
    ? `${botModelInstance.displayName} · ${modelLabel(botModelInstance, profile.modelSelection.model)}`
    : profile.modelSelection.model;
  // Only a thread on the bot's own model may carry a busy reasoning change to
  // the bot default; otherwise the save would also copy this thread's model.
  const busyUpdatesBotDefault = Boolean(threadId)
    && bot.modelSelection.instanceId === profile.modelSelection.instanceId
    && bot.modelSelection.model === profile.modelSelection.model;

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
    closeMenu();
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
    if (viewerLocal && !alsoApplyTo?.length) {
      saveViewerChoice(dispatch, bot.id, { effort: effort ?? null });
      return;
    }
    const { variant: _variant, ...rest } = selection;
    const next = { ...rest, ...(effort ? { effort } : { effort: undefined }) };
    if (!viewerLocal) {
      const updateBotDefault = bot.busy ? busyUpdatesBotDefault : Boolean(threadId);
      dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}), selection: next });
    }
    applyToOthers(next);
  };

  const chooseAuto = () => {
    if ((bot.busy && !alsoApplyTo?.length) || (viewerLocal && !alsoApplyTo?.length)) return;
    closeAll();
    if (autoOn && !alsoApplyTo?.length) return;
    const next = {
      ...selection,
      auto: true as const,
      autoOptimize: selection.autoOptimize ?? "balance",
    };
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

  const setAutoOptimize = (autoOptimize: "intelligence" | "balance" | "cost") => {
    if ((bot.busy && !alsoApplyTo?.length) || (viewerLocal && !alsoApplyTo?.length)) return;
    const next = { ...selection, auto: true as const, autoOptimize };
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
  };

  const { menuSections } = buildModelPickerSections({
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
    favoriteKeys,
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

  const toggleMenu = (anchor: HTMLElement | null = null, onDone?: () => void) => {
    if (locked) return;
    if (menu) {
      closeMenu();
      return;
    }
    const MENU_WIDTH = panes ? PANES_MENU_WIDTH : BASE_MENU_WIDTH;
    anchorRef.current = anchor;
    setMenuDoneCall(onDone ? { call: onDone } : null);
    const box = anchor ? (anchor.closest<HTMLElement>('[role="menu"]') ?? anchor) : null;
    const rect = (anchor ?? (headless ? fallbackAnchor?.() : triggerRef.current))?.getBoundingClientRect();
    if (rect && typeof window.innerWidth === "number") {
      if (anchor && box) {
        const left = Math.max(8, Math.min(box.getBoundingClientRect().right + 6, window.innerWidth - MENU_WIDTH - 8));
        setMenuAt({ left, bottom: Math.max(8, window.innerHeight - rect.bottom - 6) });
      } else if (windowOnly) {
        setMenuAt(windowOnlyMenuPlace());
      } else if (headless) {
        setMenuAt({ left: Math.max(8, Math.min(rect?.left ?? 24, window.innerWidth - MENU_WIDTH - 8)), bottom: Math.max(8, window.innerHeight - (rect?.top ?? 80) + 6) });
      } else {
        const right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - MENU_WIDTH - 8));
        setMenuAt({ right, bottom: window.innerHeight - rect.top + 6 });
      }
    } else if (windowOnly) {
      setMenuAt(windowOnlyMenuPlace());
    } else setMenuAt(null);
    setMenu(true);
  };
  if (menuControl) menuControl.current = { toggle: (anchor, onDone) => toggleMenu(anchor, onDone), close: () => closeMenu() };

  const composerTitle = bot.busy ? `${composerLabel}${followLine}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : `${composerLabel}${followLine}`;
  const ultracodeChip = isUltracodeEffort(selection.effort);
  const menuShownOpen = menu && !locked;

  useModelPickerEffects({
    anyOpen, orgMode, refreshInstances, refreshInstanceModels, displayedInstanceId,
    railDriverKind, railNeedsSetup, botBusy: Boolean(bot.busy), locked, windowOnly, open: false, menu, setMenu, setOpen: () => undefined,
    closeWindow: () => closeMenu(), closeMenu, dialogRef, menuRef, triggerRef, anchorRef, headless, fallbackAnchor,
    inComposer, botId: bot.id, toggleMenu, onChip, composerLabel, composerTitle, ultracodeChip, menuShownOpen,
  });

  const effortTitle = active?.capabilities?.modelVariants ? t("model.reasoning") : t("model.effort");

  const trigger = ModelPickerTrigger({
    windowOnly,
    inComposer,
    headless,
    contained,
    listChip,
    bot,
    threadId,
    triggerRef,
    menu,
    toggleMenu: () => toggleMenu(),
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
    // #2080: the two-pane chip always reads "Model · Effort" (Bot > Model
    // has no Effort row of its own any more)
    advanced: advanced || panes,
    locked,
  });

  const portal = (node: ReactNode) => (typeof document === "undefined" ? node : createPortal(node, document.body));
  return (
    <ModelPickerShell
      rootRef={rootRef}
      className={className}
      contained={contained}
      listChip={listChip}
      viewerLocal={viewerLocal}
      label={label}
      trigger={trigger}
      menuMotion={menuMotion}
      portal={portal}
      bot={bot}
      threadId={threadId}
      menuRef={menuRef}
      menuAt={menuAt}
      containedBusy={Boolean(bot.busy && !contained)}
      active={active}
      busyUpdatesBotDefault={busyUpdatesBotDefault}
      menuSections={menuSections}
      onRow={onRow}
      favoriteKeys={favoriteKeys}
      openProviders={openProviders}
      advanced={advanced}
      selection={selection}
      autoOn={autoOn}
      setEffort={setEffort}
      setAutoOptimize={setAutoOptimize}
      autoEditOpen={autoEditOpen}
      setAutoEditOpen={setAutoEditOpen}
      pick={pick}
      effortTitle={effortTitle}
      headless={headless}
      windowOnly={windowOnly}
      closeMenu={closeMenu}
      triggerRef={triggerRef}
      inComposer={inComposer}
      panes={panes}
      turnedOff={turnedOff}
      openActiveModels={openActiveModels}
    />
  );
}

function ModelPickerShell({
  rootRef,
  className,
  contained,
  listChip,
  viewerLocal,
  label,
  trigger,
  menuMotion,
  portal,
  bot,
  threadId,
  menuRef,
  menuAt,
  containedBusy,
  active,
  busyUpdatesBotDefault,
  menuSections,
  onRow,
  favoriteKeys,
  openProviders,
  advanced,
  selection,
  autoOn,
  setEffort,
  setAutoOptimize,
  autoEditOpen,
  setAutoEditOpen,
  pick,
  effortTitle,
  headless,
  windowOnly,
  closeMenu,
  triggerRef,
  inComposer,
  panes,
  turnedOff,
  openActiveModels,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  contained: boolean;
  listChip: boolean;
  viewerLocal: boolean;
  label?: ReactNode;
  trigger: ReactNode;
  menuMotion: ReturnType<typeof useMenuMotion>;
  portal: (node: ReactNode) => ReactNode;
  bot: Bot;
  threadId?: string;
  menuRef: React.RefObject<HTMLDivElement | null>;
  menuAt: { left?: number; right?: number; top?: number; bottom?: number } | null;
  containedBusy: boolean;
  active: ReturnType<typeof useStore>["state"]["instances"][number] | undefined;
  busyUpdatesBotDefault: boolean;
  menuSections: Parameters<typeof ModelPickerMenu>[0]["menuSections"];
  onRow: (row: ModelMenuRow) => void;
  favoriteKeys: ReturnType<typeof useModelFavorites>;
  openProviders: () => void;
  advanced: boolean;
  selection: ModelSelection;
  autoOn: boolean;
  setEffort: (effort: ModelSelection["effort"]) => void;
  setAutoOptimize: (optimize: NonNullable<ModelSelection["autoOptimize"]>) => void;
  autoEditOpen: boolean;
  setAutoEditOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pick: (instance: NonNullable<typeof active>, modelId: string) => void;
  effortTitle: string;
  headless: boolean;
  windowOnly: boolean;
  closeMenu: (refocus?: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  inComposer: boolean;
  panes: boolean;
  turnedOff: number;
  openActiveModels?: () => void;
}) {
  return (
    <div ref={rootRef} className={cn(contained || listChip ? "w-full min-w-0" : "relative", className)}>
      {listChip ? (
        <div className="min-w-0 w-full">
          {trigger}
          {!viewerLocal && <ModelNoEngineNotice className="mt-1 w-full" />}
        </div>
      ) : contained ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <div className="min-w-0 flex-1 basis-[200px]">{label}</div>
          <div className="ml-auto shrink-0">{trigger}</div>
          {!viewerLocal && <ModelNoEngineNotice className="w-full" />}
        </div>
      ) : (
        trigger
      )}

      {menuMotion.shown && portal(containedBusy ? (
        <div
          ref={menuRef}
          data-model-menu=""
          role="dialog"
          aria-label={t("model.menu")}
          {...menuMotion.exitProps}
          className={cn(
            "z-50 flex max-h-[min(560px,calc(100dvh-96px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50",
            menuAt ? "fixed" : "absolute bottom-full right-0 mb-1.5",
            menuMotion.className,
          )}
          style={menuAt ? { ...menuAt, width: BASE_MENU_WIDTH } : { width: BASE_MENU_WIDTH }}
        >
          <BusyModelMenu
            bot={bot}
            threadId={threadId}
            updateBotDefault={busyUpdatesBotDefault}
            variants={Boolean(active?.capabilities?.modelVariants)}
          />
        </div>
      ) : ModelPickerMenu({
        menuRef,
        menuAt,
        menuMotion,
        headless: headless || windowOnly,
        closeMenu,
        menuSections,
        onRow,
        bot,
        favoriteKeys,
        viewerLocal,
        openProviders,
        advanced,
        threadId,
        selection,
        active,
        autoOn,
        setEffort,
        setAutoOptimize,
        autoEditOpen,
        setAutoEditOpen,
        pick,
        effortTitle,
        anchorRef: (!headless && !windowOnly && (listChip || inComposer)) ? triggerRef : undefined,
        panes,
        turnedOff,
        openActiveModels: panes ? openActiveModels : undefined,
      }))}
    </div>
  );
}

