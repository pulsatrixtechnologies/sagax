// OS fullscreen for page and artifact windows (#2043).
import { useCallback, useEffect, useMemo, useState } from "react";

import { readOsFullscreenBridge, setOsFullscreen, subscribeOsFullscreen } from "@/lib/os-fullscreen";

/** Live OS fullscreen state and a click-time toggle (Electron setFullScreen
 * or the Fullscreen API). */
export function useOsFullscreen(): {
  fullscreen: boolean;
  set(on: boolean): void;
  toggle(): void;
} {
  const [fullscreen, setFullscreen] = useState(false);
  const deps = useMemo(() => ({
    bridge: typeof window !== "undefined" ? readOsFullscreenBridge(window.ogb) : null,
    document,
  }), []);

  useEffect(() => subscribeOsFullscreen(setFullscreen, deps), [deps]);

  const set = useCallback((on: boolean) => {
    void setOsFullscreen(on, deps);
  }, [deps]);

  const toggle = useCallback(() => {
    void setOsFullscreen(!fullscreen, deps);
  }, [deps, fullscreen]);

  return { fullscreen, set, toggle };
}
