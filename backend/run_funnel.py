"""Run the funnel over a pack's dataset and print the report.

  python run_funnel.py                    mock providers, auto embedder
  python run_funnel.py --mode live        real Jev + LLM over OpenRouter (needs credit)
  python run_funnel.py --limit 200        first 200 complaints only (cheap live check)

Why a CLI beside the API: tuning cut-offs needs a fast run-and-read loop with no server.
"""
import argparse
import json
import sys

from app.analytics import metrics, ranker
from app.config import ROOT, load_pack
from app.pipeline.run import run_batch


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", default=None)
    ap.add_argument("--mode", choices=["mock", "live"], default="mock")
    ap.add_argument("--embedder", choices=["auto", "hybrid", "st", "hash"], default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")   # Windows consoles default to cp1252 and choke on the rupee sign

    pack = load_pack(args.pack)
    con, _ = run_batch(pack, args.mode, args.embedder, args.limit,
                       progress=lambda n, total: print(f"\r  processed {n}/{total}", end="", flush=True))
    info, f, c, acc = metrics.run_info(con), metrics.funnel(con), metrics.cost(con, pack), metrics.accuracy(con, pack)
    top = ranker.rank(con, pack, n=args.top)
    (ROOT / "runs" / f"{pack['id']}_report.json").write_text(
        json.dumps(dict(run=info, funnel=f, cost=c, accuracy=acc, top=top), indent=1, ensure_ascii=False), encoding="utf-8")

    print(f"\n\n{pack['name']}: {info['n']} records | gate={info['gate']} llm={info['llm']} embedder={info['embedder']} | {info['wall_seconds']}s")
    print("\nFUNNEL")
    for s in f["stages"]:
        print(f"  {s['label']:34s} {s['count']:5d}  {s['share'] * 100:5.1f}%")
    print(f"  never reached an LLM: {f['share_without_llm'] * 100:.1f}%   LLM adjudications: {f['llm_adjudications']}   "
          f"verify calls: {f['verify_calls']}   issues discovered: {f['issues_discovered']}")

    print(f"\nCOST  ({c['note']})")
    for s in c["funnel"]["stages"]:
        print(f"  {s['stage']:9s} {s['model']:28s} calls={s['calls']:5d} in={s['in_tokens']:8d} out={s['out_tokens']:6d}  ${s['cost_usd']:.4f}")
    print(f"  FUNNEL TOTAL ${c['funnel']['cost_usd']:.4f}   (${c['funnel']['per_100k_usd']:.2f} per 100k complaints)   ~{c['funnel']['seconds']:.0f}s of model time")
    for b in c["baseline"]["models"]:
        print(f"  LLM-for-everything, {b['model']:28s} ${b['cost_usd']:.4f} (saving {b['saving_pct']}%)   "
              f"with prompt caching ${b['cost_cached_usd']:.4f} (saving {b['saving_vs_cached_pct']}%)")
    print(f"  baseline model time ~{c['baseline']['seconds']:.0f}s   speed-up x{c['speedup']}")

    if acc:
        g, i, d, idn = acc["gate"], acc["issue"], acc["discovered"], acc["identity"]
        print("\nACCURACY (against truth.json)")
        print(f"  gate: kept {g['complaint_recall_pct']}% of real complaints, removed {g['noise_removed_pct']}% of non-complaints")
        print(f"  component routing: {acc['component_accuracy_pct']}%")
        print(f"  issue: {i['accuracy_pct']}% correct of {i['assigned']} filed ({i['coverage_pct']}% of real complaints filed)")
        for stage, v in i["by_stage"].items():
            print(f"    {stage:10s} n={v['n']:5d}  {v['accuracy_pct']}%")
        print(f"    still waiting: {i['still_waiting']}")
        print(f"  discovery: found {d['hidden_issues_found']} of {d['hidden_issues_in_data']} hidden issues")
        for x in d["issues"]:
            print(f"    {x['key']:7s} -> {str(x['true_issue']):24s} size={x['size']:4d} purity={x['purity_pct']}%"
                  f"{'  DUPLICATE of a known issue' if x['duplicate_of_known'] else ''}")
        print(f"  identity: {idn['link_accuracy_pct']}% of {idn['linked']} links correct, {idn['wrong_links']} wrong, {idn['unlinked']} unlinked")

    print(f"\nTOP {args.top}")
    for x in top:
        print(f"  {x['rank']:2d}. [{x['badge']:8s}] {x['title'][:46]:46s} {','.join(x['flags']):22s} {x['formula']}")


if __name__ == "__main__":
    main()
