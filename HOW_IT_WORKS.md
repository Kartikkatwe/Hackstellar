# How Complaint Compass works

A complete guide to the backend: what every part does, why it was built that way, and what it measured. Each part starts with a simple picture, then gives the real detail.

Contents
1. [The whole thing in one minute](#1-the-whole-thing-in-one-minute)
2. [The problem we are solving](#2-the-problem-we-are-solving)
3. [Why this product is good](#3-why-this-product-is-good)
4. [Words you need](#4-words-you-need)
5. [The journey of one complaint](#5-the-journey-of-one-complaint)
6. [Folder map](#6-folder-map)
7. [Every file and function](#7-every-file-and-function)
8. [Every number in the business logic, and why](#8-every-number-in-the-business-logic-and-why)
9. [How we measure ourselves](#9-how-we-measure-ourselves)
10. [What the live run measured](#10-what-the-live-run-measured)
11. [Questions judges may ask](#11-questions-judges-may-ask)
12. [Weak spots to know about](#12-weak-spots-to-know-about)

---

## 1. The whole thing in one minute

**Like you're 5.** Imagine a post office that gets 1,500 letters a day. Most letters say the same few things ("my parcel is late", "I was charged twice"). Hiring a professor to read every letter is slow and expensive. So the post office sets up a line of sorters, cheapest first:

1. A **doorman** throws out junk mail and puts each real letter in the right room (payments, delivery, refunds…).
2. In each room, a **fast clerk** holds the letter next to a wall of known problems. If it obviously matches one, it is filed. Free.
3. If the clerk is unsure, a **checker** answers yes or no: "is this the same problem as these 3?" Very cheap.
4. Only if the checker is still unsure does the **professor** (an LLM) read it. Expensive, so used rarely.
5. Letters that match nothing go into a **waiting tray**. When 3 different people send the same new kind of letter, it becomes a **new known problem**, and the professor gives it a name.
6. At the end, a **librarian** (the Curator) checks the new problems are not duplicates of old ones.
7. A **scoreboard** ranks the problems by how many people they hurt, how badly, and whether they are growing. That is the Top 10.

**The real names:** the doorman is the **gate** (Jev, a decision model). The clerk is **similarity matching** (a local embedding model, free). The checker is **Jev verify**. The professor is **Claude Haiku 5.5**. The tray is the **buffer**. The librarian is the **Curator**. The scoreboard is the **ranker**.

**The result** (live run, 1,500 complaints): 96.1% of complaints never reached the LLM, 98.4% were filed under the right issue, the whole run cost $0.065, and a typical complaint was filed in 0.55 seconds.

---

## 2. The problem we are solving

HackStellar PS-19, "Complaint Compass": a business gets complaints across email, phone calls, chat and social media. It needs to know:

- which problems keep coming back (recurring issues),
- how many **customers** each one affects (not how many messages: one angry person who emails, calls and tweets is one customer),
- how serious each one is,
- which customer groups are hit hardest (students, a state, an age group),
- a ranked Top 10 with transparent reasons.

**Why it is hard:**
- The same problem is written a hundred ways, in English, Hindi and Hinglish ("paise kat gaye lekin order nahi bana").
- New problems appear that nobody has named yet (a bad app update starts double-charging people).
- Each channel has its own format and its own way of identifying the customer.
- Reading every complaint with an LLM works, but is slow, costs money at scale, and stops completely when the LLM provider has an outage.

---

## 3. Why this product is good

1. **Fast.** Half of all complaints are filed in 0.55 s or less. An LLM reading every complaint takes at least 1.9 s each. The real speed win is **time to discovery**: a new problem becomes a ranked issue as soon as 3 different customers report it, and a single report of lost money or a safety risk is flagged urgent immediately.
2. **Keeps working when the LLM does not.** 96% of complaints never touch the LLM. If the LLM provider is slow, rate-limited or down, almost everything still gets filed.
3. **Cheap.** $4.33 per 100,000 complaints. An LLM reading every one costs $29.70 (Haiku), $12.32 with the best prompt caching, or about $594 (Sonnet).
4. **Explainable.** Every complaint stores which step filed it, why, how sure it was, and what it cost. Every ranking score is a written formula a judge can check with a calculator.
5. **Counts people, not messages.** Identity resolution links each complaint to a customer, so repeat contacts are counted once.
6. **Finds new problems by itself.** It discovered all 5 problems we hid in the data, without being told they existed.
7. **Works in Hinglish.** The multilingual model plus word matching handles mixed-language complaints.
8. **Any business.** Everything about groceries lives in one settings file (the domain pack). A telecom or a bank writes its own file; the engine does not change. Jev needs no training for new labels.
9. **Gets cheaper over time.** When Jev or the LLM confirms a tricky wording, it becomes an example, so the next complaint written that way is matched for free.

---

## 4. Words you need

| Word | Like you're 5 | Real meaning |
|---|---|---|
| **LLM** | A very smart reader that writes answers | Large language model. Here: Claude Haiku 5.5, through OpenRouter. Paid per token, writes free text. |
| **Decision model (Jev)** | A smart reader that can only tick boxes | `typesafe/jev-1.14`. You give it text and typed questions (yes/no, pick one, score); it returns probabilities. Never writes free text, so it is cheaper and its answers never need parsing. |
| **Token** | A piece of a word | What models count and charge for. About 4 characters of English. |
| **Embedding / vector** | Turning a sentence into a list of numbers, so similar meanings get similar numbers | A list of numbers (here 384 + 16,384 = 16,768) representing the text's meaning and words. |
| **Similarity (cosine)** | How much two arrows point the same way | Dot product of two unit-length vectors. 1 = same, 0 = unrelated. |
| **Centroid** | The "average" of an issue's examples | Mean of an issue's example vectors, rescaled to length 1. |
| **Exemplar** | An example complaint stuck to an issue's wall | A stored text for an issue. Seeds come from the pack; more are learned from verdicts. |
| **Registry** | The wall of known problems | All issues, grouped by component, in memory and in the database. |
| **Component** | A room in the post office | A part of the business: payments, delivery, order accuracy, product quality, refunds, account & app, support. |
| **Buffer** | The waiting tray | Complaints that matched nothing, waiting for others like them. |
| **Domain pack** | The rulebook for one business | `packs/<name>/pack.yaml`: components, known issues, questions, segments, cut-offs, prices. |
| **Segment** | A group of customers | A customer field you can filter by: country, state, age group, student. |
| **Mock / offline** | Pretend helpers for practice | Stand-ins for Jev and the LLM that need no internet or credit. Their accuracy means nothing; reports are labelled. |
| **Prompt caching** | The model remembering the start of a long letter it already read | The provider bills a repeated prompt prefix at about a tenth of the price, if it is resent within the cache time (5 min or 1 h). |
| **Luhn check digit** | A last digit that catches typos | A digit computed from the other digits; changing any one digit breaks it. Credit cards use the same trick. |
| **TF-IDF** | Rare words matter more than common ones | Term frequency × inverse document frequency. A word in every complaint ("order") counts little; a rare one ("OTP") counts a lot. |
| **n-gram** | Small chunks of a word | "charge" → "<ch", "cha", "har"… so "charged" and "charges" still overlap, and typos still match. |

---

## 5. The journey of one complaint

Follow one email: *"Hi team, Two debits of Rs 780 for one order since the new app update. Order ID BN-628358-4. Regards, Priya"*

**Step 1. Intake** (`app/ingest.py`). The email adapter strips "Hi team," and "Regards, Priya", keeps the body as `text`, keeps subject + body as `scan` (where order IDs are searched), and records the sender's email.

**Step 2. Identity** (`app/pipeline/identity.py`). The sender's email is found in the CRM → linked to customer C-0123, method `sender_email`, confidence 0.95. The order ID in the text is checked: format OK, check digit OK, order exists, belongs to the same customer → `order_status = verified`.

**Step 3. Gate** (`app/providers/gate.py`, Jev). One request, six questions. Jev answers: is a complaint 0.99; component payments (0.93), refunds (0.05)…; impact 3 of 3; emotion 1; money lost 0.97; legal risk 0.02. Cost about $0.00003. Not a complaint would mean it is dropped here.

**Step 4. Similarity match** (`engine.process`). The text is turned into a vector. It is scored against every issue in payments (and in a second component if the gate's top two were within 0.15). Best score, say, 0.71 for "Duplicate payment debits for a single order after app update". That is ≥ 0.65, so it is **filed** right here, free. Done.

If the best score had been 0.40 (unsure), **Step 5. Verify**: Jev is asked yes/no for each of the top 3 candidates. A yes of 0.80 or more files it. If every answer is 0.20 or less, it goes to the buffer. Otherwise:

**Step 6. Adjudicate**: Claude reads the payments issue list and the complaint, and replies `{"issue": "<key or new>", "reason": "…"}`. A known key files it; "new" sends it to the buffer.

**Step 7. Buffer**: it waits. When reports from 3 different linked customers sit close together (similarity ≥ 0.50), Jev first checks whether the group is really a known issue in new words. If not, Claude names a new issue, and the group (plus any other close buffered reports) is filed under it.

**Step 8. After the batch, the Curator** checks every newly discovered issue against its 4 nearest neighbours and merges duplicates.

**Step 9. Ranking** puts the issue in the Top 10 with its score formula, and the frontend shows it.

Every step writes a row to `events` (model, tokens, cost, time) and the final decision to `assignments` (issue, stage, similarity, confidence, reason). That is how `/complaints/{id}` can show the full trail.

---

## 6. Folder map

```
Hackstellar/
  FOR_JNANOTTAM.md        frontend handoff: screens, API, setup
  DECISIONS.md            every decision we made, with reasons
  HOW_IT_WORKS.md         this file
  BACKEND_DESIGN.md       the first design (partly outdated; DECISIONS.md wins)
  docs/diagrams/          deck diagrams (SVG + PNG) and render.ps1
  frontend/               Jnanottam's project (separate)
  backend/
    .env, keys            API keys (gitignored, never committed)
    requirements.txt      Python packages
    packs/grocery/pack.yaml   the grocery domain pack
    data/
      catalog_grocery.py  the true issues, phrasings and customer data used to generate mock data
      generate.py         writes the mock CRM, orders and complaints
      grocery/            the generated data files
    app/
      config.py           loads .env and the pack; token and price arithmetic
      orderid.py          order IDs with a check digit
      ingest.py           4 channel adapters
      db.py               SQLite schema
      api.py              the HTTP API (FastAPI)
      providers/          the models: http.py, gate.py (Jev), llm.py (Claude), embed.py, mock.py
      pipeline/           engine.py (the funnel), identity.py, run.py (batch runner)
      analytics/          ranker.py (Top 10, heatmap), metrics.py (funnel, cost, accuracy)
    run_funnel.py         run the funnel from the command line
    tune.py               sweep cut-offs
    live_check.py         5 real calls to test the API key
    cache_analysis.py     realistic prompt-caching cost for the baseline
    runs/                 run databases and reports (grocery_live_backup.db is the demo backup)
    jev_test.py, jev_test.ps1   early tests of Jev access (no longer used)
```

---

## 7. Every file and function

### 7.1 `packs/grocery/pack.yaml`: the rulebook

**Like you're 5:** everything the robot knows about this shop is written on one card. Change the card, and the robot works for a different shop.

| Section | What it holds | Why |
|---|---|---|
| `name`, `domain` | "BasketNow", "Quick-commerce grocery delivery" | Used in prompts and the UI. |
| `data_dir` | Where the data files are | Each pack has its own data. |
| `order_id` | Prefix `BN`, 6 digits | Order ID format for this business. |
| `components` | 7 areas, each with a description | The gate's "which area?" options. Order is fixed because Jev's probabilities shift if options are reordered. |
| `seed_issues` | 13 known issues, each with a key, component, title, description and 3 examples (one in Hinglish) | The starting registry. "Known issues the company already tracks." |
| `gate` | Impact levels (Annoyed, Inconvenienced, Blocked, Harmed), emotion levels (Calm…Furious), flag questions (money lost, legal risk) | The gate's severity questions. |
| `thresholds` | All cut-offs (section 8) | Tuned per pack and per embedder. |
| `ranking` | Anger weight, trend multiplier, Critical rules, Top N | The scoring rules. |
| `segments` | country, state, age_group, is_student | Which customer fields can be filtered. Income was left out on purpose. |
| `models` | Jev, Claude Haiku 5.5, the embedding model | Which models to use. |
| `prices_usd_per_million` | List prices | Cost is computed from these. |
| `baseline_models`, `baseline_calibration` | Haiku and Sonnet; prompt size 1.42× the estimate, reply 197 tokens | For the "LLM reads everything" comparison, calibrated on 12 real calls. |
| `jev_token_factor`, `assumed_latency_s` | Mock-mode estimates | So offline runs do not flatter the costs. |

### 7.2 `app/config.py`: settings and money maths

- **`load_env()`**: reads `backend/.env` into environment variables (the API key, `MAX_SPEND_USD`). Ten lines instead of a library.
- **`load_pack(name)`**: reads `pack.yaml` (default `grocery`, or `PACK` env var), adds `id` and `data_path`.
- **`est_tokens(text)`**: characters ÷ 4. Used only when a provider does not report real token counts (mock mode).
- **`cost_usd(pack, model, in, out, cached)`**: tokens × price ÷ 1,000,000. Cached tokens are charged at the cache-read rate.

### 7.3 `app/orderid.py`: order IDs that catch typos

**Like you're 5:** the last digit of the order ID is a secret code made from the other digits. If someone types one digit wrong, the code no longer fits, so we know it is a typo instead of wrongly matching someone else's order.

Format: `BN-NNNNNN-C`, for example `BN-375660-8`.

- **`luhn_digit(digits)`**: the Luhn algorithm. Going from the right, double every second digit (subtract 9 if over 9), add everything, and the check digit is what brings the total to a multiple of 10.
  - Worked example, `375660`: from the right 0, 6, 6, 5, 7, 3 → doubled at positions 1, 3, 5: 0, 6, 12→3, 5, 14→5, 3 → sum 22 → check = (10 − 2) mod 10 = **8**.
  - Typo `375661`: sum becomes 24 → check would be 6, but the customer typed 8 → **fails**.
- **`make(prefix, number)`**: builds a full ID (used by the data generator).
- **`pattern(prefix)`**: a regex that finds IDs even when typed as `bn 375660 8` or `BN375660-8`.
- **`find(text, prefix)`**: returns every candidate ID in a text with "check digit OK?" true or false.

The regex only **proposes** candidates. Accepting one needs the check digit, the order to exist, and corroboration (next section).

### 7.4 `app/ingest.py`: four channels, one shape

**Like you're 5:** letters, phone calls, chats and tweets all arrive looking different. This file rewrites each one onto the same form before anyone reads it.

Every complaint becomes: `{id, channel, text, created_at, email | phone | user_id | handle, order_id, scan, meta}`.
- `text`: what the models read (the customer's own words).
- `order_id`: only when it was captured and verified at the source (voice agent, chatbot).
- `scan`: where typed order IDs are searched (email subject + body, the full social post).

| Function | Input | What it does |
|---|---|---|
| `from_email(r)` | `{id, from, subject, body, received_at}` | Strips one greeting line ("Hi team,") and the sign-off ("Regards, …"). Subject is not added to `text` ("Urgent" carries no meaning) but is kept in `scan` and `meta`. |
| `from_call(r)` | Voice agent payload | Uses `customer_utterances` (the customer's own words), not the agent's summary, which could distort what was said. Takes the order ID only if `order_verified`. Keeps the IVR choice as a hint. **Also handles the live voice webhook.** |
| `from_chat(r)` | Chat session | Joins the customer's messages, but skips the reply right after the bot asks for the order ID (that is a form field, already in `order_id`). |
| `from_social(r)` | Social post | Removes `@mentions` and `#hashtags`. Lowercases the handle. |
| `load_all(path)` | The data folder | Runs every adapter and sorts all complaints by time. Order matters because the registry grows as issues are discovered. |

The regexes here only strip **formatting** (greetings, signatures, hashtags). They make no business judgement; that is always the gate, Jev or the LLM.

### 7.5 `app/pipeline/identity.py`: who sent this?

**Like you're 5:** we want to count people, not letters. So for each letter we find out who wrote it, trusting the most reliable clue first.

Order of trust (`NATIVE`):
1. Chat login → `chat_login`, confidence 1.0
2. Caller's phone number → `caller_number`, 0.95
3. Sender's email → `sender_email`, 0.95
4. Social handle already linked in the CRM → `linked_handle`, 0.8
5. Handle learned earlier from an order ID → `learned_handle`, 0.75
6. Order ID captured by the voice agent or chatbot → `order_at_source`, 0.9 (only if nothing above matched)
7. Order ID typed in an email or post → `order_in_text`, 0.7 (only if nothing above matched, and only if verified)

**`Identity.__init__`** builds lookup tables from the CRM (email → customer, phone → customer…) and an order table.

**`resolve(c)`** returns `{customer_id, link_method, link_conf, order_id, order_status}`. `order_status` is one of:
- `none`: no order ID anywhere.
- `verified`: valid check digit, order exists, and it agrees with who sent it.
- `failed_check`: typo (check digit fails), no such order, or the order is dated after the complaint.
- `other_account`: a real order, but it belongs to someone else ("my mom's order"). The complaint stays with the sender.

A typed order ID **never overrides** a channel identifier. When an unknown social handle gives a valid order ID, the handle is remembered (`learned_handles`), so that person's later posts link automatically. That is "DM us your order ID" made automatic.

**`link_handle(handle, customer_id)`**: called when staff link a complaint by hand.

Complaints with no customer still count towards their issue; they are shown as `unlinked_mentions` and left out of the unique-customer count, never guessed.

### 7.6 `app/db.py`: where everything is written down

**Like you're 5:** one notebook per run, with a page for each kind of thing.

SQLite: one file per run, no server, easy to copy as a backup. WAL mode lets the API read while a run writes.

| Table | One row per | Main columns |
|---|---|---|
| `customers` | Customer | id, name, `profile` (JSON of segment fields; JSON because each pack has different fields) |
| `complaints` | Complaint | channel, text, time, sender, customer_id, link_method, link_conf, order_id, order_status, **settled** (which step settled it), urgent, meta |
| `gate` | Complaint | is_complaint, component, component_conf, all probabilities, impact, emotion, money_lost, legal_risk |
| `issues` | Issue | key, component, title, description, **origin** (`seed`, `discovered` or `merged`) |
| `exemplars` | Example text | issue_id, text |
| `assignments` | Filed complaint | issue_id, **stage** (`match`, `verify`, `llm`, `new_issue`), similarity, confidence, reason |
| `pending` | Complaint in the buffer | component |
| `events` | Model call | stage, model, in/out tokens, cost, latency, estimated? |
| `baseline` | Complaint | tokens an LLM-for-everything call would use (projected) |
| `merges` | Curator merge | from_issue, into_issue, reason |
| `run` | Setting | mode, models, thresholds, time taken, merges, stopped |

**`connect(path, fresh)`**: opens the database; `fresh=True` deletes the old one first and creates the tables.

### 7.7 `app/providers/`: the helpers that call models

#### `http.py`
- **`post_json(url, key, body)`**: one POST with the API key. Retries twice on rate limits (429) and server errors (5xx), with a short wait. Raises `ProviderError` on failure, and says "no credit on the account" on HTTP 402.
- It **never** quietly swaps in a mock. A run that silently became half-mock would report numbers that look real but are not.

#### `gate.py`: Jev
- **`build_questions(pack)`**: the gate's six questions, built from the pack:

  | Key | Type | Question |
  |---|---|---|
  | `is_complaint` | noul (yes/no) | Is the customer reporting a problem with the service? Praise, spam and general questions are not complaints. |
  | `component` | choice | Which area of the business is this about? (the 7 components with descriptions) |
  | `impact` | score | How badly is the customer affected? (4 levels) |
  | `emotion` | score | How upset does the customer sound? (4 levels) |
  | `money_lost` | noul | Did the customer lose money or get charged wrongly? |
  | `legal_risk` | noul | Does the complaint mention legal action, consumer court, fraud, police, food safety or a health problem? |
- **`verify_questions(candidates)`**: one yes/no per candidate: *"Is this complaint about the same underlying problem as: '<title>. <description>'?"* All in one request, so the complaint is billed once.
- **`JevGate.classify(text)`**: sends the six questions to `https://openrouter.ai/api/alpha/decisions`, returns the answers plus token usage.
- **`JevGate.verify(text, candidates)`**: returns `{issue key: probability it is the same problem}`.

**Why Jev for these jobs:** every one is a tick-box answer. Jev returns probabilities (so "unsure" is visible and can be passed on), can only answer from the given options (nothing to parse), and does not pay to write. It takes its labels in each request, so a new business needs no training.

#### `llm.py`: Claude Haiku 5.5
Settings: `temperature 0` (same input → same answer), `reasoning effort low`, `max_tokens 1024`. In the first live run the cap was 120 and Haiku's thinking used it up, so 59 of 66 answers were cut off. Low effort answers completely in about 60 tokens.

Prompts (all replies must be JSON only):
- **`adjudicator_prefix`**: "You triage customer complaints for BasketNow. Component: … Known issues in this component: (each with title, description, 2 examples). Same problem in different words is a match; a different problem in the same area is not." Reply `{"issue", "reason"}`. Only that component's issues are listed: shorter, cheaper, fewer wrong choices.
- **`naming_prompt`** + **`NAMING_RULES`**: "These complaints describe one problem not in the list yet. Name it. Neutral problem statement, in English even for Hindi or Hinglish, no greetings, emotion, threats, amounts, order IDs or customer details." Reply `{"title" (≤ 8 words), "description"}`.
- **`curator_prompt`**: "Keep the issue list free of duplicates. Issue under review: … Other issues: (4 nearest). Same root cause or same fix means same problem." Reply `{"same_as", "title", "description", "reason"}`.
- **`baseline_prefix`**: the prompt an LLM-for-everything system would need: all components, every known issue, and all the gate's questions. **Never sent in a run**; only its size is used to price the comparison.

Functions:
- **`_chat(system, user, required)`**: one call; if the reply lacks the required key, retries once. Token usage from both tries is added up.
- **`_json(text)`**: pulls the JSON object out of the reply.
- **`adjudicate(...)`**: returns the issue key, or `None` if the reply names a key that does not exist. **An invented key is treated as "new"**, never as a phantom issue.
- **`name_issue(...)`**: returns title and description. If the reply is unreadable after a retry, the title is a neutral placeholder ("Unnamed payments issue (5 reports)"), never complaint text.
- **`curate(...)`**: returns the merge verdict, checked against the keys it was shown.

#### `embed.py`: turning text into numbers (local, free)
- **`_Cached`**: each text is embedded once and remembered, because it is compared at several steps.
- **`StEmbedder`**: the multilingual sentence model `paraphrase-multilingual-MiniLM-L12-v2` (384 numbers per text, about 470 MB, runs on the laptop CPU). Understands meaning across languages. Loads from disk first so it works without internet. On Windows it registers the C++ runtime DLLs that PyTorch needs (from the `msvc-runtime` package).
- **`HashEmbedder`**: word matching in pure numpy, 16,384 numbers per text.
  - `_features`: lowercase, drop digits (amounts and IDs say nothing about the problem), drop stop words (but **keep** "not", "no", "nahi"), then whole words (weight 2), word pairs (weight 2) and 3–5 letter chunks (weight 1).
  - `_bucket`: crc32 hash of each feature into a bucket. Not Python's `hash()`, which changes each run.
  - `fit`: learns IDF from the batch (rare words count more). Uses no labels.
  - `_encode`: log-scaled counts × IDF, scaled to length 1.
- **`HybridEmbedder`**: both glued together: `[√0.5 × sentence, √0.5 × words]`. The dot product of two hybrid vectors equals 0.5 × sentence similarity + 0.5 × word similarity, so the rest of the engine needs no changes. Measured nearest-issue accuracy: sentence model alone 80%, word matching alone 84%, **both 91%**. They fail on different complaints, so they cover for each other.
- **`get_embedder(pack, choice)`**: `auto` = hybrid if the sentence model loads, otherwise the hash embedder.

#### `mock.py`: offline stand-ins
For building, testing and a Wi-Fi-failure fallback. They never read the answer key.
- **`MockGate.classify`**: component = nearest component by embeddings; complaint/money/legal/emotion from generic word lists; impact from those. Tokens estimated ×3.4 so mock costs are not flattering.
- **`MockGate.verify`**: a steep curve around the middle of the unsure band.
- **`MockLLM.adjudicate`**: picks the nearest issue if it is above the middle of the band.
- **`MockLLM.name_issue`**: always returns an "Unnamed … issue" placeholder (naming is the real LLM's job).
- **`MockLLM.curate`**: merges if two issue centres are very close.

Mock accuracy means nothing about Jev's accuracy, and every mock report says "mock".

#### `__init__.py`
- **`build(pack, mode, embedder)`**: returns (gate, embedder, llm): real Jev + Claude for `live`, the stand-ins for `mock`. A run is all live or all mock, never a mix.

### 7.8 `app/pipeline/engine.py`: the funnel (the heart)

**`Engine.__init__`**: takes the pack, database, gate, embedder, LLM and identity. Picks the cut-offs for the embedder in use (a 0.7 from one model means something different from a 0.7 from another). Sets up the registry (`issues`, `by_component`), the `buffer`, the spend cap and a gate cache.

**Registry**
- **`seed_registry`**: adds the pack's 13 known issues. Each issue's examples are its title + description and its example complaints.
- **`add_issue`**: writes the issue, embeds its examples into a matrix (`mat`), computes its centroid.
- **`restore`**: rebuilds the registry and buffer from a finished run's database. The API uses this so a live complaint can be processed on top of the 1,500 without reprocessing them.
- **`_recentre`**: centroid = average of the example vectors, rescaled to length 1.
- **`_score(vec, issue)`**: **0.5 × similarity to the centroid + 0.5 × similarity to the closest example.** The centroid captures the issue's general meaning; the closest example lets one specific wording (say, the Hinglish one) count. Either alone was worse.
- **`_candidates(vec, components)`**: scores every issue in the given components, best first.
- **`_components(gate, c)`**: which components to search: the gate's top choice, plus the second if within 0.15, plus the caller's IVR choice as a free hint.

**Bookkeeping**
- **`_event`**: writes one model call to `events` and adds its cost to `spent_usd`. If the spend cap (`MAX_SPEND_USD`) is passed, raises `BudgetExceeded`. Funnel LLM calls are costed **without** any cache discount, the conservative side.
- **`_settle`**: records which step settled the complaint.
- **`_assign`**: files a complaint under an issue. **Learning:** if Jev verify or the LLM decided it, the complaint's wording becomes a new example for that issue (up to 25 per issue). Next time, a complaint written that way matches for free. Plain matches are not learned (they add nothing), and the cap stops one wrong verdict from dragging an issue off course.

**The funnel**
- **`prefetch_gate(complaints)`**: runs the gate for the whole batch with 8 parallel threads. Only the gate can run ahead, because its answer depends on the complaint alone; later steps depend on the registry at that moment.
- **`process(c)`**: the main method, in order:
  1. Identity → who sent it.
  2. Gate → six answers; written to `gate` and `events`. The baseline's token count is recorded too.
  3. `is_complaint < 0.5` → **dropped**.
  4. Embed the text; score candidates.
  5. Best ≥ 0.65 → **filed (match)**.
  6. Best < 0.18, or no candidates → **buffer**.
  7. Otherwise Jev verify on the top 3: best yes ≥ 0.80 → **filed (verify)**; all ≤ 0.20 → **buffer** (the LLM would probably also say "new").
  8. Otherwise Claude adjudicates: a known key → **filed (llm)**; "new" → **buffer**.

**New issues**
- **`_to_buffer`**: adds the complaint to its component's buffer and to `pending` (staff see it as an "unconfirmed report"). **Urgent** if money lost or legal risk ≥ 0.5, so a single report of lost money is not left waiting. Then finds every buffered complaint within 0.50 similarity of this new one (a "star" around the newcomer, not a chain, because A≈B and B≈C does not mean A≈C). If those come from **3 or more different linked customers** (three posts from one angry person are not three people):
  - **`_existing_match`**: first, Jev is shown the 3 most typical texts together and asked whether they are one of the top 3 known issues (stage `verify_group`). Three reports together say more than one. If yes (≥ 0.80), they are filed under that known issue.
  - Otherwise **`_promote`**: Claude names the new issue (one call per new issue, not per complaint), it is added as `new_<n>` with origin `discovered`, and the buffer is swept: any other waiting complaint that now scores ≥ 0.65 against it is filed too.
- **`_typical(members)`**: sorts a group from most to least typical (closest to the group's centre).

**Curator**
- **`curate()`**: after the batch, for each discovered issue, shows Claude the issue and its 4 nearest issues in the same component. If Claude says it is the same problem, `_merge`. If an issue still has a placeholder name, it is named again. About $0.0002 per issue.
- **`_merge(src, dst)`**: moves all complaints and examples to the target, marks the source `merged` (kept, not deleted), records it in `merges`, recomputes the centroid. A seeded issue keeps its company-given name; a discovered target gets the LLM's combined name.
- **`_retitle`**: updates a title in memory and the database.

### 7.9 `app/pipeline/run.py`: the batch runner
- **`db_path(pack)`**: `runs/<pack>.db`.
- **`load_crm(pack)`**: reads customers and orders.
- **`build_engine(...)`**: builds the providers, fits the word-matching IDF on the batch + seed texts, creates the `Engine`.
- **`run_batch(pack, mode, embedder, limit, progress, overrides)`**: fresh database → load customers → build engine → seed registry → embed all complaints in one batched pass → (live) set the spend cap (default $0.25) and prefetch the gate → process every complaint in time order, committing every 100 → run the Curator → save the run's settings. If the cap is hit, the partial run is kept and marked `stopped`.

### 7.10 `app/analytics/ranker.py`: the scoreboard

**Like you're 5:** each problem gets points: more hurt people, more points; worse hurt, more points; lost money, extra; angry customers, a little extra; growing fast, extra.

```
score = unique customers
      × average impact (1 to 4)
      × (1 + share of complaints with money lost)
      × (1 + 0.25 × share of angry complaints)
      × trend (1.25 if rising, else 1)
```

**Worked example** (rank 2 in the live run, "Duplicate payment debits for a single order after app update"):
52 customers × 3.69 impact × (1 + 1.00) money × (1 + 0.25 × 0.56) anger × 1.25 trend = 52 × 3.69 × 2.00 × 1.14 × 1.25 = **547.3**

- **Unique customers**, not complaint count: one person on three channels counts once.
- **Average impact** is the gate's 0–3 score plus 1, so a mild issue is not multiplied by zero.
- **Money share**: share of its complaints where `money_lost ≥ 0.5`. Can double the score.
- **Anger** is deliberately small (at most ×1.25): a loud customer must not outrank a quiet one who lost money.
- **Rising**: customers in the last 7 days ≥ 5 **and** ≥ 2× the 7 days before. The floor of 5 stops tiny numbers looking like a trend.
- **Badges**: **Critical** if at least 3 complaints and (legal/safety share ≥ 5% or money share ≥ 50%). The rest are split into thirds: High, Medium, Low.
- **Flags**: `money` (share ≥ 0.5), `legal` (≥ 0.05), `angry` (≥ 0.4), `rising`.
- **Filters** (`state=Karnataka`, `is_student=true`…) are applied **before** counting, so the same formula answers "top issues for students" with no special code.
- Every result carries a `formula` string so the UI can show exactly how the score was made.

**Why arithmetic, not AI:** the problem statement asks for transparent criteria. A judge can check every score by hand.

**`heatmap(con, pack, dim)`**: for each Top 10 issue and each value of one segment (say each state):
- `affected` = customers in that segment with this issue,
- `rate` = affected ÷ segment size (a raw count would always make the biggest segment look worst),
- `lift` = segment rate ÷ overall rate. Lift 2.0 means customers in that segment are twice as likely to have the problem.

### 7.11 `app/analytics/metrics.py`: the report card
- **`run_info`**: the run's saved settings.
- **`funnel`**: how many complaints settled at each step and their share; number of gate, verify and LLM calls; share that never reached an LLM; issues seeded, discovered and merged; group checks and Curator calls.
- **`cost`**: the funnel's real cost per step (from `events`) against the baseline, for Haiku and Sonnet, without caching and with the best-case caching. The baseline's token counts are scaled by the calibration from 12 real calls. Also the speed-up, using the measured LLM latency.
- **`accuracy`**: checks the run against `truth.json` (the answer key the generator wrote; the engine never reads it):
  - gate: real complaints kept, non-complaints removed,
  - component routing accuracy,
  - issue accuracy overall and per step (match, verify, llm, new_issue), and what is still waiting,
  - discovery: each discovered issue is labelled with the true issue most of its members have; reports size, purity, and whether it duplicates a known issue,
  - identity: correct links, wrong links, unlinked.

### 7.12 `app/api.py`: the HTTP API (FastAPI)

The only connection to the frontend. Start with `uvicorn app.api:app --port 8000`; interactive docs at `/docs`.

| Endpoint | What it does |
|---|---|
| `GET /health` | Which pack, whether a run exists, batch progress, whether live complaints use real models. |
| `GET /config` | Everything the UI needs to label itself (components, segments and their values, level names, cut-offs, models, prices). Nothing about groceries is hard-coded in the frontend. |
| `GET /funnel` | Counts per step (`metrics.funnel`). |
| `GET /cost` | Funnel against baseline (`metrics.cost`). |
| `GET /accuracy` | Accuracy against the answer key. |
| `POST /runs` | Re-run the whole dataset in a background thread. Live runs need `ALLOW_LIVE_RUNS=1` so nobody spends credit by accident. |
| `GET /issues/top?n=10&state=…` | Ranked issues with full breakdown, optional segment filters. |
| `GET /issues/{id}` | One issue: its complaints, **repeat customers** (one person, several channels, counted once: the evidence for "no double counting"), daily counts, impact mix. |
| `GET /segments/heatmap?dim=state` | The heatmap. |
| `GET /segments/compare?dim=is_student&a=true&b=false` | Two groups' Top 10 side by side, with each issue's rank in the other group. |
| `GET /pending` | Unconfirmed reports, urgent first. |
| `GET /complaints?settled=…&linked=false` | Filterable complaint list (e.g. unlinked ones staff may chase for an order ID). |
| `GET /complaints/{id}` | One complaint's full trail: gate answers, where it was filed, every model call with tokens, cost and time. |
| `POST /complaints/{id}/link` | Staff link a complaint to a customer by hand; a social handle is then remembered. |
| `POST /complaints` | **Live demo:** push one typed complaint through the funnel now and return its trail. |
| `POST /webhooks/call` | **Voice agent:** the same, for a call payload (same shape as `calls.jsonl`). |

Helpers:
- **`_read()`**: opens a fresh read connection per request, so readers never wait on a writer.
- **`_providers()`**: live if the OpenRouter key is present (or `PROVIDERS` says otherwise).
- **`_live_engine()`**: the engine for live complaints, restored from the last run on first use, with offline stand-ins kept ready and a spend cap (default $0.50).
- **`_process_live(c)`**: gives the complaint an `L-00001` style ID and processes it. If the network fails or the cap is hit, it rolls back, reprocesses **offline**, and returns `"mode": "offline"` plus a warning. Never silent.
- **`_lock`**: one writer at a time, because the registry is shared.

### 7.13 Scripts

- **`run_funnel.py`**: `python run_funnel.py [--mode live] [--limit 200] [--top 12]`. Runs a batch and prints the funnel, cost, accuracy and Top N; writes `runs/<pack>_report.json`.
- **`tune.py`**: tries many combinations of the match, buffer and cluster cut-offs and prints accuracy, LLM use and cost for each. This is how 0.65 / 0.18 / 0.50 were chosen.
- **`live_check.py`**: 3 gate calls, 1 verify, 1 LLM call (well under 1 cent) to prove the key works and the response shape is right before spending on a batch.
- **`cache_analysis.py`**: prints the real prompts, and prices the baseline with **realistic** caching: it replays the complaints' real arrival times against the 5-minute and 1-hour cache expiry, the 512-token minimum, and the fact that a newly discovered issue changes the prompt (forcing a fresh cache write). `--measure N` sends N real calls to calibrate.
- **`data/generate.py`**: makes the mock world with a fixed seed (7):
  - 400 customers with country, state, city, age group, student status, phone, email, chat ID and sometimes a social handle (only some handles are in the CRM),
  - 2,564 orders with real check-digit IDs and dates,
  - 1,500 records: 90% complaints, 10% praise, questions or spam,
  - each channel in its own native format (email with greeting and signature, call with transcript and IVR choice, chat with bot turns, social with hashtags),
  - Hinglish more often on calls (45%) than email (5%),
  - 15% of complaints repeated by the same customer on another channel,
  - email order IDs sometimes with a typo or someone else's order,
  - `truth.json`: the answer key.
- **`data/catalog_grocery.py`**: the 18 true issues with many phrasings each. **13 are seeded** in the pack; **5 are hidden** for the engine to discover: duplicate charge after an app update (starts day 24), promo not applied, rude delivery partner, partial refund, Android app crash (starts day 24, more on Android). Some issues are skewed to segments (UPI timeouts hit students more; "delivered but not received" is higher in Maharashtra and Delhi) so the heatmap has something real to find.
- **`docs/diagrams/render.ps1`**: turns the SVG diagrams into 4K PNGs with Edge.

### 7.14 `runs/`
- `grocery.db`: the latest run (gitignored).
- `grocery_live_backup.db`: the live run of 13 Nov, committed. Copy it to `grocery.db` and every GET endpoint works with no API key.
- `grocery_report.json`: the printed report as JSON.

---

## 8. Every number in the business logic, and why

| Setting | Value | Meaning | Why this value |
|---|---|---|---|
| `is_complaint` | 0.5 | Below this, dropped | Jev's yes/no midpoint. Measured: 99.9% of real complaints kept, 100% of noise removed. |
| `component_margin` | 0.15 | Search two components if their probabilities are this close | A complaint sent to the wrong room is never compared with its true issue. |
| `match_hi` | 0.65 | File without asking | Chosen with `tune.py`. Direct matches were 99.2% correct. Higher sends more to Jev for no gain; lower files wrong ones. |
| `match_lo` | 0.18 | Below this, straight to the buffer | Deliberately low: a Jev check costs about $0.00002, far less than a wrong filing. |
| `verify_yes` | 0.80 | Jev's yes needed to file | High bar: a wrong filing corrupts the counts. |
| `verify_no` | 0.20 | All candidates below this → buffer, skip the LLM | The LLM would see the same candidates and most likely also say "new". |
| `verify_candidates` | 3 | Candidates Jev checks | The right issue was almost always in the top 3; more adds tokens. |
| `cluster` | 0.50 | Buffer reports this close count as the same new problem | Tuned with `tune.py`. |
| `new_issue_customers` | 3 | Different customers before a new issue is created | PS-19 asks for *recurring* issues; one odd complaint should not be ranked. |
| `urgent_flag` | 0.5 | Money lost or legal risk above this → urgent at once | Lost money or a safety risk should not wait for two more people. |
| `EXEMPLAR_CAP` | 25 | Examples per issue | Learning helps, but unlimited growth lets mistakes drift an issue. |
| `angry_weight` | 0.25 | Anger's effect on score | Anger matters a little; lost money matters more. |
| `trend_multiplier` | 1.25 | Bonus for rising issues | Rising issues need attention first, but should not swamp size. |
| Rising rule | ≥ 5 and ≥ 2× | Last 7 days vs previous 7 | The floor of 5 stops noise looking like a trend. |
| `critical_money_share` | 0.5 | Critical if half the reports lost money | A money problem is a company-level risk. |
| `critical_legal_share` | 0.05 | Critical if 5% mention legal/safety | Not "any mention": one stray threat should not make an issue Critical. |
| Score weights in `_score` | 0.5 / 0.5 | Centroid vs closest example | Centroid alone averages away rare wordings; closest alone lets one odd example decide. |
| Hybrid weight | 0.5 | Sentence model vs word matching | Equal weight gave 91% nearest-issue accuracy. |
| Spend cap | $0.25 batch, $0.50 API | `MAX_SPEND_USD` | Live runs spend real credit; a bug must not drain it. |

---

## 9. How we measure ourselves

- **Accuracy is measured, not claimed.** The generator writes `truth.json` with every complaint's real issue and customer. The engine never reads it; only `metrics.accuracy` does.
- **Cost is measured.** Every real call's tokens come from the provider's own usage report, priced at list price.
- **The baseline is projected, not run.** For each complaint we record how big an LLM-for-everything prompt would be (every component, every issue, the questions). Sizes were calibrated with 12 real calls: real prompts were 1.42× our estimate and replies about 197 tokens.
- **Caching is replayed, not assumed.** A cached prompt only helps if the next call comes within the cache time and the prompt has not changed. `cache_analysis.py` replays the real arrival times. Saving against Haiku with caching: 65% to 71%, depending on volume. "Every call a cache hit" is the ceiling, shown as the honest worst case for us.
- **Speed is measured** from every call's real time in `events`.

---

## 10. What the live run measured

1,500 complaints, real Jev and Claude Haiku 5.5, 13 Nov.

| Measure | Result |
|---|---|
| Never reached an LLM | 96.1% |
| Filed under the right issue | 98.4% of 1,325 filed (match 99.2%, verify 97.3%, LLM 96.2%, new issue 100%) |
| Gate | 99.9% of real complaints kept, 100% of non-complaints removed |
| Component routing | 99.6% |
| Identity | 100% of 1,215 links correct, 0 wrong, 285 unlinked |
| Hidden issues found | 5 of 5 (as 6 issues, all 100% pure) |
| Cost | $0.065 total, $4.33 per 100,000 |
| Time per complaint | 0.55 s median, 0.83 s average |

Where complaints settled: dropped 10.1%, similarity match 50.3%, Jev verify 34.7%, LLM 1.7%, became a new issue 1.7%, still waiting 1.6%.

Cost per step: gate $0.0464 (1,500 calls), verify $0.0096 (595), LLM adjudicate $0.0074 (58), group check $0.0001 (7), naming $0.0004 (6), Curator $0.0010 (6).

---

## 11. Questions judges may ask

**"Why not just use an LLM for everything?"**
It is slower (at least 1.9 s per complaint against 0.55 s), stops when the provider is down, hits rate limits during complaint spikes, and costs 7× (Haiku) to 140× (Sonnet) more. Our funnel uses the LLM only where it adds value: the 4% that cheaper steps cannot decide, naming new issues, and merging duplicates.

**"Why is Jev better than an LLM for the gate?"**
Every gate answer is a choice, not writing. Jev returns calibrated probabilities, so unsure answers can be passed on, and it can only answer from the given options. It costs $0.00003 per complaint.

**"What algorithm finds 'the same problem'?"**
Each text becomes a unit vector (multilingual sentence embedding + TF-IDF word/character n-grams). Similarity is the dot product (cosine). An issue's score is the average of similarity to its centroid and similarity to its closest example.

**"Complexity?"**
Per complaint: one gate call, then comparing one vector against the issues of one or two components (about 2–4 issues, up to 25 examples each, 16,768 numbers per vector). Linear in the number of issues in the component, tiny in practice. The buffer check is linear in the buffer size for that component.

**"How do you discover new issues?"**
Unmatched complaints wait in a per-component buffer. When reports from 3 different customers sit within 0.50 similarity of the newest one, Jev checks whether they are a known issue in new words; if not, the LLM names a new issue. After each batch the LLM Curator merges duplicates.

**"How do you avoid counting one angry customer three times?"**
Identity resolution links every complaint to a CRM customer (login, phone, email, handle, or a check-digit-verified order ID). The score counts unique customers. `/issues/{id}` lists the repeat customers as proof.

**"What if the order ID is typed wrong?"**
The check digit fails, so it is marked `failed_check` instead of wrongly linking to someone else's order.

**"Is the regex doing business logic?"**
No. Regex only strips email greetings, signatures and hashtags, and proposes order-ID candidates (which are then checked). Every judgement about meaning (is it a complaint, which issue, naming, merging) is made by Jev or the LLM.

**"How is this domain-agnostic?"**
Everything specific to groceries is in `pack.yaml`. Jev's questions, the LLM's prompts, the segments and the UI labels are all built from it. A telecom writes its own pack; no code changes.

**"Will it work on real data?"**
Our data is template-generated, so real accuracy will be lower. The design copes: thresholds are tuned per pack on a labelled sample, unsure cases go to Jev and the LLM, and learned examples improve matching over time.

---

## 12. Weak spots to know about

Know these before a judge finds them:

1. **Synthetic data.** The complaints come from templates, so they are cleaner than real ones. Accuracy on real data will be lower.
2. **Cut-offs were tuned on the same data they are measured on.** On real data you would tune on one labelled sample and measure on another.
3. **The baseline was not run.** Its cost is projected from calibrated token counts at list price.
4. **One hidden issue came out as two.** "Delivery executive rude" (34) and "rider demands extra payment" (8). The Curator judged them different problems. Defensible, but a split.
5. **Learning can drift.** Learned examples come from Jev or LLM verdicts, which are 96–97% right; the cap of 25 limits the damage of a wrong one.
6. **Jev's endpoint is in alpha** on OpenRouter. If it changes, `gate.py` is the only file to update.
7. **Prototype scale.** SQLite, one writer at a time, in-memory registry. Fine for a demo; a company would use a real database and a vector index.
8. **The gate is a network call.** 0.53 s of the 0.55 s is waiting on Jev; the local matching takes 0.02 s.
9. **Not built yet:** the telecom pack, the voice agent phone simulator (the webhook exists), plain-language insights, and the frontend (Jnanottam).
