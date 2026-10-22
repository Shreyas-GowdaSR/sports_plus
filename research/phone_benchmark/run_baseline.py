"""Phase 1: score the app's current 2D screen against motion-capture ground truth.

    python research/phone_benchmark/run_baseline.py

For every usable trial: 6 camera views x {landscape, portrait} x {30, 60} fps x
{none, typical, hard} noise, each analysed by the app port as-is and with the aspect-ratio fix. Writes
research/phone_benchmark/results/phase1_baseline.json and prints the summary tables.
"""
from __future__ import annotations

import json
import warnings
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from app_baseline import L, analyse
from mocap import EXCLUDE, MARKER_HZ, RAW_DIR, load_trial, subjects
from synth import VIEWS, make_clip
from truth import author_strike_labels, heights, knee_flexion, trial_truth

warnings.filterwarnings('ignore')
OUT = Path(__file__).resolve().parent / 'results'
TEST_COHORT = {'RBDS009', 'RBDS015', 'RBDS018', 'RBDS021', 'RBDS022', 'RBDS026', 'RBDS028', 'RBDS031'}
START, SECONDS, MATCH_S = 2.0, 12.0, 0.12


def knee_2d(xy, side):
    hip, knee, ankle = (L[f'{side}h'], L[f'{side}k'], L[f'{side}a'])
    a, b, c = xy[:, hip], xy[:, knee], xy[:, ankle]
    ba, bc = a - b, c - b
    cos = np.sum(ba * bc, -1) / (np.linalg.norm(ba, axis=-1) * np.linalg.norm(bc, axis=-1) + 1e-9)
    return 180 - np.degrees(np.arccos(np.clip(cos, -1, 1)))


def score_clip(clip, result, truth, trial, labels, code):
    row = {'view': clip.view, 'group': clip.view.split('_')[0], 'fps': clip.fps, 'noise': clip.noise, 'orientation': clip.orientation,
           'view_ok': result.get('view') == {'side': 'side', 'oblique': 'oblique', 'front': 'front', 'back': 'front'}[clip.view.split('_')[0]]}
    if result.get('readiness') != 'ready':
        row['ready'] = False
        return row
    row['ready'] = True
    abs_t = result['ts'] / 1000 + clip.time[0]
    frames = np.clip(np.round(abs_t * MARKER_HZ).astype(int), 0, len(trial.time) - 1)
    # Knee flexion over the whole clip: near leg in side views, both legs otherwise.
    near = 'r' if clip.view in ('side_right', 'oblique_front_right') else 'l' if clip.view in ('side_left', 'oblique_back_left') else None
    errors = [knee_2d(result['xy'], s) - knee_flexion(trial.joints, s)[frames] for s in ([near] if near else 'rl')]
    row['knee_rmse'] = float(np.sqrt(np.nanmean(np.concatenate(errors) ** 2)))
    if clip.view.startswith(('front', 'back')) and 'hip_level_p75' in result:
        row['hip_level_err'] = abs(result['hip_level_p75'] - truth['hip_level_p75']) * 100
    if 'contacts' not in result:
        return row
    detected, actual = result['contacts'], truth['contacts']
    used, matched = set(), []
    for c in detected:
        t = c['t'] + clip.time[0]
        best = min((a for a in actual if a['side'] == c['side'] and id(a) not in used), key=lambda a: abs(a['ic'] - t), default=None)
        if best is not None and abs(best['ic'] - t) <= MATCH_S:
            used.add(id(best))
            matched.append((c, best, t - best['ic']))
    row['recall'] = len(matched) / max(len(actual), 1)
    row['precision'] = len(matched) / max(len(detected), 1)
    if matched:
        dt = np.array([m[2] for m in matched]) * 1000
        row['timing_bias_ms'] = float(np.median(dt))
        row['timing_mae_ms'] = float(np.mean(np.abs(dt)))
        adv = [abs(c['advance'] - a['advance']) for c, a, _ in matched if np.isfinite(c['advance'])]
        row['advance_mae'] = float(np.mean(adv)) if adv else np.nan
        strikes = [(c['type'], labels.get((trial.subject, a['side'], code))) for c, a, _ in matched]
        strikes = [s for s in strikes if s[1]]
        row['strike_contact_acc'] = float(np.mean([p == t for p, t in strikes])) if strikes else np.nan
    if len(detected) > 1:
        cadence = 60 * (len(detected) - 1) / (detected[-1]['t'] - detected[0]['t'])
        row['cadence_err'] = abs(cadence - truth['cadence'])
    row['pelvis_osc_err'] = abs(result['pelvis_oscillation'] - truth['pelvis_oscillation']) * 100
    r_label, l_label = labels.get((trial.subject, 'r', code)), labels.get((trial.subject, 'l', code))
    if r_label and r_label == l_label:
        row['strike_conclusive'] = result['strike'] != 'inconclusive'
        if row['strike_conclusive']:
            row['strike_clip_acc'] = float(result['strike'] == r_label)
    if 'landing' in result and truth['landing']:
        row['landing_acc'] = float(result['landing'] == truth['landing'])
    return row


