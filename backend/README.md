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
