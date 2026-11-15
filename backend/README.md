# Complaint Compass: backend

Classifier-first complaint funnel for HackStellar PS-19. Design notes are in `../BACKEND_DESIGN.md`, decisions in `../DECISIONS.md`.

## Run it

All commands from `backend/`, using the virtual environment's Python.

```powershell
.\.venv\Scripts\python.exe data\generate.py            # make the mock data (already done once)
.\.venv\Scripts\python.exe run_funnel.py               # offline run with mock providers, prints the report
.\.venv\Scripts\python.exe live_check.py               # 5 real calls, well under 1 cent
.\.venv\Scripts\python.exe run_funnel.py --mode live   # real Jev + LLM; capped by MAX_SPEND_USD (default $0.25)
.\.venv\Scripts\python.exe tune.py                     # sweep the similarity cut-offs
.\.venv\Scripts\uvicorn.exe app.api:app --port 8000    # API for the frontend, docs at http://localhost:8000/docs
```

Each run rewrites `runs/<pack>.db` and `runs/<pack>_report.json`. Copy the `.db` file to keep a run as a demo backup.

## Spending credit

- `run_funnel.py --mode live` stops when the run's cost passes `MAX_SPEND_USD`.
- The API uses mock providers for live complaints unless started with `PROVIDERS=live`.
- `POST /runs` with `mode=live` is refused unless the server was started with `ALLOW_LIVE_RUNS=1`.

## Layout

| Path | What |
|---|---|
| `packs/<name>/pack.yaml` | Everything about one business: components, known issues, gate questions, cut-offs, ranking weights, segments, prices |
| `data/generate.py`, `data/catalog_grocery.py` | Mock data generator and its ground truth |
| `app/ingest.py` | Four channel formats into one complaint shape |
| `app/pipeline/identity.py` | Complaint to customer, order-ID checks |
| `app/pipeline/engine.py` | The funnel: gate, match, verify, adjudicate, buffer |
| `app/providers/` | Jev gate, LLM, embedders, and offline mocks |
| `app/analytics/ranker.py` | Top issues, score breakdown, segment heatmap |
| `app/analytics/metrics.py` | Funnel counts, cost vs baseline, accuracy |
| `app/api.py` | HTTP endpoints |
| `app/log.py` | Logging: requests, errors, security and admin events (IDs only, never complaint text) |
| `tests/` | Automated test suite (pytest), offline, no API key |
| `loadtest/` | Load-test and probe scripts, run by hand |

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health`, `/config` | Run status; labels, components and segment values for the UI |
| GET | `/funnel`, `/cost`, `/accuracy` | The three pitch measurements |
| GET | `/issues/top?n=10&state=Karnataka&is_student=true` | Ranked issues with score breakdown; any segment key filters |
| GET | `/issues/{id}` | Grouped complaints, repeat customers across channels, daily trend |
| GET | `/segments/heatmap?dim=state` | Issue by segment matrix with rate and lift |
| GET | `/segments/compare?dim=is_student&a=true&b=false` | Two groups side by side |
| GET | `/pending` | Unconfirmed reports, urgent first |
| GET | `/complaints?linked=false`, `/complaints/{id}` | Staff list; one complaint's trail through the funnel |
| POST | `/complaints` | Push one complaint through the funnel live |
| POST | `/webhooks/call` | Voice agent payload (same shape as `calls.jsonl`) |
| POST | `/complaints/{id}/link` | Staff link a complaint to a customer |
| POST | `/runs` | Reprocess the dataset in the background |

## Tests

```
pip install -r requirements-dev.txt
python -m pytest
```

About 25 seconds, offline (stand-in models, hash embedder), no API key, no cost. Each test works on its own copy of the database, never on `runs/`.

| File | Covers |
|---|---|
| `tests/test_units.py` | Order-ID check digit, identity rules, embedder, cost arithmetic |
| `tests/test_api_reads.py` | Every read endpoint; scores equal their formula; the live-run figures (96.13%, 560.2) have not moved |
| `tests/test_intake.py` | Live complaints, the voice webhook, the three-different-people rule, 50 complaints at once |
| `tests/test_security.py` | Access control, identity, input validation, data integrity |
| `tests/test_logging.py` | What is logged, and that complaint text and addresses never are |

`xfailed` in the result is expected: those tests describe weaknesses that are known and not fixed yet (`@finding` in `test_security.py`). When a fix lands, its test starts passing, pytest reports that as a failure, and you delete the `@finding` line above it. From then on the test guards the fix. Strategy and the manual checklist: [`docs/testing/`](../docs/testing/TESTING.md).

## Logging

`app/log.py`. Lines go to the console and to `backend/logs/app.log` (rotating, 5 files of 2 MB; not committed).

```
2026-11-15 12:55:26 INFO    cc.funnel   rid=940ae6b6 event=complaint complaint=L-00001 channel=chat settled=verify issue=pay_debited_no_order urgent=0 mode=offline
2026-11-15 12:55:26 INFO    cc.request  rid=940ae6b6 event=request method=POST path=/complaints status=200 ms=507.2 client=127.0.0.1
2026-11-15 12:55:26 ERROR   cc.request  rid=d32eec27 event=unhandled_error method=POST path=/complaints status=500 ms=0.9 client=127.0.0.1   (+ traceback)
2026-11-15 12:55:26 WARNING cc.security rid=e105b756 event=live_run_refused reason="ALLOW_LIVE_RUNS is not set"
2026-11-15 12:55:26 INFO    cc.admin    rid=e4733d1f event=manual_link complaint=E-00001 customer=C-0001 channel=email
```

- `rid` is the request ID. It is also returned in the `X-Request-ID` header and in the body of a 500, so an error someone reports can be found in the log.
- Never logged: complaint text, emails, phone numbers, request bodies, query strings.
- Successful `GET`s are logged at `DEBUG` (the dashboard polls every second). Writes, refusals, errors and requests slower than 1 s always show.
- Settings: `LOG_LEVEL` (default `INFO`), `LOG_FILE`, `LOG_TO_FILE=0` for console only. Where the folder is read-only (Vercel), it logs to the console only.
- Model calls and filing decisions are not in this log: they are in the database (`events`, `assignments`), as before.
