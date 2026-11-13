# Complaint Compass: backend design (v1, for 13 Nov demo)

Defaults chosen where the team hadn't decided. Anything marked **[default]** can be changed in `config.yaml` or in a quick team call.

## 1. Stack [default]

| Part | Choice | Why |
|---|---|---|
| Language | Python 3.12 | Embeddings + AI SDKs + fast to write |
| API | FastAPI | Typed, auto docs at `/docs` for the demo |
| DB | SQLite via SQLModel | Zero setup, one file, easy to snapshot for a backup demo |
| Embeddings | Local `paraphrase-multilingual-MiniLM-L12-v2` | Free, offline, handles Hinglish reasonably |
| Gate | Jev 1.14 via OpenRouter `/api/alpha/decisions` | Mock gate until credit is added |
| LLM | Via OpenRouter (cheap model, e.g. Claude Haiku 5.5) | Same key as Jev |
| Frontend | Separate app in `frontend/`, talks to the backend only over HTTP (stack open: React/Vite or Streamlit) | Backend and frontend can be built in parallel by different people |

## 2. Folder layout

Two independent projects in `D:\Projects\Hackstellar`. The only contract between them is the HTTP API in section 7 (FastAPI serves it at `http://localhost:8000`, with CORS enabled for the frontend's dev server).

```
Hackstellar/
  backend/
    .env              keys (moved from repo root)
    requirements.txt
    README.md         how to run
    app/
  config.yaml       business, components, thresholds, formula, models
  db.py             engine + session
  models.py         tables (section 3)
  schemas.py        API response shapes (the contract with frontend)
  config.yaml       business, components, thresholds, formula, models
  db.py             engine + session
  models.py         tables (section 3)
  schemas.py        API response shapes
  ingest.py         channel files -> Complaint rows
  providers/
    gate.py         Gate interface: JevGate, MockGate
    llm.py          LLM interface: OpenRouterLLM, MockLLM
    embed.py        Embedder interface: LocalEmbedder (+ cache)
  pipeline/
    matcher.py      similarity vs registry -> MATCH / UNSURE / NEW
    adjudicator.py  LLM with component registry as prefix
    buffer.py       cluster unmatched, promote to new issue at K customers
    run.py          orchestrates stages, writes stage_events
    baseline.py     LLM-for-every-complaint run, same data
  analytics/
    ranker.py       score formula + breakdown + segment filters
    accuracy.py     compare to true_issue_id
  api.py            FastAPI routes
    data/
      generate.py       synthetic customers + complaints with true issues
      customers.jsonl, complaints.jsonl
    tests/
  frontend/
    (separate app: dashboard screens calling the backend API)
```

(Everything listed under `app/` above sits inside `backend/app/`.)

Every external call goes through `providers/`. `MOCK=1` swaps all three for offline fakes, which is the safety net if the venue network fails.

## 3. Data model

```
customers      id PK, name, country, state, age_group, is_student, income_bracket
complaints     id PK, customer_id FK NULL, channel(email|call|chat|social), text,
               created_at, true_issue_key NULL   -- synthetic ground truth
gate_results   complaint_id PK, is_complaint, component, component_probs JSON,
               component_conf, impact (0-3 float), money_lost, churn_risk, legal_risk
issues         id PK, component, key, title, description, centroid BLOB,
               origin(seed|buffer|llm), created_at
assignments    complaint_id PK, issue_id FK, stage(match|verify|llm|buffer),
               similarity, confidence, reason
buffer_items   complaint_id PK, component, embedding BLOB, added_at
runs           id PK, mode(funnel|baseline), started_at, finished_at, n_total
stage_events   id PK, run_id, complaint_id, stage, outcome, latency_ms,
               input_tokens, output_tokens, cost_usd
```

Rules:
- **Affected customers** = `COUNT(DISTINCT customer_id)` over an issue's assignments. Repeats across channels count once.
- **Unlinked mentions** = assignments whose complaint has `customer_id IS NULL`, shown separately.
- Every pitch number (funnel share, cost, latency, accuracy) is a query over `stage_events` and `assignments`.

## 4. Pipeline per complaint

```
GATE (Jev, 1 call, 6 questions)
  is_complaint < 0.5            -> DROPPED
  component + top-2 if margin < 0.15
MATCH (embeddings, within component[s])
  best sim >= 0.80              -> ASSIGN stage=match
  best sim <  0.55              -> BUFFER
  otherwise                     -> ADJUDICATE
ADJUDICATE (LLM, prefix = component registry, cache-friendly)
  "issue <key>" + reason        -> ASSIGN stage=llm
  "new"                         -> BUFFER
BUFFER (per component, after each batch of 50)
  greedy cluster at sim >= 0.70
  cluster with >= 3 unique customers -> LLM writes title/description
  -> new issue, members assigned stage=buffer, later complaints match it
```

Verify stage: left out of v1 (stub in `matcher.py` for later).

## 5. Gate questions (Jev)

| Key | Type | Criteria |
|---|---|---|
| is_complaint | noul | complaint vs praise/spam/question |
| component | choice | descriptions from config.yaml |
| impact | score | Minor annoyance / Inconvenienced / Blocked / Harmed (money, safety, data) |
| money_lost | noul | lost money or charged wrongly |
| churn_risk | noul | says they will leave or switch |
| legal_risk | noul | legal action, consumer court, fraud, food safety, harassment |

Option order is fixed in config; model pinned to `typesafe/jev-1.14`.

## 6. Severity and ranking

```
score = unique_customers
      x avg_impact
      x (1 + money_share)
      x (1 + churn_share)
      x trend            (1.0, or 1.25 if customers in last 7 days >= 2x previous 7)

badge: CRITICAL if legal_share > 0 or money_share >= 0.5
       HIGH / MEDIUM / LOW by score tercile
```

`ranker.top(n, segment)` returns each issue with every factor, flags and badge, so the UI can show the breakdown.
A segment is a filter on customers (`country, state, age_group, is_student, income_bracket`), applied before counting.

## 7. API

| Method | Path | Purpose |
|---|---|---|
| POST | `/runs?mode=funnel\|baseline&limit=` | Process the dataset (background task) |
| GET | `/runs/{id}/funnel` | Per-stage counts, tokens, cost, latency (polled live) |
| GET | `/runs/compare` | Funnel vs baseline: cost, time, accuracy |
| GET | `/issues/top?n=10&<segment filters>` | Ranked issues with breakdown |
| GET | `/issues/{id}` | Detail: grouped complaints by channel, severity mix, daily trend |
| GET | `/segments/heatmap?dim=age_group` | Issue x segment matrix |
| GET | `/segments/compare?a=...&b=...` | Two segments side by side |
| POST | `/complaints` | Push one complaint live during the demo |
| GET/PUT | `/config` | Components and thresholds |

## 8. Synthetic data

- 400 customers with segment profiles.
- ~1,500 complaints over 30 days, 4 channels, ~18 true issues across 6 components (3 seeded per component in the registry, the rest left for the buffer to discover).
- ~15% of customers complain on 2+ channels about the same issue (tests double-counting).
- ~10% non-complaints (praise, spam, questions); ~10% Hinglish; ~15% social posts with no customer link.
- Some issues skewed to segments (e.g. UPI timeouts mostly students) so filters show a story.
- One issue spikes in the last 7 days (shows the trend flag).

## 9. Build order

1. `models.py`, `config.yaml`, `data/generate.py`
2. Providers with mocks, `run.py` end to end on mock
3. `ranker.py` + `/issues/top`; frontend builds the top-10 screen in parallel against `schemas.py` (mock JSON until the API is up)
4. Real Jev + embeddings + LLM; tune cut-offs
5. Baseline run + `/runs/compare` + funnel counter
6. Segments, heatmap, compare view
7. Snapshot the DB and record a video
