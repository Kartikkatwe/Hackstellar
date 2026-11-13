"""Vercel entry point: the backend API (backend/app/api.py) as one Python function under /api.

Why a copy in /tmp: a Vercel function's own files are read-only, and live complaints write
     to SQLite. Each instance starts from the finished live run (grocery_live_backup.db), so
     every judge sees the same 1,500 complaints plus whatever was sent since that instance started.
Why no sentence-transformers here: torch is far over the function size limit. The engine
     falls back to its pure-numpy hash embedder by itself (providers/embed.py, EMBEDDER=auto).
Not: a change to the backend. Kartik's code runs as is; only where the database lives moves.
"""
import json
import os
import shutil
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

TMP = Path(os.environ.get("CC_TMP", "/tmp/complaint-compass"))  # CC_TMP only for local tests
TMP.mkdir(parents=True, exist_ok=True)
if not (TMP / "grocery.db").exists():
    shutil.copy(BACKEND / "runs" / "grocery_live_backup.db", TMP / "grocery.db")

from app.pipeline import run as _run  # noqa: E402


def _db_path(pack: dict) -> Path:
    return TMP / f"{pack['id']}.db"


_run.db_path = _db_path

from app import api as _api  # noqa: E402

_api.db_path = _db_path

# ---------------------------------------------------------------- live sync between instances
# Shares live complaints between Vercel function instances through Vercel Blob.
# 
# Why: each instance has its own SQLite copy in /tmp, so a complaint sent from a judge's phone
#      could land on one instance while the projector polls another. Every write request now
#      publishes the exact rows it changed; every instance replays what it has not seen yet
#      before it answers, so all screens agree within a poll or two.
# Why row diffs and not re-running the funnel: a live complaint costs model calls and the
#      models can answer differently twice. The instance that processed it is the only one
#      that decides; the others copy its result.
# Not: a database server. A hackathon demo writes a few dozen complaints; one small JSON
#      object per write is enough, and it needs no new service beyond the project's Blob store.
# Without BLOB_READ_WRITE_TOKEN (local runs) every function here is a no-op.


TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN")
API = os.environ.get("VERCEL_BLOB_API_URL", "https://vercel.com/api/blob")  # the SDK reads the same variable
# A new LIVE_SYNC_PREFIX (and a redeploy) starts every instance clean from the live run.
PREFIX = os.environ.get("LIVE_SYNC_PREFIX", "live/")
EVERY_S = 1.5  # how often an instance looks for others' writes

_applied: set[str] = set()
_last = 0.0
_lock = threading.Lock()


def _request(method: str, url: str, body: bytes | None = None, headers: dict | None = None) -> dict:
    h = {"authorization": f"Bearer {TOKEN}", "x-api-version": "11", **(headers or {})}
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=8) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def _tables(con: sqlite3.Connection) -> list[str]:
    return [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]


def snapshot(db: Path) -> dict:
    """Every row of every table, as multisets (tables without a primary key may repeat rows)."""
    if not TOKEN:
        return {}
    con = sqlite3.connect(db)
    try:
        out = {}
        for t in _tables(con):
            cur = con.execute(f'SELECT * FROM "{t}"')
            out[t] = ([d[0] for d in cur.description], Counter(cur.fetchall()))
        return out
    finally:
        con.close()


def publish(db: Path, before: dict) -> None:
    """Upload what this write changed, as one object named by time so replays keep order."""
    if not TOKEN or not before:
        return
    after = snapshot(db)
    change = {}
    for t, (cols, rows) in after.items():
        old = before.get(t, (cols, Counter()))[1]
        added, removed = rows - old, old - rows
        if added or removed:
            change[t] = {"columns": cols, "insert": list(added.elements()), "delete": list(removed.elements())}
    if not change:
        return
    name = f"{PREFIX}{time.time_ns()}.json"
    q = urllib.parse.urlencode({"pathname": name})
    _request("PUT", f"{API}/?{q}", json.dumps(change).encode(), {
        "x-content-type": "application/json", "x-add-random-suffix": "0", "x-allow-overwrite": "1",
    })
    _applied.add(name)


def _apply(con: sqlite3.Connection, change: dict) -> None:
    for t, c in change.items():
        cols = c["columns"]
        where = " AND ".join(f'"{k}" IS ?' for k in cols)
        for row in c["delete"]:
            con.execute(f'DELETE FROM "{t}" WHERE rowid IN (SELECT rowid FROM "{t}" WHERE {where} LIMIT 1)', row)
        names = ", ".join(f'"{k}"' for k in cols)
        marks = ", ".join("?" for _ in cols)
        for row in c["insert"]:
            con.execute(f'INSERT OR REPLACE INTO "{t}" ({names}) VALUES ({marks})', row)


def pull(db: Path) -> bool:
    """Apply other instances' writes not seen yet. Returns True when anything was applied.
    Why the timestamp is set after the pull: a request that arrives during a pull waits for
    it and then answers with the new rows, instead of skipping ahead with stale ones."""
    global _last
    if not TOKEN or time.time() - _last < EVERY_S:
        return False
    with _lock:
        if time.time() - _last < EVERY_S:
            return False
        try:
            blobs, cursor = [], None
            while True:
                q = {"prefix": PREFIX, "limit": "1000", **({"cursor": cursor} if cursor else {})}
                page = _request("GET", f"{API}?{urllib.parse.urlencode(q)}")
                blobs += page.get("blobs", [])
                if not page.get("hasMore"):
                    break
                cursor = page.get("cursor")
            todo = sorted((b for b in blobs if b["pathname"] not in _applied), key=lambda b: b["pathname"])
            if not todo:
                return False
            con = sqlite3.connect(db)
            try:
                for b in todo:
                    with urllib.request.urlopen(b["url"], timeout=8) as r:
                        _apply(con, json.loads(r.read()))
                    _applied.add(b["pathname"])
                con.commit()
            finally:
                con.close()
            return True
        finally:
            _last = time.time()


# ---------------------------------------------------------------- the app
from fastapi import FastAPI  # noqa: E402
from starlette.concurrency import run_in_threadpool  # noqa: E402

DB = TMP / "grocery.db"
_write_lock = threading.Lock()
WRITES = ("/complaints", "/webhooks/call", "/link", "/remove", "/restore")


class LiveSync:
    """Before any request: pull other instances' writes. Around a write: publish its rows
    before the response leaves, since a function may be frozen once it has answered."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        try:
            if await run_in_threadpool(pull, DB):
                _api._engine = None  # rebuild the live engine from the database, new issues included
        except Exception as e:  # a sync hiccup must never take the API down
            print(f"[sync] pull failed: {e}")
        if scope["method"] != "POST" or not scope["path"].endswith(WRITES):
            return await self.app(scope, receive, send)
        held = []

        async def keep(message):
            held.append(message)

        await run_in_threadpool(_write_lock.acquire)
        try:
            before = await run_in_threadpool(snapshot, DB)
            await self.app(scope, receive, keep)
            try:
                await run_in_threadpool(publish, DB, before)
            except Exception as e:
                print(f"[sync] publish failed: {e}")
        finally:
            _write_lock.release()
        for message in held:
            await send(message)


# The frontend calls /api/<endpoint>; the backend's routes have no prefix.
app = FastAPI(title="Complaint Compass")
app.mount("/api", LiveSync(_api.app))
