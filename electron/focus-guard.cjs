"use strict";

const koffi = require("koffi");

let winApi = null;

function loadWin() {
  if (winApi) return winApi;
  const user32 = koffi.load("user32.dll");
  winApi = {
    GetForegroundWindow: user32.func("void* GetForegroundWindow()")
  };
  return winApi;
}

function snapshotForeground() {
  if (process.platform !== "win32") return { kind: "none" };
  try {
    const hwnd = loadWin().GetForegroundWindow();
    const id = hwnd == null ? "" : String(hwnd);
    if (!id || id === "0" || id === "null") return { kind: "none" };
    return { kind: "hwnd", id };
  } catch (_) {
    return { kind: "none" };
  }
}

function matches(snap) {
  if (!snap || snap.kind !== "hwnd") return true;
  const now = snapshotForeground();
  if (now.kind !== "hwnd") return true;
  return now.id === snap.id;
}

module.exports = {
  snapshotForeground,
  matches,
  supported: process.platform === "win32"
};
