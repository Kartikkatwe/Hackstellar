"""Batch runner: load a pack's data, push every complaint through the funnel, save the run.

Why one fresh database per run: a run is a self-contained, reproducible artefact that can
     be copied as the demo backup. Not appending to an old run: stale rows would mix figures
     from different settings.
"""
import datetime as dt
import json
import os
from pathlib import Path

from .. import db, ingest, providers
from ..config import ROOT
from .engine import BudgetExceeded, Engine
from .identity import Identity


def db_path(pack: dict) -> Path:
    return ROOT / "runs" / f"{pack['id']}.db"


def load_crm(pack: dict) -> tuple[list[dict], list[dict]]:
    path = pack["data_path"]
    return (json.loads((path / "customers.json").read_text(encoding="utf-8")),
            json.loads((path / "orders.json").read_text(encoding="utf-8")))


def build_engine(pack: dict, con, mode: str, embedder_choice: str | None, fit_texts: list[str]) -> Engine:
    gate, embedder, llm = providers.build(pack, mode, embedder_choice)
    seed_texts = [t for i in pack["seed_issues"] for t in [i["title"], i["description"], *i.get("examples", [])]]
    embedder.fit(fit_texts + seed_texts + list(pack["components"].values()))   # no-op for the sentence model
    customers, orders = load_crm(pack)
    return Engine(pack, con, gate, embedder, llm, Identity(pack, customers, orders))


def run_batch(pack: dict, mode: str = "mock", embedder_choice: str | None = None, limit: int | None = None, progress=None,
              overrides: dict | None = None):
    """overrides: cut-offs to try in place of the pack's (used by tune.py)."""
    complaints = ingest.load_all(pack["data_path"])[:limit]
    con = db.connect(db_path(pack), fresh=True)
    customers, _ = load_crm(pack)
    dims = list(pack["segments"])
    con.executemany("INSERT INTO customers VALUES(?,?,?)",
                    [(c["id"], c["name"], json.dumps({d: c.get(d) for d in dims})) for c in customers])
    engine = build_engine(pack, con, mode, embedder_choice, [c["text"] for c in complaints])
    if overrides:
        engine.t.update(overrides)
        engine.mid = (engine.t["match_hi"] + engine.t["match_lo"]) / 2
    if mode == "live":
        # Default cap 25 cents per run; raise it on purpose with MAX_SPEND_USD, never by accident.
        engine.budget_usd = float(os.environ.get("MAX_SPEND_USD", "0.25"))
    started = dt.datetime.now()
    engine.seed_registry(complaints[0]["created_at"])
    engine.embedder.encode([c["text"] for c in complaints])   # one batched pass; the funnel then reads the cache
    if mode == "live":
        engine.prefetch_gate(complaints)
    stopped = None
    try:
        for n, c in enumerate(complaints, 1):
            engine.process(c)
            if n % 100 == 0:
                con.commit()
                if progress:
                    progress(n, len(complaints))
        merges = engine.curate()
    except BudgetExceeded as e:
        # Keep what was processed; the report then covers a partial run, and says so.
        con.rollback()
        stopped, merges = str(e), []
        print(f"\n[run] {stopped}")
    meta_extra = dict(stopped=stopped)
    meta = dict(pack=pack["id"], mode=mode, merges=merges, **meta_extra, gate=engine.gate.name, llm=engine.llm.name, embedder=engine.embedder.name,
                n=len(complaints), started=started.isoformat(timespec="seconds"),
                wall_seconds=round((dt.datetime.now() - started).total_seconds(), 1), thresholds=engine.t)
    con.executemany("INSERT OR REPLACE INTO run VALUES(?,?)", [(k, json.dumps(v)) for k, v in meta.items()])
    con.commit()
    return con, engine
