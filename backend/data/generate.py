"""Generate BasketNow mock data: a CRM, orders, and complaints in four channel-native formats.
Run from backend/:  python data/generate.py [--n 1500] [--customers 400] [--seed 7]

Writes data/grocery/{customers,orders}.json, {emails,calls,chats,social}.jsonl and truth.json.
truth.json holds the real issue and customer of every complaint. The engine never reads it;
only the accuracy report does.

Why templates: free, repeatable (fixed seed) and needs no API credit, so nothing is blocked.
Not LLM-written text: more natural, but costs credit and a generation run before any test.
Why one file per channel in its own format: intake adapters have real differences to handle.
Not one pre-cleaned complaints file: it would hide the "consolidate across channels" work.
"""
import argparse
import datetime as dt
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "data"))
from app import orderid  # noqa: E402
import catalog_grocery as cat  # noqa: E402

DAYS = 30
START = dt.datetime(2026, 10, 14)
PREFIX = "BN"
HINDI_MARKERS = {"nahi", "hai", "hua", "gaye", "gaya", "raha", "baar", "kiya", "aaya", "tha", "bhej", "diya", "aata", "mila",
                 "bola", "hota", "jata", "wapas", "kate", "the", "karenge", "hoti", "deta", "lagta", "padta", "nikla", "thi", "hue"}
HINDI_MARKERS.discard("the")
HINGLISH_PROB = {"call": 0.45, "chat": 0.25, "social": 0.20, "email": 0.05}
CHANNEL_SHARE = [("email", 0.30), ("chat", 0.30), ("call", 0.22), ("social", 0.18)]
EMOTION_BY_IMPACT = {3: [0.10, 0.30, 0.40, 0.20], 2: [0.20, 0.40, 0.30, 0.10], 1: [0.45, 0.40, 0.12, 0.03], 0: [0.55, 0.35, 0.08, 0.02]}
EMOTIONS = ["calm", "frustrated", "angry", "furious"]


def is_hinglish(text):
    return any(w.strip(",.?!") in HINDI_MARKERS for w in text.lower().split())


def pick(rng, pairs):
    """pairs: [(value, weight)]"""
    return rng.choices([p[0] for p in pairs], weights=[p[1] for p in pairs])[0]


def ts(day, rng):
    return (START + dt.timedelta(days=day, hours=rng.randint(7, 23), minutes=rng.randint(0, 59), seconds=rng.randint(0, 59))).isoformat()


def make_customers(rng, n):
    customers, used_emails = [], set()
    for i in range(1, n + 1):
        country, state, cities, _ = rng.choices(cat.REGIONS, weights=[r[3] for r in cat.REGIONS])[0]
        age = pick(rng, cat.AGE_GROUPS)
        student = rng.random() < cat.STUDENT_PROB[age]
        first, last = rng.choice(cat.FIRST_NAMES), rng.choice(cat.LAST_NAMES)
        while True:
            email = f"{first.lower()}.{last.lower()}{rng.randint(1, 999)}@{rng.choice(['gmail.com', 'outlook.com', 'yahoo.in'])}"
            if email not in used_emails:
                used_emails.add(email)
                break
        phone = ("+9715" + str(rng.randint(10000000, 99999999))) if country == "UAE" else ("+91" + str(rng.randint(7000000000, 9999999999)))
        has_handle = rng.random() < 0.55
        handle = f"@{first.lower()}_{last.lower()[:4]}{rng.randint(1, 99)}" if has_handle else None
        customers.append(dict(
            id=f"C-{i:04d}", name=f"{first} {last}", email=email, phone=phone, chat_user_id=f"u_{10000 + i}",
            social_handle=handle if (has_handle and rng.random() < 0.30) else None,   # only some handles are linked in the CRM
            _real_handle=handle, country=country, state=state, city=rng.choice(cities), age_group=age, is_student=student,
            platform="android" if rng.random() < (0.80 if student else 0.68) else "ios",
            _upi=rng.random() < (0.90 if student else 0.60)))
    return customers


def make_orders(rng, customers):
    orders, numbers = [], rng.sample(range(100000, 999999), len(customers) * 9)
    k = 0
    for c in customers:
        for _ in range(rng.randint(4, 9)):
            pay = rng.choice(["UPI", "GPay", "PhonePe", "Paytm"]) if c["_upi"] else rng.choice(["credit card", "debit card", "UPI"])
            day = rng.randint(-3, DAYS - 1)
            # Why a real date: identity checks "order placed before the complaint" as corroboration.
            orders.append(dict(order_id=orderid.make(PREFIX, numbers[k]), customer_id=c["id"], day=day,
                               date=(START + dt.timedelta(days=day)).date().isoformat(),
                               amount=rng.choice([149, 199, 249, 320, 415, 560, 640, 780, 840, 999, 1250, 1680]), payment=pay))
            k += 1
    return orders


def typo(rng, oid):
    """Change one digit of the body: the check digit then fails."""
    p, body, c = oid.split("-")
    i = rng.randrange(len(body))
    body = body[:i] + str((int(body[i]) + rng.randint(1, 9)) % 10) + body[i + 1:]
    return f"{p}-{body}-{c}"


