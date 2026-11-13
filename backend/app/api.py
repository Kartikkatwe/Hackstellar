"""HTTP API: the only contract between backend and frontend.

  uvicorn app.api:app --port 8000        (run from backend/; docs at /docs)

Why read endpoints open a fresh connection per request: SQLite readers then never wait on
     a batch or a live complaint being written.
Why live complaints use real Jev + LLM by default (decided 13 Nov): the offline stand-ins
     are weak, especially on Hinglish, and each live complaint costs a fraction of a cent.
     MAX_SPEND_USD caps the session. If the network or the cap fails, the complaint is
     processed offline and the response says so ("mode": "offline") - never silently.
     PROVIDERS=mock forces offline.
Not a websocket for the live funnel counter: polling /funnel once a second is simpler for
     the frontend and enough for a demo.
"""
import datetime as dt
import json
import os
import threading
from collections import Counter, defaultdict

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db, ingest
from .analytics import metrics, ranker
from .config import load_pack
from .pipeline.engine import BudgetExceeded
from .pipeline.run import build_engine, db_path, run_batch
from .providers.http import ProviderError
from .providers.mock import MockGate, MockLLM

pack = load_pack()
app = FastAPI(title=f"Complaint Compass - {pack['name']}")
# Open CORS: the frontend is a separate project on another port. Fine for a local prototype only.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_lock = threading.Lock()          # one writer at a time: the engine's registry is shared state
_engine = None
_batch = dict(running=False, done=0, total=0, error=None)


def _read():
    path = db_path(pack)
    if not path.exists():
        raise HTTPException(409, "No run yet. POST /runs or run `python run_funnel.py` first.")
    return db.connect(path)


def _filters(request: Request) -> dict:
    return {k: v for k, v in request.query_params.items() if k in pack["segments"]}


def _providers() -> str:
    return os.environ.get("PROVIDERS") or ("live" if os.environ.get("OPENROUTER_API_KEY") else "mock")


def _live_engine():
    """Engine for single live complaints, restored from the last run on first use."""
    global _engine
    if _engine is None:
        con = _read()
        texts = [r[0] for r in con.execute("SELECT text FROM complaints")]
        _engine = build_engine(pack, con, _providers(), None, texts)
        _engine.restore()
        _engine.offline = MockGate(pack, _engine.embedder), MockLLM(pack)
        if _engine.gate.name != "mock":
            _engine.budget_usd = float(os.environ.get("MAX_SPEND_USD", "0.50"))
    return _engine


# ------------------------------------------------------------------ run + pitch numbers
@app.get("/health")
def health():
    path = db_path(pack)
    return dict(pack=pack["id"], business=pack["name"], has_run=path.exists(), batch=_batch, live_complaints_use=_providers())


@app.get("/config")
def config():
    """Everything the UI needs to label itself, so nothing about groceries is hard-coded in the frontend."""
    values = defaultdict(set)
    if db_path(pack).exists():
        con = _read()
        for row in con.execute("SELECT profile FROM customers"):
            for k, v in json.loads(row[0]).items():
                values[k].add(v)
        con.close()
    return dict(business=pack["name"], domain=pack["domain"], components=pack["components"],
                segments=[dict(key=k, label=label, values=sorted(values[k], key=str)) for k, label in pack["segments"].items()],
                impact_levels=pack["gate"]["impact_levels"], emotion_levels=pack["gate"]["emotion_levels"],
                thresholds=pack["thresholds"], ranking=pack["ranking"], models=pack["models"], prices=pack["prices_usd_per_million"])


@app.get("/funnel")
def funnel():
    con = _read()
    try:
        return dict(run=metrics.run_info(con), **metrics.funnel(con))
    finally:
        con.close()


@app.get("/cost")
def cost():
    con = _read()
    try:
        return metrics.cost(con, pack)
    finally:
        con.close()


@app.get("/accuracy")
def accuracy():
    con = _read()
    try:
        return metrics.accuracy(con, pack) or dict(note="No truth file for this pack.")
    finally:
        con.close()


class RunRequest(BaseModel):
    mode: str = "mock"
    limit: int | None = None


