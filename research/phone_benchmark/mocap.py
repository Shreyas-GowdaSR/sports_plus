"""Ground truth from the raw Fukuchi 2017 treadmill trials.

Lab frame (mm): X forward (running direction), Y up, Z to the runner's right.
Markers are sampled at 150 Hz, treadmill force at 300 Hz.

Running trials carry only tracking markers (pelvis, thigh/shank clusters, heel), so
anatomical points are rebuilt from the static calibration trial:
  - each segment's cluster in the static pose is matched to the cluster in every
    running frame with a least-squares rigid fit (Kabsch/SVD), and the static
    anatomical markers are carried along with it;
  - hip joint centre: Harrington et al. 2007 regression in the pelvis frame;
  - greater trochanter carried with the thigh cluster (phone "hip" keypoints sit
    between it and the hip joint centre);
  - knee / ankle centre: midpoint of the lateral and medial epicondyles / malleoli;
  - heel / toe: virtual points at sole level (15 mm above the floor in the standing
    trial), under the heel marker and 30% beyond the second-metatarsal head along the
    heel-to-MT2 line. They approximate the shoe heel and toe tip that phone pose models
    label "heel" and "foot index", and move rigidly with the heel cluster.

Events: initial contact / toe-off where the treadmill's vertical force crosses 50 N.
The foot in contact is the one whose ankle is further forward at that instant (this
alternated right/left on every trial; a "lowest foot" rule mislabelled ~10% at 2.5 m/s).

RBDS032 is excluded: its 2.5, 3.5 and 4.5 m/s marker and force files are byte-identical.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

RAW_DIR = Path(__file__).resolve().parents[2] / 'storage' / 'datasets' / 'fukuchi2017' / 'raw'
MARKER_HZ = 150
FORCE_HZ = 300
CONTACT_N = 50.0
EXCLUDE = {'RBDS032': 'the three speed files are byte-identical (dataset duplication)'}

CLUSTERS = {
    'thigh': ['Thigh.Top.Lateral', 'Thigh.Bottom.Lateral', 'Thigh.Top.Medial', 'Thigh.Bottom.Medial'],
    'shank': ['Shank.Top.Lateral', 'Shank.Bottom.Lateral', 'Shank.Top.Medial', 'Shank.Bottom.Medial'],
    'foot': ['Heel.Top', 'Heel.Bottom', 'Heel.Lateral'],
}
ANATOMY = {
    'thigh': ['Knee', 'Knee.Medial', 'GTR'],
    'shank': ['Ankle', 'Ankle.Medial'],
    'foot': ['HeelSole', 'ToeTip'],
}
SOLE_MM = 15.0
PELVIS = ['R.ASIS', 'L.ASIS', 'R.PSIS', 'L.PSIS']
JOINTS = ['pelvis', 'r_hip', 'l_hip', 'r_knee', 'l_knee', 'r_ankle', 'l_ankle', 'r_heel', 'l_heel', 'r_toe', 'l_toe']


def read_table(path: Path) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    with path.open(encoding='utf8') as stream:
        header = stream.readline().rstrip('\n').split('\t')
    data = np.genfromtxt(path, delimiter='\t', skip_header=1, invalid_raise=False)
    data = data[:, :len(header)]
    columns = {name: data[:, i] for i, name in enumerate(header)}
    return data[:, 0], columns


def markers(columns: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    out = {}
    for name in columns:
        if name.endswith('X') and name[:-1] + 'Y' in columns:
            base = name[:-1]
            xyz = np.stack([columns[base + 'X'], columns[base + 'Y'], columns[base + 'Z']], axis=-1)
            xyz[np.all(xyz == 0, axis=-1)] = np.nan  # exporters write 0,0,0 for gaps
            out[base] = xyz
    return out


def fill_gaps(xyz: np.ndarray, max_gap: int = 15) -> np.ndarray:
    """Linear interpolation over short gaps (<= 0.1 s); longer gaps stay NaN."""
    out = xyz.copy()
    for axis in range(3):
        values = out[:, axis]
        bad = np.isnan(values)
        if not bad.any() or bad.all():
            continue
        index = np.arange(len(values))
        filled = np.interp(index, index[~bad], values[~bad])
        # restore long gaps
        run_start = None
        for i, missing in enumerate(np.append(bad, False)):
            if missing and run_start is None:
                run_start = i
            elif not missing and run_start is not None:
                if i - run_start > max_gap:
                    filled[run_start:i] = np.nan
                run_start = None
        out[:, axis] = filled
    return out


def rigid_fit(source: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Rotation R and translation t with R @ source + t ~ target (Kabsch)."""
    cs, ct = source.mean(axis=0), target.mean(axis=0)
    u, _, vt = np.linalg.svd((source - cs).T @ (target - ct))
    d = np.sign(np.linalg.det(vt.T @ u.T))
    rotation = vt.T @ np.diag([1, 1, d]) @ u.T
    return rotation, ct - rotation @ cs


