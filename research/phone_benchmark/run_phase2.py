"""Phase 2: score the improved 2D engine and MotionBERT 3D lifting on the locked test runners.

    python research/phone_benchmark/tune_engine2d.py   # development runners only
    python research/phone_benchmark/run_phase2.py      # test runners, once

Part A (all 72 clip settings): app as-is, app + aspect fix, improved 2D engine.
Part B (portrait, 30/60 fps, all views and noise levels): knee angle from the improved 2D
engine vs MotionBERT lite and full, plus a "best by view" combination chosen in advance:
2D in side view, MotionBERT in every other view.
Writes results/phase2.json.
"""
from __future__ import annotations

import json
import time
import warnings
from functools import partial
from pathlib import Path

import app_baseline
import engine2d
import evaluate as E
import lifting

warnings.filterwarnings('ignore')
RESULTS = Path(__file__).resolve().parent / 'results'


def by_view(clip, params):
    """Pre-registered rule: MotionBERT knee angles except in side view."""
    result = engine2d.analyse(clip, params)
    if result.get('readiness') == 'ready' and result.get('view') != 'side':
        return lifting.analyse(clip, 'lite', params)
    return result


def main():
    params = json.loads((RESULTS / 'engine2d_params.json').read_text(encoding='utf8'))['params']
    report = {'params': params, 'cohort': sorted(E.TEST_COHORT)}

    started = time.time()
    rows_a = E.evaluate({'app': app_baseline.analyse,
                         'app+aspect_fix': partial(app_baseline.analyse, aspect_fix=True),
                         'engine2d': partial(engine2d.analyse, params=params)}, E.TEST)
    report['part_a'] = E.summarise(rows_a, ('method', 'group', 'orientation', 'fps', 'noise'))
    report['part_a_overall'] = E.summarise(rows_a, ('method', 'group', 'noise'))
    print(f'part A: {len(rows_a)} scored clips in {time.time() - started:.0f} s', flush=True)

    started = time.time()
    grid = E.clip_grid(orientations=('portrait',), fps=(30, 60))
    rows_b = E.evaluate({'engine2d': partial(engine2d.analyse, params=params),
                         'motionbert_lite': partial(lifting.analyse, variant='lite', params=params),
                         'motionbert_full': partial(lifting.analyse, variant='full', params=params),
                         'best_by_view': partial(by_view, params=params)}, E.TEST, grid)
    report['part_b'] = E.summarise(rows_b, ('method', 'group', 'noise'))
    print(f'part B: {len(rows_b)} scored clips in {time.time() - started:.0f} s', flush=True)

    (RESULTS / 'phase2.json').write_text(json.dumps(report, indent=1), encoding='utf8')


if __name__ == '__main__':
    main()
