"""Realistic prompt-caching analysis for the "LLM reads every complaint" baseline.

  python cache_analysis.py                 print prompts + scenarios (no credit used)
  python cache_analysis.py --measure 12    also send 12 real baseline calls to calibrate

Why: metrics.cost() assumes the baseline's whole prefix is a cache hit on every call. That
     is the baseline's best case, not what a company would see. A cache entry only helps when
       1. the static prefix is at least the model's minimum (512 tokens on Haiku/Sonnet 5.5),
       2. the next request arrives before the entry expires (5 min, or 1 h at a dearer write),
       3. the prefix is byte-identical (a newly discovered issue changes it: a fresh write).
     Only the static prefix is ever cached; the complaint text and the reply never are.
Not a flat "hit rate" guess: hits are replayed from the complaints' real arrival times.
Why --measure: baseline token counts were chars/4 estimates; a few real calls give the true
     prompt size, reply size and proof that the cache engages through OpenRouter.
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime

from app.config import ROOT, est_tokens, load_pack
from app.providers import llm
from app.providers.http import post_json

WRITE_MULT = {"5m": 1.25, "1h": 2.0}   # cache-write price as a multiple of normal input
TTL_MIN = {"5m": 5, "1h": 60}
MIN_PREFIX = 512                        # minimum cacheable prefix, Haiku 5.5 / Sonnet 5.5


def load(con):
    issues = []
    for r in con.execute("SELECT * FROM issues ORDER BY id"):
        texts = [x[0] for x in con.execute("SELECT text FROM exemplars WHERE issue_id=? ORDER BY rowid", (r["id"],))]
        issues.append(dict(r) | dict(texts=texts))
    rows = con.execute("SELECT c.created_at, c.text, b.prefix_tokens, b.in_tokens, b.out_tokens FROM baseline b "
                       "JOIN complaints c ON c.id = b.complaint_id ORDER BY c.created_at").fetchall()
    return issues, rows


def measure(pack, prefix, texts, n):
    """n real back-to-back baseline calls with a cache marker on the static prefix."""
    key, model, out = os.environ["OPENROUTER_API_KEY"], pack["baseline_models"][0], []
    for text in texts[:n]:
        data, _ = post_json(llm.URL, key, {
            "model": model, "temperature": 0, "max_tokens": 200, "usage": {"include": True},
            "messages": [{"role": "system", "content": [{"type": "text", "text": prefix, "cache_control": {"type": "ephemeral"}}]},
                         {"role": "user", "content": f"Message: {text}"}]})
        out.append(data.get("usage") or {})
    return model, out


def simulate(rows, prices, scale, speedup, ttl, out_tokens):
    """Cost of the baseline with caching, replaying arrival gaps. speedup compresses time
    (10 = ten times the volume in the same period). ttl None = no caching."""
    total, hits, last_t, last_prefix = 0.0, 0, None, None
    for r in rows:
        t = datetime.fromisoformat(r["created_at"]).timestamp() / 60 / speedup          # minutes
        prefix, dynamic = r["prefix_tokens"] * scale, (r["in_tokens"] - r["prefix_tokens"]) * scale
        total += dynamic * prices["input"] + out_tokens * prices["output"]
        if ttl is None or prefix < MIN_PREFIX:
            total += prefix * prices["input"]
        elif last_t is not None and t - last_t < TTL_MIN[ttl] and prefix == last_prefix:
            total += prefix * prices["cache_read"]                                      # hit; a read also refreshes the timer
            hits += 1
        else:
            total += prefix * prices["input"] * WRITE_MULT[ttl]                         # miss: pay the write premium
        if ttl is not None:
            last_t, last_prefix = t, prefix
    return total / 1e6, hits / len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--measure", type=int, default=0)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    pack = load_pack()
    con = sqlite3.connect(ROOT / "runs" / "grocery_live_backup.db")
    con.row_factory = sqlite3.Row
    issues, rows = load(con)
    prefix = llm.baseline_prefix(pack, issues)
    pay = [i for i in issues if i["component"] == "payments"]

    print("=" * 100, "\nBASELINE PROMPT (one call per complaint)\n")
    print("--- static part: system prompt; the only part a cache can hold ---")
    print(prefix[:1400] + f"\n   ... [{len(prefix) - 1400} more characters: the rest of the {len(issues)} issues, then the reply format]")
    print("\n--- dynamic part: differs on every call, never cached ---\nMessage: <the complaint text>\n(+ the model's JSON reply, billed as output)")
    print("\n" + "=" * 100, "\nFUNNEL ADJUDICATOR PROMPT (payments; sent only for the unsure few)\n")
    print(llm.adjudicator_prefix(pack, "payments", pay) + "\n\n--- dynamic part ---\nComplaint: <the complaint text>")

    scale, out_tokens, note = 1.0, llm.BASELINE_OUT_TOKENS, "estimated (chars/4, 90-token reply)"
    if args.measure:
        model, usage = measure(pack, prefix, [r["text"] for r in rows[-args.measure:]], args.measure)
        print("\n" + "=" * 100, f"\nREAL MEASUREMENT: {args.measure} back-to-back calls on {model}\n")
        for u in usage[:3]:
            print("  usage:", json.dumps(u))
        est_in = sum(est_tokens(prefix) + est_tokens("Message: " + r["text"]) for r in rows[-args.measure:])
        real_in = sum(u.get("prompt_tokens", 0) for u in usage)
        scale, out_tokens = real_in / est_in, sum(u.get("completion_tokens", 0) for u in usage) / len(usage)
        cached = [(u.get("prompt_tokens_details") or {}).get("cached_tokens", 0) for u in usage]
        print(f"\n  real prompt tokens are {scale:.2f}x the estimate; real reply averages {out_tokens:.0f} tokens")
        print(f"  cached tokens per call: {cached}")
        print(f"  billed for these calls: ${sum(u.get('cost', 0) or 0 for u in usage):.6f}")
        note = f"calibrated on {args.measure} real calls"

    n = len(rows)
    p0, p1 = rows[0]["prefix_tokens"] * scale, rows[-1]["prefix_tokens"] * scale
    dyn = sum(r["in_tokens"] - r["prefix_tokens"] for r in rows) / n * scale
    changes = sum(rows[i]["prefix_tokens"] != rows[i - 1]["prefix_tokens"] for i in range(1, n))
    print("\n" + "=" * 100, f"\nSIZES ({note})")
    print(f"  static prefix: {p0:.0f} tokens at the start, {p1:.0f} at the end ({changes} changes as issues were discovered)")
    print(f"  dynamic: {dyn:.0f} input tokens per complaint + {out_tokens:.0f} output tokens")
    print(f"  cacheable share of input: {p1 / (p1 + dyn) * 100:.0f}%   minimum cacheable prefix: {MIN_PREFIX} tokens")

    funnel = con.execute("SELECT SUM(cost_usd) FROM events").fetchone()[0]
    print(f"\nFUNNEL (measured, no caching applied): ${funnel:.4f} for {n} complaints\n")
    scenarios = [("as it arrived: 1,500 a month", 1), ("15,000 a month", 10), ("150,000 a month", 100),
                 ("1.5 million a month", 1000)]
    for model in pack["baseline_models"]:
        prices = pack["prices_usd_per_million"][model]
        print(f"BASELINE on {model}  (input ${prices['input']}, cache read ${prices['cache_read']}, output ${prices['output']} per million)")
        print(f"  {'scenario':32s} {'no cache':>9s} {'5-min':>9s} {'hit%':>5s} {'1-hour':>9s} {'hit%':>5s} | {'best':>9s}  funnel saving")
        for label, speed in scenarios:
            none, _ = simulate(rows, prices, scale, speed, None, out_tokens)
            c5, h5 = simulate(rows, prices, scale, speed, "5m", out_tokens)
            c1, h1 = simulate(rows, prices, scale, speed, "1h", out_tokens)
            best = min(none, c5, c1)
            print(f"  {label:32s} ${none:8.4f} ${c5:8.4f} {h5 * 100:4.0f}% ${c1:8.4f} {h1 * 100:4.0f}% | ${best:8.4f}  {(1 - funnel / best) * 100:5.1f}%")
        ideal, _ = simulate(rows, prices, scale, 1e9, "5m", out_tokens)
        print(f"  {'ceiling: every call a cache hit':32s} {'':>9s} ${ideal:8.4f} {'':>5s} {'':>9s} {'':>5s} | ${ideal:8.4f}  {(1 - funnel / ideal) * 100:5.1f}%\n")


if __name__ == "__main__":
    main()
