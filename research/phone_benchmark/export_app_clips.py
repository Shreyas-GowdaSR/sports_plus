"""Export benchmark clips for testing the app's real TypeScript form check
(frontend/src/lib/running.ts) with run_app_ts.mjs.

    python research/phone_benchmark/export_app_clips.py [--cohort test|dev] [--side-only]

Each clip is stored once at its own frame rate as flat arrays (13 modelled MediaPipe
landmarks: x, y, visibility). run_app_ts.mjs rebuilds exactly what pose.ts produces: 33
landmarks sampled every 1/60 s, so 30 fps clips repeat frames.

Grid per trial: side views (left, right) in every setting (portrait/landscape x 30/60 fps x
none/typical/hard noise), plus oblique, front and back views with typical noise.
Writes storage/benchmark/app_clips/<cohort>.jsonl (gitignored).
"""
from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np

import evaluate as E
from app_baseline import MODELLED
from mocap import load_trial
from synth import make_clip

warnings.filterwarnings('ignore')
OUT = Path(__file__).resolve().parents[2] / 'storage' / 'benchmark' / 'app_clips'
SIDE_ONLY = '--side-only' in sys.argv  # e.g. for calibrating side-view measures on development runners


def grid():
    for view in ('side_right', 'side_left'):
        for orientation in ('portrait', 'landscape'):
            for fps in (30, 60):
                for noise in ('none', 'typical', 'hard'):
                    yield view, orientation, fps, noise
    if SIDE_ONLY:
        return
    for view in ('oblique_front_right', 'front', 'back'):
        for orientation in ('portrait', 'landscape'):
            for fps in (30, 60):
                yield view, orientation, fps, 'typical'


def main():
    cohort = E.DEV if '--cohort' in sys.argv and sys.argv[sys.argv.index('--cohort') + 1] == 'dev' else E.TEST
    OUT.mkdir(parents=True, exist_ok=True)
    count = 0
    with (OUT / f'{cohort}.jsonl').open('w', encoding='utf8') as out:
        for subject, code, height in E.trial_jobs(cohort):
            trial = load_trial(subject, code)
            if trial.time[-1] < E.START + E.SECONDS:
                continue
            for k, (view, orientation, fps, noise) in enumerate(grid()):
                clip = make_clip(trial, height, view, fps, noise, int(subject[4:]) * 1000 + int(code[1:]) * 100 + k, E.START, E.SECONDS, orientation)
                frames = clip.xy[:, MODELLED]
                keep = ~np.isnan(frames).any(axis=(1, 2))
                out.write(json.dumps({
                    'subject': subject, 'speed': code, 'height': height, 'view': view, 'orientation': orientation, 'fps': fps,
                    'noise': noise, 'start': float(clip.time[0]), 'aspect': clip.width / clip.height, 'imageHeight': clip.height,
                    'modelled': MODELLED, 'times': np.round(clip.time[keep] - clip.time[0], 5).tolist(),
                    'xy': np.round(frames[keep], 5).reshape(int(keep.sum()), -1).tolist(),
                    'visibility': np.round(clip.visibility[keep][:, MODELLED], 3).tolist(),
                }) + '\n')
                count += 1
    print(f'{count} clips -> {OUT / f"{cohort}.jsonl"}')


if __name__ == '__main__':
    main()
