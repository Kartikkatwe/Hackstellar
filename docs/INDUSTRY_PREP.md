# Industry round prep (13 Nov, 4:30 PM)

Two parts: the live demo script, then the questions industry judges are likely to ask, with short honest answers.

Pitch rules (Kartik): lead with speed, cost and output tokens. Do not claim "finds problems on its own" or "keeps working when the LLM is down". On slides, cost only as a percentage. Test-run figures below are for answering questions, and always say they come from template-made test data.

---

## Part 1: demo script

Open the console's **Live intake** on the projector. Rehearse every step once on the deployed site before 4:30: the live models decide, so an answer can differ from what is written here.

| # | Type this | Chat login | What to point at |
|---|---|---|---|
| 1 | `paise kat gaye lekin order nahi bana, please check` | `u_10003` | Hinglish. Filed under **Money debited but order not placed**. The trail shows which step filed it and how sure it was. |
| 2 | `I was charged twice for one order since I updated the app` | `u_10009` | Filed under **Duplicate payment debits after app update**. Likely via Jev's yes/no: show that step. |
| 3 | `Love the 10 minute delivery, great job team!` | (none) | Set aside at the gate: not a complaint. No further cost. |
| 4 | `I paid 900 rupees and the paneer made my child sick` | `u_10011` | Money lost and a safety risk: flagged **urgent** at once, even if it matches nothing known. |
| 5a | `The app says the store near me is closed but it is open` | `judge1` | A problem the company has no name for: goes to the waiting list ("Unconfirmed"). |
| 5b | `store closed dikha raha hai app me jab ki khula hai` | `judge2` | Still waiting: 2 people. |
| 5c | `App shows my nearby store as closed all day` | `judge3` | Third different person. Jev checks it is not a known problem, the LLM names it, and it appears in **Top issues**. |

Notes:
- **Each 5a–5c needs a different login.** Any login counts as one person, even one not in the customer list (`judge1`, `judge2`, ...). Without a login a report cannot count, because three of them could be one person.
- Better still, let three judges scan the QR code and send 5a–5c from their own phones with their own names as the login.
- If a step shows "offline", say so out loud: the live models were unreachable and stand-ins answered.

---

## Part 2: questions industry judges may ask

### Product and value

**Who buys this?** Any business with a support team that hears from customers on more than one channel: quick-commerce, telecom, banks, airlines. The buyer is the head of customer experience or operations; the user is the support lead deciding what engineering fixes first.

**What does it replace?** Manually tagging tickets, or sending every ticket to an LLM. Tagging is slow and inconsistent; an LLM on every ticket is slower and costs more (our three headline numbers).

**How is this different from Zendesk or Freshdesk tagging?** Those tag single tickets with fixed labels. We group complaints from every channel under the underlying problem, count people rather than tickets, and rank problems with a score anyone can check. It sits beside a helpdesk, not instead of it.

### How it works

**Why not just use an LLM for everything?** Filing a complaint is a set of choices, not writing. A decision model (Jev) makes the choices and writes nothing, so it is faster and far cheaper. The LLM is kept for what needs words: the last unsure few, naming a new problem, merging duplicates.

**What is Jev?** A decision model on OpenRouter. You give it text and questions with fixed options; it returns a choice and a probability for each. No free text, so nothing to parse and no output tokens to pay for.

**What if Jev is wrong?** Every Jev answer is a probability. Only a confident yes (0.80 or more) files a complaint; anything unsure is passed on to the next check, and only the last unsure few reach the LLM. On the test data, complaints filed by Jev's yes/no were right 97.3% of the time.

**How do you count one customer once?** Each complaint is linked to a customer by login, phone, email or social handle, or by an order ID that passes a check digit and matches the customer's orders. A sender not in the customer list still counts as one person by their address. Complaints with no sender at all are kept, but cannot help form a new problem.

**How does a new problem get created?** Unmatched complaints wait. When 3 different people report similar things, Jev first checks it is not a known problem in new words; if not, the LLM names it. Lost money or a safety risk is flagged urgent at once, without waiting.

**Is any of it rules or regex?** No business judgement is. Complaint text reaches the models exactly as written. The only regex finds order-ID candidates, which are then verified.

### Accuracy and trust

**How accurate is it?** On 1,500 template-made test complaints with a hidden answer key: 98.4% filed under the right issue, 99.6% sent to the right area, 100% of customer links correct. Say plainly: real complaints are messier, and the cut-offs were tuned on that same data. The next step is a real labelled sample.

**Can a person override it?** Yes: every complaint keeps its trail (which step decided, how sure, why), staff can link a complaint to a customer from the console, and every merge of two problems is recorded rather than deleted.

**What about bias or a loud customer?** The score counts people, not messages, and anger is capped at a small factor so a loud customer never outranks a quiet one who lost money.

### Scale, speed and cost

**How fast?** A typical complaint is filed in about half a second; one LLM call alone takes about 1.9 seconds. On average we are 2.3 times faster than an LLM reading every complaint.

**What does it cost at scale?** 65 to 85% cheaper than Claude Haiku reading every complaint, with or without prompt caching, and about 99% cheaper than Claude Sonnet. 96% fewer output tokens. The LLM-everywhere side is projected from calibrated token counts, not run.

**Will it scale to millions?** The heavy work per complaint is one Jev call plus a vector comparison against the issues of one area, a few dozen at most. That is linear and small. The prototype uses SQLite and an in-memory list; a company would use a real database and a vector index. The design does not change.

### Deployment, privacy and integration

**How does it connect to our systems?** Every channel is one small adapter into one complaint format. There is already a webhook for a voice agent (`POST /webhooks/call`) and an API for new complaints (`POST /complaints`). A helpdesk integration is one more adapter.

**Where does customer data go?** Complaint text goes to the model provider (OpenRouter) for the Jev and LLM calls; customer records stay in the company's own database. For a bank, the same design runs with a model hosted in the company's own cloud.

**A new business: how long to set up?** Write one settings file: the areas of the business, the questions, the problems it already knows about. There is no training step, because Jev takes its labels with each request.

### Limits (say these before a judge does)

- Test data is cleaner than real complaints.
- Cut-offs were tuned on the same data they are scored on.
- The LLM-everywhere comparison is projected, not run.
- On the hosted demo, matching uses a lighter word-based model than on the laptop (the full model is too large for a serverless function). Jev's check makes up for most of it.
