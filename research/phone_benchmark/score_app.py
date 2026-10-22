"""Score the app's TypeScript form check (outputs of run_app_ts.mjs) against ground truth.

    python research/phone_benchmark/score_app.py <old.jsonl> <new.jsonl> [...]

The original running.ts does not record which foot a contact belongs to, so its contacts
are matched to the nearest true contact of either foot (slightly generous to it).
Writes results/app_comparison.json and results/app_comparison.md.
"""
from __future__ import annotations

import json
import re
import sys
import warnings
from collections import defaultdict
from pathlib import Path

import numpy as np

from mocap import load_trial
from run_baseline import MATCH_S
from truth import author_strike_labels, trial_truth

warnings.filterwarnings('ignore')
RESULTS = Path(__file__).resolve().parent / 'results'
SIDE = {'left': 'l', 'right': 'r', None: None}
_truth: dict = {}


def truth_for(row):
    key = (row['subject'], row['speed'])
    if key not in _truth:
        trial = load_trial(*key)
        _truth[key] = trial_truth(trial, row['height'], row['start'], 12.0)
    return _truth[key]


def number(text, pattern):
    match = re.search(pattern, text or '')
    return float(match.group(1)) if match else None


def score(row, labels):
    truth = truth_for(row)
    group = 'front' if row['view'] in ('front', 'back') else row['view'].split('_')[0]
    out = {'view_ok': float(row['detectedView'] == group), 'ready': float(row['readiness'] == 'ready')}
    if row['detectedView'] != 'side' or row['readiness'] != 'ready':
        return out
    actual, detected = truth['contacts'], row['contacts']
    used, dts = set(), []
    for c in detected:
        t = c['t'] + row['start']
        side = SIDE[c['side']]
        best = min((a for a in actual if (side is None or a['side'] == side) and id(a) not in used), key=lambda a: abs(a['ic'] - t), default=None)
        if best is not None and abs(best['ic'] - t) <= MATCH_S:
            used.add(id(best))
            dts.append((t - best['ic']) * 1000)
    out['recall'] = len(used) / max(len(actual), 1)
    out['precision'] = len(used) / max(len(detected), 1)
    if dts:
        out['timing_bias_ms'] = float(np.median(dts))
        out['timing_mae_ms'] = float(np.mean(np.abs(dts)))
    if len(detected) > 1:
        out['cadence_err'] = abs(60 * (len(detected) - 1) / (detected[-1]['t'] - detected[0]['t']) - truth['cadence'])
    r_label, l_label = labels.get((row['subject'], 'r', row['speed'])), labels.get((row['subject'], 'l', row['speed']))
    if r_label and r_label == l_label:
        out['strike_given'] = float(row['strike'] != 'inconclusive')
        if row['strike'] != 'inconclusive':
            out['strike_correct'] = float(row['strike'] == r_label)
    if row['landing'] != 'inconclusive' and truth['landing']:
        out['landing_correct'] = float(row['landing'] == truth['landing'])
    pelvis = number(row['pelvisValue'], r'([\d.]+)% vertical')
    if pelvis is not None:
        out['pelvis_err'] = abs(pelvis - truth['pelvis_oscillation'] * 100)
    placement = number(row['placementValue'], r'(-?[\d.]+)× torso')
    if placement is not None and truth['advance_p75'] == truth['advance_p75']:
        out['placement_err'] = abs(placement - truth['advance_p75'])
    return out


def main():
    labels = author_strike_labels()
    groups = defaultdict(list)
    for path in sys.argv[1:]:
        for line in Path(path).read_text(encoding='utf8').splitlines():
            row = json.loads(line)
            frames = f"{row['fps']} fps" + (' (inexact repeats)' if row['wobble'] else '')
            scored = score(row, labels)
            group = 'front/back' if row['view'] in ('front', 'back') else row['view'].split('_')[0]
            for key in [(row['label'], group, row['noise'], frames), (row['label'], group, row['noise'], 'all')]:
                groups[key].append(scored)
    table = []
    for key, rows in sorted(groups.items()):
        entry = dict(zip(('version', 'view', 'noise', 'frames'), key), clips=len(rows))
        for metric in sorted({m for r in rows for m in r}):
            values = [r[metric] for r in rows if metric in r]
            entry[metric] = round(float(np.mean(values)), 4)
            entry[metric + '_n'] = len(values)
        table.append(entry)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / 'app_comparison.json').write_text(json.dumps(table, indent=1), encoding='utf8')
    print(json.dumps([e for e in table if e['frames'] == 'all' and e['noise'] == 'typical'], indent=1))


if __name__ == '__main__':
    main()
