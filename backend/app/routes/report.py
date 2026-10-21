import json, sys
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.config import RESULTS_DIR, REPORTS_DIR, AI_DIR

sys.path.insert(0, str(AI_DIR))

router = APIRouter(prefix="/report", tags=["Report"])

@router.get("/{video_stem}")
def download_report(video_stem: str):
    rf = REPORTS_DIR / f"{video_stem}.pdf"
    if not rf.exists():
        result_file = RESULTS_DIR / f"{video_stem}.json"
        if not result_file.exists():
            raise HTTPException(404, "No analysis found for this video")
        from report_generator import generate_pdf
        data = json.loads(result_file.read_text())
        rf   = generate_pdf(data, rf)
    return FileResponse(
        str(rf), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={video_stem}_report.pdf"})
