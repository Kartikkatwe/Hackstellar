# For Jnanottam: what we're building, what exists, and what the frontend needs

Written 13 Nov 2026 from Kartik's planning and build session with Claude. Read sections 1 to 3 for the idea, section 5 for what to build, and section 6 for the API. The rest is reference.

**Your job:** build the frontend in `frontend/`. The stack is your choice. It talks to the backend only through the HTTP API in section 6.

**Deadline:** round 1 is today, 13 Nov, 11:00 AM, offline, judged by teachers. The final is at 4:30 PM before industry judges, for shortlisted teams only.

## 1. The problem (HackStellar PS-19, Complaint Compass)

Build a system that:

1. brings complaints together from email, voice calls, chatbots and social media
2. recognises one underlying problem behind differently worded complaints
3. avoids double-counting a complaint repeated across channels
4. ranks issues by transparent criteria, such as affected customers and severity
5. lets a company filter and compare by customer group (country, state, age group, student status)
6. outputs the top 10 recurring issues

## 2. Our idea in one paragraph

Most teams will send every complaint to an LLM. We don't. Each complaint passes through a **funnel** of checks ordered cheapest first, and each check either settles the complaint or passes it on. A small, fast "decision model" called **Jev** and a free similarity comparison settle almost everything. An LLM is called only for the few complaints those checks can't decide. The pitch is the measured result: the same job at a fraction of the cost, with every ranking explainable by numbers on screen.

## 3. The funnel

```
        ALL COMPLAINTS (email, calls, chat, social)
                         |
   0. WHO SENT THIS?     match to a customer record
                         |
   1. GATE (Jev)         complaint or not? which area? how bad?      --> not a complaint: dropped
                         money lost? legal risk? how angry?
                         |
   2. SIMILARITY MATCH   compare with known issues in that area      --> very close: filed
      (free, local)                                                  --> like nothing known: waiting list
                         |
   3. VERIFY (Jev)       "same problem as issue X?" yes/no           --> confident yes: filed
                         for the 3 closest issues                    --> no to all: waiting list
                         |
   4. ADJUDICATE (LLM)   only the still-unsure few                   --> "issue N": filed
                                                                     --> "new": waiting list

   WAITING LIST   3 different customers report the same new thing --> it becomes a new named issue
   RANKING        unique customers x impact x money lost x anger x trend --> top 10
```

Terms you'll see in the API:

- **Component:** an area of the business (payments, delivery, refunds…). The company defines the list.
- **Issue:** one underlying problem, e.g. "Money debited but order not placed".
- **Registry:** the list of known issues per component. 13 are known from the start ("seed"); the rest are found by the system ("discovered").
- **Pending / unconfirmed report:** a complaint that matches no known issue yet.
- **Settled at:** the stage that decided a complaint: `dropped`, `match`, `verify`, `llm`, `new_issue`, `pending`.

## 4. The thinking behind it

- **Right tool for each job.** Every per-complaint judgement is a pick-one, a rating or a yes/no. Jev answers exactly those, returns a probability with each answer, and costs about $0.00003 per complaint. An LLM is kept for what needs judgement or writing.
- **Count people, not messages.** One customer who emails, phones and tweets counts once. Each complaint is tied to a customer through its channel's identifier (sender email, caller number, chat login, linked social handle) or a verified order ID.
- **Never guess who someone is.** Order IDs carry a check digit (`BN-NNNNNN-C`), so a typo fails instead of matching another customer. Complaints we can't tie to a customer are shown as unlinked, and staff decide what to do.
- **Transparent ranking.** The score is plain arithmetic and every factor is returned by the API, so the UI can show why an issue ranks where it does.
- **One engine, any business.** Everything about the grocery business sits in one config file (`backend/packs/grocery/pack.yaml`). The frontend should take its labels, components and filter options from `GET /config`, with nothing about groceries hard-coded. A telecom pack is planned to prove this.
- **Recurring, not one-off.** A new problem becomes a ranked issue only after 3 different customers report it. A single report with money lost or a safety risk is flagged urgent immediately.
- **Honest numbers.** The mock data records each complaint's true issue, so accuracy is measured, not claimed.

