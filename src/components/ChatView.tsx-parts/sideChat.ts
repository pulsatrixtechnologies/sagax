import type { ReactNode } from "react";

/** The compact chat of a side thread (SideThreadPanel): its own header in
 * place of the bot pill and controls, and none of the window-wide parts
 * (calls, ⌘F, the app's error and notice banners), which stay with the
 * main chat. */
/** A chat drawn compact beside the main one. A split-view section passes
 * `panel` and a header that takes the pill: the same pill as the main
 * chat's, which opens this bot's or group's panel at the window's right
 * edge (AppState.panelOwner). `slot`: where a group's panel portals to. */
export type SideChat = {
  header: ReactNode | ((pill: ReactNode) => ReactNode);
  label: string;
  panel?: { open: boolean; onToggle: () => void; slot?: HTMLElement | null };
  /** Older pages for this pane's own transcript (outside the store). */
  loadOlder?: () => void;
  loadingOlder?: boolean;
};

export const noop = () => {};