def carry(static: dict, running: dict, cluster: list[str], points: list[str]) -> dict[str, np.ndarray]:
    """Rebuild static anatomical points in every running frame from a tracked cluster."""
    source = np.stack([np.nanmean(static[m], axis=0) for m in cluster])
    anatomy = {p: np.nanmean(static[p], axis=0) for p in points}
    frames = len(running[cluster[0]])
    out = {p: np.full((frames, 3), np.nan) for p in points}
    tracked = np.stack([running[m] for m in cluster], axis=1)  # T x M x 3
    for t in range(frames):
        ok = ~np.isnan(tracked[t]).any(axis=1)
        if ok.sum() < 3:
            continue
        rotation, shift = rigid_fit(source[ok], tracked[t][ok])
        for p in points:
            out[p][t] = rotation @ anatomy[p] + shift
    return out


def pelvis_frame(rasis, lasis, rpsis, lpsis):
    origin = (rasis + lasis) / 2
    z = rasis - lasis
    z /= np.linalg.norm(z, axis=-1, keepdims=True)
    forward = origin - (rpsis + lpsis) / 2
    y = np.cross(z, forward)
    y /= np.linalg.norm(y, axis=-1, keepdims=True)
    x = np.cross(y, z)
    return origin, np.stack([x, y, z], axis=-1)  # columns are pelvis axes in lab frame


def hip_centres(m: dict) -> tuple[np.ndarray, np.ndarray]:
    origin, axes = pelvis_frame(m['R.ASIS'], m['L.ASIS'], m['R.PSIS'], m['L.PSIS'])
    width = np.nanmedian(np.linalg.norm(m['R.ASIS'] - m['L.ASIS'], axis=-1))
    depth = np.nanmedian(np.linalg.norm((m['R.ASIS'] + m['L.ASIS']) / 2 - (m['R.PSIS'] + m['L.PSIS']) / 2, axis=-1))
    local = lambda side: np.array([-0.24 * depth - 9.9, -0.30 * width - 10.9, side * (0.33 * width + 7.3)])
    right = origin + np.einsum('tij,j->ti', axes, local(+1))
    left = origin + np.einsum('tij,j->ti', axes, local(-1))
    return right, left


@dataclass
class Trial:
    subject: str
    speed: float                 # treadmill speed, m/s
    time: np.ndarray             # s, marker samples
    joints: dict[str, np.ndarray]  # name -> T x 3 (mm)
    contacts: list[dict] = field(default_factory=list)  # {side, ic, to} in seconds
    static_foot_angle: dict[str, float] = field(default_factory=dict)  # deg, standing


def foot_angle(heel: np.ndarray, toe: np.ndarray) -> np.ndarray:
    """Sagittal angle of the heel-to-toe line, + when the toe is higher (dorsiflexed)."""
    d = toe - heel
    return np.degrees(np.arctan2(d[..., 1], np.hypot(d[..., 0], d[..., 2])))


