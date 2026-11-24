// A docked panel's opening slide (`animate-panel-in`) belongs to the panel
// opening. A panel that is remounted for another subject while it is open
// (the bot panel is keyed per bot, so a bot switch mounts a new one) must not
// slide in again (#5228). At the new instance's first render the one it
// replaces is still mounted, which is how the two cases are told apart; the
// answer is kept for the instance's life, so a re-render neither starts nor
// cuts the slide.
import { useLayoutEffect, useState } from "react";

const mounted = new Map<string, number>();

/** True when this instance is the panel opening, false when it replaces an
 * open panel of the same `kind`. */
export function useDockedPanelEntrance(kind: string): boolean {
  const [entrance] = useState(() => (mounted.get(kind) ?? 0) === 0);
  useLayoutEffect(() => {
    mounted.set(kind, (mounted.get(kind) ?? 0) + 1);
    return () => {
      mounted.set(kind, Math.max(0, (mounted.get(kind) ?? 1) - 1));
    };
  }, [kind]);
  return entrance;
}
