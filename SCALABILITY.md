# Scalability strategy: Complaint Compass

How the funnel grows from the 1,500-complaint demo to millions of complaints a month and many businesses, what breaks first, and what we change at each stage. Numbers marked *measured* come from the 13 Nov live run; everything else is a projection.

## 1. The short answer (for judges)

> The funnel already gets the hard part of scaling right. 96% of complaints never touch the LLM, cost grows linearly at $4.33 per 100,000, and the only shared state is split up naturally by business and by component. To scale, we split the pipeline into stateless steps that we can run as many copies of as needed, plus one single-writer worker for each business × component, connected by a queue. No step has to be redesigned.

## 2. Why the design already scales

| Property | Why it matters at scale |
|---|---|
| **96.1% never reach an LLM** (*measured*) | LLM rate limits and outages affect only ~4% of traffic. During a complaint spike, only those 4% queue up. |
| **Cost is linear and small** (*measured* $4.33 / 100k) | 10M complaints a month ≈ **$433** in model calls. An LLM on every complaint with Haiku ≈ $1,232 (best caching) to $2,970; with Sonnet ≈ $59,400. |
| **Partitioned by business (pack) and component** | A complaint is only compared with issues in its own component. Payments never waits on delivery. That gives a natural split for both data and work. |
| **Jev takes labels per request** | A new business is a new `pack.yaml`. There's no model to train or host per business. |
| **Gets cheaper with use** | Learned examples (up to 25 per issue) turn tomorrow's Jev and LLM cases into free similarity matches. |
| **Every decision is a row** | Audit, metrics and replay work the same at any volume. |

## 3. What breaks first (the honest list)

From the prototype code (`engine.py`, `api.py`, `run.py`):

| # | Bottleneck today | Breaks at about | Fix |
|---|---|---|---|
| 1 | **One writer for everything** (`_lock` in `api.py`); the registry and buffer live in one process's memory | Sustained traffic above a few complaints a second | One writer per tenant × component partition (section 4) |
| 2 | **SQLite**, one file per run | Several processes writing at once, or a long history | Postgres (plus pgvector), with tables split by tenant and month |
| 3 | **Gate latency** 0.53 s per call (*measured*), 8 threads | ~15 complaints/s ≈ 1.3M a day per worker | More gate workers; cache answers for near-duplicate texts; ask Jev about batching |
| 4 | **Dense 16,768-number vectors**, scanned one by one | ~1,000 issues in a component × 25 examples ≈ 25k vectors ≈ **1.7 GB** of float32 | Store the word part sparsely (it is mostly zeros), and/or an approximate-nearest-neighbour index per partition |
| 5 | **Buffer scan** is linear in buffer size | Large backlogs of unmatched reports | Expire old buffer items (e.g. 30 days); nearest-neighbour index on the buffer |
| 6 | **Ranker recomputes** Top 10 from all assignments | Millions of assignments | Running counters per issue (customers, impact sum, money count, anger count), updated on each filing; Top 10 refreshed every minute |
| 7 | **Jev is on the critical path** | A Jev outage stops intake | Degraded mode: route by nearest component using embeddings (`MockGate` logic), labelled `degraded`, re-gated when Jev returns |
| 8 | **Provider rate limits** (OpenRouter) | Unknown until tested | Back-pressure from the queue, token-bucket per provider, a second provider path for the LLM |

## 4. Target architecture

```
 Channels (email, voice webhook, chat, social)
          |
   [ Intake API ]  stateless, any number of copies
          |
   queue: raw-complaints
          |
   [ Stage A workers ]  stateless, any number of copies
     intake -> identity (CRM cache) -> Jev gate -> embed
          |
   queue: classified, keyed by  tenant : component
          |
   [ Stage B: partition workers ]  exactly one writer per key
     similarity match -> Jev verify -> LLM adjudicate
     -> buffer -> new issue -> learn exemplars
          |
   Postgres + pgvector  (issues, exemplars, assignments, events)
          |
   [ Curator ]  scheduled, per partition      [ Ranker ]  running counters -> Top 10 / heatmap
          |
   Read API + dashboard (read replicas)
```

**Why it's split this way:**
- **Stage A has no shared state.** Identity reads a CRM cache and the gate depends only on the complaint itself (the same reason `prefetch_gate` can already run ahead). So Stage A scales just by adding workers.
- **Stage B is where order matters.** The registry grows as issues are discovered, so complaints in one component must be handled one at a time, in order. Keying the queue by `tenant:component` keeps that order inside each partition while different partitions run in parallel. A grocery business has 7 partitions; 100 businesses have about 700.
- **Two-component complaints** (gate margin < 0.15): the worker reads the second component's issues from a recent snapshot and writes only to its own partition. Reads never need a lock.
- **A hot partition** (e.g. payments during an outage) stays mostly cheap. Most of its complaints file on the free similarity match, so one worker keeps up. If it doesn't, split it by sub-area or by region.
- **Identity's learned social handles** are small per-tenant writes (an upsert in Postgres), not in-memory state.

## 5. Phases

| Phase | Volume | Changes | Rough model cost per month |
|---|---|---|---|
| **0. Today** (built) | Demo, ~1,500 per batch | SQLite, one process, in-memory registry | — |
| **1. One business, production** | Up to ~1M/month | Postgres + pgvector; Redis queue; Stage A and Stage B as separate processes on one or two machines; running counters for the ranker; degraded-gate mode | ≈ $43 |
| **2. Many businesses** | 10M+/month | Partitioned queue (Kafka or Redis Streams keyed by `tenant:component`); per-tenant packs and data isolation; autoscaled Stage A; scheduled Curator per partition; read replicas for the dashboard | ≈ $433 at 10M |
| **3. Optimise** | 100M+/month | Embedding model on a shared GPU service; gate cache for near-duplicate texts; batched Jev calls if supported; sparse vectors; per-tenant tuning of cut-offs on a labelled sample | Below linear: learned examples push more complaints onto the free match |

Model costs are the *measured* per-complaint cost × volume. They exclude hosting, which at these volumes is a few machines plus a managed Postgres.

## 6. Throughput maths (projection)

- **Stage A:** each worker keeps 8 gate calls in flight. At 0.53 s per call, that's ≈ 15 complaints/s ≈ 1.3M a day. Ten workers ≈ 13M a day. Jev's real rate limit is the unknown to check first.
- **Stage B:** local matching takes ≈ 0.02 s (*measured*), so one partition worker can file about 50 complaints/s on the match path. The 35% that need verify add a network call. Run verify calls in parallel within a partition, but write the results in order.
- **LLM:** ~4% of traffic. At 10M a month that's ≈ 0.15 calls/s on average. Spikes are absorbed by the queue rather than failing.

## 7. Keeping quality as it scales

- **Tune per pack:** each new business tunes its cut-offs (`match_hi`, `match_lo`, `cluster`) on a labelled sample and is measured on a separate one. This also answers today's weak spot of tuning on the same data we measure on.
- **Drift guard:** keep the exemplar cap (25). Re-score a random sample of learned examples weekly with Jev, and drop any that fail.
- **Monitoring:** watch the share settled at each step. If the LLM share climbs above ~5%, the registry is out of date or a new problem is emerging. The funnel's own metrics act as the health check.
- **Shadow mode** for a new tenant: run alongside their current process for two weeks before switching over.

## 8. What we have not proven

- No load test has been run. The throughput numbers above are worked out from measured latencies.
- Jev and OpenRouter rate limits at production volume are unknown.
- Real complaint data will be messier than our templates, which could push more traffic to verify and the LLM. That raises cost linearly but doesn't change the architecture.
