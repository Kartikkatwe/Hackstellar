import json, sys, sqlite3, httpx
BASE = "http://127.0.0.1:8103"; DATA = sys.argv[1]; DB = sys.argv[2]
customers = json.load(open(DATA + "/customers.json"))
def q(sql):
    c = sqlite3.connect(DB); r = c.execute(sql).fetchall(); c.close(); return r
def call(label, method, path, j=None):
    try:
        r = httpx.request(method, BASE + path, json=j, timeout=60); print(f"[{label}] -> {r.status_code} {r.text[:110]}"); return r
    except Exception as e:
        print(f"[{label}] -> EXC {type(e).__name__}")
call("missing text", "POST", "/complaints", {"channel": "chat"})
call("text is whitespace", "POST", "/complaints", {"text": "   "})
call("NUL and emoji", "POST", "/complaints", {"text": "refund \u0000 nahi mila \U0001F621"})
base = {"call_id": "x", "customer_utterances": ["my refund never came and money was debited"], "started_at": "2026-11-14T10:00:00", "caller_number": "+910000000000"}
n0 = q("select count(*) from complaints")[0][0]
call("ivr_choice as list (crashes mid-processing)", "POST", "/webhooks/call", {**base, "ivr_choice": ["payments"]})
print("   rows visible to readers right after the crash:", q("select count(*) from complaints")[0][0] - n0)
r = call("next valid complaint", "POST", "/complaints", {"text": "the app keeps crashing on my phone"})
print("   new rows now:", q("select count(*) from complaints")[0][0] - n0)
print("   orphan rows (stored, never given a stage):", q("select id, channel, settled from complaints where settled is null"))
print("   assigned id of next complaint:", r.json()["complaint"]["id"] if r is not None and r.status_code == 200 else None)
print("== fabricate an issue with 12 spoofed customer logins")
top0 = httpx.get(BASE + "/issues/top?n=10").json()["issues"]
key = None
for c in customers[20:32]:
    r = httpx.post(BASE + "/complaints", json={"text": "BasketNow stole my money, this is fraud, I am going to the police and consumer court. zxqv qwpl", "user_id": c["chat_user_id"]}, timeout=60).json()
    key = r["result"].get("issue") or key
top = httpx.get(BASE + "/issues/top?n=500").json()["issues"]
mine = next(x for x in top if x["key"] == key)
print("   top 3 before:", [(x["rank"], x["unique_customers"], x["score"]) for x in top0[:3]])
print("   fabricated issue:", dict(rank=mine["rank"], badge=mine["badge"], title=mine["title"], customers=mine["unique_customers"], complaints=mine["complaints"], score=mine["score"], flags=mine["flags"]))
r = httpx.get(BASE + "/complaints?limit=1").json()[0]
print("   urgent/pending check, last complaint:", r["id"], r["settled"], r["customer_id"])
