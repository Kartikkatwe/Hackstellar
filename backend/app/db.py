"""SQLite storage for one run.

Why SQLite: zero setup, and the whole run is one file that can be copied as a demo backup.
Not an ORM: a handful of flat tables; plain SQL is shorter and easier to explain.
Why customers.profile is JSON: segment dimensions differ per domain pack (student status
     for grocery, plan type for telecom), so they cannot be fixed columns.
Why an events table: every figure in the pitch (share settled per stage, cost, time) is a
     query over it, so the numbers can be traced to individual calls.
"""
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE customers(id TEXT PRIMARY KEY, name TEXT, profile TEXT);
CREATE TABLE complaints(id TEXT PRIMARY KEY, channel TEXT, text TEXT, created_at TEXT, sender TEXT,
    customer_id TEXT, link_method TEXT, link_conf REAL, order_id TEXT, order_status TEXT,
    settled TEXT, urgent INTEGER DEFAULT 0, meta TEXT);
CREATE TABLE gate(complaint_id TEXT PRIMARY KEY, is_complaint REAL, component TEXT, component_conf REAL, probs TEXT,
    impact REAL, emotion REAL, money_lost REAL, legal_risk REAL);
CREATE TABLE issues(id INTEGER PRIMARY KEY, key TEXT UNIQUE, component TEXT, title TEXT, description TEXT,
    origin TEXT, created_at TEXT);
CREATE TABLE exemplars(issue_id INTEGER, text TEXT);
CREATE TABLE assignments(complaint_id TEXT PRIMARY KEY, issue_id INTEGER, stage TEXT, similarity REAL,
    confidence REAL, reason TEXT);
CREATE TABLE pending(complaint_id TEXT PRIMARY KEY, component TEXT);
CREATE TABLE events(complaint_id TEXT, stage TEXT, model TEXT, in_tokens INTEGER, out_tokens INTEGER,
    cost_usd REAL, latency_s REAL, estimated INTEGER);
CREATE TABLE baseline(complaint_id TEXT PRIMARY KEY, prefix_tokens INTEGER, in_tokens INTEGER, out_tokens INTEGER);
CREATE TABLE run(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE merges(from_issue INTEGER, into_issue INTEGER, reason TEXT);
CREATE INDEX idx_events_stage ON events(stage);
CREATE INDEX idx_assign_issue ON assignments(issue_id);
"""


def connect(path: Path, fresh: bool = False) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fresh:
        for p in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
            p.unlink(missing_ok=True)
    new = not path.exists()
    # check_same_thread=False: the API runs a batch in a worker thread and reads from request threads.
    con = sqlite3.connect(path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")   # readers do not block the writer during a live run
    if new:
        con.executescript(SCHEMA)
    return con
