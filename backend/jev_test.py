"""Quick Jev gate test via AI/ML API. Stdlib only. Run: python jev_test.py"""
import json, os, time, urllib.request, urllib.error

def load_env(path=".env"):
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)

load_env()
# Prefer OpenRouter if its key is set, else AI/ML API.
if os.environ.get("OPENROUTER_API_KEY"):
    KEY, URL = os.environ["OPENROUTER_API_KEY"], "https://openrouter.ai/api/alpha/decisions"
else:
    KEY, URL = os.environ["AIMLAPI_KEY"], os.environ.get("AIMLAPI_BASE", "https://api.aimlapi.com/v1") + "/decisions"
MODEL = os.environ.get("JEV_MODEL", "typesafe/jev-1.14")

COMPONENTS = {
    "payments": "Paying for an order: UPI, cards, wallets, failed or stuck payments, double charges, promo codes at checkout",
    "delivery": "Getting the order: late, missing, marked delivered but not received, rude or lost delivery partner",
    "login": "Accessing the account: OTP not arriving, login errors, locked or hacked account",
    "refunds": "Getting money back after a cancellation or return: refund delays, wrong refund amount",
    "product_quality": "The items themselves: stale, damaged, expired, wrong item, missing items in the bag",
    "support": "Customer support itself: no reply, bot loops, agents unhelpful or rude",
}

QUESTIONS = {
    "is_complaint": {"type": "noul", "instructions": "Is the customer complaining about a problem (not praise, spam or a general question)?"},
    "component": {"type": "choice", "instructions": "Which area of the grocery delivery business is this complaint about?", "criteria": COMPONENTS},
    "impact": {"type": "score", "instructions": "How badly is the customer affected?",
               "criteria": ["Minor annoyance", "Inconvenienced", "Blocked from using the service", "Harmed: lost money, safety or data"]},
    "money_lost": {"type": "noul", "instructions": "Did the customer lose money or get charged wrongly?"},
    "churn_risk": {"type": "noul", "instructions": "Does the customer say they will leave, cancel, uninstall or switch to a competitor?"},
    "legal_risk": {"type": "noul", "instructions": "Does the complaint mention legal action, consumer court, fraud, food safety or harassment?"},
}

SAMPLES = [
    "love the new app design, 10/10 guys",
    "Paid Rs 840 via GPay, money left my account but the app shows no order. Fix this now.",
    "bhai maine kal payment kiya, paisa kat gaya par order nahi aaya, customer care bhi nahi uthata",
    "Checkout hangs after I choose UPI and then says session expired. Third time today.",
    "I was charged twice for one order. If this isn't refunded I'm taking you to consumer court.",
    "OTP never arrives when I try to log in, been 2 days",
    "Order shows delivered but I never got it. Uninstalling, switching to a competitor.",
    "The milk was expired and the bread was mouldy.",
    "What time do you open on Sundays?",
]

def ask(state):
    body = json.dumps({"model": MODEL, "state": state, "questions": QUESTIONS}).encode()
    req = urllib.request.Request(URL, data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode(errors='replace')}")
    return data, (time.perf_counter() - t) * 1000

total_tokens, total_ms = 0, 0
for s in SAMPLES:
    data, ms = ask(s)
    a = data["answers"]
    toks = data.get("usage", {}).get("input_tokens", 0)
    total_tokens += toks; total_ms += ms
    print(f"\n> {s}")
    print(f"  complaint={a['is_complaint']['noul']:.2f}  component={a['component']['choice']} "
          f"(conf {a['component'].get('confidence', 0):.2f})  impact={a['impact']['score']:.2f}")
    print(f"  money={a['money_lost']['noul']:.2f}  churn={a['churn_risk']['noul']:.2f}  legal={a['legal_risk']['noul']:.2f}"
          f"  | {toks} tok, {ms:.0f} ms, model={data.get('model')}")

n = len(SAMPLES)
print(f"\nTotal: {n} calls, {total_tokens} input tokens, avg {total_tokens/n:.0f} tok, avg {total_ms/n:.0f} ms (incl. network)")
print(f"At $0.042/M tokens: 2,000 complaints ~ ${total_tokens/n*2000*0.042/1e6:.4f} (check AI/ML API's actual rate)")
