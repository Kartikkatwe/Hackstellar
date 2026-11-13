"""Vercel entry point: the backend API (backend/app/api.py) as one Python function under /api.

Why a copy in /tmp: a Vercel function's own files are read-only, and live complaints write
     to SQLite. Each instance starts from the finished live run (grocery_live_backup.db), so
     every judge sees the same 1,500 complaints plus whatever was sent since that instance started.
Why no sentence-transformers here: torch is far over the function size limit. The engine
     falls back to its pure-numpy hash embedder by itself (providers/embed.py, EMBEDDER=auto).
Not: a change to the backend. Kartik's code runs as is; only where the database lives moves.
"""
import shutil
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

TMP = Path("/tmp/complaint-compass")
TMP.mkdir(parents=True, exist_ok=True)
if not (TMP / "grocery.db").exists():
    shutil.copy(BACKEND / "runs" / "grocery_live_backup.db", TMP / "grocery.db")

from app.pipeline import run as _run  # noqa: E402


def _db_path(pack: dict) -> Path:
    return TMP / f"{pack['id']}.db"


_run.db_path = _db_path

from app import api as _api  # noqa: E402

_api.db_path = _db_path

from fastapi import FastAPI  # noqa: E402

# The frontend calls /api/<endpoint>; the backend's routes have no prefix.
app = FastAPI(title="Complaint Compass")
app.mount("/api", _api.app)
