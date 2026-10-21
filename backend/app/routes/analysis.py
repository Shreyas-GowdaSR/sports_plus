"""
SportsAI+ — Analysis Routes (Phase 1+2)
- Background job processing
- No fake landmarks
- Video validation before analysis
- Status polling endpoint
- No filesystem paths returned to client
"""
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.config import RESULTS_DIR, UPLOAD_DIR
from app.services.analysis_service import submit_analysis, get_job

router = APIRouter(prefix="/analysis", tags=["Analysis"])

ALLOWED_COUNTRIES = {"india", "usa", "japan"}


class AnalysisRequest(BaseModel):
    upload_id: str        # ID returned from /upload, NOT a filesystem path
    country:   str = "india"


@router.post("")
async def start_analysis(req: AnalysisRequest):
    """
    Submit an analysis job. Returns job_id immediately.
    Poll GET /analysis/{job_id}/status for progress.
    """
    country = req.country.lower()
    if country not in ALLOWED_COUNTRIES:
        raise HTTPException(400, f"Country must be one of: {', '.join(sorted(ALLOWED_COUNTRIES))}")

    # Resolve upload_id → actual file path (never expose path to client)
    matches = list(UPLOAD_DIR.glob(f"{req.upload_id}.*"))
    if not matches:
        raise HTTPException(404, f"Upload not found: {req.upload_id}")

    video_path = str(matches[0])
    job_id     = submit_analysis(video_path, country)

    return {
        "job_id":  job_id,
        "status":  "queued",
        "stage":   "Queued",
        "message": "Analysis started. Poll /analysis/{job_id}/status for progress.",
    }


@router.get("/{job_id}/status")
def get_analysis_status(job_id: str):
    """
    Poll for analysis progress.

    status values: queued | processing | completed | failed
    stage: human-readable current stage
    """
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Analysis job not found")

    response = {
        "job_id": job_id,
        "status": job["status"],
        "stage":  job["stage"],
    }

    if job["status"] == "failed":
        response["error"] = job["error"]

    if job["status"] == "completed" and job["result"]:
        result = job["result"]
        # Return full result inline — do NOT include filesystem paths
        safe_result = {k: v for k, v in result.items()
                       if k not in ("video_path", "landmark_directory")}
        response["result"]  = safe_result
        response["timings"] = job.get("timings", {})

    return response


@router.get("/{job_id}/result")
def get_analysis_result(job_id: str):
    """Get the full result for a completed analysis."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Analysis job not found")
    if job["status"] != "completed":
        raise HTTPException(409, f"Analysis is {job['status']}, not completed")
    result = job["result"] or {}
    return {k: v for k, v in result.items()
            if k not in ("video_path", "landmark_directory")}


@router.get("/countries")
def get_countries():
    return {
        "supported": sorted(ALLOWED_COUNTRIES),
        "description": {
            "india": "Ayurvedic + vegetarian + budget nutrition, ashwagandha",
            "usa":   "Supplement-focused, tart cherry, creatine, chocolate milk",
            "japan": "Washoku, fish collagen, natto, matcha, precision nutrition",
        }
    }
