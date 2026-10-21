"""
SportsAI+ — FastAPI Application
Phase 14: Security hardening — CORS restricted to frontend origin
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ai"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import upload, analysis, report

# Allow only the frontend origin (set FRONTEND_ORIGIN env var in production)
ALLOWED_ORIGINS = [
    os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173"),
    "http://localhost:4173",   # vite preview
    "http://127.0.0.1:5173",
]

app = FastAPI(
    title="SportsAI+",
    version="2.0.0",
    docs_url="/docs",        # disable in production with None
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(upload.router)
app.include_router(analysis.router)
app.include_router(report.router)

@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}
