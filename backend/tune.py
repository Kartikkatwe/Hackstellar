"""Sweep the similarity cut-offs and show what each setting does to accuracy and LLM use.

  python tune.py --embedder hash
  python tune.py --embedder st --hi 0.65 0.70 0.75 --lo 0.40 0.45 --cluster 0.55 0.60

Why: a cut-off is only trustworthy once checked against complaints with known answers
     (a risk listed in the handoff). In production this would be a labelled sample.
Not tuning by eye on a few examples: the trade-off (fewer LLM calls vs wrong groupings)
     only shows up across the whole set.
"""
import argparse
import contextlib
import io

from app.analytics import metrics
from app.config import load_pack
from app.pipeline.run import run_batch


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", default=None)
    ap.add_argument("--mode", choices=["mock", "live"], default="mock")
    ap.add_argument("--embedder", choices=["hybrid", "st", "hash"], default="hybrid")
    ap.add_argument("--hi", type=float, nargs="+", default=[0.60, 0.45, 0.35, 0.28])
    ap.add_argument("--lo", type=float, nargs="+", default=[0.30, 0.20, 0.12])
    ap.add_argument("--cluster", type=float, nargs="+", default=[0.45, 0.30, 0.20])
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    pack = load_pack(args.pack)
    print("  hi    lo  clust | match verify   llm  new pend | issues dup found | acc%  filed% | noLLM%  funnel$")
    for hi in args.hi:
        for lo in args.lo:
            if lo >= hi:
                continue
            for cl in args.cluster:
                with contextlib.redirect_stdout(io.StringIO()):
                    con, _ = run_batch(pack, args.mode, args.embedder, args.limit, overrides=dict(match_hi=hi, match_lo=lo, cluster=cl))
                f, a, c = metrics.funnel(con), metrics.accuracy(con, pack), metrics.cost(con, pack)
                con.close()
                s = {x["stage"]: x["count"] for x in f["stages"]}
                d = a["discovered"]
                print(f"{hi:5.2f} {lo:5.2f} {cl:5.2f} | {s['match']:5d} {s['verify']:6d} {s['llm']:5d} {s['new_issue']:4d} {s['pending']:4d} | "
                      f"{f['issues_discovered']:6d} {sum(x['duplicate_of_known'] for x in d['issues']):3d} {d['hidden_issues_found']:5d} | "
                      f"{a['issue']['accuracy_pct']:5.1f} {a['issue']['coverage_pct']:6.1f} | {f['share_without_llm'] * 100:6.1f} {c['funnel']['cost_usd']:8.4f}")


if __name__ == "__main__":
    main()
