"""Turn results/phase1_baseline.json into the Markdown tables used in RESULTS_PHASE1.md.

    python research/phone_benchmark/report_phase1.py      # writes results/phase1_tables.md
"""
from __future__ import annotations

import json
from pathlib import Path

RESULTS = Path(__file__).resolve().parent / 'results'
DATA = json.loads((RESULTS / 'phase1_baseline.json').read_text(encoding='utf8'))
for scope in ('all_runners', 'test_cohort'):
    for entry in DATA[scope]:  # a clip-level accuracy over a handful of labelled clips is noise
        if entry.get('strike_conclusive', 1) < 0.15:
            entry.pop('strike_clip_acc', None)
            entry.pop('landing_acc', None)  # only computed when a foot-strike label is given
METHODS = {'app': 'App today', 'app+aspect_fix': 'App + aspect fix'}


def rows(scope='all_runners', **match):
    return [e for e in DATA[scope] if all(e.get(k) == v for k, v in match.items())]


def fmt(value, kind):
    if value is None:
        return '–'
    return {'pct': f'{value * 100:.0f}%', 'ms': f'{value:+.0f} ms', 'deg': f'{value:.1f}°', 'spm': f'{value:.0f}',
            'torso': f'{value:.2f}', 'pp': f'{value:.0f}'}[kind]


def table(title, columns, entries, label):
    out = [f'### {title}', '', '| ' + ' | '.join(['Setting'] + [c[0] for c in columns]) + ' |', '|' + '---|' * (len(columns) + 1)]
    for entry in entries:
        out.append('| ' + ' | '.join([label(entry)] + [fmt(entry.get(c[1]), c[2]) for c in columns]) + ' |')
    return '\n'.join(out) + '\n'


CONTACT = [('Contacts found (recall)', 'recall', 'pct'), ('Detections that are real (precision)', 'precision', 'pct'),
           ('Timing bias', 'timing_bias_ms', 'ms'), ('Step-rate error (steps/min)', 'cadence_err', 'spm')]
FORM = [('Foot strike: clip label given', 'strike_conclusive', 'pct'), ('Foot strike: clip label correct', 'strike_clip_acc', 'pct'),
        ('Foot strike: per contact correct', 'strike_contact_acc', 'pct'), ('Landing ahead/under correct', 'landing_acc', 'pct'),
        ('Landing distance error (torso lengths)', 'advance_mae', 'torso'), ('Pelvic bounce error (% torso)', 'pelvis_osc_err', 'pp'),
        ('Knee angle error (RMSE)', 'knee_rmse', 'deg')]


def main():
    parts = [f"Runners: {DATA['runners_used']} · trials: {DATA['trials_used']} · synthetic clips: {DATA['clips']} (each scored twice: app as-is and with the aspect fix)\n"]
    side = [e for m in METHODS for o in ('portrait', 'landscape') for f in (60, 30)
            for e in rows(method=m, group='side', orientation=o, fps=f, noise='typical')]
    lab = lambda e: f"{METHODS[e['method']]} · {e['orientation']} · {e['fps']} fps"
    parts.append(table('Side view, typical detector noise: foot contacts', CONTACT, side, lab))
    parts.append(table('Side view, typical detector noise: form measures', FORM, side, lab))
    sweep = [e for m in METHODS for n in ('none', 'typical', 'hard')
             for e in rows(method=m, group='side', orientation='portrait', fps=60, noise=n)]
    nlab = lambda e: f"{METHODS[e['method']]} · noise {e['noise']}"
    parts.append(table('Noise sensitivity (side view, portrait, 60 fps)', CONTACT + FORM, sweep, nlab))
    views = [e for g in ('side', 'oblique', 'front', 'back') for o in ('portrait', 'landscape')
             for e in rows(method='app', group=g, orientation=o, fps=60, noise='typical')]
    vlab = lambda e: f"{e['group']} · {e['orientation']}"
    parts.append(table('Camera-view detection and knee angle by view (app today, 60 fps, typical noise)',
                       [('View detected correctly', 'view_ok', 'pct'), ('Knee angle error (RMSE)', 'knee_rmse', 'deg'),
                        ('Pelvic level error, front/back (% torso)', 'hip_level_err', 'pp')], views, vlab))
    fixed = [e for g in ('side', 'oblique', 'front', 'back') for e in rows(method='app+aspect_fix', group=g, orientation='portrait', fps=60, noise='typical')]
    parts.append(table('Knee angle from 2D after the aspect fix (portrait, 60 fps, typical noise)',
                       [('Knee angle error (RMSE)', 'knee_rmse', 'deg')], fixed, lambda e: e['group']))
    (RESULTS / 'phase1_tables.md').write_text('# Phase 1 tables (all runners)\n\n' + '\n'.join(parts), encoding='utf8')


if __name__ == '__main__':
    main()
