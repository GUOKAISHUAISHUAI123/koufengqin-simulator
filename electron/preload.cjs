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
  setPracticeCapture: (on) => ipcRenderer.invoke("practice-capture", on),
  reportPracticeState: (state) => ipcRenderer.send("practice-state", state),
  onPracticeState: (callback) => {
    ipcRenderer.on("practice-state", (_event, data) => callback(data));
  },
  overlayCommand: (cmd) => ipcRenderer.invoke("overlay-command", cmd),
  onOverlayCommand: (callback) => {
    ipcRenderer.on("overlay-command", (_event, data) => callback(data));
  },
  onOverlayMode: (callback) => {
    ipcRenderer.on("overlay-mode", (_event, data) => callback(data));
  },
  startAutoplay: (payload) => ipcRenderer.invoke("autoplay-start", payload),
  pauseAutoplay: () => ipcRenderer.invoke("autoplay-pause"),
  resumeAutoplay: () => ipcRenderer.invoke("autoplay-resume"),
  stopAutoplay: () => ipcRenderer.invoke("autoplay-stop"),
  autoplayStatus: () => ipcRenderer.invoke("autoplay-status"),
  onAutoplayState: (callback) => {
    ipcRenderer.on("autoplay-state", (_event, data) => callback(data));
  },
  saveImportedSongs: (songs) => ipcRenderer.invoke("save-imported-songs", songs),
  saveImportedSongsSync: (songs) => ipcRenderer.sendSync("save-imported-songs-sync", songs),
  readImportedSongs: () => ipcRenderer.invoke("read-imported-songs"),
  readImportedSongsSync: () => ipcRenderer.sendSync("read-imported-songs-sync"),
  onImportedSongsChanged: (callback) => {
    ipcRenderer.on("imported-songs-changed", () => callback());
  },
  onOverlaySong: (callback) => {
    ipcRenderer.on("overlay-song", (_event, songId) => callback(songId));
  }
});
