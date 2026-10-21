"""
SportsAI+ — Analysis Service (Phase 2: background jobs, timing, fast+deep)
"""
import sys, json, time, uuid, threading
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional
from dataclasses import dataclass, field, asdict

from app.config import AI_DIR, RESULTS_DIR
from app.services.video_validator import validate_video
from app.services.pose_service import extract_pose_frames, ExtractionResult

sys.path.insert(0, str(AI_DIR))

# ── Job store (in-memory; replace with Supabase for production) ──────────────
_jobs: Dict[str, dict] = {}
_lock = threading.Lock()

JOB_STATUSES = ("queued", "validating", "extracting", "analysing", "generating", "completed", "failed")


def _new_job(video_path: str, country: str) -> str:
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            "id":         job_id,
            "status":     "queued",
            "stage":      "Queued",
            "video_path": video_path,
            "country":    country,
            "created_at": datetime.utcnow().isoformat(),
            "result":     None,
            "error":      None,
            "timings":    {},
        }
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    return _jobs.get(job_id)


def _set_stage(job_id: str, status: str, stage: str):
    with _lock:
        if job_id in _jobs:
            _jobs[job_id]["status"] = status
            _jobs[job_id]["stage"]  = stage


def _fail_job(job_id: str, error: str):
    with _lock:
        if job_id in _jobs:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"]  = error
            _jobs[job_id]["stage"]  = "Failed"


def _complete_job(job_id: str, result: dict, timings: dict):
    with _lock:
        if job_id in _jobs:
            _jobs[job_id]["status"]  = "completed"
            _jobs[job_id]["stage"]   = "Complete"
            _jobs[job_id]["result"]  = result
            _jobs[job_id]["timings"] = timings


# ── Pipeline cache (one per country) ─────────────────────────────────────────
_pipelines: Dict[str, object] = {}
_pipeline_lock = threading.Lock()

def _get_pipeline(country: str):
    with _pipeline_lock:
        if country not in _pipelines:
            from pipeline.pipeline import SportsAIPipeline
            _pipelines[country] = SportsAIPipeline(country=country)
    return _pipelines[country]


# ── Background worker ─────────────────────────────────────────────────────────
def _run_job(job_id: str):
    job      = _jobs[job_id]
    video_p  = job["video_path"]
    country  = job["country"]
    timings: Dict[str, float] = {}

    try:
        # Stage 1: Validate
        _set_stage(job_id, "processing", "Validating video")
        t0 = time.perf_counter()
        vr = validate_video(video_p)
        timings["validation"] = round(time.perf_counter() - t0, 2)
        if not vr.valid:
            _fail_job(job_id, vr.error or "Video validation failed")
            return

        # Stage 2: Extract pose landmarks
        _set_stage(job_id, "processing", "Extracting movement")
        t0 = time.perf_counter()
        extraction = extract_pose_frames(video_p)
        timings["pose_extraction"] = round(time.perf_counter() - t0, 2)

        if extraction.confidence_level == "Insufficient":
            _fail_job(job_id,
                "We couldn't reliably detect the athlete in enough frames. "
                "Please upload a clearer video with the full body visible, "
                "good lighting, and a stable side-view camera angle.")
            return

        # Convert to pipeline frame format
        frames = [
            {"frame": f.frame_index, "timestamp": f.timestamp_ms / 1000,
             "landmarks": f.landmarks}
            for f in extraction.frames
        ]

        # Stage 3: Run pipeline
        _set_stage(job_id, "processing", "Calculating biomechanics")
        t0  = time.perf_counter()
        pipeline = _get_pipeline(country)
        result   = pipeline.run(frames, video_name=Path(video_p).name)
        timings["pipeline"] = round(time.perf_counter() - t0, 2)

        # Attach pose confidence info to result
        result["pose_confidence"] = {
            "level":           extraction.confidence_level,
            "avg_confidence":  extraction.avg_confidence,
            "usable_frames":   extraction.usable_frames,
            "rejected_frames": extraction.rejected_frames,
            "total_sampled":   extraction.usable_frames + extraction.rejected_frames,
            "usable_pct":      round(
                extraction.usable_frames /
                max(extraction.usable_frames + extraction.rejected_frames, 1) * 100, 1),
        }

        timings["total"] = round(sum(timings.values()), 2)
        print(f"[Analysis] Job {job_id} complete | timings={timings}")

        _complete_job(job_id, result, timings)

    except Exception as e:
        import traceback
        traceback.print_exc()
        _fail_job(job_id, "Analysis failed due to an internal error. Please try again.")


def submit_analysis(video_path: str, country: str) -> str:
    """Submit a background analysis job. Returns job_id immediately."""
    job_id = _new_job(video_path, country)
    t = threading.Thread(target=_run_job, args=(job_id,), daemon=True)
    t.start()
    return job_id
