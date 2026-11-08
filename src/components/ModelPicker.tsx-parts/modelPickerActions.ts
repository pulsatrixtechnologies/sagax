import type { MutableRefObject, RefObject } from "react";
import { isDesktopModelId, localRowUnavailable } from "@/lib/local-models";
import { batchModelActions } from "@/lib/batch-bot-model";
import type { Bot, InstanceInfo, ModelSelection, useStore } from "@/state/store";
import type { EffortLevel } from "../../../shared/wire";
import { MENU_WIDTH as BASE_MENU_WIDTH, modelSelectionForPick, saveViewerChoice } from "./helpers";
import { windowOnlyMenuPlace } from "./ModelPickerMenu";

type Store = ReturnType<typeof useStore>;

export interface ModelPickerActionsCtx {
  state: Store["state"];
  dispatch: Store["dispatch"];
  bot: Bot;
  choose?: { onPick: (pick: { instanceId?: string; model: string }) => void };
  threadId?: string;
  alsoApplyTo?: readonly string[];
  viewerLocal: boolean;
  selection: ModelSelection;
  autoOn: boolean;
  busyUpdatesBotDefault: boolean;
  notAllowed: (instance: InstanceInfo) => boolean;
  closeAll: () => void;
}

/** The pick / effort / auto handlers of ModelPicker (plain closures, no hooks). */
export function makeModelPickerActions(ctx: ModelPickerActionsCtx) {
  const { state, dispatch, bot, choose, threadId, alsoApplyTo, viewerLocal, selection, autoOn, busyUpdatesBotDefault, notAllowed, closeAll } = ctx;
  const applyToOthers = (next: ModelSelection) => {
    if (!alsoApplyTo?.length) return;
    const others = alsoApplyTo.flatMap((id) => {
      if (id === bot.id) return [];
      const candidate = state.bots.find((item) => item.id === id);
      return candidate ? [{ id: candidate.id, threadId: candidate.threadId, busy: candidate.busy }] : [];
    });
    for (const action of batchModelActions(others, next)) dispatch(action);
  };

  const pick = (instance: typeof state.instances[number], model: string, keepOpen = false) => {
    if (choose) {
      if (instance.policy || notAllowed(instance)) return;
      choose.onPick({ instanceId: instance.instanceId, model });
      closeAll();
      return;
    }
    if ((bot.busy && !alsoApplyTo?.length) || instance.policy || notAllowed(instance)) return;
    const localRow = instance.models.options.find((option) => option.id === model && (option.local || isDesktopModelId(option.id)));
    if (localRow && localRowUnavailable(instance.driverKind, model, localRow.anthropic)) return;
    if (viewerLocal && !alsoApplyTo?.length) {
      saveViewerChoice(dispatch, bot.id, { model: { instanceId: instance.instanceId, model } });
      if (!keepOpen) closeAll();
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
  return { pick, setEffort, chooseAuto, setAutoOptimize };
}

export interface MenuToggleCtx {
  locked: boolean;
  menu: boolean;
  closeMenu: () => void;
  anchorRef: MutableRefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  setMenuDoneCall: (call: { call: () => void } | null) => void;
  setMenuAt: (at: { left?: number; right?: number; top?: number; bottom?: number } | null) => void;
  setMenu: (open: boolean) => void;
  headless: boolean;
  windowOnly: boolean;
  fallbackAnchor?: () => HTMLElement | null;
}

/** Opens or closes the model menu and places it next to its anchor. */
export function makeToggleMenu(ctx: MenuToggleCtx) {
  const { locked, menu, closeMenu, anchorRef, triggerRef, setMenuDoneCall, setMenuAt, setMenu, headless, windowOnly, fallbackAnchor } = ctx;
  return (anchor: HTMLElement | null = null, onDone?: () => void) => {
    if (locked) return;
    if (menu) {
      closeMenu();
      return;
    }
    const MENU_WIDTH = BASE_MENU_WIDTH;
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
}
