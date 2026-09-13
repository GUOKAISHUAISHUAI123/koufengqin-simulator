const { app, BrowserWindow, ipcMain, Menu, screen, globalShortcut, systemPreferences } = require("electron");
const fs = require("fs");
const path = require("path");
const { AutoPlayer } = require("./auto-player.cjs");
const inputDriver = require("./input-driver.cjs");

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-gpu-sandbox");
if (process.platform === "win32") {
  app.commandLine.appendSwitch("no-sandbox");
}

function copyFileIfMissing(src, dest) {
  if (!src || !dest || !fs.existsSync(src) || fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function pinStableUserData() {
  try {
    const stable = path.join(app.getPath("appData"), "koufengqin-simulator");
    fs.mkdirSync(stable, { recursive: true });
    const dest = path.join(stable, "imported-songs.js");
    for (const name of ["koufengqin-simulator", "口琴模拟器"]) {
      copyFileIfMissing(path.join(app.getPath("appData"), name, "imported-songs.js"), dest);
    }
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
      copyFileIfMissing(path.join(portableDir, "koufengqin-data", "imported-songs.js"), dest);
    }
    app.setPath("userData", stable);
  } catch (error) {
    console.error("pin userData failed", error);
  }
}

pinStableUserData();

const autoPlayer = new AutoPlayer();

let mainWindow = null;
let overlayWindow = null;
let overlaySongId = "";
let focusTimer = null;
let hudTimer = null;

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
      sandbox: true,
      partition: "persist:koufengqin"
    }
  };
}

function appIcon() {
  const ico = path.join(__dirname, "..", "build", "icon.ico");
  const png = path.join(__dirname, "..", "build", "icon.png");
  if (process.platform === "win32" && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return undefined;
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
    title: "口琴模拟器 v1.1.0",
    icon: appIcon(),
    backgroundColor: "#11161d",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:koufengqin"
    }
  });
  mainWindow.setMenuBarVisibility(false);
  const showMain = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  };
  mainWindow.once("ready-to-show", showMain);
  mainWindow.webContents.once("did-finish-load", showMain);
  mainWindow.webContents.once("did-fail-load", (_e, code, desc) => {
    console.error("main window failed to load", code, desc);
    showMain();
  });
  loadPage(mainWindow);
  setTimeout(showMain, 1500);
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

const PRACTICE_KEYS = [
  { accel: "Z", key: "z" },
  { accel: "X", key: "x" },
  { accel: "C", key: "c" },
  { accel: "V", key: "v" },
  { accel: "B", key: "b" },
  { accel: "N", key: "n" },
  { accel: "M", key: "m" },
  { accel: ",", key: "," }
];

const practiceHeld = Object.create(null);
let practicePoll = null;

function sendInstrumentKey(type, key) {
  const payload = { key, type };
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("instrument-key", payload);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("instrument-key", payload);
  }
}

function clearPracticeHotkeys() {
  for (const item of PRACTICE_KEYS) {
    try {
      globalShortcut.unregister(item.accel);
    } catch (_) {}
  }
  if (practicePoll) {
    clearInterval(practicePoll);
    practicePoll = null;
  }
  for (const item of PRACTICE_KEYS) {
    if (!practiceHeld[item.key]) continue;
    practiceHeld[item.key] = false;
    sendInstrumentKey("keyUp", item.key);
  }
}

function wirePracticeHotkeys() {
  clearPracticeHotkeys();
  for (const item of PRACTICE_KEYS) {
    globalShortcut.register(item.accel, () => {
      if (practiceHeld[item.key]) return;
      practiceHeld[item.key] = true;
      sendInstrumentKey("keyDown", item.key);
    });
  }
  practicePoll = setInterval(() => {
    for (const item of PRACTICE_KEYS) {
      if (!practiceHeld[item.key]) continue;
      let down = false;
      try {
        down = inputDriver.isKeyDown(item.key);
      } catch (_) {
        down = false;
      }
      if (!down) {
        practiceHeld[item.key] = false;
        sendInstrumentKey("keyUp", item.key);
      }
    }
  }, 20);
}

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

