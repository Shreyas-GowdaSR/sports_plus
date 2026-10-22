"""Score any form-check engine on the synthetic phone benchmark.

An engine is a function clip -> result dict with the same keys as app_baseline.analyse
(view, contacts, strike, landing, pelvis_oscillation, hip_level_p75, ts, xy and
optionally knee = {'l': angles, 'r': angles}).
"""
from __future__ import annotations

import warnings
from multiprocessing import Pool

import numpy as np

from mocap import RAW_DIR, load_trial, subjects
from run_baseline import START, SECONDS, TEST_COHORT, score_clip, summarise
from synth import VIEWS, make_clip
from truth import author_strike_labels, heights, trial_truth

warnings.filterwarnings('ignore')
DEV = 'dev'
TEST = 'test'


def trial_jobs(cohort: str):
    tall = heights()
    for s in subjects():
        if (s in TEST_COHORT) != (cohort == TEST):
            continue
        for code in ('T25', 'T35', 'T45'):
            if (RAW_DIR / f'{s}run{code}markers.txt').exists():
                yield s, code, tall[s]


def clip_grid(views=tuple(VIEWS), orientations=('portrait', 'landscape'), fps=(30, 60), noises=('none', 'typical', 'hard')):
    return [(v, o, f, n) for v in views for o in orientations for f in fps for n in noises]


def _run(args):
    (subject, code, height), engines, grid = args
    try:
        trial = load_trial(subject, code)
    except Exception:  # noqa: BLE001
        return []
    window = (trial.time >= START) & (trial.time < START + SECONDS)
    if trial.time[-1] < START + SECONDS or max(np.isnan(v[window, 0]).mean() for v in trial.joints.values()) > 0.05:
        return []
    truth = trial_truth(trial, height, START, SECONDS)
    labels = author_strike_labels()
    rows = []
    seed = int(subject[4:]) * 100 + int(code[1:])
    for k, (view, orientation, fps, noise) in enumerate(grid):
        clip = make_clip(trial, height, view, fps, noise, seed + 7919 * k, START, SECONDS, orientation)
        for name, engine in engines.items():
            row = score_clip(clip, engine(clip), truth, trial, labels, code)
            row.update(method=name, subject=subject, speed=code, test=subject in TEST_COHORT)
            rows.append(row)
    return rows


def evaluate(engines: dict, cohort: str, grid=None, workers: int = 6):
    grid = grid or clip_grid()
    jobs = [(job, engines, grid) for job in trial_jobs(cohort)]
    rows = []
    if workers <= 1:
        for job in jobs:
            rows.extend(_run(job))
    else:
        with Pool(workers) as pool:
            for part in pool.imap_unordered(_run, jobs):
                rows.extend(part)
    return rows


def headline(rows, keys=('method', 'group', 'noise')):
    return summarise(rows, keys)
