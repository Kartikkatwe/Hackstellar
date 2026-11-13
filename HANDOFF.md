# Session handoff: Complaint Compass (13 Nov 2026)

Everything a new session needs to continue. Read this first, then `HOW_IT_WORKS.md` (the full code guide), `DECISIONS.md` (every decision) and `FOR_JNANOTTAM.md` (frontend handoff).

## 1. Project and people

- **What:** HackStellar PS-19 "Complaint Compass". A classifier-first funnel that files customer complaints from 4 channels under recurring issues, discovers new issues, and ranks a transparent Top 10.
- **Team of 2:** Kartik (backend, the user of these sessions) and Jnanottam (frontend in `frontend/`, his own stack, not built by us).
- **Today, 13 Nov 2026:** Round 1 at **11:00 AM**, offline, judged by teachers (CSE department hackathon). Final at **4:30 PM** before industry judges (Siddhartha Pandey, Microsoft; Abhijit Verma, Ribbon).
- **Repo:** https://github.com/Kartikkatwe/Hackstellar (public). Branch `main`.

## 2. Standing rules from Kartik (follow them)

1. **Code comments:** every file carries short `Why:` / `Not:` notes at decision points: why it was written that way and what was decided against, without wasting tokens.
2. **Business judgement is never regex or rules.** Naming, merging, "same problem?" are always the LLM's or Jev's job. Regex only strips formatting (email greetings, signatures, hashtags) and proposes order-ID candidates that are then verified.
3. **Ask questions** on real decisions (he asked to be asked "a ton of questions").
4. **Credits:** small live spends are fine ("its a few cents"), but every live run stays capped with `MAX_SPEND_USD`. About $0.25 of the $5 OpenRouter credit has been used.
5. **Secrets:** API keys live in `backend/.env` and `backend/keys`, both gitignored. Never commit or paste them anywhere. A remote session does not have them: ask Kartik to set `OPENROUTER_API_KEY` in that environment if a live call is needed.
6. **Privacy:** never put Kartik's email in commits or external requests. Commit as `Kartikkatwe <Kartikkatwe@users.noreply.github.com>`, ending messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
7. **Pitch honesty:** quote measured numbers only, name the comparison model, say what was projected rather than run.

## 3. Where things are

| Path | What |
|---|---|
| `HOW_IT_WORKS.md` | Complete guide: every file and function, business logic numbers, judge Q&A, weak spots |
| `DECISIONS.md` | Decision log |
| `FOR_JNANOTTAM.md` | Frontend handoff: screens, API, setup, measured results |
| `docs/diagrams/` | `1_gate`, `2_funnel`, `3_domain_packs` as SVG (editable) + 4K PNG; `render.ps1` renders SVG→PNG with Edge headless (Windows) |
| `docs/deck/project/` | Source of the pitch deck (section 5) |
| `backend/` | The backend (FastAPI + SQLite + providers); `runs/grocery_live_backup.db` is the live run, committed |