function waitForLoad(win) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) {
      resolve();
      return;
    }
    if (!win.webContents.isLoading()) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      win.webContents.removeListener("did-finish-load", done);
      resolve();
    };
    const timer = setTimeout(done, 4000);
    win.webContents.once("did-finish-load", done);
  });
}

function createOverlayWindow(options = {}) {
  const query = {
    coach: "1",
    song: options.song || "",
    mode: options.mode === "autoplay" ? "autoplay" : "practice"
  };
  if (options.start) query.start = "1";
  const shouldFocus = options.mode !== "autoplay" && options.focus !== false && !options.start;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (query.song && overlaySongId !== query.song) {
      overlaySongId = query.song;
      overlayWindow.webContents.send("overlay-song", query.song);
    }
    overlayWindow.webContents.send("overlay-mode", {
      mode: query.mode,
      start: Boolean(options.start)
    });
    overlayWindow.show();
    if (shouldFocus) overlayWindow.focus();
    placeOverlayOnTop(overlayWindow);
    overlayWindow.webContents.setBackgroundThrottling(false);
    return overlayWindow;
  }
  overlayWindow = new BrowserWindow(overlayOptions());
  overlayWindow.setMinimumSize(420, 148);
  overlayWindow.setMenuBarVisibility(false);
  overlayWindow.webContents.setBackgroundThrottling(false);
  placeOverlayOnTop(overlayWindow);
  wireInstrumentKeys(overlayWindow);
  overlaySongId = query.song;
  loadPage(overlayWindow, query);
  overlayWindow.once("ready-to-show", () => {
    if (shouldFocus) overlayWindow.focus();
  });
  overlayWindow.on("closed", () => {
    overlayWindow = null;
    overlaySongId = "";
    clearPracticeHotkeys();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("practice-state", { practicing: false });
    }
    if (!autoPlayer.isActive) restoreMain();
  });
  return overlayWindow;
}

function restoreMain() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()) {
    mainWindow.restore();
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  if (!gotTheLock) return;
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  seedUserLibrary();
  createMainWindow();
  watchImportedSongs();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  abortAutoplay();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  abortAutoplay();
  clearPracticeHotkeys();
  globalShortcut.unregisterAll();
});

ipcMain.handle("open-overlay", async (_event, options) => {
  const win = createOverlayWindow(options || {});
  await waitForLoad(win);
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
    overlayWindow.webContents.setBackgroundThrottling(false);
    overlayWindow.setIgnoreMouseEvents(Boolean(on), { forward: true });
  }
}

function stopHudPump() {
  if (hudTimer) {
    clearInterval(hudTimer);
    hudTimer = null;
  }
}

function startHudPump() {
  if (hudTimer) return;
  hudTimer = setInterval(() => {
    if (autoPlayer.stopped || autoPlayer.paused) return;
    broadcast("autoplay-state", autoPlayer.snapshot());
  }, 50);
}

function stopFocusWatch() {
  if (focusTimer) {
    clearInterval(focusTimer);
    focusTimer = null;
  }
}

let focusResumeIgnoreUntil = 0;

function startFocusWatch() {
  // 游戏全屏、反作弊浮层、升降八度的鼠标键都会改前台窗口。
  // 代按只由 / 暂停、F9 停止，不再因焦点变化自动停。
}

const autoplayKeyHeld = Object.create(null);
let autoplayKeyPoll = null;
let autoplayActionAt = 0;

function stopAutoplayKeyPoll() {
  if (autoplayKeyPoll) {
    clearInterval(autoplayKeyPoll);
    autoplayKeyPoll = null;
  }
  for (const key of Object.keys(autoplayKeyHeld)) autoplayKeyHeld[key] = false;
}

function clearHotkeys() {
  stopAutoplayKeyPoll();
}

function consumeAutoplayAction(action) {
  const now = Date.now();
  if (now - autoplayActionAt < 450) return false;
  autoplayActionAt = now;
  if (action === "stop") {
    abortAutoplay();
    return true;
  }
  if (autoPlayer.isPaused) resumeAutoplay();
  else if (autoPlayer.isPlaying || autoPlayer.isActive) pauseAutoplay();
  return true;
}

