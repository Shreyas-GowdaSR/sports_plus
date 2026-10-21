from pathlib import Path

BASE_DIR      = Path(__file__).resolve().parents[2]   # sportsai_v3/
AI_DIR        = BASE_DIR / "ai"
UPLOAD_DIR    = BASE_DIR / "storage" / "uploads"
RESULTS_DIR   = BASE_DIR / "storage" / "results"
REPORTS_DIR   = BASE_DIR / "storage" / "reports"
LANDMARKS_DIR = BASE_DIR / "storage" / "landmarks"

for d in [UPLOAD_DIR, RESULTS_DIR, REPORTS_DIR, LANDMARKS_DIR]:
    d.mkdir(parents=True, exist_ok=True)
