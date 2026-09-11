#!/usr/bin/env python3
import argparse
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np


NOTES = [
    ("1", "z", 0),
    ("2", "x", 2),
    ("3", "c", 4),
    ("4", "v", 5),
    ("5", "b", 7),
    ("6", "n", 9),
    ("7", "m", 11),
    ("i", ",", 12),
]


def extract_audio(input_path: Path, workdir: Path) -> Path:
    wav_path = workdir / "source.wav"
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required. Install it first, then rerun this script.")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "22050",
            str(wav_path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return wav_path


def note_from_midi(midi: int):
    best = None
    for octave in (-12, 0, 12):
        for index, (note, key, degree) in enumerate(NOTES):
            for half in (0, 1):
                mapped = 60 + octave + degree + half
                cost = abs(mapped - midi) + (0.1 if half else 0)
                if best is None or cost < best[0]:
                    best = (cost, note, key, octave, half)
    _, note, key, octave, half = best
    mouse = []
    if octave < 0:
        mouse.append("left")
    elif octave > 0:
        mouse.append("right")
    if half:
        mouse.append("middle")
    return {"key": key, "note": note, "mouse": mouse}


def fold_midi(midi: int) -> int:
    while midi > 85:
        midi -= 12
    while midi < 48:
        midi += 12
    return midi


def detect_grid_events(wav_path: Path, step=None):
    y, sr = librosa.load(wav_path, sr=22050, mono=True)
    harmonic = librosa.effects.harmonic(y, margin=4)
    onset_env = librosa.onset.onset_strength(y=harmonic, sr=sr, hop_length=512)
    tempo = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=onset_env, sr=sr, hop_length=512))[0])
    if step is None:
        step = (60 / tempo) / 2

    cqt = np.abs(
        librosa.cqt(
            harmonic,
            sr=sr,
            hop_length=512,
            fmin=librosa.note_to_hz("C3"),
            n_bins=48,
            bins_per_octave=12,
        )
    )
    times = librosa.frames_to_time(np.arange(cqt.shape[1]), sr=sr, hop_length=512)
    weighted = librosa.amplitude_to_db(cqt * np.linspace(0.75, 1.25, cqt.shape[0])[:, None], ref=np.max)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)

    raw = []
    for start in np.arange(0, len(y) / sr, step):
        end = min(start + step, len(y) / sr)
        frame_idx = np.where((times >= start) & (times < end))[0]
        if len(frame_idx) == 0:
            continue
        if np.nanmedian(rms_db[frame_idx]) < -38:
            continue
        energy = np.nanmedian(weighted[:, frame_idx], axis=1)
        best_bin = int(np.argmax(energy))
        if energy[best_bin] < np.nanmedian(energy) + 8:
            continue
        midi = 48 + best_bin
        if midi < 60:
            midi += 12
        raw.append({"t": round(float(start), 3), "d": round(float(step), 3), "midi": fold_midi(midi)})

    merged = []
    for event in raw:
        if merged and event["midi"] == merged[-1]["midi"] and abs(event["t"] - (merged[-1]["t"] + merged[-1]["d"])) < 0.04:
            merged[-1]["d"] = round(event["t"] + event["d"] - merged[-1]["t"], 3)
        else:
            merged.append(event)

    events = []
    for event in merged:
        mapped = note_from_midi(event["midi"])
        events.append({"t": event["t"], "d": event["d"], **mapped})

    events = merge_same_controls(events)
    return {"tempo": tempo, "step": step, "events": events}


def parse_score_text(text: str):
    tokens = text.replace("\n", " ").split()
    parsed = []
    for token in tokens:
        high = token.startswith(".") or token.endswith("'") or token.endswith("·")
        low = token.startswith("_")
        note = token.strip("._'·")
        if note not in {item[0] for item in NOTES if item[0] != "i"}:
            raise SystemExit(f"Unsupported score token: {token}")
        parsed.append({"note": note, "high": high, "low": low})
    return parsed


def event_for_score_note(score_note, t, d):
    note = score_note["note"]
    note_info = next(item for item in NOTES if item[0] == note)
    mouse = []
    if score_note.get("high"):
        mouse.append("right")
    if score_note.get("low"):
        mouse.append("left")
    return {"t": round(t, 3), "d": round(d, 3), "key": note_info[1], "note": note, "mouse": mouse}


