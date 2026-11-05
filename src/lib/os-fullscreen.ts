// OS fullscreen for a page or artifact window (#2043): prefer Electron
// BrowserWindow.setFullScreen through the preload bridge; in a browser build
// use the Fullscreen API on documentElement. The label follows the real
// window state (enter/leave-full-screen or fullscreenchange).

export type OsFullscreenBridge = {
  set(on: boolean): Promise<boolean>;
  state(): Promise<{ fullscreen: boolean }>;
  onChanged(cb: (fullscreen: boolean) => void): () => void;
};

/** The narrow bridge main and artifact-window preloads expose, or null. */
export function readOsFullscreenBridge(ogb: unknown): OsFullscreenBridge | null {
  if (!ogb || typeof ogb !== "object") return null;
  const bridge = (ogb as { windowFullscreen?: unknown }).windowFullscreen;
  if (!bridge || typeof bridge !== "object") return null;
  const { set, state, onChanged } = bridge as Record<string, unknown>;
  if (typeof set !== "function" || typeof state !== "function" || typeof onChanged !== "function") return null;
  return bridge as OsFullscreenBridge;
}

export type OsFullscreenDocument = {
  fullscreenElement: Element | null;
  exitFullscreen?: () => Promise<void>;
  documentElement: { requestFullscreen?: () => Promise<void> };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type OsFullscreenDeps = {
  bridge: OsFullscreenBridge | null;
  document: OsFullscreenDocument;
};

/** Enter or leave OS fullscreen. Electron uses setFullScreen; a browser uses
 * the Fullscreen API. Call from a click so the gesture stays live. */
export async function setOsFullscreen(on: boolean, deps: OsFullscreenDeps): Promise<void> {
  if (deps.bridge) {
    await deps.bridge.set(on);
    return;
  }
  const root = deps.document.documentElement;
  if (on) {
    if (!deps.document.fullscreenElement && typeof root.requestFullscreen === "function") {
      await Promise.resolve(root.requestFullscreen()).catch(() => {});
    }
    return;
  }
  if (deps.document.fullscreenElement && typeof deps.document.exitFullscreen === "function") {
    await Promise.resolve(deps.document.exitFullscreen()).catch(() => {});
  }
}

/** Subscribe to the real fullscreen state. Returns the unsubscribe function. */
export function subscribeOsFullscreen(listener: (fullscreen: boolean) => void, deps: OsFullscreenDeps): () => void {
  if (deps.bridge) {
    let live = true;
    void deps.bridge.state().then((answer) => {
      if (live) listener(Boolean(answer?.fullscreen));
    }).catch(() => {});
    const stop = deps.bridge.onChanged((fullscreen) => listener(Boolean(fullscreen)));
    return () => {
      live = false;
      stop();
    };
  }
  const sync = () => listener(Boolean(deps.document.fullscreenElement));
  sync();
  deps.document.addEventListener("fullscreenchange", sync);
  return () => deps.document.removeEventListener("fullscreenchange", sync);
}
