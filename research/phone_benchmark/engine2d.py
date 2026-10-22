"""Improved 2D form-check engine (Phase 2), same keypoints and output as the app.

Each step is simple enough to port to frontend/src/lib/running.ts:
  1. unique frames: pose.ts samples every 1/60 s; repeated frames are dropped
  2. aspect fix: x is rescaled by width / height so lengths and angles are true to pixels
  3. leg identity: left/right labels are swapped back where swapping makes the motion
     more continuous; low-visibility frames are filled by interpolation
  4. smoothing: zero-phase 2nd-order Butterworth low-pass (CUTOFF_HZ)
  5. contacts: one candidate per stride where the ankle is furthest forward of the hips
     (Zeni et al. 2008), refined to the first frame the foot gets near that stride's lowest point
  6. foot strike: 2D foot angle at contact, thresholds tuned on development runners
Parameters live in PARAMS and are tuned only on development runners (tune_engine2d.py).
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, filtfilt

from app_baseline import MODELLED, L, app_samples

PARAMS = {
    'cutoff_hz': 6.0,        # low-pass cutoff
    'ground_tol': 0.03,      # foot within this many torso lengths of its stride's lowest point = touching
    'ic_bias_ms': 0.0,       # constant correction learned on development runners
    'rear_deg': 8.0,         # foot angle above this: rearfoot
    'fore_deg': -2.0,        # foot angle below this: forefoot
    'side_spread': 0.25,     # view classification on aspect-corrected coordinates (dev: side <=0.10, oblique >=0.41)
    'front_spread': 0.60,    # (dev: oblique <=0.53, front/back >=0.66)
}
PAIRS = [(L['lh'], L['rh']), (L['lk'], L['rk']), (L['la'], L['ra']), (L['lheel'], L['rheel']), (L['ltoe'], L['rtoe'])]
LEGS = {'l': (L['lh'], L['lk'], L['la'], L['lheel'], L['ltoe']), 'r': (L['rh'], L['rk'], L['ra'], L['rheel'], L['rtoe'])}


def unique_frames(ts, xy, vis):
    keep = np.ones(len(ts), bool)
    keep[1:] = np.any(np.abs(np.diff(xy, axis=0)) > 1e-9, axis=(1, 2))
    return ts[keep], xy[keep], vis[keep]


def fix_swaps(xy):
    """Swap left/right leg labels on frames where that makes the legs move less."""
    xy = xy.copy()
    left = [a for a, _ in PAIRS]
    right = [b for _, b in PAIRS]
    for t in range(1, len(xy)):
        keep = np.linalg.norm(xy[t, left] - xy[t - 1, left], axis=-1).sum() + np.linalg.norm(xy[t, right] - xy[t - 1, right], axis=-1).sum()
        swap = np.linalg.norm(xy[t, right] - xy[t - 1, left], axis=-1).sum() + np.linalg.norm(xy[t, left] - xy[t - 1, right], axis=-1).sum()
        if swap < 0.7 * keep:
            xy[t, left + right] = xy[t, right + left]
    return xy


def fill_low_visibility(xy, vis, minimum=0.5):
    xy = xy.copy()
    bad = (vis[:, MODELLED].mean(axis=1) < minimum) | np.isnan(xy[:, MODELLED]).any(axis=(1, 2))
    if bad.any() and (~bad).sum() > 2:
        index = np.arange(len(xy))
        for k in MODELLED:
            for d in range(2):
                xy[bad, k, d] = np.interp(index[bad], index[~bad], xy[~bad, k, d])
    return xy


def smooth(xy, fps, cutoff):
    if cutoff <= 0 or len(xy) < 15 or cutoff >= fps / 2:
        return xy
    b, a = butter(2, cutoff / (fps / 2))
    return filtfilt(b, a, xy, axis=0)


def mid(xy, a, b):
    return (xy[:, a] + xy[:, b]) / 2


def knee_angle(xy, side):
    hip, knee, ankle = LEGS[side][:3]
    ba, bc = xy[:, hip] - xy[:, knee], xy[:, ankle] - xy[:, knee]
    cos = np.sum(ba * bc, -1) / (np.linalg.norm(ba, axis=-1) * np.linalg.norm(bc, axis=-1) + 1e-9)
    return 180 - np.degrees(np.arccos(np.clip(cos, -1, 1)))


def find_contacts(ts, xy, torso, direction, fps, p):
    contacts = []
    hip = mid(xy, L['lh'], L['rh'])
    min_gap = int(0.35 * fps)  # same foot cannot land twice within 0.35 s
    for side, (_, _, ankle, heel, toe) in LEGS.items():
        reach = (xy[:, ankle, 0] - hip[:, 0]) * direction / torso
        foot_low = np.maximum(xy[:, heel, 1], xy[:, toe, 1])  # image y grows downward
        peaks = [i for i in range(1, len(reach) - 1) if reach[i] >= reach[i - 1] and reach[i] > reach[i + 1] and reach[i] > 0]
        chosen, last = [], -min_gap
        for i in peaks:  # keep the largest peak within each 0.35 s window
            if i - last < min_gap and chosen:
                if reach[i] > reach[chosen[-1]]:
                    chosen[-1], last = i, i
                continue
            chosen.append(i)
            last = i
        for i in chosen:
            # This stride's ground level: the foot's lowest point in the next 0.25 s.
            end = min(len(ts), i + int(0.25 * fps) + 1)
            local_ground = foot_low[i:end].max()
            j = i
            while j < end - 1 and (local_ground - foot_low[j]) / torso[j] > p['ground_tol']:
                j += 1
            t = ts[j] / 1000 + p['ic_bias_ms'] / 1000
            j = min(len(ts) - 1, max(0, j + int(round(p['ic_bias_ms'] / 1000 * fps))))  # measure at the corrected contact
            d = xy[j, toe] - xy[j, heel]
            angle = np.degrees(np.arctan2(-d[1], abs(d[0]) + 1e-9))  # + when the toe is higher
            kind = 'rearfoot' if angle > p['rear_deg'] else 'forefoot' if angle < p['fore_deg'] else 'midfoot'
            contacts.append({'side': side, 't': t, 'type': kind, 'angle': float(angle), 'i': j, 'visible': 0.95,
                             'advance': float((xy[j, ankle, 0] - hip[j, 0]) * direction / torso[j])})
    return sorted(contacts, key=lambda c: c['t'])


def detrended_range(values, fps, window_s=0.4):
    half = max(1, int(window_s * fps))
    trend = np.array([values[max(0, i - half):i + half + 1].mean() for i in range(len(values))])
    residual = values - trend
    return float(np.percentile(residual, 90) - np.percentile(residual, 10))


def analyse(clip, params=None) -> dict:
    p = {**PARAMS, **(params or {})}
    ts, xy, vis = app_samples(clip, aspect_fix=True)
    ts, xy, vis = unique_frames(ts, xy, vis)
    xy = xy.copy()
    xy[:, ~np.isin(np.arange(33), MODELLED)] = 0.0  # points the benchmark does not model
    if len(ts) < 36:
        return {'readiness': 'limited'}
    fps = 1000 / np.median(np.diff(ts))
    xy = smooth(fill_low_visibility(fix_swaps(xy), vis), fps, p['cutoff_hz'])
    shoulder, hip = mid(xy, L['ls'], L['rs']), mid(xy, L['lh'], L['rh'])
    torso = np.maximum(np.linalg.norm(shoulder - hip, axis=-1), 1e-3)
    spread = np.mean((np.abs(xy[:, L['ls'], 0] - xy[:, L['rs'], 0]) + np.abs(xy[:, L['lh'], 0] - xy[:, L['rh'], 0])) / (2 * torso))
    view = 'side' if spread < p['side_spread'] else 'front' if spread > p['front_spread'] else 'oblique'
    out = {'readiness': 'ready', 'view': view, 'ts': ts, 'xy': xy, 'knee': {s: knee_angle(xy, s) for s in 'lr'}}
    if view == 'front':
        out['hip_level_p75'] = float(np.percentile(np.abs(xy[:, L['lh'], 1] - xy[:, L['rh'], 1]) / torso, 75))
        return out
    travel = np.median(np.diff(hip[:, 0]))
    lean = np.mean(shoulder[:, 0] - hip[:, 0])
    direction = np.sign(travel) if abs(travel) > 1e-4 else np.sign(lean)
    contacts = find_contacts(ts, xy, torso, direction, fps, p) if direction else []
    out['contacts'] = contacts
    out['pelvis_oscillation'] = detrended_range(hip[:, 1] / torso, fps)
    if len(contacts) >= 8:
        counts = {k: sum(c['type'] == k for c in contacts) for k in ('rearfoot', 'midfoot', 'forefoot')}
        out['strike'] = max(counts, key=counts.get)
        advances = np.array([c['advance'] for c in contacts])
        out['landing'] = 'ahead-of-body' if np.mean(advances > 0.38) >= 0.38 else 'under-body'
        out['advance_p75'] = float(np.percentile(advances, 75))
    else:
        out['strike'] = 'inconclusive'
    return out
