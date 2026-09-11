const { app, BrowserWindow, ipcMain, screen, globalShortcut, systemPreferences } = require("electron");
const path = require("path");
const { AutoPlayer } = require("./auto-player.cjs");

const autoPlayer = new AutoPlayer();

let mainWindow = null;
let overlayWindow = null;

function overlayOptions() {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;
  return {
    width: 760,
    height: 200,
    minWidth: 420,
    minHeight: 148,
    x: Math.round((width - 760) / 2),
    y: 48,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

function loadPage(win, query = {}) {
  const file = path.join(__dirname, "..", "index.html");
  win.loadFile(file, { query });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 840,
    minWidth: 880,
    minHeight: 640,
    title: "口风琴模拟",
    backgroundColor: "#11161d",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  loadPage(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  });
}

function placeOverlayOnTop(win) {
  if (process.platform === "darwin") {
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setWindowButtonVisibility(false);
  } else {
    win.setAlwaysOnTop(true, "screen-saver");
  }
}

const INSTRUMENT_CODES = {
  KeyZ: "z",
  KeyX: "x",
  KeyC: "c",
  KeyV: "v",
  KeyB: "b",
  KeyN: "n",
  KeyM: "m",
  Comma: ","
};

function wireInstrumentKeys(win) {
  win.webContents.on("before-input-event", (event, input) => {
    if (win === overlayWindow && input.type === "keyDown" && (input.key === "Escape" || ((input.meta || input.control) && input.key.toLowerCase() === "w"))) {
      event.preventDefault();
      if (!win.isDestroyed()) win.close();
      return;
    }
    const key = INSTRUMENT_CODES[input.code];
    if (!key) return;
    event.preventDefault();
    if (input.isAutoRepeat && input.type === "keyDown") return;
    win.webContents.send("instrument-key", { key, type: input.type });
  });
}

function createOverlayWindow(options = {}) {
  const query = {
    coach: "1",
    song: options.song || "",
    mode: options.mode || "follow"
  };
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    loadPage(overlayWindow, query);
    overlayWindow.show();
    if (options.mode !== "autoplay") overlayWindow.focus();
    placeOverlayOnTop(overlayWindow);
    return overlayWindow;
  }
  overlayWindow = new BrowserWindow(overlayOptions());
  overlayWindow.setMinimumSize(420, 148);
  overlayWindow.setMenuBarVisibility(false);
  placeOverlayOnTop(overlayWindow);
  wireInstrumentKeys(overlayWindow);
  loadPage(overlayWindow, query);
  overlayWindow.once("ready-to-show", () => {
    if (options.mode !== "autoplay") overlayWindow.focus();
  });
  overlayWindow.on("closed", () => {
    overlayWindow = null;
    if (autoPlayer.isPlaying) stopAutoplay();
  });
  return overlayWindow;
}

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  stopAutoplay();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopAutoplay();
  globalShortcut.unregisterAll();
});

ipcMain.handle("open-overlay", (_event, options) => {
  createOverlayWindow(options || {});
  return true;
});

ipcMain.handle("close-overlay", () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  return true;
});

ipcMain.handle("overlay-bounds", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.getBounds() : null;
});

ipcMain.handle("set-overlay-bounds", (event, bounds) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !bounds) return false;
  win.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(420, Math.round(bounds.width)),
    height: Math.max(148, Math.round(bounds.height))
  });
  return true;
});

function broadcast(channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  }
}

function setOverlayClickThrough(on) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(Boolean(on), { forward: true });
  }
}

function stopAutoplay() {
  const done = autoPlayer.stop();
  globalShortcut.unregister("F8");
  setOverlayClickThrough(false);
  return done;
}

autoPlayer.onState = (state) => {
  broadcast("autoplay-state", state);
  if (state.phase === "ended" || state.phase === "stopped" || state.phase === "error") {
    globalShortcut.unregister("F8");
    setOverlayClickThrough(false);
  }
};

ipcMain.handle("autoplay-start", async (_event, payload) => {
  await autoPlayer.stop();
  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      return { ok: false, error: "请在系统设置 → 隐私与安全 → 辅助功能 中允许「口风琴模拟」或 Electron，然后重试" };
    }
  }
  const result = autoPlayer.start(payload?.events || [], {
    speed: payload?.speed,
    humanize: payload?.humanize !== false,
    npcSubmit: Boolean(payload?.npcSubmit),
    countdownMs: 3000
  });
  if (!result.ok) return result;
  globalShortcut.unregister("F8");
  globalShortcut.register("F8", () => {
    stopAutoplay();
    broadcast("autoplay-state", { phase: "stopped", playhead: 0 });
  });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  setOverlayClickThrough(true);
  return { ok: true };
});

ipcMain.handle("autoplay-stop", async () => {
  await stopAutoplay();
  return true;
});
