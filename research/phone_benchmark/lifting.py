"""3D lifting with the genuine pretrained MotionBERT (Zhu et al., ICCV 2023).

Weights and model code: huggingface.co/walterzhu/MotionBERT (Apache-2.0), downloaded to
storage/models/motionbert/ (gitignored):
  lite.bin  checkpoint/pose3d/FT_MB_lite_MB_ft_h36m_global_lite/best_epoch.bin
            (the authors' default for in-the-wild video)
  full.bin  checkpoint/pose3d/FT_MB_release_MB_ft_h36m/best_epoch.bin

Input handling follows the authors' infer_wild.py: 17 Human3.6M joints with confidence,
normalised to [-1, 1] by the clip's bounding box (crop_scale, scale 1), windows of up to
243 frames, prediction averaged with the mirrored input. Clips are resampled to 50 fps,
Human3.6M's frame rate, and the output back to the clip's frames.

Keypoint mapping from MediaPipe indices (as used by the app):
  root = mid-hips, spine = mid(root, thorax), thorax = mid-shoulders, neck/nose = nose,
  head = mid-ears + 0.35 x (mid-ears - thorax); limbs map one to one.
"""
from __future__ import annotations

import sys
from functools import partial
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import yaml

import engine2d

MODEL_DIR = Path(__file__).resolve().parents[2] / 'storage' / 'models' / 'motionbert'
CONFIGS = {'lite': 'MB_ft_h36m_global_lite.yaml', 'full': 'MB_ft_h36m.yaml'}
_models: dict[str, nn.Module] = {}


def load(variant: str = 'lite') -> nn.Module:
    if variant in _models:
        return _models[variant]
    sys.path.insert(0, str(MODEL_DIR))
    from lib.model.DSTformer import DSTformer  # noqa: E402  (MotionBERT's own code)
    cfg = yaml.safe_load((MODEL_DIR / 'configs' / 'pose3d' / CONFIGS[variant]).read_text(encoding='utf8'))
    model = DSTformer(dim_in=3, dim_out=3, dim_feat=cfg['dim_feat'], dim_rep=cfg['dim_rep'], depth=cfg['depth'],
                      num_heads=cfg['num_heads'], mlp_ratio=cfg['mlp_ratio'], norm_layer=partial(nn.LayerNorm, eps=1e-6),
                      maxlen=cfg['maxlen'], num_joints=cfg['num_joints'])
    state = torch.load(MODEL_DIR / f'{variant}.bin', map_location='cpu', weights_only=False)['model_pos']
    model.load_state_dict({k.removeprefix('module.'): v for k, v in state.items()}, strict=True)
    model.eval()
    _models[variant] = model
    return model


def to_h36m(xy: np.ndarray, conf: np.ndarray) -> np.ndarray:
    """MediaPipe-indexed T x 33 x 2 (pixels) + T x 33 confidence -> T x 17 x 3."""
    T = len(xy)
    out = np.zeros((T, 17, 3))
    j = lambda k: np.concatenate([xy[:, k], conf[:, k, None]], axis=-1)
    root = (j(23) + j(24)) / 2
    thorax = (j(11) + j(12)) / 2
    ears = (j(7) + j(8)) / 2
    head = ears.copy()
    head[:, :2] = ears[:, :2] + 0.35 * (ears[:, :2] - thorax[:, :2])
    for index, value in enumerate([root, j(24), j(26), j(28), j(23), j(25), j(27), (root + thorax) / 2, thorax, j(0), head,
                                   j(11), j(13), j(15), j(12), j(14), j(16)]):
        out[:, index] = value
    return out


def crop_scale(motion: np.ndarray) -> np.ndarray:
    """MotionBERT's utils_data.crop_scale with scale_range [1, 1]."""
    result = motion.copy()
    valid = motion[motion[..., 2] != 0][:, :2]
    xmin, ymin = valid.min(axis=0)
    xmax, ymax = valid.max(axis=0)
    scale = max(xmax - xmin, ymax - ymin)
    xs, ys = (xmin + xmax - scale) / 2, (ymin + ymax - scale) / 2
    result[..., :2] = ((motion[..., :2] - [xs, ys]) / scale - 0.5) * 2
    return np.clip(result, -1, 1)


def flip(data: torch.Tensor) -> torch.Tensor:
    left, right = [4, 5, 6, 11, 12, 13], [1, 2, 3, 14, 15, 16]
    out = data.clone()
    out[..., 0] *= -1
    out[..., left + right, :] = out[..., right + left, :]
    return out


@torch.no_grad()
def lift(xy_px: np.ndarray, conf: np.ndarray, times: np.ndarray, variant: str = 'lite') -> np.ndarray:
    """Returns T x 17 x 3 predicted joints at the input times (MotionBERT units)."""
    model = load(variant)
    grid = np.arange(times[0], times[-1] + 1e-9, 1 / 50)
    h36 = to_h36m(xy_px, conf)
    flat = h36.reshape(len(times), -1)
    resampled = np.stack([np.interp(grid, times, flat[:, k]) for k in range(flat.shape[1])], axis=-1).reshape(len(grid), 17, 3)
    motion = torch.from_numpy(crop_scale(resampled)).float()
    outputs = []
    for start in range(0, len(grid), 243):
        window = motion[start:start + 243][None]
        outputs.append(((model(window) + flip(model(flip(window)))) / 2)[0].numpy())
    pred = np.concatenate(outputs)
    flat = pred.reshape(len(grid), -1)
    return np.stack([np.interp(times, grid, flat[:, k]) for k in range(flat.shape[1])], axis=-1).reshape(len(times), 17, 3)


def knee_flexion_3d(pose: np.ndarray, side: str) -> np.ndarray:
    hip, knee, ankle = (1, 2, 3) if side == 'r' else (4, 5, 6)
    ba, bc = pose[:, hip] - pose[:, knee], pose[:, ankle] - pose[:, knee]
    cos = np.sum(ba * bc, -1) / (np.linalg.norm(ba, axis=-1) * np.linalg.norm(bc, axis=-1) + 1e-9)
    return 180 - np.degrees(np.arccos(np.clip(cos, -1, 1)))


def analyse(clip, variant: str = 'lite', params=None) -> dict:
    """Improved 2D engine for everything, with knee angles from MotionBERT's 3D output."""
    torch.set_num_threads(1)
    result = engine2d.analyse(clip, params)
    if result.get('readiness') != 'ready':
        return result
    xy = clip.xy * [clip.width, clip.height]
    conf = clip.visibility.copy()
    xy = engine2d.fill_low_visibility(np.nan_to_num(xy, nan=0.0) * (conf[..., None] > 0), conf)
    pose = lift(xy, conf, clip.time, variant)
    knee = {s: knee_flexion_3d(pose, s) for s in 'lr'}
    # Score at the engine's sample times (one per unique frame).
    sample_t = result['ts'] / 1000 + clip.time[0]
    result['knee'] = {s: np.interp(sample_t, clip.time, knee[s]) for s in 'lr'}
    return result
