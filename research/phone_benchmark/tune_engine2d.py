"""Tune the improved 2D engine on development runners only (the 8 test runners are never used).

    python research/phone_benchmark/tune_engine2d.py [--refit-thresholds]

1. Grid-search the smoothing cut-off and ground tolerance for contact F1 (then timing error).
2. Set the constant timing correction to minus the median timing error.
3. Fit the two foot-angle thresholds to the authors' foot-strike labels (per contact).
Writes results/engine2d_params.json.
"""
from __future__ import annotations

import itertools
import json
import warnings
import zlib
from functools import partial
from multiprocessing import Pool
from pathlib import Path

import numpy as np

import engine2d
import evaluate as E
from mocap import load_trial
from run_baseline import MATCH_S
from synth import make_clip
from truth import author_strike_labels, heights

warnings.filterwarnings('ignore')
OUT = Path(__file__).resolve().parent / 'results'
SETTINGS = [(v, o, f, n) for v in ('side_right', 'side_left') for o in ('portrait', 'landscape') for f in (30, 60) for n in ('none', 'typical', 'hard')]


def trial_clips(job):
    subject, code, height = job
    try:
        trial = load_trial(subject, code)
    except Exception:  # noqa: BLE001
        return None
    if trial.time[-1] < E.START + E.SECONDS:
        return None
    clips = [make_clip(trial, height, v, f, n, zlib.crc32(f'{subject}{code}{v}{o}{f}{n}'.encode()), E.START, E.SECONDS, o) for v, o, f, n in SETTINGS]
    return subject, code, trial, clips


def match(params, item):
    subject, code, trial, clips = item
    labels = author_strike_labels()
    out = []
    for clip in clips:
        result = engine2d.analyse(clip, params)
        if result.get('view') != 'side':
            out.append({'noise': clip.noise, 'found': 0, 'detected': 0, 'actual': 1, 'dt': [], 'angles': []})
            continue
        actual = [a for a in trial.contacts if clip.time[0] <= a['ic'] < clip.time[-1]]
        used, dts, angles = set(), [], []
        for c in result['contacts']:
            t = c['t'] + clip.time[0]
            best = min((a for a in actual if a['side'] == c['side'] and id(a) not in used), key=lambda a: abs(a['ic'] - t), default=None)
            if best is not None and abs(best['ic'] - t) <= MATCH_S:
                used.add(id(best))
                dts.append((t - best['ic']) * 1000)
                label = labels.get((subject, c['side'], code))
                if label:
                    angles.append((c['angle'], label))
        out.append({'noise': clip.noise, 'found': len(used), 'detected': len(result['contacts']), 'actual': len(actual), 'dt': dts, 'angles': angles})
    return out


def score(results):
    found = sum(r['found'] for r in results)
    precision = found / max(sum(r['detected'] for r in results), 1)
    recall = found / max(sum(r['actual'] for r in results), 1)
    dts = np.concatenate([r['dt'] for r in results if r['dt']]) if any(r['dt'] for r in results) else np.array([0.0])
    return {'f1': 2 * precision * recall / max(precision + recall, 1e-9), 'precision': precision, 'recall': recall,
            'bias_ms': float(np.median(dts)), 'mae_ms': float(np.mean(np.abs(dts - np.median(dts))))}


def fit_thresholds(pairs):
    angles = np.array([a for a, _ in pairs])
    labels = np.array([l for _, l in pairs])
    best = None
    for fore in np.arange(-15, 10.5, 0.5):
        for rear in np.arange(fore + 1, 30.5, 0.5):
            pred = np.where(angles > rear, 'rearfoot', np.where(angles < fore, 'forefoot', 'midfoot'))
            balanced = np.mean([np.mean(pred[labels == k] == k) for k in ('rearfoot', 'midfoot', 'forefoot') if (labels == k).any()])
            if best is None or balanced > best[0]:
                best = (balanced, float(fore), float(rear), float(np.mean(pred == labels)))
    return best


