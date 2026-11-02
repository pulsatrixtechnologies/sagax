// App's slot at the window's right edge, past the content frame (App.tsx
// `[data-split-panel-slot]`). A split section's group panel and a page's
// detail panel (DetailPanel.tsx) portal into it, so every right panel sits at
// the same edge. Its own module so a page can reach it without importing the
// split view (and everything that pulls in).
import { createContext, useContext, type ReactNode } from "react";

const PanelSlot = createContext<HTMLElement | null>(null);

/** The slot, or null outside the app shell (galleries, tests). */
export function usePanelSlot(): HTMLElement | null {
  return useContext(PanelSlot);
}

export function PanelSlotProvider({ slot, children }: { slot: HTMLElement | null; children: ReactNode }) {
  return <PanelSlot.Provider value={slot}>{children}</PanelSlot.Provider>;
}
