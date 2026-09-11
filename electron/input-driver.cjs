"use strict";

const koffi = require("koffi");

const KEY_SCAN = {
  z: 0x2c,
  x: 0x2d,
  c: 0x2e,
  v: 0x2f,
  b: 0x30,
  n: 0x31,
  m: 0x32,
  ",": 0x33,
  q: 0x10
};

const MAC_KEYCODE = {
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  n: 45,
  m: 46,
  ",": 43,
  q: 12
};

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const MOUSEEVENTF = {
  left: { down: 0x0002, up: 0x0004 },
  right: { down: 0x0008, up: 0x0010 },
  middle: { down: 0x0020, up: 0x0040 }
};

const kCGHIDEventTap = 0;
const kCGEventSourceStateHIDSystemState = 1;
const kCGEventLeftMouseDown = 1;
const kCGEventLeftMouseUp = 2;
const kCGEventRightMouseDown = 3;
const kCGEventRightMouseUp = 4;
const kCGEventOtherMouseDown = 25;
const kCGEventOtherMouseUp = 26;
const kCGMouseButtonLeft = 0;
const kCGMouseButtonRight = 1;
const kCGMouseButtonCenter = 2;

let winApi = null;
let macApi = null;

function loadWin() {
  if (winApi) return winApi;
  const user32 = koffi.load("user32.dll");
  const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
    dx: "long",
    dy: "long",
    mouseData: "uint32",
    dwFlags: "uint32",
    time: "uint32",
    dwExtraInfo: "uintptr"
  });
  const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
    wVk: "uint16",
    wScan: "uint16",
    dwFlags: "uint32",
    time: "uint32",
    dwExtraInfo: "uintptr"
  });
  const HARDWAREINPUT = koffi.struct("HARDWAREINPUT", {
    uMsg: "uint32",
    wParamL: "uint16",
    wParamH: "uint16"
  });
  const INPUTunion = koffi.union("INPUTunion", {
    mi: MOUSEINPUT,
    ki: KEYBDINPUT,
    hi: HARDWAREINPUT
  });
  const INPUT = koffi.struct("INPUT", {
    type: "uint32",
    u: INPUTunion
  });
  winApi = {
    INPUT,
    SendInput: user32.func("uint SendInput(uint, INPUT*, int)")
  };
  return winApi;
}

function loadMac() {
  if (macApi) return macApi;
  const cg = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
  const cf = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const CGPoint = koffi.struct("CGPoint", {
    x: "double",
    y: "double"
  });
  macApi = {
    CGPoint,
    CGEventSourceCreate: cg.func("void* CGEventSourceCreate(uint32)"),
    CGEventCreate: cg.func("void* CGEventCreate(void*)"),
    CGEventGetLocation: cg.func("CGPoint CGEventGetLocation(void*)"),
    CGEventCreateKeyboardEvent: cg.func("void* CGEventCreateKeyboardEvent(void*, uint16, bool)"),
    CGEventCreateMouseEvent: cg.func("void* CGEventCreateMouseEvent(void*, uint32, CGPoint, uint32)"),
    CGEventSetFlags: cg.func("void CGEventSetFlags(void*, uint64)"),
    CGEventPost: cg.func("void CGEventPost(uint32, void*)"),
    CFRelease: cf.func("void CFRelease(void*)")
  };
  return macApi;
}

function sendWinKey(key, up) {
  const scan = KEY_SCAN[String(key).toLowerCase()];
  if (scan == null) throw new Error(`不支持的按键: ${key}`);
  const api = loadWin();
  const input = {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: 0,
        wScan: scan,
        dwFlags: KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0),
        time: 0,
        dwExtraInfo: 0
      }
    }
  };
  const sent = api.SendInput(1, [input], koffi.sizeof(api.INPUT));
  if (sent !== 1) throw new Error(`SendInput 键盘失败: ${key}`);
}

function sendWinMouse(button, up) {
  const flags = MOUSEEVENTF[button];
  if (!flags) throw new Error(`未知鼠标键: ${button}`);
  const api = loadWin();
  const input = {
    type: INPUT_MOUSE,
    u: {
      mi: {
        dx: 0,
        dy: 0,
        mouseData: 0,
        dwFlags: up ? flags.up : flags.down,
        time: 0,
        dwExtraInfo: 0
      }
    }
  };
  const sent = api.SendInput(1, [input], koffi.sizeof(api.INPUT));
  if (sent !== 1) throw new Error(`SendInput 鼠标失败: ${button}`);
}

function postMac(event) {
  const api = loadMac();
  try {
    api.CGEventSetFlags(event, 0);
  } catch (_) {}
  api.CGEventPost(kCGHIDEventTap, event);
  api.CFRelease(event);
}

function sendMacKey(key, up) {
  const code = MAC_KEYCODE[String(key).toLowerCase()];
  if (code == null) throw new Error(`不支持的按键: ${key}`);
  const api = loadMac();
  const source = api.CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  const event = api.CGEventCreateKeyboardEvent(source, code, !up);
  postMac(event);
  if (source) api.CFRelease(source);
}

function sendMacMouse(button, up) {
  const api = loadMac();
  const types = {
    left: [kCGEventLeftMouseDown, kCGEventLeftMouseUp, kCGMouseButtonLeft],
    right: [kCGEventRightMouseDown, kCGEventRightMouseUp, kCGMouseButtonRight],
    middle: [kCGEventOtherMouseDown, kCGEventOtherMouseUp, kCGMouseButtonCenter]
  };
  const spec = types[button];
  if (!spec) throw new Error(`未知鼠标键: ${button}`);
  const probe = api.CGEventCreate(null);
  const loc = api.CGEventGetLocation(probe);
  api.CFRelease(probe);
  const source = api.CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  const event = api.CGEventCreateMouseEvent(source, up ? spec[1] : spec[0], loc, spec[2]);
  postMac(event);
  if (source) api.CFRelease(source);
}

function pressKey(key) {
  if (process.platform === "win32") sendWinKey(key, false);
  else if (process.platform === "darwin") sendMacKey(key, false);
  else throw new Error("代按目前只支持 macOS 和 Windows");
}

function releaseKey(key) {
  if (process.platform === "win32") sendWinKey(key, true);
  else if (process.platform === "darwin") sendMacKey(key, true);
  else throw new Error("代按目前只支持 macOS 和 Windows");
}

function pressMouse(button) {
  if (process.platform === "win32") sendWinMouse(button, false);
  else if (process.platform === "darwin") sendMacMouse(button, false);
  else throw new Error("代按目前只支持 macOS 和 Windows");
}

function releaseMouse(button) {
  if (process.platform === "win32") sendWinMouse(button, true);
  else if (process.platform === "darwin") sendMacMouse(button, true);
  else throw new Error("代按目前只支持 macOS 和 Windows");
}

function panicRelease(keys = [], mouseButtons = []) {
  for (const key of keys) {
    try {
      if (key) releaseKey(key);
    } catch (_) {}
  }
  for (const button of mouseButtons) {
    try {
      if (button) releaseMouse(button);
    } catch (_) {}
  }
}

function dispatch(event) {
  if (event.device === "kb") {
    if (event.action === "down") pressKey(event.key);
    else releaseKey(event.key);
    return;
  }
  if (event.action === "down") pressMouse(event.key);
  else releaseMouse(event.key);
}

module.exports = { dispatch, panicRelease, pressKey, releaseKey };
