// Preload for an artifact or page window (electron/artifact-window.mjs).
// Sandboxed and context-isolated: the page sees only this narrow surface to
// read and toggle always-on-top for its own window (#2046), OS fullscreen
// for its own BrowserWindow (#2043), and fit-to-content for a page window
// (#2051). It holds no token and reaches no file, no network and no other
// window. Main answers only for the BrowserWindow that loaded this preload.
const { contextBridge, ipcRenderer } = require("electron");

const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

contextBridge.exposeInMainWorld("artifactWindowSelf", {
  isAlwaysOnTop: () => ipcRenderer.invoke("artifact-window:get-top"),
  setAlwaysOnTop: (on) => ipcRenderer.invoke("artifact-window:set-top", { on: on === true }),
  // The cursor entered (true) or left (false) this window: its content frame
  // swallows pointer events, so main watches the cursor (#2336).
  onPointer: (cb) => {
    const handler = (_event, inside) => cb(inside === true);
    ipcRenderer.on("artifact-window:pointer", handler);
    return () => ipcRenderer.removeListener("artifact-window:pointer", handler);
  },
  fitContent: (size) => ipcRenderer.invoke("artifact-window:fit-content", {
    width: finite(size && size.width),
    height: finite(size && size.height),
  }),
});

contextBridge.exposeInMainWorld("ogb", {
  windowFullscreen: {
    set: (on) => ipcRenderer.invoke("window:set-fullscreen", on === true),
    state: () => ipcRenderer.invoke("window:fullscreen-state"),
    onChanged: (cb) => {
      const handler = (_event, fullscreen) => cb(fullscreen === true);
      ipcRenderer.on("window:fullscreen-changed", handler);
      return () => ipcRenderer.removeListener("window:fullscreen-changed", handler);
    },
  },
});
