// Model picker: active models in one menu, grouped by provider. A choice
// applies to every thread of the bot. Connection controls live in Providers
// (lot 7: the full window is gone; Auto chain and recovery live in Settings).
// Model and effort travel through the same action from the chip and composer.
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Monitor } from "lucide-react";
import { type Bot, type ModelSelection, type useStore } from "@/state/store";
import { shallowEqual, useStoreCommands, useStoreDispatch, useStoreGetter, useStoreSelector } from "@/state/store-selector";
import { engineHidden, engineOffer } from "../../shared/offered-engines";
import { engineOfferContext, modelSwitches } from "@/lib/offered-instances";
import { accountPickChipLine } from "@/lib/account-pick";
import { credentialFormLabelKey } from "../../shared/credential-resolver";
import { configuredModelInstances, isClaudeAccount } from "@/lib/engine-rail";
import { needsCli } from "./EngineSetup";
import type { ModelMenuRow } from "./ModelMenu";
import { cn } from "@/lib/cn";
import { COMPOSER_POPOVER_RISE_CLASS, MENU_BOX } from "./menu-look";
import { useMenuMotion } from "./MenuMotion";
import { EngineLimitIndicator } from "./LimitResetContinue";
import { useAdvancedMode } from "@/lib/interface-mode";
import { t } from "@/lib/i18n";
import { useMyEngineModels, useMyEngines, usePerspicaxOrg } from "@/lib/perspicax-org";
import { orgRefusesEngine } from "./OrgHostToolsNote";
import { useAutoModelStatus } from "@/lib/auto-model-preview";
import { ModelNoEngineNotice } from "./ModelNoEngineNotice";
import { InstanceProviderMark, PresetProviderMark, ProviderMonogram, hasOwnProviderMark } from "./ProviderIcons";
import { PROVIDER_ICON_PRESETS, type ProviderIconPreset } from "../../shared/provider-icon";
import { COMPUTER_PROVIDER_ID } from "../../shared/model-provider";
import { openModelWindow } from "@/lib/model-window";
import { ModelManager } from "./ModelPicker.tsx-parts/ModelManager";
import { effortLabel } from "@/lib/effort-label";
import { isUltracodeEffort } from "../../shared/ultracode-effort";
import { useModelFavorites } from "@/lib/model-favorites";
import { useModelFavoritesServerSync } from "@/lib/model-favorites-sync";
import { requestSettingsCard, useSettingsSurface } from "./SettingsPrimitives";
import { modelOffer, type ModelSwitches } from "../../shared/offered-models";

