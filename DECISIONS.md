# Decisions log

Settled by the team after the 12 Nov handoff. Newest at the bottom.

## Project layout
- Two separate projects: `backend/` and `frontend/`, connected only over the HTTP API.

## Product shape
- Domain-agnostic product: a generic core engine plus a **domain pack** (components, seed issues, severity, segments, channels, identity rules) per business. Reusable UI components render whatever the pack defines.

## Voice channel
- Production vision: IVR, then an AI voice agent that talks to the caller, gathers context, verifies the order ID live and sends a structured complaint as a **webhook** to our intake. The agent records; it does not classify (the funnel does).
- Prototype: phone simulator page with IVR keypad, browser speech-to-text and text-to-speech, scripted slot-filling agent, local POST to `/webhooks/call`. Text mode as a fallback.
- Bulk mock calls use the same webhook payload as the live demo call.

## Identity and order IDs
| Channel | Method |
|---|---|
| Voice, chatbot | **Capture at source.** The agent/bot asks for the order ID as its own field and verifies it against the CRM during the conversation. |
| Email, social | **Regex + verification.** Regex only proposes candidates. A link is accepted only if the order exists, the check digit is valid, and one more signal agrees (sender email or handle matches the order's customer, order date before the complaint). |
| All | **Check digit in order IDs.** Format `BN-NNNNNN-C`, where C is a check digit over the six digits, so a typo fails validation instead of matching someone else's order. |

- Channel-native identifiers (chat login, caller number, sender email) always beat anything extracted from text.
- Every link stores its method and confidence, and the UI shows it.

## Complaints without a verified order ID
- Still go through the funnel and still count towards their issue.
- Shown in the UI with an identity status under the complaint:
  - `No order ID`
  - `Order ID failed check` (invalid check digit or not found)
  - `Order ID belongs to another account` (exists, but corroboration failed)
- Staff decide what to do. Prototype actions:
  - **Request order ID:** opens a pre-filled reply draft; staff send it manually (we do not send email).
  - **Link to customer:** staff pick the customer by hand; the link is stored as `method=manual`.
  - **Leave unlinked.**
- A manual link updates the identity graph (e.g. the social handle is linked from then on), and the issue's unique-customer count and segment numbers recompute.
- Customers known from a channel identifier (e.g. sender email) still count in segments even when no order ID is present. Only fully unidentified complaints are left out of segment breakdowns, and the UI shows how many.

## Settled 13 Nov (question round with Kartik)
- **Team:** 2 people. Kartik builds the backend; his partner builds the frontend and picks its stack.
- **Round 1:** 13 Nov, 11 AM, offline. Must show: the idea, top 10 with score breakdown, funnel counter, and cost against an LLM-for-everything baseline. Cost is the main pitch.
- **Main business:** quick-commerce grocery ("BasketNow"), 7 components: Payments, Delivery, Order accuracy, Product quality, Refunds, Account & app, Support.
- **Second pack:** telecom, to show the engine is domain-agnostic. Not built yet.
- **Severity signals from the gate:** impact level (always), money lost, legal/safety risk, emotion level. Churn risk was dropped.
- **Emotion in the score:** a small multiplier, `1 + 0.25 x share of angry complaints`.
- **Income bracket:** left out of the grocery pack. Segment dimensions are per pack, so a domain that needs it adds it.
- **Verify stage:** built now (Jev yes/no before the LLM).
- **New issues:** a pattern becomes a ranked issue at 3 different linked customers. Until then complaints are "unconfirmed reports", visible to staff. A single unmatched complaint with money lost or legal/safety risk is flagged urgent at once.
- **Mock data:** template generator, about 1,500 records and 400 customers, fixed seed.
- **Code style:** every file carries short `Why:` / `Not:` notes at decision points.

## Settled 13 Nov (from measurements during the build)
- **Jev access:** OpenRouter, `POST https://openrouter.ai/api/alpha/decisions`, model pinned to `typesafe/jev-1.14`. $5 of credit; live runs are capped by `MAX_SPEND_USD`.
- **Adjudicator and naming LLM:** `anthropic/claude-haiku-5.5` through the same OpenRouter key.
- **Similarity model:** hybrid of the local multilingual sentence model and word/character n-gram matching. Nearest-issue accuracy on complaints about known issues: sentence model 80%, word matching 84%, both together 91%.
- **Cut-offs (hybrid):** file automatically at 0.65 or above, buffer below 0.18, Jev verify in between. The wide middle band is deliberate: a verify call costs about $0.00002.
- **Confident "no" to every verify candidate:** goes to the buffer, not the LLM (was open decision 7).
- **Critical badge:** legal/safety share of 5% or more, or money-loss share of 50% or more.
- **Baseline for the cost claim:** costed for Claude Haiku 5.5 and Claude Sonnet 5.5, each with and without prompt caching. The baseline is projected from token counts, not run.