function abortAutoplay() {
  stopFocusWatch();
  stopHudPump();
  clearHotkeys();
  setOverlayClickThrough(false);
  return autoPlayer.stop();
}

function pauseAutoplay() {
  const ok = autoPlayer.pause();
  if (!ok) return false;
  return true;
}

function resumeAutoplay() {
  const ok = autoPlayer.resume();
  if (!ok) return false;
  focusResumeIgnoreUntil = Date.now() + 1200;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  setOverlayClickThrough(true);
  return true;
}

function wireAutoplayHotkeys() {
  clearHotkeys();
  autoplayKeyPoll = setInterval(() => {
    if (!autoPlayer.isActive) return;
    let f8 = false;
    let f9 = false;
    let slash = false;
    try {
      f8 = inputDriver.isKeyDown("f8");
      f9 = inputDriver.isKeyDown("f9");
      slash = inputDriver.isKeyDown("/") || inputDriver.isKeyDown("?");
    } catch (_) {}
    if ((f8 && !autoplayKeyHeld.f8) || (f9 && !autoplayKeyHeld.f9)) consumeAutoplayAction("stop");
    else if (slash && !autoplayKeyHeld.slash) consumeAutoplayAction("pause");
    autoplayKeyHeld.f8 = f8;
    autoplayKeyHeld.f9 = f9;
    autoplayKeyHeld.slash = slash;
  }, 40);
}

autoPlayer.onArmed = () => {
  startFocusWatch();
  startHudPump();
};

autoPlayer.onState = (state) => {
  broadcast("autoplay-state", state);
  if (state.phase === "ended" || state.phase === "stopped" || state.phase === "error") {
    stopFocusWatch();
    stopHudPump();
    clearHotkeys();
    setOverlayClickThrough(false);
    restoreMain();
  }
};

ipcMain.handle("practice-capture", (_event, on) => {
  if (on) wirePracticeHotkeys();
  else clearPracticeHotkeys();
  return true;
});

ipcMain.on("practice-state", (_event, state) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("practice-state", state);
  }
});

ipcMain.handle("overlay-command", (_event, cmd) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay-command", cmd);
  }
  return true;
});

ipcMain.handle("autoplay-start", async (_event, payload) => {
  clearPracticeHotkeys();
  await autoPlayer.stop();
  stopFocusWatch();
  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      return { ok: false, error: "请在系统设置 → 隐私与安全 → 辅助功能 中允许「口风琴模拟」或 Electron，然后重试" };
    }
  }
  const result = autoPlayer.start(payload?.events || [], {
    speed: payload?.speed,
    humanize: false,
    scenario: "npc",
    songId: payload?.songId,
    npcSubmit: true,
    latencyMs: payload?.latencyMs,
    countdownMs: 3000
  });
  if (payload?.songId && overlayWindow && !overlayWindow.isDestroyed()) {
    overlaySongId = String(payload.songId);
    overlayWindow.webContents.send("overlay-song", overlaySongId);
  }
  if (!result.ok) return result;
  wireAutoplayHotkeys();
  startHudPump();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  setOverlayClickThrough(true);
  return { ok: true, scenario: "npc" };
});

ipcMain.handle("autoplay-pause", () => pauseAutoplay());
ipcMain.handle("autoplay-resume", () => resumeAutoplay());
ipcMain.handle("autoplay-stop", async () => {
  await abortAutoplay();
  restoreMain();
  return true;
});

ipcMain.handle("autoplay-status", () => autoPlayer.snapshot());

function bundledLibraryFile() {
  return path.join(app.getAppPath(), "library", "imported-songs.js");
}

function portableLibraryFile() {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!dir) return "";
  return path.join(dir, "koufengqin-data", "imported-songs.js");
}

function legacyLibraryFile() {
  return path.join(app.getPath("appData"), "口琴模拟器", "imported-songs.js");
}

function libraryJsonFile() {
  return path.join(app.getPath("userData"), "library.json");
}