def run_trial(args):
    subject, code, height = args
    try:
        trial = load_trial(subject, code)
    except Exception as error:  # noqa: BLE001
        return subject, code, [], f'load failed: {error}'
    window = (trial.time >= START) & (trial.time < START + SECONDS)
    if trial.time[-1] < START + SECONDS:
        return subject, code, [], 'trial shorter than 14 s'
    gaps = max(np.isnan(v[window, 0]).mean() for v in trial.joints.values())
    if gaps > 0.05:
        return subject, code, [], f'{gaps:.0%} of the window has missing markers'
    truth = trial_truth(trial, height, START, SECONDS)
    labels = author_strike_labels()
    rows = []
    seed = int(subject[4:]) * 100 + int(code[1:])
    for view in VIEWS:
        for orientation in ('landscape', 'portrait'):
            for fps in (30, 60):
                for noise in ('none', 'typical', 'hard'):
                    clip = make_clip(trial, height, view, fps, noise, seed, START, SECONDS, orientation)
                    seed += 1
                    for method, fix in (('app', False), ('app+aspect_fix', True)):
                        row = score_clip(clip, analyse(clip, aspect_fix=fix), truth, trial, labels, code)
                        row.update(method=method, subject=subject, speed=code, test=subject in TEST_COHORT)
                        rows.append(row)
    return subject, code, rows, None


def summarise(rows, keys=('method', 'group', 'orientation', 'fps', 'noise')):
    metrics = ['view_ok', 'ready', 'recall', 'precision', 'timing_bias_ms', 'timing_mae_ms', 'cadence_err', 'strike_conclusive',
               'strike_clip_acc', 'strike_contact_acc', 'advance_mae', 'landing_acc', 'pelvis_osc_err', 'hip_level_err', 'knee_rmse']
    groups = defaultdict(list)
    for row in rows:
        groups[tuple(row[k] for k in keys)].append(row)
    table = []
    for key, members in sorted(groups.items()):
        entry = dict(zip(keys, key), clips=len(members))
        for m in metrics:
            values = [float(r[m]) for r in members if m in r and r[m] == r[m]]
            if values:
                entry[m] = round(float(np.mean(values)), 4)
        table.append(entry)
    return table


def main():
    tall = heights()
    jobs = [(s, code, tall[s]) for s in subjects() for code in ('T25', 'T35', 'T45')
            if (RAW_DIR / f'{s}run{code}markers.txt').exists()]
    rows, skipped = [], {}
    with Pool(6) as pool:
        for subject, code, trial_rows, reason in pool.imap_unordered(run_trial, jobs):
            if reason:
                skipped[f'{subject} {code}'] = reason
            rows.extend(trial_rows)
            print(f'{subject} {code}: {reason or len(trial_rows)}', flush=True)
    OUT.mkdir(exist_ok=True)
    report = {
        'trials_used': len({(r['subject'], r['speed']) for r in rows}), 'runners_used': len({r['subject'] for r in rows}),
        'excluded_runners': EXCLUDE, 'skipped_trials': skipped, 'clips': len(rows) // 2,
        'all_runners': summarise(rows), 'test_cohort': summarise([r for r in rows if r['test']]),
    }
    (OUT / 'phase1_baseline.json').write_text(json.dumps(report, indent=1), encoding='utf8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('all_runners', 'test_cohort')}, indent=1))


if __name__ == '__main__':
    main()