def align_score_to_audio(score, detected_events):
    target_midi = []
    degree = {note: deg for note, _, deg in NOTES}
    for item in score:
        midi = 60 + degree[item["note"]]
        if item.get("high"):
            midi += 12
        if item.get("low"):
            midi -= 12
        target_midi.append(midi)

    n, m = len(score), len(detected_events)
    inf = 10**9
    dp = [[inf] * (m + 1) for _ in range(n + 1)]
    pre = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    for i in range(n + 1):
        for j in range(m + 1):
            cur = dp[i][j]
            if cur >= inf:
                continue
            if i < n and j < m:
                detected_midi = 60 + next(deg for note, key, deg in NOTES if key == detected_events[j]["key"])
                if "right" in detected_events[j].get("mouse", []):
                    detected_midi += 12
                if "left" in detected_events[j].get("mouse", []):
                    detected_midi -= 12
                diff = abs(target_midi[i] - detected_midi)
                cost = min(diff, abs(diff - 12), abs(diff + 12), abs(diff - 24), abs(diff + 24)) * 1.4 + min(diff, 12) * 0.08
                if cur + cost < dp[i + 1][j + 1]:
                    dp[i + 1][j + 1] = cur + cost
                    pre[i + 1][j + 1] = (i, j, "match")
            if j < m and cur + 1.9 < dp[i][j + 1]:
                dp[i][j + 1] = cur + 1.9
                pre[i][j + 1] = (i, j, "skip_audio")
            if i < n and cur + 1.7 < dp[i + 1][j]:
                dp[i + 1][j] = cur + 1.7
                pre[i + 1][j] = (i, j, "skip_target")

    matched = [None] * n
    i, j = n, m
    while i or j:
        prev = pre[i][j]
        if prev is None:
            break
        pi, pj, op = prev
        if op == "match":
            matched[pi] = detected_events[pj]
        i, j = pi, pj

    for idx in range(n):
        if matched[idx] is not None:
            continue
        prev = next((p for p in range(idx - 1, -1, -1) if matched[p] is not None), None)
        nxt = next((q for q in range(idx + 1, n) if matched[q] is not None), None)
        if prev is not None and nxt is not None:
            step = (matched[nxt]["t"] - matched[prev]["t"]) / (nxt - prev)
            t = matched[prev]["t"] + step * (idx - prev)
            d = max(0.18, min(step * 0.78, 0.75))
        elif prev is not None:
            t = matched[prev]["t"] + 0.43
            d = 0.34
        elif nxt is not None:
            t = max(0, matched[nxt]["t"] - 0.43)
            d = 0.34
        else:
            t = idx * 0.43
            d = 0.34
        matched[idx] = {"t": round(t, 3), "d": round(d, 3)}

    events = []
    shift = matched[0]["t"]
    for idx, item in enumerate(score):
        det = matched[idx]
        next_t = matched[idx + 1]["t"] if idx + 1 < n else det["t"] + det.get("d", 0.43)
        d = min(det.get("d", 0.34), max(0.16, next_t - det["t"] - 0.035))
        d = max(d, 0.16)
        events.append(event_for_score_note(item, det["t"] - shift, d))
    return merge_same_controls(events)


def merge_same_controls(events):
    out = []
    for event in events:
        if out and event["key"] == out[-1]["key"] and event.get("mouse", []) == out[-1].get("mouse", []) and event["t"] - (out[-1]["t"] + out[-1]["d"]) < 0.04:
            out[-1]["d"] = round(event["t"] + event["d"] - out[-1]["t"], 3)
        else:
            out.append(event)
    return out


def main():
    parser = argparse.ArgumentParser(description="Generate koufengqin autoplay JSON from audio/video.")
    parser.add_argument("input", type=Path, help="Audio or video file.")
    parser.add_argument("-o", "--output", type=Path, default=Path("song-events.json"))
    parser.add_argument("--title", default="未命名曲目")
    parser.add_argument("--score", type=Path, help="Optional jianpu text. Use .1 for high 1, plain 7 for normal 7.")
    parser.add_argument("--step", type=float, help="Override analysis grid step in seconds.")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        wav = extract_audio(args.input, Path(tmp))
        detected = detect_grid_events(wav, step=args.step)
        if args.score:
            score = parse_score_text(args.score.read_text(encoding="utf-8"))
            events = align_score_to_audio(score, detected["events"])
            source = f"score-aligned to {args.input.name}"
        else:
            events = detected["events"]
            source = f"auto-detected from {args.input.name}"

    result = {
        "title": args.title,
        "source": source,
        "events": events,
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.output} with {len(events)} events.")


if __name__ == "__main__":
    main()
