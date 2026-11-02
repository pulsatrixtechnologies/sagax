// Focus, keyboard and refresh effects for ModelPicker (#1383).
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { refreshLocalModelsOnOpen, runsLoopbackModels } from "@/lib/local-models";
import { reloadMyEngines } from "@/lib/perspicax-org";
import type { InstanceInfo } from "@/state/store";
import { COMPOSER_MODEL_EVENT, FOCUSABLE, type ComposerModelChip } from "./helpers";

export function useModelPickerEffects(opts: {
  anyOpen: boolean;
  orgMode: boolean;
  refreshInstances: () => Promise<unknown>;
  refreshInstanceModels: (instanceId: string) => Promise<unknown>;
  displayedInstanceId: string | undefined;
  railDriverKind: InstanceInfo["driverKind"] | undefined;
  railNeedsSetup: boolean;
  botBusy: boolean;
  windowOnly: boolean;
  open: boolean;
  menu: boolean;
  setMenu: (open: boolean) => void;
  setOpen: (open: boolean) => void;
  closeWindow: () => void;
  closeMenu: (refocus?: boolean) => void;
  dialogRef: RefObject<HTMLDivElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  headless: boolean;
  fallbackAnchor?: () => HTMLElement | null;
  inComposer: boolean;
  botId: string;
  toggleMenu: (anchor?: HTMLElement | null, onDone?: () => void) => void;
  onChip?: (chip: ComposerModelChip | null) => void;
  composerLabel: string;
  composerTitle: string;
  ultracodeChip: boolean;
  menuShownOpen: boolean;
}): void {
  const {
    anyOpen, orgMode, refreshInstances, refreshInstanceModels, displayedInstanceId,
    railDriverKind, railNeedsSetup, botBusy, windowOnly, open, menu, setMenu, setOpen,
    closeWindow, closeMenu, dialogRef, menuRef, triggerRef, anchorRef, headless,
    fallbackAnchor, inComposer, botId, toggleMenu, onChip, composerLabel, composerTitle,
    ultracodeChip, menuShownOpen,
  } = opts;

  const refreshingRef = useRef(false);
  const refreshLocalInstances = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    void refreshInstances()
      .catch(() => {
        // Keep the last known catalog when the app is temporarily offline.
      })
      .finally(() => {
        refreshingRef.current = false;
      });
  }, [refreshInstances]);

  useEffect(() => {
    if (!anyOpen) return;
    refreshLocalInstances();
    if (orgMode) void reloadMyEngines();
  }, [anyOpen, orgMode, refreshLocalInstances]);

  // Opening the picker looks for local models again (a server started after
  // launch), at most once per LOCAL_REFRESH_FRESH_MS. Solo probes this
  // machine through the engine's catalog; an organization server asks this
  // desktop app to probe the person's own computer.
  useEffect(() => {
    if (!anyOpen || !displayedInstanceId) return;
    if (orgMode) {
      const bridgeRefresh = window.ogb?.serverMode?.refreshLocalModels;
      if (!bridgeRefresh) return;
      void refreshLocalModelsOnOpen({ key: "desktop", orgMode: true, bridgeRefresh, reload: async () => { await refreshInstances(); } });
      return;
    }
    if (railNeedsSetup || !runsLoopbackModels(railDriverKind)) return;
    void refreshLocalModelsOnOpen({ key: displayedInstanceId, orgMode: false, refreshModels: async () => { await refreshInstanceModels(displayedInstanceId); } });
  }, [anyOpen, displayedInstanceId, orgMode, railDriverKind, railNeedsSetup, refreshInstances, refreshInstanceModels]);

  useEffect(() => {
    if (!botBusy) return;
    setMenu(false);
    if (!windowOnly) setOpen(false);
  }, [botBusy, windowOnly, setMenu, setOpen]);

  const closeWindowRef = useRef(closeWindow);
  closeWindowRef.current = closeWindow;
  // Escape closes the window. The window closes on its backdrop and keeps
  // Tab inside itself.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      // A child dialog (the provider switch confirmation) owns its keys.
      if (event.defaultPrevented || document.querySelector('[role="alertdialog"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeWindowRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dialogRef]);

  // The window takes focus when it opens and gives it back to the chip (the
  // composer's + when headless: its menu closed when the window opened).
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current ?? (headless ? fallbackAnchor?.() as HTMLButtonElement | null | undefined : null);
    const dialog = dialogRef.current;
    const start = dialog?.querySelector<HTMLElement>('[data-model-provider-column] [aria-pressed="true"]') ?? dialog;
    start?.focus();
    return () => {
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    };
  }, [open, dialogRef, triggerRef, headless, fallbackAnchor]);

  // The menu: a click outside or a resize closes it; Escape anywhere in it
  // closes it and gives the focus back to the chip.
  useEffect(() => {
    if (!menu) return;
    const outside = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setMenu(false);
    };
    const resize = () => setMenu(false);
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [menu, menuRef, triggerRef, anchorRef, setMenu]);

  // the desktop mascot's model chip: the app comes forward and this chip's menu opens
  const toggleRef = useRef(toggleMenu);
  toggleRef.current = toggleMenu;
  useEffect(() => {
    if (!inComposer) return;
    const onModel = (event: Event) => {
      if ((event as CustomEvent<{ botId?: string }>).detail?.botId === botId) toggleRef.current(null);
    };
    window.addEventListener(COMPOSER_MODEL_EVENT, onModel);
    return () => window.removeEventListener(COMPOSER_MODEL_EVENT, onModel);
  }, [inComposer, botId]);

  useEffect(() => {
    onChip?.({ label: composerLabel, title: composerTitle, busy: Boolean(botBusy), ultracode: ultracodeChip, open: menuShownOpen });
  }, [onChip, composerLabel, composerTitle, botBusy, ultracodeChip, menuShownOpen]);
  // another thread or a group: the + menu's row never shows the last bot's model
  useEffect(() => () => onChip?.(null), [onChip]);
  // headless: an Escape with the focus outside the open menu (tabbed away)
  // still closes it first; the + menu's own Escape waits for its row
  useEffect(() => {
    if (!headless || !menu) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (menuRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });
}
