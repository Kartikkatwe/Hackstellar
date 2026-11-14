"""Scenario 2: writes with realistic model latency (gate 0.53 s, verify 0.54 s, LLM 1.90 s), and reads during a write burst."""
import asyncio, json, random, sys, time
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from load import run, show, BASE
DATA = sys.argv[2]
texts = [json.loads(l)["text"] for l in open(DATA + "/social.jsonl")] + [json.loads(l)["body"] for l in open(DATA + "/emails.jsonl")]
customers = json.load(open(DATA + "/customers.json"))
random.seed(2)
def complaint(i):
    c = random.choice(customers)
    return ("POST", "/complaints", {"channel": "chat", "text": f"{random.choice(texts)} ref{i}", "user_id": c.get("chat_user_id")})
async def main():
    out = []
    out.append(show(await run("POST /complaints (sim latency)", complaint, 1, 20)))
    out.append(show(await run("POST /complaints (sim latency)", complaint, 10, 40)))
    # burst of 60 writes at once; meanwhile poll reads
    burst = asyncio.create_task(run("POST burst 60 (sim latency)", complaint, 60, 60, timeout=300))
    await asyncio.sleep(1.0)
    reads = await run("GET /health during burst", lambda i: ("GET", "/health", None), 5, 25, timeout=300)
    reads2 = await run("GET /issues/top during burst", lambda i: ("GET", "/issues/top", None), 5, 25, timeout=300)
    out += [show(reads), show(reads2), show(await burst)]
    json.dump(out, open(sys.argv[3], "w"), indent=1)
asyncio.run(main())
