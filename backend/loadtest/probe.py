import json, sys, time, sqlite3, subprocess, httpx
BASE = "http://127.0.0.1:8103"; DATA = sys.argv[1]; DB = sys.argv[2]; PID = sys.argv[3]
cl = httpx.Client(base_url=BASE, timeout=300)
customers = json.load(open(DATA + "/customers.json")); orders = json.load(open(DATA + "/orders.json"))
def rss(): return int(subprocess.check_output(["ps", "-o", "rss=", "-p", PID]).strip()) // 1024
def q(sql, *a):
    c = sqlite3.connect(DB); r = c.execute(sql, a).fetchall(); c.close(); return r
def call(label, method, path, **kw):
    t = time.perf_counter()
    try:
        r = cl.request(method, path, **kw); body = r.text
        print(f"[{label}] {method} {path[:60]} -> {r.status_code} in {time.perf_counter()-t:.2f}s, {len(body)} bytes"); return r
    except Exception as e:
        print(f"[{label}] {method} {path[:60]} -> EXC {type(e).__name__} in {time.perf_counter()-t:.2f}s"); return None
P = lambda j: dict(json=j)
print("== A. access control")
for p in ("/docs", "/openapi.json", "/complaints?limit=3", "/pending"):
    call("no-auth", "GET", p)
r = cl.get("/complaints?limit=2").json(); print("   PII fields returned:", {k: r[0][k] for k in ("sender", "customer_id", "order_id")})
r = cl.options("/complaints", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
print("   CORS preflight from evil.example:", r.status_code, r.headers.get("access-control-allow-origin"))
print("== B. input validation")
call("empty text", "POST", "/complaints", **P({"text": ""}))
call("missing text", "POST", "/complaints", **P({"channel": "chat"}))
r = call("bad channel", "POST", "/complaints", **P({"text": "refund not received for my order", "channel": "<script>alert(1)</script>"}))
print("   stored channel:", r.json()["complaint"]["channel"] if r is not None and r.status_code == 200 else None)
r = call("negative limit", "GET", "/complaints?limit=-1"); print("   rows returned with limit=-1:", len(r.json()))
r = call("sqli settled", "GET", "/complaints?settled=x' OR '1'='1"); print("   rows:", len(r.json()))
call("sqli id", "GET", "/complaints/x' OR '1'='1")
call("sqli segment", "GET", "/issues/top?state=x' OR '1'='1")
call("huge n", "GET", "/issues/top?n=-5")
call("bad dim", "GET", "/segments/heatmap?dim=profile")
print("== C. oversized input (holds the global lock)")
m0 = rss()
for size in (100_000, 1_000_000, 5_000_000):
    words = " ".join(f"w{i}" for i in range(size // 7))
    call(f"{size//1000} KB text", "POST", "/complaints", **P({"text": "payment failed refund " + words}))
print("   RSS before/after MB:", m0, rss())
print("== D. webhook")
call("empty payload", "POST", "/webhooks/call", **P({}))
base = {"call_id": "x", "customer_utterances": ["my refund never came"], "started_at": "2026-11-14T10:00:00", "caller_number": "+910000000000"}
call("valid minimal", "POST", "/webhooks/call", **P(base))
call("utterances as string", "POST", "/webhooks/call", **P({**base, "customer_utterances": "refund"}))
call("utterances as ints", "POST", "/webhooks/call", **P({**base, "customer_utterances": [1, 2]}))
n0 = q("select count(*) from complaints")[0][0]
call("ivr_choice as list", "POST", "/webhooks/call", **P({**base, "ivr_choice": ["payments"]}))
call("started_at as dict", "POST", "/webhooks/call", **P({**base, "started_at": {"a": 1}}))
call("follow-up valid", "POST", "/complaints", **P({"text": "the app keeps crashing on my phone"}))
print("   complaints added:", q("select count(*) from complaints")[0][0] - n0, "| rows with no settled stage:", q("select id, settled from complaints where settled is null"))
print("   complaint rows with no gate row:", q("select count(*) from complaints c left join gate g on g.complaint_id=c.id where g.complaint_id is null")[0][0])
print("== E. identity spoofing")
victim = customers[5]
r = call("spoof user_id", "POST", "/complaints", **P({"text": "refund not received", "user_id": victim["chat_user_id"]}))
print("   linked to:", r.json()["complaint"]["customer_id"], r.json()["complaint"]["link_method"], "(victim", victim["id"] + ")")
o = orders[10]
r = call("spoof order_id", "POST", "/complaints", **P({"text": "refund not received", "order_id": o["order_id"]}))
print("   linked to:", r.json()["complaint"]["customer_id"], r.json()["complaint"]["link_method"], r.json()["complaint"]["order_status"], "(order owner", o["customer_id"] + ")")
r = call("fake order_id", "POST", "/complaints", **P({"text": "refund not received", "order_id": "BN-000000-0"}))
print("   status:", r.json()["complaint"]["order_status"])
print("== F. ranking manipulation: fabricate an issue with 12 spoofed customers")
before = len(cl.get("/issues/top?n=500").json()["issues"])
res = []
for c in customers[20:32]:
    r = cl.post("/complaints", json={"text": "URGENT scam alert BasketNow stole money fraud police consumer court zxqv competitor is better", "user_id": c["chat_user_id"]})
    res.append(r.json()["result"]["settled"])
print("   settled stages:", res)
top = cl.get("/issues/top?n=500").json()["issues"]
fake = [x for x in top if x["unique_customers"] and "L-" in json.dumps(cl.get(f"/issues/{x['issue_id']}").json()["complaints"][-1]["id"])][:3]
print("   issues before/after:", before, len(top))
for x in top[:3]: print("   rank", x["rank"], x["badge"], x["title"], "| customers", x["unique_customers"], "| score", x["score"])
mine = [x for x in top if x["key"].startswith("new_") and x["issue_id"] > 0 and x["unique_customers"] >= 9 and x["complaints"] <= 13][-1:]
print("   fabricated issue:", [(x["rank"], x["badge"], x["title"], x["unique_customers"], x["score"]) for x in mine])
print("== G. manual link without auth")
cid = cl.get("/complaints?linked=false&limit=1").json()[0]["id"]
r = call("link", "POST", f"/complaints/{cid}/link", **P({"customer_id": customers[0]["id"]})); print("  ", r.text)
print("== H. POST /runs without auth")
n_before = q("select count(*) from complaints")[0][0]
r1 = call("start run", "POST", "/runs", **P({"mode": "mock", "limit": 300})); print("  ", r1.text)
r2 = call("second run at once", "POST", "/runs", **P({"mode": "mock", "limit": 300})); print("  ", r2.text)
codes = {}
t = time.time()
while time.time() - t < 20:
    for p in ("/issues/top", "/funnel", "/complaints?limit=5"):
        try: c = cl.get(p).status_code
        except Exception as e: c = type(e).__name__
        codes[c] = codes.get(c, 0) + 1
    h = cl.get("/health").json()["batch"]
    if not h["running"]: break
print("   read statuses during the run:", codes, "| batch:", h)
print("   complaints before/after:", n_before, q("select count(*) from complaints")[0][0])
call("live mode", "POST", "/runs", **P({"mode": "live"}))
