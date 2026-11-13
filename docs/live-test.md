# Live accuracy test, 13 Nov 2026

300 complaints the engine had never seen, sent one at a time to the live site (https://hackstellar-three.vercel.app) with the real models: Jev for the gate and verify, Claude Haiku as the LLM. Every complaint has a hidden right answer; the engine never reads it.

## Method

- **Complaints:** made by `data/generate.py --fresh <seed>`. They use the site's own customers and orders, with new randomness for the complaint text. 251 of the 300 are worded unlike anything in the 1,500-complaint dataset. The other 49 repeat a template sentence exactly.
- **Batches:** three independent batches of 50, 100 and 150 (seeds 5001, 5002, 5003). Each ran on a clean copy of the live data. Each batch is about 10% non-complaints (praise, spam, questions), as in the main dataset.
- **Sending:** one at a time, through the public API, the same way a customer's complaint arrives.
  - Calls went to `/webhooks/call` as the voice agent's payload.
  - Email, chat and social went to `/complaints` as the customer's own words, without email greetings and signatures, social hashtags, or the chat reply that gives the order ID.
  - The site ran main at `7a078c0`, with the Vercel cut-offs and the word-only embedder.
  - Since then, intake keeps the raw text. A re-run with `live_test.py` sends it as written, so its numbers may differ slightly.
- **Scoring:** `live_test.py score` compares every answer with the key. It uses the final state of each complaint, because a complaint can be filed after its own answer when a new issue forms.
- **Reset:** the live data was reset after the test.

## Results

| | Batch 1 · 50 | Batch 2 · 100 | Batch 3 · 150 | All 300 |
|---|---|---|---|---|
| Handled right | 49 | 99 | 149 | 297 |
| Gate: real complaints kept | 44 / 45 | 90 / 90 | 135 / 135 | 269 / 270 |
| Gate: non-complaints set aside | 5 / 5 | 10 / 10 | 15 / 15 | 30 / 30 |
| Right business area | 44 / 44 | 89 / 90 | 135 / 135 | 268 / 269 (99.6%) |
| Filed under the right problem | 44 / 44 | 89 / 89 | 134 / 134 | **267 / 267 (100%)** |
| Waiting, not guessed | 0 | 1 (urgent) | 1 | 2 |
| Wrong | 1 | 0 | 0 | 1 |

### By the step that filed it

| Step | Done by | Filed | Right | Full run of 1,500 (for comparison) |
|---|---|---|---|---|
| Similarity | free, local | 100 | 100% | 99.2% |
| Verify | Jev | 162 | 100% | 97.3% |
| LLM | Claude Haiku | 5 (+2 sent to the waiting list) | 100% | 96.2% |

**Customers:** customer links were checked on batch 3. Of 150 complaints, 121 were linked to a customer and none were wrong. The other 29 came from unknown senders and were left unlinked rather than guessed.

### The three not filed

1. **Missed.** "ande toote hue aaye. Thanks." The eggs arrived broken; it came in as a call, in Hinglish. The gate gave it 0.15 as a complaint, because the thank-you read as polite.
2. **Waiting, urgent.** "Seriously? order me cooking oil aaya hi nahi, paise pure kate I needed it urgently. Sort it out." An item was missing from the order. The gate put it under delivery, and the LLM declined to choose a problem. It is flagged urgent because money was lost.
3. **Waiting.** "The detergent had fungus on it." An expired product. The LLM was not sure which known problem it is.

### Speed and cost

- **Time per complaint:** timed from outside, through the internet to the live site and back.
  - Median 0.45 s; 90% finished under 0.62 s.
  - By the step that settled it (medians):
    - similarity: 0.39 s
    - gate (set aside): 0.42 s
    - Jev verify: 0.48 s
    - LLM: 1.85 s
  - One LLM call alone took 1.24 s (median of 7).
- **Cost:** $0.013 for all 300 at list prices, which is $4.33 per 100,000 complaints. The run of 1,500 gives the same figure.

## Limits

- The complaints come from the same templates as the dataset, so real complaints will be messier and accuracy lower.
- The cut-offs were tuned on the same templates.
- The test is 300 complaints, run on one day.
