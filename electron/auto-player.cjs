"use strict";

const driver = require("./input-driver.cjs");

const SETTLE_MS = 55;
const RELEASE_MS = 30;
const COUNTDOWN_MS = 3000;
const NPC_PACE = 1.15;
const MIN_HOLD_MS = 130;
const MIN_GAP_MS = 25;
const SAME_KEY_GAP_MS = 45;
const MIN_SEND_GAP_MS = 10;

const HUMANIZE = {
  jitterMs: 12,
  breathMs: 25,
  leapMs: 5,
  minGapMs: MIN_GAP_MS,
  shortHold: [0.72, 0.86],
  midHold: [0.78, 0.92],
  longHold: [0.86, 0.98]
};

function pickButton(mouse) {
  const list = Array.isArray(mouse) ? mouse : [];
  const left = list.includes("left");
  const right = list.includes("right");
  const middle = list.includes("middle");
  if (left) return "left";
  if (right) return "right";
  if (middle) return "middle";
  return null;
}

function gaussian(sigma) {
  if (!sigma) return 0;
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

function holdRatio(duration) {
  const pick = (range) => range[0] + Math.random() * (range[1] - range[0]);
  if (duration <= 0.25) return pick(HUMANIZE.shortHold);
  if (duration >= 0.8) return pick(HUMANIZE.longHold);
  return pick(HUMANIZE.midHold);
}

function pitchValue(event) {
  const order = "zxcvbnm";
  let value = order.indexOf(String(event.key).toLowerCase());
  if (value < 0 && event.key === ",") value = 7;
  if (value < 0) return 7;
  if ((event.mouse || []).includes("left")) value -= 7;
  if ((event.mouse || []).includes("right") || event.key === ",") value += 7;
  return value;
}

function compileScore(scoreEvents, options = {}) {
  const scenario = options.scenario === "npc" ? "npc" : "free";
  const npc = scenario === "npc";
  const speed = Math.max(0.25, Number(options.speed) || 1);
  const pace = npc ? NPC_PACE : 1;
  const humanize = npc ? false : options.humanize !== false;
  const latency = Math.max(0, Number(options.latencyMs) || 0);
  const npcSubmit = npc || Boolean(options.npcSubmit);
  const events = [];
  let cursor = 0;
  let held = null;
  let prevPitch = null;
  let prevEnd = 0;
  let prevDur = 0;
  let prevKey = null;
  let prevKeyUp = 0;

  for (let i = 0; i < scoreEvents.length; i += 1) {
    const item = scoreEvents[i];
    const durMs = (Math.max(0.06, Number(item.d) || 0.2) / speed) * 1000 * pace;
    const ideal = (Math.max(0, Number(item.t) || 0) / speed) * 1000 * pace;
    let button = pickButton(item.mouse);
    let key = String(item.key || "z").toLowerCase();
    if (key === "," || (key === "z" && button === "right")) {
      key = ",";
      button = null;
    }

    let t = Math.max(ideal, cursor);
    if (prevKey === key) t = Math.max(t, prevKeyUp + SAME_KEY_GAP_MS);
    if (humanize) {
      t += gaussian(HUMANIZE.jitterMs);
      const gap = ideal - prevEnd;
      if (gap > 140) t += HUMANIZE.breathMs;
      else if (prevDur >= 0.8) t += HUMANIZE.breathMs;
      if (prevPitch != null && Math.abs(pitchValue(item) - prevPitch) >= 4) {
        t += HUMANIZE.leapMs;
      }
      t = Math.max(t, cursor + HUMANIZE.minGapMs);
      if (prevKey === key) t = Math.max(t, prevKeyUp + SAME_KEY_GAP_MS);
    }

    if (button && button !== held) {
      if (held) {
        events.push({ tMs: t, device: "mouse", key: held, action: "up" });
        t += RELEASE_MS;
      }
      events.push({ tMs: t, device: "mouse", key: button, action: "down" });
      t += SETTLE_MS;
      held = button;
    }

    const ratio = humanize ? holdRatio(item.d) : 0.88;
    const hold = Math.min(3000, Math.max(MIN_HOLD_MS, durMs * ratio));
    events.push({ tMs: t, device: "kb", key, action: "down", scoreT: Number(item.t) || 0 });
    const tUp = t + hold;
    events.push({ tMs: tUp, device: "kb", key, action: "up", scoreT: Number(item.t) || 0 });

    let releaseEnd = tUp;
    const next = scoreEvents[i + 1];
    let nextButton = next ? pickButton(next.mouse) : null;
    if (next && (String(next.key) === "," || (String(next.key).toLowerCase() === "z" && nextButton === "right"))) {
      nextButton = null;
    }
    if (held && held !== nextButton) {
      releaseEnd = tUp + RELEASE_MS;
      events.push({ tMs: releaseEnd, device: "mouse", key: held, action: "up" });
      held = null;
    }

    cursor = Math.max(ideal + durMs, releaseEnd + HUMANIZE.minGapMs);
    prevEnd = cursor;
    prevDur = Number(item.d) || 0;
    prevPitch = pitchValue(item);
    prevKey = key;
    prevKeyUp = tUp;
  }

  if (held) events.push({ tMs: cursor, device: "mouse", key: held, action: "up" });
  if (npcSubmit) {
    const qAt = (events.at(-1)?.tMs || cursor) + 280;
    events.push({ tMs: qAt, device: "kb", key: "q", action: "down" });
    events.push({ tMs: qAt + 80, device: "kb", key: "q", action: "up" });
  }

  events.sort((a, b) => a.tMs - b.tMs || (a.action === "up" ? -1 : 1));
  if (latency) {
    for (const event of events) event.tMs = Math.max(0, event.tMs - latency);
  }
  return events;
}

function requiredDispatchGap(prev, next) {
  if (!prev || !next) return 0;
  if (prev.device === "mouse" && prev.action === "down" && next.device === "kb" && next.action === "down") {
    return SETTLE_MS;
  }
  if (prev.device === "kb" && prev.action === "down" && next.device === "kb" && next.action === "up" && prev.key === next.key) {
    return MIN_HOLD_MS;
  }
  if (prev.device === "kb" && prev.action === "up" && next.device === "kb" && next.action === "down") {
    return prev.key === next.key ? SAME_KEY_GAP_MS : MIN_GAP_MS;
  }
  if (prev.action === "up" && next.action === "down") return RELEASE_MS;
  return MIN_SEND_GAP_MS;
}

class AutoPlayer {
  constructor() {
    this.stopped = true;
    this.paused = false;
    this.timer = null;
    this.waitResolve = null;
    this.busy = null;
    this.scenario = "free";
    this.speed = 1;
    this.pace = 1;
    this.events = [];
    this.index = 0;
    this.t0 = 0;
    this.elapsedOffset = 0;
    this.countdownUntil = 0;
    this.heldKeys = new Set();
    this.heldMouse = new Set();
    this.songId = "";
    this.onState = () => {};
    this.onArmed = () => {};
  }

  get isPlaying() {
    return !this.stopped && !this.paused && Boolean(this.busy);
  }

  get isActive() {
    return !this.stopped && Boolean(this.busy);
  }

  get isPaused() {
    return this.paused && this.isActive;
  }

  scorePlayhead(elapsedMs = this.elapsedOffset) {
    const ms = Number(elapsedMs) || 0;
    return Math.max(0, (ms / 1000) * (this.speed / this.pace));
  }

  snapshot() {
    const songId = this.songId || "";
    if (this.stopped) {
      return { phase: this.busy ? "stopped" : "idle", playhead: 0, scenario: this.scenario, speed: this.speed, pace: this.pace, songId };
    }
    if (!this.t0) {
      return {
        phase: "countdown",
        playhead: 0,
        remainingMs: Math.max(0, this.countdownUntil - Date.now()),
        countdownUntil: this.countdownUntil,
        scenario: this.scenario,
        speed: this.speed,
        pace: this.pace,
        songId
      };
    }
    if (this.paused) {
      return {
        phase: "paused",
        playhead: this.scorePlayhead(this.elapsedOffset),
        elapsedMs: this.elapsedOffset,
        t0: Date.now() - this.elapsedOffset,
        scenario: this.scenario,
        speed: this.speed,
        pace: this.pace,
        songId
      };
    }
    const elapsedMs = Math.max(0, Date.now() - this.t0);
    return {
      phase: "playing",
      playhead: this.scorePlayhead(elapsedMs),
      elapsedMs,
      t0: this.t0,
      remainingMs: Math.max(0, (this.events.at(-1)?.tMs || 0) - elapsedMs),
      scenario: this.scenario,
      speed: this.speed,
      pace: this.pace,
      songId
    };
  }

  start(scoreEvents, options = {}) {
    if (this.isActive) return { ok: false, error: "正在代按" };
    const compiled = compileScore(scoreEvents, options);
    if (!compiled.length) return { ok: false, error: "谱面为空" };
    this.stopped = false;
    this.paused = false;
    this.t0 = 0;
    this.elapsedOffset = 0;
    this.scenario = options.scenario === "npc" ? "npc" : "free";
    this.songId = String(options.songId || "");
    this.speed = Math.max(0.25, Number(options.speed) || 1);
    this.pace = this.scenario === "npc" ? NPC_PACE : 1;
    this.events = compiled;
    this.index = 0;
    this.heldKeys.clear();
    this.heldMouse.clear();
    const countdown = options.countdownMs ?? COUNTDOWN_MS;
    this.busy = this.run(compiled, countdown)
      .catch((error) => {
        this.onState({ phase: "error", error: error.message || String(error), scenario: this.scenario });
      })
      .finally(() => {
        this.busy = null;
      });
    return { ok: true, scenario: this.scenario };
  }

  pause() {
    if (this.stopped || this.paused || !this.busy) return false;
    if (!this.t0) {
      this.stop();
      return false;
    }
    this.paused = true;
    this.elapsedOffset = Math.max(0, Date.now() - this.t0);
    this.wakeWait();
    this.panicHeld();
    this.onState(this.snapshot());
    return true;
  }

  resume() {
    if (!this.isPaused) return false;
    this.paused = false;
    this.t0 = Date.now() - this.elapsedOffset;
    this.wakeWait();
    this.onState(this.snapshot());
    return true;
  }

  stop() {
    this.stopped = true;
    this.paused = false;
    this.wakeWait();
    return this.busy || Promise.resolve();
  }

  wakeWait() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve();
    }
  }

  wait(ms) {
    return new Promise((resolve) => {
      this.waitResolve = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.waitResolve = null;
        resolve();
      }, Math.max(0, ms));
    });
  }

  trackHeld(event) {
    const set = event.device === "kb" ? this.heldKeys : this.heldMouse;
    if (event.action === "down") set.add(event.key);
    else set.delete(event.key);
  }

  panicHeld() {
    driver.panicRelease([...this.heldKeys], [...this.heldMouse]);
    this.heldKeys.clear();
    this.heldMouse.clear();
  }

  async run(events, countdownMs) {
    this.countdownUntil = Date.now() + countdownMs;
    this.onState(this.snapshot());
    while (!this.stopped) {
      const left = this.countdownUntil - Date.now();
      if (left <= 0) break;
      this.onState(this.snapshot());
      await this.wait(Math.min(200, left));
    }
    if (this.stopped) {
      this.onState({ phase: "stopped", playhead: 0, scenario: this.scenario, speed: this.speed, pace: this.pace });
      return;
    }

    this.t0 = Date.now();
    this.elapsedOffset = 0;
    const duration = events.at(-1).tMs;
    let lastHud = 0;
    try {
      this.onArmed();
      this.onState(this.snapshot());
      let lastEvent = null;
      let lastDispatchAt = 0;
      while (!this.stopped && this.index < events.length) {
        if (this.paused) {
          lastDispatchAt = 0;
          await this.wait(80);
          continue;
        }
        const event = events[this.index];
        const absoluteWait = this.t0 + event.tMs - Date.now();
        const catchupWait = lastDispatchAt
          ? requiredDispatchGap(lastEvent, event) - (Date.now() - lastDispatchAt)
          : 0;
        const wait = absoluteWait > 0 ? absoluteWait : Math.max(0, catchupWait);
        if (wait > 0) await this.wait(wait);
        if (this.stopped || this.paused) continue;
        driver.dispatch(event);
        this.trackHeld(event);
        lastEvent = event;
        lastDispatchAt = Date.now();
        this.index += 1;
        const now = Date.now();
        if (now - lastHud > 80 || event.action === "down") {
          lastHud = now;
          this.onState(this.snapshot());
        }
      }
    } catch (error) {
      this.onState({ phase: "error", error: error.message, scenario: this.scenario, speed: this.speed, pace: this.pace });
      throw error;
    } finally {
      driver.panicRelease(
        [...new Set(events.filter((e) => e.device === "kb").map((e) => e.key))],
        [...new Set(events.filter((e) => e.device === "mouse").map((e) => e.key))]
      );
      this.heldKeys.clear();
      this.heldMouse.clear();
    }
    this.onState({
      phase: this.stopped ? "stopped" : "ended",
      playhead: this.scorePlayhead(duration),
      scenario: this.scenario,
      speed: this.speed,
      pace: this.pace
    });
  }
}

module.exports = { AutoPlayer, compileScore, HUMANIZE, NPC_PACE };