function importedSongsFile() {
  if (app.isPackaged) return path.join(app.getPath("userData"), "imported-songs.js");
  return path.join(__dirname, "..", "library", "imported-songs.js");
}

function seedUserLibrary() {
  if (!app.isPackaged) return;
  const dest = importedSongsFile();
  if (fs.existsSync(dest)) return;
  const portable = portableLibraryFile();
  const src = [portable, legacyLibraryFile(), bundledLibraryFile()].find((file) => file && fs.existsSync(file));
  if (!src) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function sanitizeImportedSongs(songs) {
  if (!Array.isArray(songs)) throw new Error("曲库必须是数组");
  if (songs.length > 400) throw new Error("曲库太多，拒绝写入");
  return songs
    .filter((song) => song && typeof song === "object" && song.id)
    .map((song) => {
      const events = Array.isArray(song.events) ? song.events : [];
      return {
        id: String(song.id),
        title: String(song.title || "未命名曲目"),
        source: String(song.source || ""),
        createdAt: String(song.createdAt || ""),
        events: events.slice(0, 20000).map((event) => ({
          t: Number(event.t) || 0,
          d: Number(event.d) || 0.2,
          key: String(event.key || "").toLowerCase(),
          note: String(event.note || ""),
          mouse: Array.isArray(event.mouse)
            ? event.mouse.filter((item) => item === "left" || item === "middle" || item === "right")
            : []
        }))
      };
    });
}

let writingImported = false;
let importedWatchTimer = null;

function parseLibraryText(text) {
  const match = String(text || "").match(/window\.koufengqinImportedSongs\s*=\s*(\[[\s\S]*\])\s*;/);
  if (match) return JSON.parse(match[1]);
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.library)) return data.library;
  throw new Error("无法解析项目曲库");
}

function parseImportedSongsFile() {
  const candidates = [
    importedSongsFile(),
    libraryJsonFile(),
    portableLibraryFile(),
    legacyLibraryFile(),
    bundledLibraryFile()
  ].filter(Boolean);
  let lastError = null;
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      return parseLibraryText(fs.readFileSync(file, "utf8"));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("读项目曲库失败");
}

function writeLibraryFile(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.copyFileSync(tmp, file);
  try {
    fs.unlinkSync(tmp);
  } catch (_) {}
}

function writeImportedSongs(songs, event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { ok: false, error: "只能从主窗口保存" };
  }
  try {
    const clean = sanitizeImportedSongs(songs);
    const file = importedSongsFile();
    const body = `window.koufengqinImportedSongs = ${JSON.stringify(clean)};\n`;
    writingImported = true;
    writeLibraryFile(file, body);
    writeLibraryFile(libraryJsonFile(), JSON.stringify({ app: "口风琴模拟", version: 1, library: clean }));
    const portable = portableLibraryFile();
    if (portable) writeLibraryFile(portable, body);
    setTimeout(() => {
      writingImported = false;
    }, 800);
    return { ok: true, count: clean.length, file };
  } catch (error) {
    writingImported = false;
    return { ok: false, error: error.message };
  }
}

function watchImportedSongs() {
  const file = importedSongsFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.watch(path.dirname(file), (_type, name) => {
      if (!name || !String(name).includes("imported-songs")) return;
      if (writingImported) return;
      clearTimeout(importedWatchTimer);
      importedWatchTimer = setTimeout(() => {
        if (writingImported || !mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("imported-songs-changed");
      }, 250);
    });
  } catch (_) {}
}

ipcMain.handle("save-imported-songs", (event, songs) => writeImportedSongs(songs, event));
ipcMain.on("save-imported-songs-sync", (event, songs) => {
  event.returnValue = writeImportedSongs(songs, event);
});
ipcMain.handle("read-imported-songs", () => {
  try {
    return parseImportedSongsFile();
  } catch (error) {
    throw new Error(error.message || "读项目曲库失败");
  }
});
ipcMain.on("read-imported-songs-sync", (event) => {
  try {
    event.returnValue = parseImportedSongsFile();
  } catch (error) {
    event.returnValue = { error: error.message || "读项目曲库失败" };
  }
});
