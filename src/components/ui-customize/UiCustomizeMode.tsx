// Whole-app customize mode context (D-20261127-004, #5443).
// Draft edits until Save; Escape / Cancel discard; Reset confirms in-page.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useConfirm } from "../ConfirmProvider";
import { t } from "@/lib/i18n";
import {
  cloneLayout,
  hideInZone,
  moveInZone,
  nudgeInZone,
  restoreInZone,
  setComposerSide,
  setUsagePlacement,
} from "@/lib/ui-layout/draft";
import {
  defaultUiLayout,
  getUiLayout,
  resetUiLayoutToDefaults,
  setUiLayout,
  subscribeUiLayout,
} from "@/lib/ui-layout/preference";
import { mergeSidebarSections } from "@/lib/ui-layout/sidebar-order";
import type { UiLayoutV1, UsagePlacement, ZoneId } from "@/lib/ui-layout/types";

export type UiCustomizeApi = {
  active: boolean;
  draft: UiLayoutV1;
  begin: () => void;
  save: () => void;
  cancel: () => void;
  /** Opens ConfirmDialog; on confirm resets draft (and persisted on save path via resetDefaults). */
  requestReset: () => void;
  /** Persist defaults immediately and leave mode (after confirm). */
  resetAndLeave: () => void;
  hide: (zoneId: ZoneId, id: string) => void;
  restore: (zoneId: ZoneId, id: string) => void;
  move: (zoneId: ZoneId, id: string, toIndex: number) => void;
  nudge: (zoneId: ZoneId, id: string, delta: -1 | 1) => void;
  setSide: (id: string, side: "left" | "right") => void;
  setPlacement: (placement: UsagePlacement) => void;
  /** Merge live sidebar section ids into the draft order while customizing. */
  ensureSidebarSections: (sectionIds: string[]) => void;
  dragging: { zoneId: ZoneId; id: string } | null;
  setDragging: (next: { zoneId: ZoneId; id: string } | null) => void;
};

const UiCustomizeContext = createContext<UiCustomizeApi | null>(null);

export function UiCustomizeProvider({ children }: { children: ReactNode }) {
  const confirm = useConfirm();
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState<UiLayoutV1>(() => cloneLayout(getUiLayout()));
  const [dragging, setDragging] = useState<{ zoneId: ZoneId; id: string } | null>(null);

  // Keep draft aligned with store when not customizing (another window / bot set).
  useEffect(() => {
    return subscribeUiLayout(() => {
      if (active) return;
      setDraft(cloneLayout(getUiLayout()));
    });
  }, [active]);

  const begin = useCallback(() => {
    setDraft(cloneLayout(getUiLayout()));
    setDragging(null);
    setActive(true);
  }, []);

  const save = useCallback(() => {
    setUiLayout(draft);
    setDragging(null);
    setActive(false);
  }, [draft]);

  const cancel = useCallback(() => {
    setDraft(cloneLayout(getUiLayout()));
    setDragging(null);
    setActive(false);
  }, []);

  const resetAndLeave = useCallback(() => {
    const next = resetUiLayoutToDefaults();
    setDraft(cloneLayout(next));
    setDragging(null);
    setActive(false);
  }, []);

  const requestReset = useCallback(() => {
    void confirm({
      title: t("ui.customize.resetConfirm.title"),
      body: t("ui.customize.resetConfirm.body"),
      confirmLabel: t("ui.customize.resetConfirm.confirm"),
      tone: "neutral",
    }).then((ok) => {
      if (!ok) return;
      // Reset draft to defaults while staying in mode so the person can Save or keep editing.
      setDraft(cloneLayout(defaultUiLayout()));
      setDragging(null);
    });
  }, [confirm]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (active) root.setAttribute("data-ui-customize", "1");
    else root.removeAttribute("data-ui-customize");
    return () => root.removeAttribute("data-ui-customize");
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: Event) => {
      const key = (event as globalThis.KeyboardEvent).key;
      if (key !== "Escape") return;
      // ConfirmDialog handles its own Escape; skip when a dialog is open.
      if (document.querySelector("[data-confirm-dialog], [role='alertdialog']")) return;
      event.preventDefault();
      event.stopPropagation();
      setDraft(cloneLayout(getUiLayout()));
      setDragging(null);
      setActive(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);

  const hide = useCallback((zoneId: ZoneId, id: string) => {
    setDraft((current) => hideInZone(current, zoneId, id));
  }, []);
  const restore = useCallback((zoneId: ZoneId, id: string) => {
    setDraft((current) => restoreInZone(current, zoneId, id));
  }, []);
  const move = useCallback((zoneId: ZoneId, id: string, toIndex: number) => {
    setDraft((current) => moveInZone(current, zoneId, id, toIndex));
  }, []);
  const nudge = useCallback((zoneId: ZoneId, id: string, delta: -1 | 1) => {
    setDraft((current) => nudgeInZone(current, zoneId, id, delta));
  }, []);
  const setSide = useCallback((id: string, side: "left" | "right") => {
    setDraft((current) => setComposerSide(current, id, side));
  }, []);
  const setPlacement = useCallback((placement: UsagePlacement) => {
    setDraft((current) => setUsagePlacement(current, placement));
  }, []);

  const ensureSidebarSections = useCallback((sectionIds: string[]) => {
    setDraft((current) => {
      const merged = mergeSidebarSections(current.zones.sidebar, sectionIds);
      if (
        merged.order.length === current.zones.sidebar.order.length
        && merged.order.every((id, index) => id === current.zones.sidebar.order[index])
      ) return current;
      return {
        ...current,
        zones: { ...current.zones, sidebar: merged },
      };
    });
  }, []);

  const api = useMemo<UiCustomizeApi>(() => ({
    active,
    draft,
    begin,
    save,
    cancel,
    requestReset,
    resetAndLeave,
    hide,
    restore,
    move,
    nudge,
    setSide,
    setPlacement,
    ensureSidebarSections,
    dragging,
    setDragging,
  }), [
    active, draft, begin, save, cancel, requestReset, resetAndLeave,
    hide, restore, move, nudge, setSide, setPlacement, ensureSidebarSections, dragging,
  ]);

  return (
    <UiCustomizeContext.Provider value={api}>
      {children}
    </UiCustomizeContext.Provider>
  );
}

/** Stable no-op when a surface mounts outside UiCustomizeProvider (gallery / isolated tests). */
const NOOP_CUSTOMIZE: UiCustomizeApi = {
  active: false,
  draft: defaultUiLayout(),
  begin: () => undefined,
  save: () => undefined,
  cancel: () => undefined,
  requestReset: () => undefined,
  resetAndLeave: () => undefined,
  hide: () => undefined,
  restore: () => undefined,
  move: () => undefined,
  nudge: () => undefined,
  setSide: () => undefined,
  setPlacement: () => undefined,
  ensureSidebarSections: () => undefined,
  dragging: null,
  setDragging: () => undefined,
};

export function useUiCustomize(): UiCustomizeApi {
  const ctx = useContext(UiCustomizeContext);
  return ctx ?? NOOP_CUSTOMIZE;
}