def compose(rng, issue, emotion, legal, hinglish, order, short=False):
    cores = [c for c in issue["cores"] if is_hinglish(c) == hinglish] or issue["cores"]
    fill = dict(amt=order["amount"] if order else rng.choice([199, 320, 560, 840, 1250]), item=rng.choice(cat.ITEMS),
                pay=(order["payment"] if order else rng.choice(cat.PAY_METHODS)) if issue["key"] != "pay_upi_timeout" else rng.choice(["UPI", "GPay", "PhonePe", "Paytm"]),
                days=rng.randint(3, 12), mins=rng.randint(45, 120), n=rng.randint(2, 5))
    parts = []
    opener = rng.choice(cat.OPENERS[emotion])
    if opener and not short:
        parts.append(opener)
    parts.append(rng.choice(cores).format(**fill))
    if not short and rng.random() < 0.5:
        parts.append(rng.choice(issue["details"]).format(**fill))
    closer = rng.choice(cat.CLOSERS[emotion])
    if closer and (not short or emotion in ("angry", "furious")):
        parts.append(closer)
    if legal:
        parts.append(rng.choice(cat.LEGAL_CLOSERS))
    return parts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1500)
    ap.add_argument("--customers", type=int, default=400)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(ROOT / "data" / "grocery"))
    # --fresh: keep the CRM and orders of --seed, but write new complaints from this seed.
    # Why: a live test needs complaints the engine has never seen, from customers it knows.
    ap.add_argument("--fresh", type=int, default=None)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    customers = make_customers(rng, args.customers)
    orders = make_orders(rng, customers)
    if args.fresh is not None:
        rng.seed(args.fresh)
    orders_by_cust = {}
    for o in orders:
        orders_by_cust.setdefault(o["customer_id"], []).append(o)

    # customer sampling weights per issue (segment skew)
    def cust_weights(issue):
        w = []
        for c in customers:
            x = 1.0
            for field, table in issue.get("skew", {}).items():
                x *= table.get(c[field], 1.0)
            w.append(x)
        return w
    weights = {i["key"]: cust_weights(i) for i in cat.ISSUES}

    records = {"email": [], "call": [], "chat": [], "social": []}
    truth = {}
    counters = {"email": 0, "call": 0, "chat": 0, "social": 0}
    id_prefix = {"email": "E", "call": "V", "chat": "C", "social": "S"}

    def new_id(channel):
        counters[channel] += 1
        return f"{id_prefix[channel]}-{counters[channel]:05d}"

    def emit(channel, day, cust, parts, issue=None, emotion="calm", legal=False, hinglish=False, order=None):
        """Write one record in the channel's native format and its truth row."""
        cid, when = new_id(channel), ts(day, rng)
        text = " ".join(parts)
        mentioned, link_note = None, None
        if channel == "email":
            sender = cust["email"] if (cust and rng.random() < 0.92) else f"user{rng.randint(1000, 99999)}@mail.com"
            if issue and order and rng.random() < 0.65:
                r = rng.random()
                if r < 0.05:
                    mentioned, link_note = typo(rng, order["order_id"]), "typo"
                elif r < 0.07:
                    mentioned, link_note = rng.choice(orders)["order_id"], "other_account"
                else:
                    mentioned = order["order_id"]
                text += " " + rng.choice([f"Order ID {mentioned}.", f"My order number is {mentioned}.", f"Ref: {mentioned.lower().replace('-', ' ')}"])
            subject = rng.choice(["Complaint", "Issue with my order", "Need help", "Problem with BasketNow", "Urgent"]) if issue else rng.choice(["Question", "Feedback", "Hello"])
            name = cust["name"] if cust else "A customer"
            records[channel].append(dict(id=cid, **{"from": sender}, subject=subject, body=f"Hi team,\n\n{text}\n\nRegards,\n{name}", received_at=when))
        elif channel == "call":
            number = cust["phone"] if (cust and rng.random() < 0.95) else "+91" + str(rng.randint(7000000000, 9999999999))
            captured = order["order_id"] if (issue and order and rng.random() < 0.85) else None
            mentioned = captured
            transcript = [dict(speaker="agent", text="Thank you for calling BasketNow. How can I help you today?"),
                          dict(speaker="customer", text=text),
                          dict(speaker="agent", text="I'm sorry about that. Can you tell me your order ID?"),
                          dict(speaker="customer", text=(f"Yes, it is {captured}." if captured else "I don't have it with me right now.")),
                          dict(speaker="agent", text="Thank you. I have recorded your complaint and our team will get back to you.")]
            records[channel].append(dict(
                call_id=cid, caller_number=number, ivr_choice=(issue["component"] if issue and rng.random() < 0.85 else "other"),
                started_at=when, duration_s=rng.randint(40, 320), language="hi-en" if hinglish else "en",
                order_id=captured, order_verified=bool(captured), complaint_summary=text, customer_utterances=[text],
                transcript=transcript, agent_flags=dict(asked_for_human=rng.random() < 0.1)))
        elif channel == "chat":
            captured = order["order_id"] if (issue and order and rng.random() < 0.80) else None
            mentioned = captured
            msgs = [dict(sender="bot", text="Hi! I'm BasketBot. What can I help you with?")]
            msgs += [dict(sender="customer", text=p) for p in parts]
            msgs.append(dict(sender="bot", text="Please share your order ID so I can check."))
            msgs.append(dict(sender="customer", text=captured or "dont have it"))
            records[channel].append(dict(session_id=cid, user_id=cust["chat_user_id"] if cust else None, started_at=when,
                                         order_id=captured, order_verified=bool(captured), messages=msgs))
        else:  # social
            handle = (cust["_real_handle"] if cust and cust["_real_handle"] else f"@user{rng.randint(10000, 99999)}")
            if issue and order and rng.random() < 0.15:
                mentioned = order["order_id"]
                text += f" order {mentioned}"
            text = "@BasketNow " + text + rng.choice(["", "", " #BasketNow", " #fail", " :("])
            records[channel].append(dict(post_id=cid, handle=handle, text=text, likes=rng.randint(0, 240) if emotion in ("angry", "furious") else rng.randint(0, 12), posted_at=when))
        truth[cid] = dict(is_complaint=bool(issue), issue=issue["key"] if issue else None, component=issue["component"] if issue else None,
                          customer_id=cust["id"] if cust else None, emotion=cat.EMOTION_INDEX[emotion], legal=legal, hinglish=hinglish,
                          order_mentioned=mentioned, link_note=link_note, day=day, channel=channel)

    def complaint(issue, cust, day, channel):
        impact = issue["impact"]
        emotion = rng.choices(EMOTIONS, weights=EMOTION_BY_IMPACT[impact])[0]
        legal = rng.random() < issue.get("legal", 0.05 if impact == 3 else 0.005)
        hinglish = rng.random() < HINGLISH_PROB[channel]
        past = [o for o in orders_by_cust[cust["id"]] if o["day"] <= day]
        order = max(past, key=lambda o: o["day"]) if past else None
        parts = compose(rng, issue, emotion, legal, hinglish, order, short=(channel == "social"))
        emit(channel, day, cust, parts, issue, emotion, legal, hinglish, order)

    n_non = int(args.n * 0.10)
    n_complaints = args.n - n_non
    made = 0
    issue_weights = [i["weight"] for i in cat.ISSUES]
    while made < n_complaints:
        issue = rng.choices(cat.ISSUES, weights=issue_weights)[0]
        day = rng.randint(issue.get("start_day", 0), DAYS - 1)
        cust = rng.choices(customers, weights=weights[issue["key"]])[0]
        channel = pick(rng, CHANNEL_SHARE)
        complaint(issue, cust, day, channel)
        made += 1
        # the same customer repeats the complaint on other channels
        if rng.random() < 0.15:
            others = [c for c, _ in CHANNEL_SHARE if c != channel]
            for ch in rng.sample(others, rng.randint(1, 2)):
                if made >= n_complaints:
                    break
                complaint(issue, cust, min(DAYS - 1, day + rng.randint(1, 3)), ch)
                made += 1

    for _ in range(n_non):
        text = rng.choice(cat.NON_COMPLAINTS)
        spam = "click" in text or "won" in text
        cust = None if spam else rng.choice(customers)
        emit(pick(rng, [("social", 0.4), ("chat", 0.3), ("email", 0.2), ("call", 0.1)]) if cust else pick(rng, [("social", 0.6), ("email", 0.4)]),
             rng.randint(0, DAYS - 1), cust, [text])

    time_key = {"email": "received_at", "call": "started_at", "chat": "started_at", "social": "posted_at"}
    files = {"email": "emails.jsonl", "call": "calls.jsonl", "chat": "chats.jsonl", "social": "social.jsonl"}
    for ch, rows in records.items():
        rows.sort(key=lambda r: r[time_key[ch]])
        with open(out / files[ch], "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    crm = [{k: v for k, v in c.items() if not k.startswith("_")} for c in customers]
    (out / "customers.json").write_text(json.dumps(crm, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "orders.json").write_text(json.dumps(orders, indent=1), encoding="utf-8")
    (out / "truth.json").write_text(json.dumps(truth, indent=1, ensure_ascii=False), encoding="utf-8")
    catalog = [dict(key=i["key"], component=i["component"], seed=i["seed"], impact=i["impact"]) for i in cat.ISSUES]
    (out / "truth_issues.json").write_text(json.dumps(catalog, indent=1), encoding="utf-8")

    print(f"customers={len(customers)} orders={len(orders)} " + " ".join(f"{ch}={len(r)}" for ch, r in records.items()))
    by_issue = {}
    for t in truth.values():
        by_issue[t["issue"]] = by_issue.get(t["issue"], 0) + 1
    for k, v in sorted(by_issue.items(), key=lambda kv: -kv[1]):
        print(f"  {str(k):28s} {v}")


if __name__ == "__main__":
    main()