@app.post("/runs")
def start_run(req: RunRequest):
    """Reprocess the whole dataset in the background; poll /health for progress."""
    global _engine
    if req.mode == "live" and os.environ.get("ALLOW_LIVE_RUNS") != "1":
        raise HTTPException(403, "Live batch runs spend credit. Start the server with ALLOW_LIVE_RUNS=1 to allow them.")
    if _batch["running"]:
        raise HTTPException(409, "A run is already in progress.")
    _batch.update(running=True, done=0, total=0, error=None)

    def work():
        global _engine
        try:
            with _lock:
                if _engine:
                    _engine.con.close()
                    _engine = None
                con, _ = run_batch(pack, req.mode, None, req.limit, progress=lambda n, t: _batch.update(done=n, total=t))
                con.close()
        except Exception as e:   # surfaced through /health, not lost in a thread
            _batch["error"] = str(e)
        finally:
            _batch["running"] = False

    threading.Thread(target=work, daemon=True).start()
    return dict(started=True, mode=req.mode)


# ------------------------------------------------------------------ issues
@app.get("/issues/top")
def top_issues(request: Request, n: int | None = None):
    con = _read()
    try:
        filters = _filters(request)
        return dict(filters=filters, issues=ranker.rank(con, pack, filters, n or pack["ranking"]["top_n"]))
    finally:
        con.close()


@app.get("/issues/{issue_id}")
def issue_detail(issue_id: int):
    con = _read()
    try:
        summary = next((x for x in ranker.rank(con, pack) if x["issue_id"] == issue_id), None)
        if not summary:
            raise HTTPException(404, "No such issue, or nothing filed under it.")
        rows = [dict(r) for r in con.execute(
            "SELECT c.id, c.channel, c.text, c.created_at, c.customer_id, cu.name customer_name, c.sender, c.link_method, "
            "c.order_id, c.order_status, a.stage, a.similarity, a.confidence, a.reason, g.impact, g.emotion, g.money_lost, g.legal_risk "
            "FROM assignments a JOIN complaints c ON c.id = a.complaint_id JOIN gate g ON g.complaint_id = c.id "
            "LEFT JOIN customers cu ON cu.id = c.customer_id WHERE a.issue_id = ? ORDER BY c.created_at", (issue_id,))]
        by_customer = defaultdict(list)
        for r in rows:
            if r["customer_id"]:
                by_customer[r["customer_id"]].append(r)
        # The evidence for "no double-counting": one customer, several contacts, counted once.
        repeat = [dict(customer_id=cid, name=items[0]["customer_name"], channels=sorted({i["channel"] for i in items}),
                       contacts=[dict(id=i["id"], channel=i["channel"], created_at=i["created_at"], text=i["text"]) for i in items])
                  for cid, items in by_customer.items() if len(items) > 1]
        repeat.sort(key=lambda x: (-len(x["channels"]), -len(x["contacts"])))
        return dict(summary=summary, complaints=rows, repeat_customers=repeat,
                    daily=sorted(Counter(r["created_at"][:10] for r in rows).items()),
                    impact_mix=dict(Counter(min(3, round(r["impact"])) for r in rows)))
    finally:
        con.close()


# ------------------------------------------------------------------ segments
@app.get("/segments/heatmap")
def segment_heatmap(dim: str, n: int | None = None):
    if dim not in pack["segments"]:
        raise HTTPException(400, f"dim must be one of {list(pack['segments'])}")
    con = _read()
    try:
        return ranker.heatmap(con, pack, dim, n)
    finally:
        con.close()


@app.get("/segments/compare")
def segment_compare(dim: str, a: str, b: str, n: int | None = None):
    """Two groups side by side, e.g. dim=is_student&a=true&b=false."""
    if dim not in pack["segments"]:
        raise HTTPException(400, f"dim must be one of {list(pack['segments'])}")
    con = _read()
    try:
        n = n or pack["ranking"]["top_n"]
        left, right = ranker.rank(con, pack, {dim: a}), ranker.rank(con, pack, {dim: b})
        pos = {x["issue_id"]: x["rank"] for x in right}
        for x in left[:n]:
            x["rank_in_other"] = pos.get(x["issue_id"])
        return dict(dimension=dim, a=dict(value=a, issues=left[:n]), b=dict(value=b, issues=right[:n]))
    finally:
        con.close()