## 5. What the frontend should show

Priority order for 11 AM. The first four carry the demo.

| # | Screen | What it shows | Endpoints |
|---|---|---|---|
| 1 | **Top 10 issues** | Ranked list. Per issue: title, badge (Critical/High/Medium/Low), flags (money, legal, angry, rising), unique customers, and the `formula` string as the score breakdown | `/issues/top` |
| 2 | **Funnel and cost** | Count and share per stage; "95.6% never reached an LLM"; funnel cost beside the LLM-for-everything baselines | `/funnel`, `/cost` |
| 3 | **Issue detail** | The differently worded complaints grouped under one issue, by channel; customers who complained on several channels and were counted once; daily trend | `/issues/{id}` |
| 4 | **Segment filter** | Dropdowns built from `/config` segments; re-query the top 10 with the filter | `/issues/top?state=…` |
| 5 | Segment heatmap | Issues by segment values, coloured by `lift` | `/segments/heatmap` |
| 6 | Compare two groups | Students vs non-students side by side | `/segments/compare` |
| 7 | Unconfirmed reports | Waiting list, urgent first | `/pending` |
| 8 | Live complaint box | Type a complaint, watch which stage settles it | `POST /complaints` |
| 9 | Accuracy panel | Measured accuracy against known answers | `/accuracy` |

Ideas discussed but not built in the backend: a severity-by-reach scatter plot (x = `unique_customers`, y = `avg_impact`; the data is already in `/issues/top`), a phone simulator for a voice-agent call (the webhook exists: `POST /webhooks/call`), and a QR code so judges can submit a complaint from their phone.

**For the pitch, quote the saving with its comparison model.** Measured on 1,500 complaints: 99.0% cheaper than Claude Sonnet 5.5, 80.5% cheaper than Claude Haiku 5.5, and 33.3% cheaper than Haiku with prompt caching. The baseline is projected from token counts, not run.

## 6. The API

Base URL `http://localhost:8000`. Interactive docs with full response shapes: `http://localhost:8000/docs`. CORS is open.

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{pack, business, has_run, batch:{running, done, total, error}}` |
| GET | `/config` | Business name, components, `segments:[{key, label, values}]`, impact and emotion level names, cut-offs, prices |
| GET | `/funnel` | `{total, stages:[{stage, label, count, share}], share_without_llm, llm_adjudications, verify_calls, issues_seeded, issues_discovered, run}` |
| GET | `/cost` | `{funnel:{stages, cost_usd, per_100k_usd, seconds}, baseline:{models:[{model, cost_usd, cost_cached_usd, saving_pct, saving_vs_cached_pct}], seconds, note}, speedup}` |
| GET | `/accuracy` | Gate, component, issue (overall and by stage), discovery and identity accuracy |
| GET | `/issues/top?n=10&<segment>=<value>` | `{filters, issues:[…]}`, see below |
| GET | `/issues/{id}` | `{summary, complaints:[…], repeat_customers:[…], daily:[[date, count]], impact_mix}` |
| GET | `/segments/heatmap?dim=state` | `{dimension, label, segment_sizes, rows:[{issue_id, title, rank, values:{<value>:{affected, rate, lift}}}]}` |
| GET | `/segments/compare?dim=is_student&a=true&b=false` | `{a:{value, issues}, b:{value, issues}}`; issues in `a` carry `rank_in_other` |
| GET | `/pending` | Unconfirmed reports: `[{id, channel, text, created_at, urgent, component, …}]` |
| GET | `/complaints?linked=false&settled=…&limit=…` | Complaint list for staff |
| GET | `/complaints/{id}` | `{complaint, gate, filed_under, events}`: one complaint's path and cost |
| POST | `/complaints` | Body `{channel, text, email?, phone?, user_id?, handle?, order_id?}`; returns `{result, complaint, gate, filed_under, events}` |
| POST | `/webhooks/call` | Voice agent payload, same shape as a line of `backend/data/grocery/calls.jsonl` |
| POST | `/complaints/{id}/link` | Body `{customer_id}`: staff link a complaint by hand |
| POST | `/runs` | Body `{mode:"mock", limit?}`: reprocess the dataset in the background |

One item of `/issues/top`:

```json
{
  "rank": 1, "issue_id": 21, "key": "new_8", "component": "payments",
  "title": "Duplicate payment debits for single order after app update",
  "description": "...", "origin": "discovered",
  "score": 546.7, "badge": "Critical", "flags": ["money", "angry", "rising"],
  "unique_customers": 52, "complaints": 73, "unlinked_mentions": 7,
  "avg_impact": 3.69, "money_share": 1.0, "legal_share": 0.03, "angry_share": 0.56,
  "trend": 1.25, "customers_last_7d": 52, "customers_prior_7d": 0,
  "channels": {"email": 25, "call": 20, "chat": 16, "social": 12},
  "settled_at": {"match": 42, "verify": 27, "new_issue": 4},
  "formula": "52 customers x 3.69 impact x 2.00 money x 1.14 anger x 1.25 trend = 546.7"
}
```

These are the real values from the live run (`description` shortened). `avg_impact` runs from 1 (annoyed) to 4 (harmed). Segment filter keys for grocery: `country`, `state`, `age_group`, `is_student` (`true`/`false`).

## 7. Running the backend on your machine

Needs Python 3.12. From `backend/`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy runs\grocery_live_backup.db runs\grocery.db
.\.venv\Scripts\uvicorn.exe app.api:app --port 8000
```

