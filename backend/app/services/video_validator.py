"""
SportsAI+ — Video Validator
Phase 1: Validate video before analysis. Reject bad inputs with clear errors.
"""
import os
import subprocess
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
MAX_FILE_SIZE_MB   = 500
MIN_DURATION_SEC   = 2.0
MAX_DURATION_SEC   = 300.0
MIN_FPS            = 5.0
MIN_WIDTH          = 240
MIN_HEIGHT         = 180


@dataclass
class VideoInfo:
    duration: float
    fps: float
    width: int
    height: int
    codec: str


@dataclass
class ValidationResult:
    valid: bool
    error: Optional[str]
    video_info: Optional[VideoInfo]


def validate_video(path: str) -> ValidationResult:
    """
    Validate a video file before running pose detection.
    Returns ValidationResult with user-friendly error messages.
    """
    p = Path(path)

    # File exists
    if not p.exists():
        return ValidationResult(False, "Video file not found.", None)

    # Extension
    if p.suffix.lower() not in ALLOWED_EXTENSIONS:
        return ValidationResult(
            False,
            f"Unsupported file type '{p.suffix}'. Please upload MP4, MOV, WebM, AVI, or MKV.",
            None)

    # File size
    size_mb = p.stat().st_size / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        return ValidationResult(
            False,
            f"File is {size_mb:.0f} MB. Please upload a video under {MAX_FILE_SIZE_MB} MB.",
            None)

    if size_mb < 0.001:
        return ValidationResult(False, "File appears to be empty.", None)

    # Try to read video properties with OpenCV
    try:
        import cv2
        cap = cv2.VideoCapture(str(p))
        if not cap.isOpened():
            return ValidationResult(
                False,
                "The video file could not be opened. It may be corrupted or encoded in an unsupported format.",
                None)

        fps    = cap.get(cv2.CAP_PROP_FPS) or 0
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        cap.release()

        # Compute duration — some codecs report 0 frames so use a fallback
        duration = frames / fps if fps > 0 and frames > 0 else 0.0

        if fps < MIN_FPS:
            return ValidationResult(
                False,
                f"Video frame rate is too low ({fps:.1f} fps). Please use a video with at least {MIN_FPS} fps.",
                None)

        if width < MIN_WIDTH or height < MIN_HEIGHT:
            return ValidationResult(
                False,
                f"Video resolution is too low ({width}×{height}). Please use at least {MIN_WIDTH}×{MIN_HEIGHT}.",
                None)

        if duration > 0 and duration < MIN_DURATION_SEC:
            return ValidationResult(
                False,
                f"Video is too short ({duration:.1f}s). Please upload at least {MIN_DURATION_SEC:.0f} seconds of footage.",
                None)

        if duration > MAX_DURATION_SEC:
            return ValidationResult(
                False,
                f"Video is too long ({duration:.0f}s). Please upload a clip under {MAX_DURATION_SEC:.0f} seconds.",
                None)

        # Try reading at least one frame
        cap2 = cv2.VideoCapture(str(p))
        ok, frame = cap2.read()
        cap2.release()
        if not ok or frame is None:
            return ValidationResult(
                False,
                "Could not read frames from this video. It may be corrupted.",
                None)

        return ValidationResult(
            True, None,
            VideoInfo(
                duration=duration if duration > 0 else frames / fps,
                fps=fps, width=width, height=height,
                codec="unknown"))

    except Exception as e:
        return ValidationResult(
            False,
            "Video validation failed. The file may be corrupted or use an unsupported codec.",
            None)