# ------------------------------------------------------------------ staff views
@app.get("/pending")
def pending():
    """Unconfirmed reports: complaints that match no known issue yet. Urgent ones first."""
    con = _read()
    try:
        return [dict(r) for r in con.execute(
            "SELECT c.id, c.channel, c.text, c.created_at, c.customer_id, c.urgent, p.component, g.impact, g.money_lost, g.legal_risk "
            "FROM pending p JOIN complaints c ON c.id = p.complaint_id JOIN gate g ON g.complaint_id = c.id "
            "ORDER BY c.urgent DESC, c.created_at DESC")]
    finally:
        con.close()


@app.get("/complaints")
def complaints(settled: str | None = None, order_status: str | None = None, linked: bool | None = None, limit: int = 100):
    """Filterable list. linked=false gives the complaints staff may want to chase for an order ID."""
    sql, args = "SELECT * FROM complaints WHERE 1=1", []
    if settled:
        sql, args = sql + " AND settled = ?", args + [settled]
    if order_status:
        sql, args = sql + " AND order_status = ?", args + [order_status]
    if linked is not None:
        sql += " AND customer_id IS NOT NULL" if linked else " AND customer_id IS NULL"
    con = _read()
    try:
        return [dict(r) for r in con.execute(sql + " ORDER BY created_at DESC LIMIT ?", args + [min(limit, 1000)])]
    finally:
        con.close()


@app.get("/complaints/{cid}")
def complaint_trail(cid: str):
    """One complaint's path through the funnel: what each stage decided, and what it cost."""
    con = _read()
    try:
        c = con.execute("SELECT * FROM complaints WHERE id = ?", (cid,)).fetchone()
        if not c:
            raise HTTPException(404, "No such complaint.")
        gate = con.execute("SELECT * FROM gate WHERE complaint_id = ?", (cid,)).fetchone()
        filed = con.execute("SELECT a.*, i.key, i.title FROM assignments a JOIN issues i ON i.id = a.issue_id WHERE a.complaint_id = ?", (cid,)).fetchone()
        events = [dict(r) for r in con.execute("SELECT stage, model, in_tokens, out_tokens, cost_usd, latency_s FROM events WHERE complaint_id = ? ORDER BY rowid", (cid,))]
        return dict(complaint=dict(c), gate=dict(gate) if gate else None, filed_under=dict(filed) if filed else None, events=events)
    finally:
        con.close()


class LinkRequest(BaseModel):
    customer_id: str


@app.post("/complaints/{cid}/link")
def link_customer(cid: str, req: LinkRequest):
    """Staff link a complaint to a customer by hand (decided 12 Nov: what to do without an order ID is the staff's call)."""
    with _lock:
        engine = _live_engine()
        row = engine.con.execute("SELECT channel, sender FROM complaints WHERE id = ?", (cid,)).fetchone()
        if not row or not engine.con.execute("SELECT 1 FROM customers WHERE id = ?", (req.customer_id,)).fetchone():
            raise HTTPException(404, "Unknown complaint or customer.")
        engine.con.execute("UPDATE complaints SET customer_id = ?, link_method = 'manual', link_conf = 1.0 WHERE id = ?", (req.customer_id, cid))
        if row["channel"] == "social" and row["sender"]:
            engine.identity.link_handle(row["sender"], req.customer_id)   # later posts from this handle link automatically
        engine.con.commit()
    return dict(linked=True)


# ------------------------------------------------------------------ staff remove / restore an issue
# Why (13 Nov, Kartik): staff must be able to take any issue off the list (fixed, wrong, a test).
# Why a soft remove (origin 'removed:<old origin>') and a merges row, not DELETE: complaints keep
#      their trail, the action is on record, and Restore puts it back exactly. It also needs no new
#      table, so the Vercel live sync (row diffs) carries it to every instance unchanged.
# After removal the issue is off the ranking and no longer matched; new complaints like it go to
#      the waiting list and can form a fresh issue.
class RemoveRequest(BaseModel):
    reason: str | None = None