- `runs/grocery_live_backup.db` is the finished live run on 1,500 complaints. With it copied to `runs/grocery.db`, every GET endpoint works with real results and **no API key or credit**.
- `POST /complaints` uses offline stand-in models by default. They are weak, especially on Hinglish. For a convincing live demo the server needs Kartik's OpenRouter key in `backend/.env` and `PROVIDERS=live`. Ask Kartik for the key; it is not in the repo. Credit is limited to $5, so don't trigger live batch runs.
- The first `POST /complaints` loads a 470 MB sentence model, so it is slow once.

## 8. What the live run measured (1,500 mock complaints, real Jev and Claude Haiku 5.5)

| Measure | Result |
|---|---|
| Filed under the right issue | 99.1% of 1,318 filed |
| Never reached an LLM | 95.6% |
| Routed to the right component | 99.6% |
| Customer links correct | 100% of 1,215; 285 unlinked |
| Hidden issues discovered | 5 of 5 |
| Funnel cost | $0.065 ($4.32 per 100,000 complaints) |

Settled at: gate 10.1%, similarity match 50.3%, Jev verify 33.9%, LLM 0.1%, became a new issue 3.5%, still waiting 2.1%.

## 9. Known problems

- **Discovered issues are split.** The 5 hidden problems came out as 15 issues (the Android crash is 5 of them), and 3 duplicate the known UPI timeout issue. The top 10 therefore undercounts them. A merge step is the next backend task.
- **One discovered issue has a poor title** (it starts "This is unacceptable. I was refunded only part…").
- **Accuracy is on template-generated data.** Real complaints will be messier.
- **Not built:** telecom pack, voice agent simulator, merge step, plain-language insights.

## 10. Decisions already made

Full list in `DECISIONS.md`. The ones that affect the UI:

- Grocery business "BasketNow" with 7 components: payments, delivery, order accuracy, product quality, refunds, account & app, support.
- Severity signals: impact, money lost, legal/safety risk, emotion. Income bracket is left out of grocery.
- Critical badge: legal/safety share of 5% or more, or money-loss share of 50% or more.
- A complaint with no verified order ID still counts towards its issue. Its status (`none`, `failed_check`, `other_account`) is shown, and staff choose whether to request the ID, link it by hand, or leave it.
- Voice channel: the production idea is an AI voice agent behind an IVR that records the complaint and sends it as a webhook. For the prototype only the webhook exists.

## 11. Where things are

| Path | What |
|---|---|
| `backend/README.md` | Commands and endpoint list |
| `BACKEND_DESIGN.md` | Original backend design (some details changed during the build; the code and this file are current) |
| `DECISIONS.md` | Decision log |
| `backend/packs/grocery/pack.yaml` | The business config |
| `backend/runs/grocery_report.json` | Full report of the live run |
| `frontend/` | Yours |
