"use strict";

const driver = require("./input-driver.cjs");

const SETTLE_MS = 30;
const RELEASE_MS = 20;
const COUNTDOWN_MS = 3000;

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
  if (duration <= 0.25) return 0.62 + Math.random() * 0.1;
  if (duration >= 0.8) return 0.88 + Math.random() * 0.08;
  return 0.72 + Math.random() * 0.1;
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
  const speed = Math.max(0.25, Number(options.speed) || 1);
  const humanize = options.humanize !== false;
  const events = [];
  let cursor = 0;
  let held = null;
  let prevPitch = null;
  let prevEnd = 0;

  for (let i = 0; i < scoreEvents.length; i += 1) {
    const item = scoreEvents[i];
    const durMs = (Math.max(0.06, Number(item.d) || 0.2) / speed) * 1000;
    const ideal = (Math.max(0, Number(item.t) || 0) / speed) * 1000;
    let button = pickButton(item.mouse);
    let key = String(item.key || "z").toLowerCase();
    if (key === "," || (key === "z" && button === "right")) {
      key = ",";
      button = null;
    }

    let t = Math.max(ideal, cursor);
    if (humanize) {
      t += gaussian(12);
      const gap = ideal - prevEnd;
      if (gap > 140) t += 15 + Math.random() * 10;
      if (prevPitch != null && Math.abs(pitchValue(item) - prevPitch) >= 4) {
        t += 2.5 + Math.random() * 2.5;
      }
      t = Math.max(t, cursor + 2);
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

    const ratio = humanize ? holdRatio(item.d) : 0.85;
    const hold = Math.min(3000, Math.max(40, durMs * ratio));
    events.push({ tMs: t, device: "kb", key, action: "down" });
    const tUp = t + hold;
    events.push({ tMs: tUp, device: "kb", key, action: "up" });

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

    cursor = Math.max(ideal + durMs, releaseEnd + 2);
    prevEnd = cursor;
    prevPitch = pitchValue(item);
  }

  if (held) events.push({ tMs: cursor, device: "mouse", key: held, action: "up" });
  if (options.npcSubmit) {
    const qAt = (events.at(-1)?.tMs || cursor) + 280;
    events.push({ tMs: qAt, device: "kb", key: "q", action: "down" });
    events.push({ tMs: qAt + 80, device: "kb", key: "q", action: "up" });
  }

  events.sort((a, b) => a.tMs - b.tMs || (a.action === "up" ? -1 : 1));
  return events;
}

class AutoPlayer {
  constructor() {
    this.stopped = true;
    this.timer = null;
    this.busy = null;
    this.onState = () => {};
  }

  get isPlaying() {
    return !this.stopped && Boolean(this.busy);
  }

  start(scoreEvents, options = {}) {
    if (this.isPlaying) return { ok: false, error: "正在代按" };
    const compiled = compileScore(scoreEvents, options);
    if (!compiled.length) return { ok: false, error: "谱面为空" };
    this.stopped = false;
    const countdown = options.countdownMs ?? COUNTDOWN_MS;
    this.busy = this.run(compiled, countdown)
      .catch((error) => {
        this.onState({ phase: "error", error: error.message || String(error) });
      })
      .finally(() => {
        this.busy = null;
      });
    return { ok: true };
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.busy || Promise.resolve();
  }

  wait(ms) {
    return new Promise((resolve) => {
      this.timer = setTimeout(() => {
        this.timer = null;
        resolve();
      }, Math.max(0, ms));
    });
  }

  async run(events, countdownMs) {
    const announceStart = Date.now();
    this.onState({ phase: "countdown", playhead: 0, remainingMs: countdownMs });
    while (!this.stopped) {
      const left = countdownMs - (Date.now() - announceStart);
      if (left <= 0) break;
      this.onState({ phase: "countdown", playhead: 0, remainingMs: left });
      await this.wait(Math.min(200, left));
    }
    if (this.stopped) {
      this.onState({ phase: "stopped", playhead: 0 });
      return;
    }

    const t0 = Date.now();
    const duration = events.at(-1).tMs;
    try {
      for (let i = 0; i < events.length; i += 1) {
        if (this.stopped) break;
        const wait = t0 + events[i].tMs - Date.now();
        if (wait > 0) await this.wait(wait);
        if (this.stopped) break;
        driver.dispatch(events[i]);
        this.onState({
          phase: "playing",
          playhead: events[i].tMs / 1000,
          remainingMs: Math.max(0, duration - events[i].tMs)
        });
      }
    } catch (error) {
      this.onState({ phase: "error", error: error.message });
      throw error;
    } finally {
      driver.panicRelease(
        [...new Set(events.filter((e) => e.device === "kb").map((e) => e.key))],
        [...new Set(events.filter((e) => e.device === "mouse").map((e) => e.key))]
      );
    }
    this.onState({ phase: this.stopped ? "stopped" : "ended", playhead: duration / 1000 });
  }
}

module.exports = { AutoPlayer, compileScore };
