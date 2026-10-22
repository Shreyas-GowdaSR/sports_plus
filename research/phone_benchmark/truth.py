"""Ground-truth measures for one trial, computed from 3D motion capture and force plate.

Every measure mirrors something the app reports (or will report after Phase 2), so the
same quantity can be compared between truth and a phone-video estimate.
"""
from __future__ import annotations

import numpy as np

from mocap import MARKER_HZ, RAW_DIR, Trial, foot_angle

TORSO = 0.288  # shoulder-to-hip length as a fraction of height (Winter 2009)
STRIKE = {'Rearfoot': 'rearfoot', 'Midfoot': 'midfoot', 'Forefoot': 'forefoot'}


def author_strike_labels() -> dict[tuple[str, str, str], str]:
    """(subject, side, speed code) -> rearfoot / midfoot / forefoot, from RBDSinfo.txt.

    The dataset authors classified foot strike for each foot and speed (columns
    RFSI25 ... LFSI45)."""
    lines = (RAW_DIR / 'RBDSinfo.txt').read_text(encoding='utf8', errors='replace').splitlines()
    header = lines[0].split('\t')
    labels = {}
    for line in lines[1:]:
        row = dict(zip(header, line.split('\t')))
        subject = f"RBDS{int(row['Subject']):03d}"
        for side in 'RL':
            for code in ('25', '35', '45'):
                value = STRIKE.get(row.get(f'{side}FSI{code}', '').strip())
                if value:
                    labels[(subject, side.lower(), f'T{code}')] = value
    return labels


def heights() -> dict[str, float]:
    lines = (RAW_DIR / 'RBDSinfo.txt').read_text(encoding='utf8', errors='replace').splitlines()
    header = lines[0].split('\t')
    out = {}
    for line in lines[1:]:
        row = dict(zip(header, line.split('\t')))
        out[f"RBDS{int(row['Subject']):03d}"] = float(row['Height']) * 10  # cm -> mm
    return out


def included_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Angle ABC in degrees (works for 2D or 3D points, shape ... x D)."""
    ba, bc = a - b, c - b
    cos = np.sum(ba * bc, axis=-1) / (np.linalg.norm(ba, axis=-1) * np.linalg.norm(bc, axis=-1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def knee_flexion(j: dict, side: str) -> np.ndarray:
    """0 deg = straight knee."""
    return 180 - included_angle(j[f'{side}_hip'], j[f'{side}_knee'], j[f'{side}_ankle'])


def detrended_range(values: np.ndarray, half_window: int) -> float:
    kernel = np.ones(2 * half_window + 1) / (2 * half_window + 1)
    padded = np.pad(values, half_window, mode='edge')
    trend = np.convolve(padded, kernel, mode='valid')
    residual = values - trend
    return float(np.percentile(residual, 90) - np.percentile(residual, 10))


def trial_truth(trial: Trial, height_mm: float, start_s: float, seconds: float) -> dict:
    j = trial.joints
    torso = TORSO * height_mm
    window = (trial.time >= start_s) & (trial.time < start_s + seconds)
    contacts = []
    for event in trial.contacts:
        if not start_s <= event['ic'] < start_s + seconds:
            continue
        side, f = event['side'], int(round(event['ic'] * MARKER_HZ))
        stance = slice(f, int(round(event['to'] * MARKER_HZ)) + 1)
        contacts.append({
            **event,
            'foot_angle': float(foot_angle(j[f'{side}_heel'][f], j[f'{side}_toe'][f]) - trial.static_foot_angle[side]),
            'advance': float((j[f'{side}_ankle'][f, 0] - j['pelvis'][f, 0]) / torso),
            'knee_ic': float(knee_flexion(j, side)[f]),
            'knee_peak': float(np.nanmax(knee_flexion(j, side)[stance])),
        })
    duration = contacts[-1]['ic'] - contacts[0]['ic'] if len(contacts) > 1 else np.nan
    # Pelvic obliquity: angle of the hip-centre line in the frontal (Y-Z) plane.
    d = j['r_hip'][window] - j['l_hip'][window]
    obliquity = np.degrees(np.arctan2(d[:, 1], np.abs(d[:, 2])))
    hip_gap = np.abs(d[:, 1]) / torso
    pelvis_y = j['pelvis'][window, 1] / torso
    return {
        'contacts': contacts,
        'cadence': 60 * (len(contacts) - 1) / duration if duration == duration else np.nan,
        'pelvis_oscillation': detrended_range(pelvis_y, int(MARKER_HZ * 12 / 30)),  # app uses +-12 frames at 30 fps
        'pelvic_obliquity_range': float(np.percentile(obliquity, 95) - np.percentile(obliquity, 5)),
        'hip_level_p75': float(np.percentile(hip_gap, 75)),
        'advance_p75': float(np.percentile([c['advance'] for c in contacts], 75)) if contacts else np.nan,
        'landing': ('ahead-of-body' if np.mean([c['advance'] > 0.38 for c in contacts]) >= 0.38 else 'under-body') if contacts else None,
    }