def refit_thresholds():
    """Keep the tuned contact settings; refit only the foot-angle thresholds."""
    saved = json.loads((OUT / 'engine2d_params.json').read_text(encoding='utf8'))
    with Pool(6) as pool:
        items = [i for i in pool.map(trial_clips, list(E.trial_jobs(E.DEV))) if i]
        results = [r for part in pool.map(partial(match, saved['params']), items) for r in part]
    pairs = [p for r in results if r['noise'] == 'typical' for p in r['angles']]
    balanced, fore, rear, accuracy = fit_thresholds(pairs)
    saved['params'].update(fore_deg=fore, rear_deg=rear)
    saved['foot_strike_dev'] = {'balanced_accuracy': balanced, 'accuracy': accuracy, 'contacts': len(pairs)}
    print(f'forefoot < {fore} deg < midfoot < {rear} deg < rearfoot (dev balanced accuracy {balanced:.2f}, accuracy {accuracy:.2f}, n={len(pairs)})')
    (OUT / 'engine2d_params.json').write_text(json.dumps(saved, indent=1), encoding='utf8')


def main():
    with Pool(6) as pool:
        items = [i for i in pool.map(trial_clips, list(E.trial_jobs(E.DEV))) if i]
        print(f'{len(items)} development trials, {len(items) * len(SETTINGS)} clips')
        grid = []
        # tol 1.0 = no refinement: the furthest-forward frame itself is the contact.
        for cutoff, tol in itertools.product((3, 4, 6), (0.05, 0.08, 0.12, 1.0)):
            params = {**engine2d.PARAMS, 'cutoff_hz': cutoff, 'ground_tol': tol, 'ic_bias_ms': 0.0}
            first = score([r for part in pool.map(partial(match, params), items) for r in part if r['noise'] == 'typical'])
            params['ic_bias_ms'] = -round(first['bias_ms'])  # score each setting after its own timing correction
            s = score([r for part in pool.map(partial(match, params), items) for r in part if r['noise'] == 'typical'])
            grid.append((s['f1'], -s['mae_ms'], cutoff, tol, {**s, 'ic_bias_ms': params['ic_bias_ms']}))
            print(f'cutoff {cutoff} Hz, tol {tol}: F1 {s["f1"]:.3f} (P {s["precision"]:.2f} R {s["recall"]:.2f}), '
                  f'correction {params["ic_bias_ms"]:+d} ms, spread {s["mae_ms"]:.0f} ms', flush=True)
        _, _, cutoff, tol, s = max(grid, key=lambda g: (round(g[0], 3), g[1]))
        params = {**engine2d.PARAMS, 'cutoff_hz': cutoff, 'ground_tol': tol, 'ic_bias_ms': s['ic_bias_ms']}
        results = [r for part in pool.map(partial(match, params), items) for r in part]
    pairs = [p for r in results if r['noise'] == 'typical' for p in r['angles']]
    balanced, fore, rear, accuracy = fit_thresholds(pairs)
    params.update(fore_deg=fore, rear_deg=rear)
    print(f'chosen: cutoff {cutoff} Hz, tol {tol}, bias {params["ic_bias_ms"]} ms, forefoot < {fore} deg < midfoot < {rear} deg < rearfoot '
          f'(dev per-contact balanced accuracy {balanced:.2f}, accuracy {accuracy:.2f}, n={len(pairs)})')
    OUT.mkdir(exist_ok=True)
    (OUT / 'engine2d_params.json').write_text(json.dumps({'params': params, 'tuned_on': 'development runners only',
                                                          'grid': [{'cutoff_hz': g[2], 'ground_tol': g[3], **g[4]} for g in grid]}, indent=1), encoding='utf8')


if __name__ == '__main__':
    import sys
    refit_thresholds() if '--refit-thresholds' in sys.argv else main()