Windows machine details (Kartik's laptop): Python venv `backend\.venv\Scripts\python.exe`; Git at `C:\Program Files\Git\cmd\git.exe`; PyTorch needs the `msvc-runtime` pip package. In PowerShell 5.1, a double quote inside a `git commit -m @'…'@` here-string breaks argument passing (use single quotes), and `python -c` with `count(*)` gets mangled (write a script file instead).

On Linux: `python -m venv .venv && .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu && .venv/bin/pip install -r requirements.txt` (skip `msvc-runtime`). Offline run: `python run_funnel.py` (mock). Serve: `cp runs/grocery_live_backup.db runs/grocery.db && uvicorn app.api:app --port 8000`.

## 4. State of the backend: done and measured

All built and pushed: intake adapters, identity (check-digit order IDs), Jev gate, hybrid embeddings, verify, LLM adjudication, buffer → new issues with a Jev group check, LLM naming, LLM Curator merges, ranking, segment heatmap/compare, metrics, API with live-by-default and labelled offline fallback, cost/caching analysis.

Latest fixes (second live run, all pushed): Haiku 5.5 with `reasoning: {effort: "low"}` and `max_tokens 1024` (a 120 cap was eaten by thinking in run 1: 59 of 66 verdicts cut off); one retry; placeholder titles never complaint text; check-before-create; Curator.

### Measured numbers (live run, 1,500 complaints, real Jev + Claude Haiku 5.5)

| Measure | Value |
|---|---|
| Never reached an LLM | 96.1% |
| Filed under the right issue | 98.4% of 1,325 (match 99.2%, verify 97.3%, LLM 96.2%, new issue 100%) |
| Gate | 99.9% of real complaints kept, 100% of non-complaints removed (151 dropped) |
| Component routing | 99.6% |
| Identity | 100% of 1,215 links correct, 0 wrong, 285 unlinked |
| Hidden issues | 5 of 5 found, as 6 issues, all 100% pure (rude delivery partner split into "rude" 34 + "demands extra payment" 8; Curator judged them different) |
| Settled at | dropped 10.1%, match 50.3%, verify 34.7%, LLM 1.7%, new issue 1.7%, waiting 1.6% |
| Cost | $0.0650 total ($4.33 per 100k): gate $0.0464 (1,500 calls), verify $0.0096 (595), LLM $0.0074 (58), group check $0.0001 (7), naming $0.0004 (6), Curator $0.0010 (6) |

**Speed** (from `events` latencies): per complaint median **0.55 s**, mean 0.83 s, p90 1.11 s, p99 3.54 s. Gate 0.53 s avg, verify 0.54 s, LLM call 1.90 s (163 output tokens), Curator 2.18 s. By path: match 0.53 s, verify 1.09 s, LLM 3.19 s. Local similarity ≈ 0.02 s. LLM-for-everything ≥ 1.9 s per complaint (floor: our Haiku calls had shorter prompts). 2.3× faster on average, 3.5× at the median.

**Detection time** (first complaint of a hidden issue → issue named): duplicate charge after app update **15.1 h** (10 complaints by then); Android app crash **23.4 h**; promo not applied 29.3 h; rude partner 101 h (4.2 days); partial refund 171.7 h (7.2 days). Sudden outages are named within a day; slow trickles wait for 3 different customers.

**Cost by monthly volume** (funnel vs LLM-for-everything on Haiku; caching replayed against real arrival gaps):

| Complaints/month | Funnel | Haiku, no cache | Haiku, best caching | Save vs no cache | Save vs cache |
|---|---|---|---|---|---|
| 1,000 | $0.043 | $0.30 | $0.18 | 85% | 76% |
| 5,000 | $0.22 | $1.49 | $0.65 | 85% | 67% |
| 10,000 | $0.43 | $2.97 | $1.30 | 85% | 67% |
| 50,000 | $2.17 | $14.85 | $6.16 | 85% | 65% |
| 100,000 | $4.33 | $29.70 | $12.32 | 85% | 65% |

Sonnet 5.5: $594 per 100k uncached, about $226 with best caching (we save 98–99%). Baseline calibrated on 12 real calls (prompt 1.42× estimate, reply 197 tokens). The baseline is projected, not run.

**Top 10** (live run): 1 Money debited but order not placed (67 customers, 560.2, Critical); 2 Duplicate payment debits for a single order after app update (52, 547.3, Critical, rising; formula 52 × 3.69 × 2.00 × 1.14 × 1.25); 3 Marked delivered but not received (74, 462.0, Critical); 4 Refund not received (46, 311.8, Critical); 5 Expired or spoiled product delivered (47, 274.8, Critical, legal); 6 App crashes after latest update (60, 243.5, High, rising); 7 Items missing (41, 211.6, Critical); 8 Login OTP late (85, 190.6, High); 9 Delivery late (78, 186.3, High); 10 UPI payment times out (50, 163.3, High).

**Segments** (heatmap lift = segment rate ÷ overall rate): students are **2.4×** as likely to hit UPI timeouts (29.7% vs 12.5% of all customers); Maharashtra is **1.75×** as likely to report "delivered but not received" (32.3% vs 18.5%). Both patterns were planted in the mock data; the engine found them without being told.

## 5. In progress: the pitch deck

**Kartik asked for the deck to be built. The main pitch is SPEED** (big companies care less about token cost); cost is a supporting point.

- **Deck:** https://claude.ai/artifact/RgTd5SB87GSgynCWfGXhR1 (Slides artifact type, private: Kartik must share it from its Share menu before others can open it).
- **Source:** `docs/deck/project/` (identical to what is published). Publish changes with the Artifact tool: `url` = the deck, `root` = the folder that holds `project/` (e.g. `docs/deck`), `file_path` = one file's absolute path, `files` = the others as `{"project/slides/x.html": "project/slides/x.html"}`. Send `deck.json` only if order/sections/faces change. If no Artifact tool is available, write the slide files into `docs/deck/project/slides/` and push; Kartik publishes them from his machine.
- **Look:** Space Grotesk headings, Inter body, JetBrains Mono for formulas. Tokens in `deck.css` on `section`: ink `#141A2E`, body `#4A5568`, paper `#F6F7FA`, paper2 `#ECEFF5`, card `#FCFCFD`, line `#D9DEE8`, accent indigo `#4338CA`, accent-soft `#E7E9FB`, statement `#312E81`. Classes ready: `.eyebrow .title .lead .note .spacer .cards .card(.text .big) .grid2 .stat(.big .text) .table .head .formula .example .cols .col .list .full .dark .cover .statement(.say) .row3 .close .demo-*  .rise` (staged arrival with `style="--i:N"`). Type scale 120 / 64 / 44 / 32 / 24. Canvas 1920×1080, padding 128.
- **Uploaded images:** gate `/_blob/f6b13f7876e8ad7771110eb12ce69c81`, funnel `/_blob/2d5f1b02e1cafc69e4e689aecc3f9c03`, domain packs `/_blob/109169679456cdc65d59bcc4a79bc7f8`. Full-bleed image slides use `<section class="full"><img src="…" alt="…">`.
- **Order (16):** cover, problem, llm, idea, funnel, gate, demo, speed, discovery, accuracy, ranking, segments, cost, packs, limits, close.

**Published (7):** cover, problem, llm, idea, funnel, gate, demo. Each has speaker notes in an `<aside>`.

**Still to write (9), with planned content** (numbers from section 4):

1. **speed** — eyebrow SPEED; title "Filed in half a second, while the customer is still on the line"; `.grid2` of 4 `.stat`: **0.55 s** "median time to file a complaint (an LLM call alone takes 1.9 s or more)"; **96.1%** "of complaints never wait on an LLM, so outages and rate limits barely touch us"; **15 h** "from the first double-charge complaint to a named issue, now ranked #2 and Critical"; **1 report** "of lost money or a safety risk is flagged urgent at once". Notes: live triage while the customer is on chat/call; under a complaint spike only ~4% queue on the LLM; Android crash named in 23 h.
2. **discovery** — title "It found all 5 problems we hid in the data"; `.table` columns Problem (as the LLM named it) / Reports / Named after first report: Duplicate payment debits after app update 73 / 15 hours; App crashes after latest update 91 / 23 hours; Coupon shows applied but no discount 44 / 29 hours; Delivery executive rude to customer 34 + 8 / 4 days; Refund less than amount paid 35 / 7 days. `.note`: sudden outages named within a day; slow trickles wait for 3 different customers; one problem came out as two issues.
3. **accuracy** — eyebrow "ACCURACY · LIVE RUN, 1,500 COMPLAINTS"; title "Measured against an answer key"; table Check / Result: Filed under the right issue 98.4% of 1,325; Real complaints kept 99.9%; Praise, spam and questions removed 100%; Sent to the right part of the business 99.6%; Customer links correct 100% of 1,215 (0 wrong); Hidden problems discovered 5 of 5. `.note`: template-generated data with a fixed seed; the engine never sees the answer key; real complaints will be messier.
4. **ranking** — title "A score anyone can check with a calculator"; `.formula`: customers × impact × (1 + money share) × (1 + 0.25 × anger share) × trend; `.example`: 52 × 3.69 × 2.00 × 1.14 × 1.25 = 547.3 for duplicate payment debits (Critical, rising); table of top 4 (rank, issue, customers, badge).
5. **segments** — title "It shows who is hit hardest"; two `.card`s with `.big` **2.4×** (students, UPI timeouts, 30% vs 12.5%) and **1.75×** (Maharashtra, delivered but not received, 32% vs 18.5%); `.note`: rate = affected ÷ segment size so big segments don't look worst; both patterns were planted and found.
6. **cost** — title "It also costs a fraction"; table Complaints a month / Our funnel / Haiku, best caching / Sonnet, no caching: 1,000 $0.04 / $0.18 / $5.94; 10,000 $0.43 / $1.30 / $59; 100,000 $4.33 / $12.32 / $594. `.note`: Sonnet with best caching about $226 per 100k; baseline priced from calibrated token counts, not run.
7. **packs** — `.full` image of domain packs; notes: one settings file per business, Jev takes labels per request so no training, telecom pack planned.
8. **limits** — title "What is not done yet"; `.cols`: Limits (mock data is cleaner than real; cut-offs tuned on the data they are scored on; baseline priced, not run; one hidden problem split in two) and Next (telecom pack; voice agent phone demo, webhook built; plain-language weekly insights; tune on a real labelled sample).
9. **close** — `.dark .close`; h1 Complaint Compass; `.row3` of 3 `.stat`: 0.55 s to file a complaint; 96.1% never wait on an LLM; 5 of 5 hidden problems found; `.lead` "Thank you. Questions?".

Rules from the Slides type: one `<section id="<id>">` per file, the id equal to the file name; speaker notes in one `<aside>` as the last child; font sizes ≥ 24px; never verify by rendering unless Kartik asks.

## 6. Other open work

- **Rehearse the demo** complaints on the live API (the three on the `demo` slide; one Hinglish). The API must be running with the key for live mode; otherwise it says `"mode": "offline"`.
- **Funnel diagram bottom strip** still leads with cost; could be changed to lead with speed (offered to Kartik, not answered).
- **Not built:** telecom domain pack, voice agent phone simulator (webhook `POST /webhooks/call` exists), plain-language insights, the frontend (Jnanottam).
- Old files `backend/jev_test.py` and `jev_test.ps1` are unused; `BACKEND_DESIGN.md` is partly outdated (DECISIONS.md wins).

## 7. Things learned the hard way

- Haiku 5.5 thinks by default and the thinking counts towards `max_tokens`; use `reasoning: {effort: "low"}` with room (1024).
- Jev on OpenRouter: `POST https://openrouter.ai/api/alpha/decisions`, body `{model: "typesafe/jev-1.14", state, questions}`; answers at `answers[key].noul|choice|probabilities|score`; ~720 input tokens and 0.53 s per gate call; $0.042 per million input tokens.
- Prompt caching only helps if the prefix is ≥ 512 tokens, unchanged, and resent within 5 min (or 1 h at a 2× write); quote replayed figures, not "every call a hit".
- Prices (per million): Haiku 5.5 $0.10 in / $0.50 out / $0.01 cache read; Sonnet 5.5 $2 / $10 / $0.10.