@app.post("/issues/{issue_id}/remove")
def remove_issue(issue_id: int, req: RemoveRequest):
    with _lock:
        engine = _live_engine()
        row = engine.con.execute("SELECT origin, component FROM issues WHERE id = ?", (issue_id,)).fetchone()
        if not row or row["origin"] == "merged" or row["origin"].startswith("removed:"):
            raise HTTPException(404, "No such issue, or it is already removed or merged.")
        engine.con.execute("UPDATE issues SET origin = 'removed:' || origin WHERE id = ?", (issue_id,))
        reason = (req.reason or "").strip()[:300]
        engine.con.execute("INSERT INTO merges VALUES(?,?,?)", (issue_id, None, f"Removed by staff{': ' + reason if reason else ''}"))
        engine.con.commit()
        engine.issues.pop(issue_id, None)
        engine.by_component[row["component"]] = [i for i in engine.by_component[row["component"]] if i["id"] != issue_id]
    return dict(removed=True)


@app.post("/issues/{issue_id}/restore")
def restore_issue(issue_id: int):
    global _engine
    with _lock:
        engine = _live_engine()
        row = engine.con.execute("SELECT origin FROM issues WHERE id = ?", (issue_id,)).fetchone()
        if not row or not row["origin"].startswith("removed:"):
            raise HTTPException(404, "No such removed issue.")
        engine.con.execute("UPDATE issues SET origin = substr(origin, 9) WHERE id = ?", (issue_id,))
        engine.con.execute("INSERT INTO merges VALUES(?,?,?)", (issue_id, None, "Restored by staff"))
        engine.con.commit()
        engine.con.close()
        _engine = None          # rebuilt on next use, with the issue back in matching
    return dict(restored=True)


@app.get("/removed-issues")
def removed_issues():
    con = _read()
    try:
        rows = con.execute(
            "SELECT i.id, i.title, i.component, "
            "(SELECT reason FROM merges m WHERE m.from_issue = i.id AND m.into_issue IS NULL ORDER BY rowid DESC LIMIT 1) reason, "
            "(SELECT COUNT(*) FROM assignments a WHERE a.issue_id = i.id) complaints "
            "FROM issues i WHERE i.origin LIKE 'removed:%' ORDER BY i.id").fetchall()
        return dict(issues=[dict(r) for r in rows])
    finally:
        con.close()


# ------------------------------------------------------------------ live intake
class NewComplaint(BaseModel):
    channel: str = "chat"
    text: str
    email: str | None = None
    phone: str | None = None
    user_id: str | None = None
    handle: str | None = None
    order_id: str | None = None


def _process_live(c: dict) -> dict:
    with _lock:
        engine = _live_engine()
        n = engine.con.execute("SELECT COUNT(*) FROM complaints WHERE id LIKE 'L-%'").fetchone()[0]
        c["id"] = f"L-{n + 1:05d}"
        c.setdefault("created_at", dt.datetime.now().isoformat(timespec="seconds"))
        mode, warning = ("live" if engine.gate.name != "mock" else "offline"), None
        try:
            result = engine.process(dict(c))
        except (ProviderError, BudgetExceeded) as e:
            engine.con.rollback()
            # Fallback: same complaint through the offline stand-ins, labelled as such.
            live = engine.gate, engine.llm
            engine.gate, engine.llm = engine.offline
            try:
                result = engine.process(dict(c))
            finally:
                engine.gate, engine.llm = live
            mode, warning = "offline", f"Live models unavailable ({str(e)[:120]}); processed offline, results are less reliable."
        engine.con.commit()
    return dict(mode=mode, warning=warning, result=result, **complaint_trail(c["id"]))


@app.post("/complaints")
def new_complaint(req: NewComplaint):
    """Push one complaint through the funnel now and return its trail (for the live demo)."""
    c = {k: v for k, v in req.model_dump().items() if v}
    if c.get("handle"):
        c["handle"] = c["handle"].lower()
    c["scan"] = c["text"]
    return _process_live(c)


@app.post("/webhooks/call")
def call_webhook(payload: dict):
    """The voice agent's webhook. Same payload shape as data/<pack>/calls.jsonl."""
    try:
        c = ingest.from_call(payload)
    except KeyError as e:
        raise HTTPException(422, f"Missing field in call payload: {e}")
    c.pop("id", None)
    return _process_live(c)
