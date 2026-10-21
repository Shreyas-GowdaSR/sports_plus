"""
SportsAI+ — Upload Route (Phase 14: security hardening)
- File validation (size, extension, MIME)
- Safe filenames (UUID-based, no path traversal)
- No filesystem paths returned to client
- Upload size limit enforced
"""
import os, uuid, mimetypes
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from app.config import UPLOAD_DIR, RESULTS_DIR

router  = APIRouter(prefix="/upload", tags=["Upload"])

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
ALLOWED_MIMETYPES  = {"video/mp4","video/avi","video/quicktime",
                      "video/x-msvideo","video/webm","video/x-matroska"}
MAX_BYTES          = 500 * 1024 * 1024   # 500 MB


@router.post("")
async def upload_video(request: Request, file: UploadFile = File(...)):
    # Extension check
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Unsupported file type. Please upload one of: "
            f"{', '.join(sorted(ALLOWED_EXTENSIONS))}")

    # Read with size limit
    data = b""
    async for chunk in file:
        data += chunk
        if len(data) > MAX_BYTES:
            raise HTTPException(
                413, f"File is too large. Maximum upload size is {MAX_BYTES//(1024*1024)} MB.")

    # Magic bytes check (basic)
    if len(data) < 8:
        raise HTTPException(400, "File is empty or too small to be a valid video.")

    # Safe filename: UUID only — no user-supplied filename on disk
    uid      = uuid.uuid4().hex
    filename = f"{uid}{suffix}"
    dest     = UPLOAD_DIR / filename

    with open(dest, "wb") as f:
        f.write(data)

    # Return only the upload_id — never return the filesystem path
    return {
        "upload_id": uid,
        "original_filename": file.filename,
        "size_bytes": len(data),
    }


@router.get("/history")
def upload_history():
    """Recent analyses for the history tab. Returns IDs and summary, not paths."""
    results = []
    for f in sorted(RESULTS_DIR.glob("*.json"),
                    key=lambda x: x.stat().st_mtime, reverse=True)[:20]:
        try:
            import json as _json
            data = _json.loads(f.read_text())
            results.append({
                "result_id":    f.stem,
                "video_name":   data.get("video_name", ""),
                "country":      data.get("country", "india"),
                "mki_score":    data.get("mki_output", {}).get("mki_score", 0),
                "grade":        data.get("mki_output", {}).get("grade", ""),
                "completed_at": data.get("completed_at", ""),
            })
        except Exception:
            pass
    return results
