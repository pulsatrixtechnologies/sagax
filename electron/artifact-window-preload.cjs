// Preload for an artifact or page window (electron/artifact-window.mjs).
// Sandboxed and context-isolated: the page sees only this narrow surface to
// read and toggle always-on-top for its own window (#2046) and OS fullscreen
// for its own BrowserWindow (#2043). It holds no token and reaches no file,
// no network and no other window. Main answers only for the BrowserWindow
// that loaded this preload.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("artifactWindowSelf", {
  isAlwaysOnTop: () => ipcRenderer.invoke("artifact-window:get-top"),
  setAlwaysOnTop: (on) => ipcRenderer.invoke("artifact-window:set-top", { on: on === true }),
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
