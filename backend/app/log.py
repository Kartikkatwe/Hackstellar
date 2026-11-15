"""Application logging: one line per request, every error with its traceback, and the
security and admin events worth looking back at.

Why: the database already records every model call and every filing decision (events,
     assignments), but nothing recorded requests, crashes or who triggered an admin action.
     A crash only printed to the terminal and was gone when the window closed.
Why key=value text lines: readable in a terminal and still easy to grep or parse.
Not a JSON logger or a log service: one more dependency than a prototype needs.
Never logged: complaint text, emails, phone numbers or request bodies. Complaints are personal
     data and may quote card or order details, so log lines carry IDs only.
Why the file handler is optional: a Vercel function's own files are read-only, so there the
     console is the log (Vercel keeps it). A log that cannot open must never stop the API.

Why successful reads are logged at DEBUG: the dashboard polls /funnel about once a second,
     which would bury everything else. Writes, refusals, errors and slow requests always show.

Loggers:  cc.request   HTTP requests, and unhandled errors with their traceback
          cc.security  refused requests and blocked actions
          cc.admin     actions that change data outside the funnel (batch runs, manual links)
          cc.funnel    one line per live complaint, fallbacks to offline models
Settings: LOG_LEVEL (default INFO), LOG_FILE (default backend/logs/app.log), LOG_TO_FILE=0 to
          log to the console only.
"""
import contextvars
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMAT = "%(asctime)s %(levelname)-7s %(name)s rid=%(rid)s %(message)s"
_ready = False
# Why a request ID on every line: one request can write several lines (request, complaint,
# fallback); the ID ties them together, and the same ID goes back to the caller in the
# X-Request-ID header so a reported error can be found in the log.
request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class _RequestId(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.rid = request_id.get()
        return True


def setup() -> logging.Logger:
    """Attach the handlers once. Safe to call again (uvicorn reloads, tests)."""
    global _ready
    root = logging.getLogger("cc")
    if _ready:
        return root
    _ready = True
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())
    console = logging.StreamHandler()
    console.setFormatter(logging.Formatter(FORMAT))
    console.addFilter(_RequestId())
    root.addHandler(console)
    if os.environ.get("LOG_TO_FILE", "1") != "0":
        path = Path(os.environ.get("LOG_FILE") or ROOT / "logs" / "app.log")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Why rotating: a long demo day must not fill the disk. 5 files of 2 MB is days of requests.
            handler = RotatingFileHandler(path, maxBytes=2_000_000, backupCount=5, encoding="utf-8")
            handler.setFormatter(logging.Formatter(FORMAT))
            handler.addFilter(_RequestId())
            root.addHandler(handler)
        except OSError as e:
            root.warning("log_file_unavailable path=%s reason=%s; logging to the console only", path, str(e)[:80])
    return root


def get(name: str) -> logging.Logger:
    return logging.getLogger(f"cc.{name}")


def kv(**fields) -> str:
    """key=value pairs for a log line. Values with spaces are quoted so a line still splits cleanly."""
    parts = []
    for k, v in fields.items():
        if v is None:
            continue
        s = str(v).replace("\n", " ").replace("\r", " ")
        parts.append(f'{k}="{s}"' if " " in s else f"{k}={s}")
    return " ".join(parts)
