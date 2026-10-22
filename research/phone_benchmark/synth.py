"""Synthetic phone-camera clips from real 3D running motion.

Each clip projects one Fukuchi treadmill trial through a pinhole phone camera
(main camera, 69 deg field of view across the long side of a 1920x1080 frame, held in
landscape or portrait), 3-7 m away at 0.8-1.4 m height with up to ~1.5 deg of hand-held
roll. Trajectories are interpolated to an exact 30 or 60 fps grid. Then pose-detector
noise is added:

  none     exact projection (upper bound for any 2D method)
  typical  Gaussian jitter of 1% of the runner's image height plus a slowly varying
           (AR(1), rho 0.85) offset of 0.7%; heel/toe x1.5; the far leg x1.5 in side views
  hard     twice the typical noise, plus left/right leg swaps on ~3% of side-view frames
           (2-5 frames each) and ~2% dropped frames (low visibility)

The noise levels are assumptions, not measured detector errors (Fukuchi has no video).
They are reported as a sensitivity sweep.

Keypoint semantics: the 2D "hip" is placed halfway between the hip joint centre and the
greater trochanter, as phone pose models label the side of the hip; ground-truth angles
still use joint centres. Heel and toe are sole-level points (see mocap.py).

The motion capture covers only the pelvis and legs. Pose pipelines also need shoulders
(for scale and direction), so a rigid synthetic upper body is attached to the pelvis
(torso 0.288 x height, 6 deg forward lean, shoulder width 0.259 x height, Winter 2009
proportions). No upper-body measure is scored.

Keypoints follow MediaPipe's indices for the joints we have:
0 nose, 11/12 shoulders, 23/24 hips, 25/26 knees, 27/28 ankles, 29/30 heels, 31/32 toes.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import lfilter

from mocap import Trial

LONG, SHORT = 1920, 1080
FOCAL = (LONG / 2) / np.tan(np.radians(69 / 2))
VIEWS = {'side_right': 90, 'side_left': 270, 'oblique_front_right': 45, 'oblique_back_left': 225, 'front': 0, 'back': 180}
NOISE = {'none': 0.0, 'typical': 1.0, 'hard': 2.0}
MP = {'nose': 0, 'l_shoulder': 11, 'r_shoulder': 12, 'l_hip': 23, 'r_hip': 24, 'l_knee': 25, 'r_knee': 26,
      'l_ankle': 27, 'r_ankle': 28, 'l_heel': 29, 'r_heel': 30, 'l_toe': 31, 'r_toe': 32}
LEGS = [('l_hip', 'r_hip'), ('l_knee', 'r_knee'), ('l_ankle', 'r_ankle'), ('l_heel', 'r_heel'), ('l_toe', 'r_toe')]


@dataclass
class Clip:
    trial: str
    view: str
    azimuth: float
    fps: int
    noise: str
    orientation: str
    width: int
    height: int
    time: np.ndarray        # s (trial clock)
    xy: np.ndarray          # T x 33 x 2, normalised image coords (x / width, y / height) like MediaPipe
    visibility: np.ndarray  # T x 33
    xy_true: np.ndarray     # T x 33 x 2, noise-free projection (normalised)
    cam_joints: np.ndarray  # T x 33 x 3, 3D keypoints in the camera frame (mm), for lifting evaluation
    height_px: float        # runner's approximate image height


def upper_body(points: dict[str, np.ndarray], height_mm: float) -> dict[str, np.ndarray]:
    pelvis = points['pelvis']
    lateral = points['r_hip'] - points['l_hip']
    lateral = lateral / np.linalg.norm(lateral, axis=-1, keepdims=True)
    lean = np.radians(6)
    up = np.array([np.sin(lean), np.cos(lean), 0.0])  # tipped toward +X (forward)
    shoulder_mid = pelvis + 0.288 * height_mm * up
    half = 0.259 * height_mm / 2
    return {'r_shoulder': shoulder_mid + half * lateral, 'l_shoulder': shoulder_mid - half * lateral,
            'nose': shoulder_mid + 0.17 * height_mm * up + np.array([60.0, 0, 0])}


def camera(azimuth_deg: float, distance_mm: float, height_mm: float, target: np.ndarray, rng: np.random.Generator):
    a = np.radians(azimuth_deg)
    position = target + distance_mm * np.array([np.cos(a), 0.0, np.sin(a)])
    position[1] = height_mm
    forward = target - position
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0.0, 1.0, 0.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    roll = np.radians(rng.normal(0, 1.5))  # hand-held tilt
    right, up = np.cos(roll) * right + np.sin(roll) * up, -np.sin(roll) * right + np.cos(roll) * up
    return position, np.stack([right, up, forward])  # rows: camera axes in lab frame


def resample(trial: Trial, times: np.ndarray) -> dict[str, np.ndarray]:
    out = {}
    for name, xyz in trial.joints.items():
        out[name] = np.stack([np.interp(times, trial.time, xyz[:, k], left=np.nan, right=np.nan) for k in range(3)], axis=-1)
    return out


def make_clip(trial: Trial, height_mm: float, view: str, fps: int, noise: str, seed: int,
              start_s: float = 2.0, seconds: float = 12.0, orientation: str = 'landscape') -> Clip:
    rng = np.random.default_rng(seed)
    times = start_s + np.arange(int(seconds * fps)) / fps
    times = times[times <= trial.time[-1]]
    joints = resample(trial, times)
    points = {name: joints[name] for name in ('pelvis', 'r_knee', 'l_knee', 'r_ankle', 'l_ankle', 'r_heel', 'l_heel', 'r_toe', 'l_toe')}
    for s in 'rl':
        points[f'{s}_hip'] = (joints[f'{s}_hip'] + joints[f'{s}_gtr']) / 2
    points.update(upper_body({'pelvis': joints['pelvis'], 'r_hip': joints['r_hip'], 'l_hip': joints['l_hip']}, height_mm))
    world = np.full((len(times), 33, 3), np.nan)
    for name, k in MP.items():
        world[:, k] = points[name]

    width, height = (LONG, SHORT) if orientation == 'landscape' else (SHORT, LONG)
    azimuth = VIEWS[view] + rng.normal(0, 4)
    target = np.nanmean(joints['pelvis'], axis=0)
    position, axes = camera(azimuth, rng.uniform(3000, 7000), rng.uniform(800, 1400), target, rng)
    cam = (world - position) @ axes.T  # T x 33 x 3; x right, y up, z depth
    xy_px = np.stack([width / 2 + FOCAL * cam[..., 0] / cam[..., 2], height / 2 - FOCAL * cam[..., 1] / cam[..., 2]], axis=-1)
    used = list(MP.values())
    height_px = float(np.nanmedian(np.nanmax(xy_px[:, used, 1], axis=1) - np.nanmin(xy_px[:, used, 1], axis=1)))

    visibility = np.zeros((len(times), 33))
    visibility[:, used] = 0.95
    noisy = xy_px.copy()
    scale = NOISE[noise] * height_px / 100
    far = 'l' if view == 'side_right' else 'r' if view == 'side_left' else None
    if scale > 0:
        for name, k in MP.items():
            factor = 1.5 if name.endswith(('heel', 'toe')) else 1.0
            if far and name.startswith(far + '_'):
                factor *= 1.5
                visibility[:, k] = 0.75
            jitter = rng.normal(0, scale * factor, (len(times), 2))
            innovations = rng.normal(0, 0.7 * scale * factor * np.sqrt(1 - 0.85 ** 2), (len(times), 2))
            noisy[:, k] += jitter + lfilter([1.0], [1.0, -0.85], innovations, axis=0)  # AR(1), rho 0.85
        if noise == 'hard':
            if view.startswith('side'):  # leg identity swaps, the classic side-view failure
                t = 0
                while t < len(times):
                    if rng.random() < 0.03 / 3.5:
                        span = int(rng.integers(2, 6))
                        for left, right in LEGS:
                            a, b = MP[left], MP[right]
                            noisy[t:t + span, [a, b]] = noisy[t:t + span, [b, a]]
                        t += span
                    t += 1
            visibility[rng.random(len(times)) < 0.02] = 0.3
    norm = np.array([width, height])
    return Clip(f'{trial.subject}_{trial.speed:.1f}', view, float(azimuth), fps, noise, orientation, width, height,
                times, noisy / norm, visibility, xy_px / norm, cam, height_px)
