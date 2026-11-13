"""Smallest possible live test: 3 gate calls, 1 verify call, 1 LLM call (well under 1 cent).

Why before any batch run: confirms the key works, the response shape matches what gate.py
     parses, and shows REAL token counts, so the batch cost can be predicted before spending.
Not jumping straight to a full run: a wrong response shape would burn credit on 1,500 errors.
"""
import json
import sys

from app.config import cost_usd, load_pack
from app.providers.gate import JevGate
from app.providers.llm import OpenRouterLLM

SAMPLES = ["Love the new app design, great job team!",
           "bhai Rs 840 account se nikal gaye aur order confirm nahi hua. consumer court me complaint karunga",
           "The login OTP takes several minutes to arrive."]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    pack = load_pack()
    gate, total = JevGate(pack), 0.0
    for text in SAMPLES:
        g = gate.classify(text)
        u = g.pop("usage")
        cost = cost_usd(pack, gate.model, u["in_tokens"])
        total += cost
        probs = sorted(g.pop("component_probs").items(), key=lambda kv: -kv[1])[:2]
        print(f"\n> {text}\n  {json.dumps({k: round(v, 2) if isinstance(v, float) else v for k, v in g.items()})}")
        print(f"  top components: {[(k, round(v, 2)) for k, v in probs]}")
        print(f"  tokens={u['in_tokens']} (reported={not u['estimated']})  {u['latency_s'] * 1000:.0f} ms  ${cost:.6f}")

    seeds = {i["key"]: i for i in pack["seed_issues"]}
    cands = [dict(key=k, title=seeds[k]["title"], description=seeds[k]["description"], sim=0.0)
             for k in ("pay_debited_no_order", "pay_upi_timeout", "ref_not_received")]
    p, u = gate.verify(SAMPLES[1], cands)
    total += cost_usd(pack, gate.model, u["in_tokens"])
    print(f"\nVERIFY (same problem as...?) {json.dumps({k: round(v, 2) for k, v in p.items()})}  tokens={u['in_tokens']}  {u['latency_s'] * 1000:.0f} ms")

    llm = OpenRouterLLM(pack)
    issues = [dict(key=i["key"], component=i["component"], title=i["title"], description=i["description"],
                   texts=[i["title"]] + i["examples"]) for i in pack["seed_issues"] if i["component"] == "payments"]
    verdict, u = llm.adjudicate("payments", issues, "I was charged twice for a single order. Rs 840 was debited two times.", [])
    total += cost_usd(pack, llm.model, u["in_tokens"], u["out_tokens"])
    print(f"\nLLM ({llm.model}) verdict={verdict}  in={u['in_tokens']} out={u['out_tokens']}  {u['latency_s']:.1f}s")
    print(f"\nTotal for this check at list price: ${total:.6f}")


if __name__ == "__main__":
    main()