import {
  COMPOSER_MODEL_EVENT,
  MENU_WIDTH as BASE_MENU_WIDTH,
  composerModelLabel,
  engineStatus,
  isDesktopLocalModel,
  modelLabel,
  modelSelectionForPick,
  providerRailUnready,
  removableKeySection,
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
import { pickBotHarness, type RunsWithChoice } from "./RunsWith";
import { botRunsWith } from "@/lib/runs-with";
import { pickBotContextSize, type ContextSizeChoice } from "./ContextSize";
import { botChoosesContextSize, botContextSizes, useContextDefaults } from "@/lib/context-size";
import { makeModelPickerActions, makeToggleMenu } from "./ModelPicker.tsx-parts/modelPickerActions";
import { useModelPickerEffects } from "./ModelPicker.tsx-parts/useModelPickerEffects";
import { modelPickerComposerLabel, modelPickerFollowLine, modelPickerSummary } from "./ModelPicker.tsx-parts/labels";
import { currentProvider } from "@/lib/model-menu-steps";
import { chatBarChipLabel, shownMode } from "@/lib/model-mode";
import type { ModelPanelProps } from "./ModelPanel";
import { CUSTOM_GLYPH, MODE_GLYPHS, MODE_MENU_WIDTH } from "./ModeMenu";

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

/** Pick-only mode: the menu chooses a model and hands it back; nothing is
 * saved to a bot. For surfaces that plan a change (team settings) or launch
 * something (a cloud run), one menu everywhere. */
export interface ModelChoose {
  /** What is chosen now; null when nothing is (the keep row is current). */
  value: { instanceId?: string; model: string } | null;
  onPick: (pick: { instanceId?: string; model: string }) => void;
  /** The text the chip shows. */
  label: string;
  /** A row at the head of the menu, for example "Keep current model". */
  keep?: { label: string; onKeep: () => void };
  /** Only the engines this accepts are listed. */
  engine?: (instance: import("@/state/store").InstanceInfo) => boolean;
  /** A model typed in the search, outside the catalog, can be picked too. */
  custom?: { label: (text: string) => string };
}

/** The bot the menu leans on when it only chooses (no bot is touched). */
const CHOOSE_BOT = {
  id: "", name: "", threadId: "", busy: false, tasks: [],
  modelSelection: { instanceId: "", model: "" },
} as unknown as Bot;

export function ModelPicker({
  bot: botProp,
  choose,
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
  modes = true,
}: {
  /** Omitted with `choose`. */
  bot?: Bot;
  choose?: ModelChoose;
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
  /** #4900, #5088: in the composer the menu is the mode menu (Auto, Fast, Expert,
   * Heavy, Manual). `false` keeps the model panel's own short view there. */
  modes?: boolean;
}) {
  const dispatch = useStoreDispatch();
  const { refreshInstances, refreshModels: refreshInstanceModels } = useStoreCommands();
  const getState = useStoreGetter();
  const bot = botProp ?? CHOOSE_BOT;
  // #3624: what the picker draws (the engines, the settings, this bot's own
  // entry), so another bot's frame renders nothing here
  const state = useStoreSelector((current) => ({
    instances: current.instances,
    config: current.config,
    modelFallbacks: current.modelFallbacks,
    modelVariantSessions: current.modelVariantSessions,
    own: current.bots?.find((candidate) => candidate.id === bot.id),
  }), shallowEqual);
  // #2050: the stars follow the person through /api/me/models
  useModelFavoritesServerSync();
  const [menu, setMenu] = useState(windowOnly);
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
  const surface = useSettingsSurface();
  const org = usePerspicaxOrg();
  const advanced = useAdvancedMode();
  const favoriteKeys = useModelFavorites();
  const myEngines = useMyEngines();
  const orgMode = org !== null;
  const health = { orgMode, myEngines };
  const anyOpen = menu;
  const accountModels = useMyEngineModels(myEngines, anyOpen);

  const selection: ModelSelection = choose
    ? { instanceId: choose.value?.instanceId ?? "", model: choose.value?.model ?? "" }
    : bot.modelSelection;
  const autoOn = selection.auto === true && !viewerLocal && !choose;
  const autoTask = state.own?.tasks
    ?.find((task) => task.threadId === (threadId ?? bot.threadId));
  const autoStatus = useAutoModelStatus(bot.id, threadId, (autoOn || anyOpen) && !choose, JSON.stringify([selection, state.config?.disabledModels, state.config?.myDisabledModels, state.instances]), anyOpen);
  const autoPreview = autoStatus?.auto ? autoStatus.pick : null;
  const autoRecord = autoOn ? autoTask?.autoModel ?? autoPreview : null;
  const active = state.instances.find((instance) => instance.instanceId === selection.instanceId);
  const autoInstance = autoRecord ? state.instances.find((instance) => instance.instanceId === autoRecord.instanceId) ?? active : active;
  const configured = configuredModelInstances(state.instances, selection.instanceId);
  const offerContext = engineOfferContext(state.config, orgMode, myEngines);
  const switches = modelSwitches(state.config);
  const notAllowed = (instance: typeof state.instances[number]) => engineOffer(offerContext, instance.instanceId) === "notAllowed";
  const notGiven = (instance: typeof state.instances[number]) => engineOffer(offerContext, instance.instanceId) === "notGiven";
  // D-20261126-018: a provider the organization hid stays only in the menu
  // of what is already on it, as its model in use; a conversation on a
  // backup can still go back to its bot's own engine
  const ownEngine = state.own?.modelSelection.instanceId;
  const pickerInstances = offerContext.organization
    ? configured.filter((instance) => !notAllowed(instance) &&
      (instance.instanceId === selection.instanceId || (!engineHidden(offerContext, instance.instanceId) || instance.instanceId === ownEngine) && !orgRefusesEngine(instance) && !notGiven(instance)))
    : configured;
  // #4329 lot 6: "Runs with", the bot's own setting (src/components/RunsWith.tsx):
  // the engines offered here that may run its model; a pick writes the bot's choice
  const runsWith = botRunsWith({
    instances: pickerInstances, place: orgMode ? "organization" : "solo", selection: bot.modelSelection, chosen: bot.harness,
    onPick: pickBotHarness(dispatch, bot.id),
  });
  // #4417: "Context size", the bot's own setting (src/components/ContextSize.tsx)
  const { defaults: contextDefaults } = useContextDefaults(botChoosesContextSize(pickerInstances, bot.modelSelection));
  const contextSize = botContextSizes({
    instances: pickerInstances, selection: bot.modelSelection, chosen: bot.contextWindow, defaults: contextDefaults,
    onPick: pickBotContextSize(dispatch, bot.id),
  });
  const selectable = pickerInstances.filter((instance) => !notAllowed(instance) && (!choose?.engine || choose.engine(instance)));
  const selectedVariantLabel = variantLabelForSelection(active, selection);
  const multipleClaudeAccounts = state.instances.filter(isClaudeAccount).length > 1;
  const showActiveAccount = (multipleClaudeAccounts && isClaudeAccount(active)) || Boolean(active?.snapshot.chatgptPlan);
  const railInstance = active;
  const displayedInstanceId = active?.instanceId;
  const closeMenu = (refocus = false) => {
    setMenu(false);
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
  // Settings > Models > Advanced > Active models, from the menu's footer row.
  const openActiveModels = () => {
    closeAll();
    requestSettingsCard("models.advanced");
    dispatch({ type: "toggleAppSettings", open: true, section: "engines" });
  };
  const turnedOff = turnedOffCount(pickerInstances, switches);
  // One menu everywhere (#2050 two-pane menu retired): the settings surfaces
  // (Settings > Models, Bot > Model, bulk edit) have no Effort row of their
  // own, so their chip and menu always carry the effort, as before.
  const showEffort = !choose && (advanced || listChip || contained || Boolean(alsoApplyTo?.length));

  const profile = state.own ?? bot;
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

  const { pick, setEffort, chooseAuto, chooseMode, setAutoOptimize } = makeModelPickerActions({
    getState, dispatch, bot, choose, threadId, alsoApplyTo, viewerLocal, selection, autoOn, busyUpdatesBotDefault, notAllowed, closeAll,
  });

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
    viewerLocal: viewerLocal || Boolean(choose),
    keepRow: choose?.keep ? { key: "keep", kind: "keep", label: choose.keep.label, current: choose.value === null } : undefined,
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
    if (row.kind === "keep") {
      choose?.keep?.onKeep();
      return closeAll();
    }
    if (row.kind === "auto") return chooseAuto();
    if (row.kind === "follow") return pickBotModel();
    const instance = state.instances.find((candidate) => candidate.instanceId === row.instanceId);
    // #5014: the Account line forces its account; a row leaves it to the strategy
    if (instance && row.modelId !== undefined) pick(instance, row.modelId, false, row.pinAccount === true);
  };

  const summary = modelPickerSummary({ autoOn, autoRecord, active, selection, selectedVariantLabel, advanced });
  const followLine = modelPickerFollowLine({ follows, profileName: profile.name, fallbackLine });
  // #4329: the chip names the provider of the model in use (never a tool)
  const providerLabel = currentProvider(menuSections)?.section.label;
  // M-20261119-015: and the account it runs on, while the provider has several
  const accountLabel = autoOn ? undefined : currentProvider(menuSections)?.section.rows.find((row) => row.current)?.account;
  // #4900, #5088, M-20261123-045: the chat bar's menu is the mode menu (Auto,
  // Fast, Expert, Heavy, Build, Reasoning, All models); All models is the
  // cascade provider, account, model. The chip names the mode, or the model
  // the person pinned there.
  const modeUi = modes && inComposer && !choose && !viewerLocal && !windowOnly;
  // M-20261125-074, M-20261126-104: the chip in the message box names the mode, then the
  // reasoning level in use: the one the mode imposes (Fast, Expert, Heavy), or
  // the one the person chose under Auto. M-20261125-073: Build reads as Auto.
  const modeNow = shownMode(selection);
  const modeLevel = modeNow === null ? undefined : modeNow === "auto" ? selection.effort : autoStatus?.modes?.[modeNow]?.effort;
  const composerLabel = choose ? choose.label
    : modeUi && autoOn && modeNow ? chatBarChipLabel(modeNow, modeLevel)
    : modelPickerComposerLabel({ autoOn, autoRecord, active, selection, selectedVariantLabel, providerLabel, accountLabel, modes: modeUi });
  // M-20261126-104: Custom's row names the model picked by hand, the one the selection
  // keeps under a mode too (a turn off the modes runs it); its tooltip says the provider and the account
  const modeMenu: ModelPanelProps["modes"] = modeUi ? {
    current: modeNow,
    pinnedLabel: active ? modelLabel(active, selection.model) : autoOn ? undefined : selection.model || undefined,
    pinnedTitle: autoOn ? undefined : modelPickerComposerLabel({ autoOn, autoRecord, active, selection, selectedVariantLabel, providerLabel, accountLabel }),
    resolutions: autoStatus?.modes,
    onPick: chooseMode,
  } : undefined;

  const toggleMenu = makeToggleMenu({
    locked, menu, closeMenu, anchorRef, triggerRef, setMenuDoneCall, setMenuAt, setMenu, headless, windowOnly, fallbackAnchor,
    // the chat bar's mode menu is placed with its own width
    width: modeUi ? MODE_MENU_WIDTH : undefined,
  });
  if (menuControl) menuControl.current = { toggle: (anchor, onDone) => toggleMenu(anchor, onDone), close: () => closeMenu() };

  // #5014: why the conversation runs on this account, in one line, under the chip's words
  const threadTask = profile.tasks?.find((task) => task.threadId === (threadId ?? bot.threadId));
  const pickedLine = accountPickChipLine(threadTask?.accountPick, selection);
  const servedForm = threadTask?.credentialServed?.form;
  const servedLine = servedForm ? `\n${t("turnAccess.servedBy", { form: t(credentialFormLabelKey(servedForm)) })}` : "";
  const titled = pickedLine ? `${composerLabel}\n${pickedLine}${followLine}${servedLine}` : `${composerLabel}${followLine}${servedLine}`;
  const composerTitle = bot.busy ? `${titled}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : titled;
  const ultracodeChip = isUltracodeEffort(selection.effort);
  const menuShownOpen = menu && !locked;

  useModelPickerEffects({
    anyOpen, orgMode, refreshInstances, refreshInstanceModels, displayedInstanceId,
    railDriverKind, railNeedsSetup, botBusy: Boolean(bot.busy), locked, windowOnly, open: false, menu, setMenu, setOpen: () => undefined,
    closeWindow: () => closeMenu(), closeMenu, dialogRef, menuRef, triggerRef, anchorRef, headless, fallbackAnchor,
    inComposer, botId: bot.id, toggleMenu, onChip, composerLabel, composerTitle, ultracodeChip, menuShownOpen,
  });

  const effortTitle = t("model.effort");
  // #2963, #4329: each provider's mark, in the menu and the window's
  // column: a vendor's logo, a server's own icon (its engine instance's),
  // this computer's monitor.
  const engineMark = (key: string): ReactNode => {
    if ((PROVIDER_ICON_PRESETS as readonly string[]).includes(key)) return <PresetProviderMark preset={key as ProviderIconPreset} size={14} />;
    const section = menuSections.find((candidate) => candidate.key === key);
    const instanceId = section?.rows.find((row) => row.instanceId)?.instanceId ?? key;
    const instance = key === COMPUTER_PROVIDER_ID ? undefined : state.instances.find((candidate) => candidate.instanceId === instanceId);
    // a server with no logo of its own gets its letters, never a glyph another provider shares
    if (instance && !hasOwnProviderMark(instance)) return <ProviderMonogram label={section?.label ?? instance.displayName} size={14} />;
    return instance ? <InstanceProviderMark instance={instance} size={14} /> : <Monitor size={14} aria-hidden="true" />;
  };
  // #2963: the chat bar menu's footer opens the models window for this bot.
  // Settings surfaces (list chip, profile row, bulk edit) keep their own links.
  const onManage = !choose && bot.id && !windowOnly && !listChip && !contained && !alsoApplyTo?.length
    ? () => { closeAll(); openModelWindow(bot.id); }
    : undefined;

  const trigger = ModelPickerTrigger({
    plain: contained && surface === "plain",
    windowOnly,
    inComposer,
    headless,
    contained,
    listChip,
    bot,
    chooseLabel: choose?.label,
    threadId,
    triggerRef,
    menu,
    toggleMenu: () => toggleMenu(),
    composerLabel,
    // M-20261126-104: in the chat bar the chip leads with the icon of its mode, or Custom's for a model picked by hand
    chipGlyph: modeUi ? (modeNow ? MODE_GLYPHS[modeNow] : CUSTOM_GLYPH) : undefined,
    followLine: followLine + servedLine,
    summary,
    selection,
    autoOn,
    autoRecord,
    autoInstance,
    active,
    showActiveAccount: showActiveAccount || accountLabel !== undefined,
    accountLabel,
    selectedVariantLabel,
    // #2080: the settings chips always read "Model · Effort" (Bot > Model
    // has no Effort row of its own any more)
    advanced: showEffort,
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
      limitEngine={autoInstance?.instanceId ?? selection.instanceId}
      busyUpdatesBotDefault={busyUpdatesBotDefault}
      menuSections={menuSections}
      onRow={onRow}
      favoriteKeys={favoriteKeys}
      openProviders={openProviders}
      advanced={showEffort}
      selection={selection}
      autoOn={autoOn}
      setEffort={setEffort}
      setAutoOptimize={setAutoOptimize}
      pick={pick}
      effortTitle={effortTitle}
      headless={headless}
      windowOnly={windowOnly}
      closeMenu={closeMenu}
      triggerRef={triggerRef}
      inComposer={inComposer}
      turnedOff={turnedOff}
      openActiveModels={openActiveModels}
      onManage={onManage}
      engineMark={engineMark}
      runsWith={choose || viewerLocal ? undefined : runsWith}
      contextSize={choose || viewerLocal ? undefined : contextSize}
      customModel={choose?.custom ? { label: choose.custom.label, onPick: (text) => { choose.onPick({ model: text }); closeAll(); } } : undefined}
      modeMenu={modeMenu}
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
  limitEngine,
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
  pick,
  effortTitle,
  headless,
  windowOnly,
  closeMenu,
  triggerRef,
  inComposer,
  turnedOff,
  openActiveModels,
  onManage,
  engineMark,
  runsWith,
  contextSize,
  customModel,
  modeMenu,
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
  /** The engine this bot really runs on (Auto resolved): the only one whose limit shows. */
  limitEngine: string | undefined;
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
  pick: (instance: NonNullable<typeof active>, modelId: string, keepOpen?: boolean) => void;
  effortTitle: string;
  headless: boolean;
  windowOnly: boolean;
  closeMenu: (refocus?: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  inComposer: boolean;
  turnedOff: number;
  openActiveModels?: () => void;
  onManage?: () => void;
  engineMark: (sectionKey: string) => ReactNode;
  runsWith?: readonly RunsWithChoice[];
  contextSize?: readonly ContextSizeChoice[];
  customModel?: { label: (text: string) => string; onPick: (text: string) => void };
  /** #4900, #5088: the chat bar's mode menu, the model panel's short view. */
  modeMenu?: ModelPanelProps["modes"];
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
        <>
          {trigger}
          {/* M-20261125-070: no limit dot in the chat bar; the meter under the box carries it (ComposerMeter) */}
          {!inComposer && <EngineLimitIndicator engine={limitEngine} botId={bot.id} threadId={threadId ?? bot.threadId}
            messages={(threadId ?? bot.threadId) === bot.threadId ? bot.messages : undefined} />}
        </>
      )}

      {/* #2963: the models window (sidebar menu, Edit..., Manage models) */}
      {windowOnly && menuMotion.shown && (
        <ModelManager
          bot={bot}
          threadId={threadId}
          sections={menuSections}
          favoriteKeys={favoriteKeys}
          selection={selection}
          active={active}
          autoOn={autoOn}
          advanced={advanced}
          effortTitle={effortTitle}
          onRow={onRow}
          pick={pick}
          setEffort={setEffort}
          setAutoOptimize={setAutoOptimize}
          openProviders={openProviders}
          onClose={() => closeMenu()}
          engineMark={engineMark}
          frameRef={menuRef}
        />
      )}
      {/* M-20261126-104: one Effort everywhere. While the bot works the chat bar's mode menu still
          opens, its modes and models locked, its Effort row open; the other surfaces keep the short menu */}
      {!windowOnly && menuMotion.shown && portal(containedBusy && !modeMenu ? (
        <div
          ref={menuRef}
          data-model-menu=""
          role="dialog"
          aria-label={t("model.menu")}
          {...menuMotion.exitProps}
          className={cn(
            "z-50 flex max-h-[min(560px,calc(100dvh-96px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden py-1 text-popover-ink",
            MENU_BOX,
            menuAt ? "fixed" : "absolute bottom-full right-0 " + COMPOSER_POPOVER_RISE_CLASS,
            menuMotion.className,
          )}
          style={menuAt ? { ...menuAt, width: BASE_MENU_WIDTH } : { width: BASE_MENU_WIDTH }}
        >
          <BusyModelMenu
            bot={bot}
            threadId={threadId}
            updateBotDefault={busyUpdatesBotDefault}
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
        pick,
        effortTitle,
        anchorRef: (!headless && !windowOnly && (listChip || inComposer)) ? triggerRef : undefined,
        turnedOff,
        openActiveModels,
        onManage,
        engineMark,
        runsWith,
        contextSize,
        customModel,
        modeMenu,
      }))}
    </div>
  );
}