def load_trial(subject: str, speed_code: str) -> Trial:
    _, s_cols = read_table(RAW_DIR / f'{subject}static.txt')
    static = markers(s_cols)
    for side in 'RL':  # virtual sole-level heel and toe tip in the standing pose
        heel = np.nanmean(static[f'{side}.Heel.Bottom'], axis=0)
        mt2 = np.nanmean(static[f'{side}.MT2'], axis=0)
        static[f'{side}.HeelSole'] = np.array([[heel[0], SOLE_MM, heel[2]]])
        tip = mt2 + 0.3 * (mt2 - heel)
        static[f'{side}.ToeTip'] = np.array([[tip[0], SOLE_MM, tip[2]]])
    time, r_cols = read_table(RAW_DIR / f'{subject}run{speed_code}markers.txt')
    run = {name: fill_gaps(xyz) for name, xyz in markers(r_cols).items()}

    joints: dict[str, np.ndarray] = {}
    joints['r_hip'], joints['l_hip'] = hip_centres(run)
    joints['pelvis'] = (joints['r_hip'] + joints['l_hip']) / 2
    feet_static = {}
    for side, s in (('R', 'r'), ('L', 'l')):
        for segment, cluster in CLUSTERS.items():
            names = [f'{side}.{m}' for m in cluster]
            built = carry(static, run, names, [f'{side}.{p}' for p in ANATOMY[segment]])
            if segment == 'thigh':
                joints[f'{s}_knee'] = (built[f'{side}.Knee'] + built[f'{side}.Knee.Medial']) / 2
                joints[f'{s}_gtr'] = built[f'{side}.GTR']  # greater trochanter, for the 2D "hip" keypoint
            elif segment == 'shank':
                joints[f'{s}_ankle'] = (built[f'{side}.Ankle'] + built[f'{side}.Ankle.Medial']) / 2
            else:
                joints[f'{s}_heel'] = built[f'{side}.HeelSole']
                joints[f'{s}_toe'] = built[f'{side}.ToeTip']
                feet_static[s] = float(foot_angle(static[f'{side}.HeelSole'][0], static[f'{side}.ToeTip'][0]))

    trial = Trial(subject, int(speed_code[1:]) / 10, time, joints, static_foot_angle=feet_static)
    trial.contacts = contact_events(subject, speed_code, trial)
    return trial


def contact_events(subject: str, speed_code: str, trial: Trial) -> list[dict]:
    _, f_cols = read_table(RAW_DIR / f'{subject}run{speed_code}forces.txt')
    fy = f_cols['Fy']
    t = np.arange(len(fy)) / FORCE_HZ
    loaded = fy > CONTACT_N
    edges = np.diff(loaded.astype(int))
    starts, ends = np.where(edges == 1)[0] + 1, np.where(edges == -1)[0] + 1
    events = []
    for start in starts:
        after = ends[ends > start]
        if not len(after):
            break
        end = after[0]
        if (end - start) / FORCE_HZ < 0.08:  # ignore noise blips; running stance is > 0.15 s
            continue
        ic, to = t[start], t[end]
        frame = int(round(ic * MARKER_HZ))
        if frame >= len(trial.time):
            break
        ahead = {s: trial.joints[f'{s}_ankle'][frame, 0] for s in 'rl'}
        if any(np.isnan(v) for v in ahead.values()):
            continue
        events.append({'side': max(ahead, key=ahead.get), 'ic': float(ic), 'to': float(to),
                       'peak_n': float(fy[start:end].max())})
    return events


def subjects() -> list[str]:
    return sorted({p.name[:7] for p in RAW_DIR.glob('RBDS*static.txt')} - set(EXCLUDE))


def body_info() -> dict[str, dict]:
    """Height (m) and mass (kg) per subject from RBDSinfo.txt."""
    path = RAW_DIR / 'RBDSinfo.txt'
    if not path.exists():
        return {}
    lines = path.read_text(encoding='utf8', errors='replace').splitlines()
    header = lines[0].split('\t')
    out = {}
    for line in lines[1:]:
        row = dict(zip(header, line.split('\t')))
        try:
            subject = f"RBDS{int(float(row.get('Subject', row.get('ID', 'nan')))):03d}"
        except ValueError:
            continue
        out[subject] = row
    return out
