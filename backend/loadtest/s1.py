"""Scenario 1: read endpoints and write endpoint with no model latency (best case for the code itself)."""
import asyncio, json, random, sys, subprocess
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from load import run, show, BASE
import httpx
DATA = sys.argv[2]
texts = [json.loads(l)["text"] for l in open(DATA + "/social.jsonl")] + [json.loads(l)["body"] for l in open(DATA + "/emails.jsonl")]
customers = json.load(open(DATA + "/customers.json"))
random.seed(1)
def complaint(i):
    c = random.choice(customers)
    return ("POST", "/complaints", {"channel": "chat", "text": f"{random.choice(texts)} ref{i}", "user_id": c.get("chat_user_id")})
def rss(pid):
    return int(subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)]).strip()) // 1024
async def main():
    pid = int(sys.argv[3]); out = []
    r = httpx.get(BASE + "/issues/top").json(); iid = r["issues"][0]["issue_id"]
    reads = {"/health": "/health", "/config": "/config", "/funnel": "/funnel", "/cost": "/cost", "/accuracy": "/accuracy",
             "/issues/top": "/issues/top", "/issues/{id}": f"/issues/{iid}", "/segments/heatmap": "/segments/heatmap?dim=state",
             "/segments/compare": "/segments/compare?dim=is_student&a=true&b=false", "/pending": "/pending",
             "/complaints": "/complaints?limit=100", "/complaints/{id}": "/complaints/E-00001"}
    print("RSS start MB", rss(pid))
    for name, path in reads.items():
        for c, n in ((1, 30), (20, 100), (100, 200)):
            out.append(show(await run("GET " + name, lambda i, p=path: ("GET", p, None), c, n)))
    print("RSS after reads MB", rss(pid))
    m0 = rss(pid)
    for c, n in ((1, 200), (20, 600), (100, 1200)):
        out.append(show(await run("POST /complaints (no model delay)", complaint, c, n)))
    m1 = rss(pid)
    print("RSS after 2000 writes MB", m1, "growth", m1 - m0)
    # read cost after growth
    for name in ("/issues/top", "/issues/{id}", "/segments/heatmap"):
        out.append(show(await run("GET " + name + " (after +2000)", lambda i, p=reads[name]: ("GET", p, None), 20, 200)))
    json.dump(dict(results=out, rss_before_writes=m0, rss_after_writes=m1), open(sys.argv[4], "w"), indent=1)
asyncio.run(main())
