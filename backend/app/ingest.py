"""Channel adapters: four native formats in, one Complaint shape out.

Why adapters: the funnel should not care where a complaint came from; adding WhatsApp or
     app-store reviews later means one new function here.
Not cleaning inside the funnel: channel quirks (signatures, agent lines, hashtags) would
     leak into every stage.

Complaint = {id, channel, text, created_at, email|phone|user_id|handle, order_id, scan, meta}
  text      what the classifier reads (the customer's own words)
  order_id  only when captured and verified at source (voice agent, chatbot)
  scan      text searched for order IDs typed by the customer (email, social)
"""
import json
import re
from pathlib import Path

# Why the length cap: "Hi team," is a greeting, "Hi, my order never came ..." is the complaint.
GREETING = re.compile(r"^\s*(hi|hello|dear)\b[^\n]{0,30}\n", re.I)
SIGNOFF = re.compile(r"\n\s*(regards|thanks|thank you|sincerely|cheers)[,!.]?\s*\n.*$", re.I | re.S)
ASKS_ORDER_ID = re.compile(r"order\s*(id|number)", re.I)
TAGS = re.compile(r"(^|\s)[@#]\w+")


def from_email(r: dict) -> dict:
    body = SIGNOFF.sub("", GREETING.sub("", r["body"], count=1)).strip()
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
    parts, answering_id_prompt = [], False
    for m in r["messages"]:
        if m["sender"] == "bot":
            answering_id_prompt = bool(ASKS_ORDER_ID.search(m["text"]))
            continue
        # Why skip: the reply to "share your order ID" is a form field, already in r["order_id"].
        if not answering_id_prompt:
            parts.append(m["text"])
        answering_id_prompt = False
    return dict(id=r["session_id"], channel="chat", text=" ".join(parts), created_at=r["started_at"], user_id=r.get("user_id"),
                order_id=r.get("order_id") if r.get("order_verified") else None, meta={"turns": len(r["messages"])})


def from_social(r: dict) -> dict:
    text = TAGS.sub(" ", r["text"]).strip()   # drop @brand mentions and hashtags
    return dict(id=r["post_id"], channel="social", text=text, created_at=r["posted_at"], handle=r["handle"].lower(),
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
