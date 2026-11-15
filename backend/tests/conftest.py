"""Shared test setup.

Why offline models and the hash embedder: the suite then needs no API key, no network and no
     sentence model, costs nothing, and runs in seconds.
Why every test gets its own copy of the database: tests write complaints, and one test must
     never see another's rows. Never the files in runs/: those are the demo's.
Why one batch run for the whole session: building the database takes a couple of seconds;
     copying the file takes none.
"""
import json
import os
import shutil
import time
from pathlib import Path

import pytest

os.environ["PROVIDERS"] = "mock"
os.environ["EMBEDDER"] = "hash"
os.environ["LOG_TO_FILE"] = "0"          # tests read log lines from memory, not from backend/logs
os.environ.pop("ALLOW_LIVE_RUNS", None)

from fastapi.testclient import TestClient  # noqa: E402

from app import api  # noqa: E402
from app.pipeline import run as run_module  # noqa: E402

BACKEND = Path(__file__).resolve().parent.parent
DATA = BACKEND / "data" / "grocery"

# When authentication is added, put the test credentials here. Every normal request in the
# suite uses them; the `anon` client deliberately sends none.
STAFF_HEADERS: dict[str, str] = {}


def finding(n: int, what: str):
    """Marks a test for a weakness that is known and not fixed yet.
    Why strict: the test must fail today. The day the fix lands it passes, pytest reports an
    unexpected pass as a failure, and that is the signal to delete this marker so the test
    guards the fix from then on."""
    # raises=AssertionError: only the stated expectation may fail. A crash inside the test itself
    # (a typo, a changed response shape) still shows up as a real failure, not as "expected".
    return pytest.mark.xfail(strict=True, raises=AssertionError, reason=f"open finding {n}: {what}")


def _point_at(path: Path) -> None:
    api.db_path = run_module.db_path = lambda pack: path
    if api._engine is not None:
        api._engine.con.close()
    api._engine = None
    api._batch.update(running=False, done=0, total=0, error=None)


def wait_for_batch(timeout: float = 60.0) -> None:
    end = time.time() + timeout
    while api._batch["running"] and time.time() < end:
        time.sleep(0.05)
    assert not api._batch["running"], "batch run did not finish in time"


@pytest.fixture(scope="session")
def base_db(tmp_path_factory) -> Path:
    """One offline batch run of the whole dataset."""
    path = tmp_path_factory.mktemp("base") / "grocery.db"
    original = run_module.db_path
    run_module.db_path = lambda pack: path
    try:
        con, _ = run_module.run_batch(api.pack, "mock", "hash")
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        con.close()
    finally:
        run_module.db_path = original
    return path


@pytest.fixture
def db_file(base_db, tmp_path) -> Path:
    path = tmp_path / "grocery.db"
    shutil.copy(base_db, path)
    original = api.db_path, run_module.db_path
    _point_at(path)
    yield path
    wait_for_batch()             # a test that started a batch run must not leak it into the next test
    if api._engine is not None:
        api._engine.con.close()
        api._engine = None
    api.db_path, run_module.db_path = original


@pytest.fixture
def client(db_file) -> TestClient:
    """A signed-in member of staff (no credentials exist yet, so today this equals `anon`)."""
    with TestClient(api.app, headers=STAFF_HEADERS, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def anon(db_file) -> TestClient:
    """A caller with no credentials at all."""
    with TestClient(api.app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def live_backup(tmp_path):
    """A copy of the committed live run (13 Nov), for checking the published figures."""
    path = tmp_path / "live.db"
    shutil.copy(BACKEND / "runs" / "grocery_live_backup.db", path)
    original = api.db_path, run_module.db_path
    _point_at(path)
    with TestClient(api.app, headers=STAFF_HEADERS, raise_server_exceptions=False) as c:
        yield c
    if api._engine is not None:
        api._engine.con.close()
        api._engine = None
    api.db_path, run_module.db_path = original


@pytest.fixture(scope="session")
def customers() -> list[dict]:
    return json.loads((DATA / "customers.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def orders() -> list[dict]:
    return json.loads((DATA / "orders.json").read_text(encoding="utf-8"))


@pytest.fixture
def query(db_file):
    """Read the test database directly, the way the checklist's SQL checks do."""
    import sqlite3

    def run(sql: str, *args):
        con = sqlite3.connect(db_file)
        try:
            return con.execute(sql, args).fetchall()
        finally:
            con.close()
    return run
