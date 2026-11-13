"""Channel adapters: four native formats in, one Complaint shape out.

Why adapters: the funnel should not care where a complaint came from; adding WhatsApp or
     app-store reviews later means one new function here.
No text cleaning (decided 13 Nov): greetings, signatures, hashtags and mentions are kept as
     written. Not regex: a pattern can cut real complaint words ("Hi, my order never came"),
     so the customer's text reaches Jev and the LLM untouched. Only structure is used: who
     sent a chat line (bot or customer) and which call fields hold the customer's words.

Complaint = {id, channel, text, created_at, email|phone|user_id|handle, order_id, scan, meta}
  text      what the classifier reads (the customer's own words)
  order_id  only when captured and verified at source (voice agent, chatbot)
  scan      text searched for order IDs typed by the customer (email, social)
"""
import json
from pathlib import Path


def from_email(r: dict) -> dict:
    body = r["body"].strip()   # as written, greeting and signature included
    # Not adding the subject to text: "Urgent" / "Complaint" carry no meaning and blur matching.
    return dict(id=r["id"], channel="email", text=body, created_at=r["received_at"], email=r["from"].lower(),
                scan=f"{r['subject']} {body}", meta={"subject": r["subject"]})


def from_call(r: dict) -> dict:
    """Also the handler for the voice agent's webhook payload: same shape, live or bulk."""
    # Why customer_utterances, not complaint_summary: an agent's summary can distort what was said.
    return dict(id=r["call_id"], channel="call", text=" ".join(r["customer_utterances"]), created_at=r["started_at"],
                phone=r["caller_number"], order_id=r.get("order_id") if r.get("order_verified") else None,
                meta={"ivr_choice": r.get("ivr_choice"), "duration_s": r.get("duration_s"), "language": r.get("language"),
                      "summary": r.get("complaint_summary")})


def from_chat(r: dict) -> dict:
    # Every customer line, as written. Bot lines are left out by their sender field, not by
    # matching their text: they are the bot's words, not the customer's.
    parts = [m["text"] for m in r["messages"] if m["sender"] != "bot"]
    return dict(id=r["session_id"], channel="chat", text=" ".join(parts), created_at=r["started_at"], user_id=r.get("user_id"),
                order_id=r.get("order_id") if r.get("order_verified") else None, meta={"turns": len(r["messages"])})


def from_social(r: dict) -> dict:
    return dict(id=r["post_id"], channel="social", text=r["text"].strip(), created_at=r["posted_at"], handle=r["handle"].lower(),
                scan=r["text"], meta={"likes": r.get("likes", 0)})


ADAPTERS = {"emails.jsonl": from_email, "calls.jsonl": from_call, "chats.jsonl": from_chat, "social.jsonl": from_social}


def load_all(data_path: Path) -> list[dict]:
    """Every channel, merged and sorted by time.
    Why chronological: the registry grows as issues are discovered, so order changes outcomes."""
    out = []
    for name, adapt in ADAPTERS.items():
        path = data_path / name
        if path.exists():
            with open(path, encoding="utf-8") as f:
                out += [adapt(json.loads(line)) for line in f if line.strip()]
    return sorted(out, key=lambda c: c["created_at"])
