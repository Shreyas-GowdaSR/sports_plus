"""
SportsAI+ — Pose Extraction Service
Phase 1: No fake/synthetic landmarks.
Phase 2: MediaPipe initialised ONCE per process, frame sampling is configurable.
Phase 2: Timing logged per stage.
"""
import time
import math
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Optional

# MediaPipe model path
MODEL_PATH = Path(__file__).resolve().parents[3] / "models" / "pose_landmarker_full.task"
ANALYSIS_FPS = 15   # sample rate for analysis — enough for cadence/GCT/symmetry


@dataclass
class PoseFrame:
    frame_index:  int
    timestamp_ms: float
    landmarks:    List[Dict]   # [{id, x, y, z, visibility}]
    confidence:   float        # mean landmark visibility


@dataclass
class ExtractionResult:
    frames:           List[PoseFrame]
    total_frames:     int
    usable_frames:    int
    rejected_frames:  int
    avg_confidence:   float
    confidence_level: str      # "High" | "Medium" | "Low" | "Insufficient"
    duration_sec:     float
    fps:              float
    timings:          Dict[str, float] = field(default_factory=dict)
    error:            Optional[str]    = None


# ── Singleton landmarker ─────────────────────────────────────────────────────
_landmarker = None

def _get_landmarker():
    global _landmarker
    if _landmarker is not None:
        return _landmarker

    import mediapipe as mp
    from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

    if not MODEL_PATH.exists():
        import urllib.request
        print("[Pose] Downloading MediaPipe model...")
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
            "pose_landmarker_full/float16/latest/pose_landmarker_full.task",
            str(MODEL_PATH))
        print(f"[Pose] Model saved → {MODEL_PATH}")

    options = PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5)

    _landmarker = PoseLandmarker.create_from_options(options)
    print("[Pose] MediaPipe PoseLandmarker initialised (singleton)")
    return _landmarker


def extract_pose_frames(
    video_path: str,
    target_fps: float = ANALYSIS_FPS,
    min_confidence: float = 0.55,
) -> ExtractionResult:
    """
    Extract pose landmarks from video.

    Key guarantees:
    - MediaPipe is initialised ONCE (singleton)
    - If pose detection fails for a frame, that frame is REJECTED — no fake landmarks
    - If too few usable frames, confidence_level = "Insufficient"
    - Full timing log returned
    """
    timings: Dict[str, float] = {}
    t_start = time.perf_counter()

    import cv2
    import mediapipe as mp

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return ExtractionResult(
            frames=[], total_frames=0, usable_frames=0, rejected_frames=0,
            avg_confidence=0.0, confidence_level="Insufficient",
            duration_sec=0.0, fps=0.0, error="Cannot open video file")

    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_sec  = total_frames / source_fps if source_fps > 0 else 0.0
    sample_every  = max(1, round(source_fps / target_fps))

    timings["video_open"] = time.perf_counter() - t_start
    t_pose = time.perf_counter()

    landmarker = _get_landmarker()
    pose_frames: List[PoseFrame] = []
    rejected = 0
    fn = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        fn += 1
        if fn % sample_every != 0:
            continue

        # Convert to RGB for MediaPipe
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect(mp_img)

        if not result.pose_landmarks or not result.pose_landmarks[0]:
            # No person detected — reject frame entirely, no fake data
            rejected += 1
            continue

        raw_lm    = result.pose_landmarks[0]
        landmarks = [
            {"id": i, "x": float(lm.x), "y": float(lm.y),
             "z": float(lm.z), "visibility": float(lm.visibility)}
            for i, lm in enumerate(raw_lm)
        ]
        confidence = sum(lm["visibility"] for lm in landmarks) / len(landmarks)

        if confidence < min_confidence:
            # Too many occluded landmarks — reject
            rejected += 1
            continue

        pose_frames.append(PoseFrame(
            frame_index=fn,
            timestamp_ms=(fn / source_fps) * 1000,
            landmarks=landmarks,
            confidence=confidence))

    cap.release()
    timings["pose_extraction"] = time.perf_counter() - t_pose

    # Compute stats
    usable = len(pose_frames)
    avg_conf = sum(f.confidence for f in pose_frames) / max(usable, 1)

    # Classify confidence level
    if usable < 20:
        level = "Insufficient"
    elif avg_conf >= 0.85 and usable / max(total_frames // sample_every, 1) >= 0.80:
        level = "High"
    elif avg_conf >= 0.70:
        level = "Medium"
    else:
        level = "Low"

    timings["total"] = time.perf_counter() - t_start

    print(
        f"[Pose] Extracted {usable}/{total_frames//sample_every} usable frames "
        f"| rejected={rejected} | avg_conf={avg_conf:.2f} | level={level} "
        f"| {timings['pose_extraction']:.2f}s")

    return ExtractionResult(
        frames=pose_frames,
        total_frames=total_frames,
        usable_frames=usable,
        rejected_frames=rejected,
        avg_confidence=round(avg_conf, 3),
        confidence_level=level,
        duration_sec=duration_sec,
        fps=source_fps,
        timings=timings)
