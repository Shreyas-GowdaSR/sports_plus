"""Python port of the app's current lower-body screen (frontend/src/lib/running.ts).

Ported faithfully, including two behaviours that matter for accuracy:
  - pose.ts samples the video every 1/60 s, so a 30 fps clip yields each frame twice;
  - landmarks stay in MediaPipe's normalised coordinates (x / width, y / height), so on a
    16:9 (or 9:16) video vertical and horizontal lengths are on different scales.
`aspect_fix=True` runs the same logic on pixel-proportional coordinates, to measure what
fixing the second point is worth.
"""
from __future__ import annotations

import numpy as np

from synth import Clip

L = dict(nose=0, ls=11, rs=12, lh=23, rh=24, lk=25, rk=26, la=27, ra=28, lheel=29, rheel=30, ltoe=31, rtoe=32)
MODELLED = list(L.values())


def app_samples(clip: Clip, aspect_fix: bool = False):
    """Resample to the app's 60 Hz sample times (sample-and-hold) and apply its filters."""
    times = np.arange(0, clip.time[-1] - clip.time[0], 1 / 60)
    index = np.minimum(np.searchsorted(clip.time - clip.time[0], times + 1e-9, side='right') - 1, len(clip.time) - 1)
    xy = clip.xy[index].copy()
    vis = clip.visibility[index]
    if aspect_fix:
        xy[..., 0] *= clip.width / clip.height
    confidence = vis[:, MODELLED].mean(axis=1)  # unmodelled MediaPipe points do not count
    keep = confidence >= 0.55
    return times[keep] * 1000, xy[keep], vis[keep]


def mid(xy, a, b):
    return (xy[..., a, :] + xy[..., b, :]) / 2


def torso_len(xy):
    return np.maximum(np.linalg.norm(mid(xy, L['ls'], L['rs']) - mid(xy, L['lh'], L['rh']), axis=-1), 0.001)


def forward_direction(xy):
    hip_x = mid(xy, L['lh'], L['rh'])[:, 0]
    movement = np.percentile(np.diff(hip_x), 50) if len(hip_x) > 1 else 0
    if abs(movement) > 0.00035:
        return np.sign(movement)
    lean = np.mean(mid(xy, L['ls'], L['rs'])[:, 0] - hip_x)
    return np.sign(lean) if abs(lean) > 0.008 else 0


def find_contacts(ts, xy, vis, direction):
    contacts = []
    torso = torso_len(xy)
    hip = mid(xy, L['lh'], L['rh'])
    for side, (ankle, heel, toe) in {'l': (L['la'], L['lheel'], L['ltoe']), 'r': (L['ra'], L['rheel'], L['rtoe'])}.items():
        last = -np.inf
        for i in range(2, len(ts) - 2):
            visible = vis[i, [ankle, heel, toe]].mean()
            planted = xy[i, ankle, 1] >= xy[i - 1, ankle, 1] and xy[i, ankle, 1] >= xy[i + 1, ankle, 1]
            if not planted or visible < 0.67 or ts[i] - last < 180:
                continue
            foot = max(np.linalg.norm(xy[i, toe] - xy[i, heel]), 0.018)
            pitch = (xy[i, toe, 1] - xy[i, heel, 1]) / foot
            kind = 'forefoot' if pitch > 0.17 else 'rearfoot' if pitch < -0.17 else 'midfoot'
            advance = (xy[i, ankle, 0] - hip[i, 0]) * direction / torso[i] if direction else np.nan
            contacts.append({'side': side, 't': ts[i] / 1000, 'type': kind, 'advance': advance, 'pitch': pitch, 'visible': visible, 'i': i})
            last = ts[i]
    return sorted(contacts, key=lambda c: c['t'])


def classify_view(xy):
    torso = torso_len(xy)
    spread = np.mean((np.abs(xy[:, L['ls'], 0] - xy[:, L['rs'], 0]) + np.abs(xy[:, L['lh'], 0] - xy[:, L['rh'], 0])) / (2 * torso))
    return 'side' if spread < 0.62 else 'front' if spread > 1.02 else 'oblique'


def detrended_range(values, half=12):
    trend = np.array([values[max(0, i - half):i + half + 1].mean() for i in range(len(values))])
    residual = values - trend
    return float(np.percentile(residual, 90) - np.percentile(residual, 10))


def analyse(clip: Clip, aspect_fix: bool = False) -> dict:
    ts, xy, vis = app_samples(clip, aspect_fix)
    if len(ts) < 36:
        return {'readiness': 'limited'}
    view = classify_view(xy)
    torso = torso_len(xy)
    hip = mid(xy, L['lh'], L['rh'])
    out = {'readiness': 'ready', 'view': view, 'ts': ts, 'xy': xy}
    if view != 'side':
        out['hip_level_p75'] = float(np.percentile(np.abs(xy[:, L['lh'], 1] - xy[:, L['rh'], 1]) / torso, 75))
        return out
    direction = forward_direction(xy)
    contacts = find_contacts(ts, xy, vis, direction)
    out['contacts'] = contacts
    out['pelvis_oscillation'] = detrended_range(hip[:, 1] / torso)
    counts = {k: sum(c['type'] == k for c in contacts) for k in ('rearfoot', 'midfoot', 'forefoot')}
    if len(contacts) >= 8:
        top = max(counts, key=counts.get)
        confidence = counts[top] / len(contacts) * np.mean([c['visible'] for c in contacts]) * 100
        out['strike'] = top if confidence >= 60 else 'inconclusive'
        advances = [c['advance'] for c in contacts if np.isfinite(c['advance'])]
        if out['strike'] != 'inconclusive' and len(advances) >= 6:
            out['landing'] = 'ahead-of-body' if np.mean(np.array(advances) > 0.38) >= 0.38 else 'under-body'
            out['advance_p75'] = float(np.percentile(advances, 75))
    else:
        out['strike'] = 'inconclusive'
    return out
