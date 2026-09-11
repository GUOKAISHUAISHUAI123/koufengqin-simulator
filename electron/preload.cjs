const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("koufengqin", {
  isApp: true,
  openOverlay: (options) => ipcRenderer.invoke("open-overlay", options),
  closeOverlay: () => ipcRenderer.invoke("close-overlay"),
  overlayBounds: () => ipcRenderer.invoke("overlay-bounds"),
  setOverlayBounds: (bounds) => ipcRenderer.invoke("set-overlay-bounds", bounds),
  onInstrumentKey: (callback) => {
    ipcRenderer.on("instrument-key", (_event, data) => callback(data));
  },
  startAutoplay: (payload) => ipcRenderer.invoke("autoplay-start", payload),
  stopAutoplay: () => ipcRenderer.invoke("autoplay-stop"),
  onAutoplayState: (callback) => {
    ipcRenderer.on("autoplay-state", (_event, data) => callback(data));
  }
});

