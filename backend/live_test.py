"""Live accuracy test: send complaints the engine has never seen to a running site, score them.

Run from backend/:
  python data/generate.py --n 50 --fresh 5001 --out live_test_runs/b50     # 50 new complaints + answer key
  python live_test.py send live_test_runs/b50 https://hackstellar-three.vercel.app/api
  python live_test.py score live_test_runs/b50 [live_test_runs/b100 ...]

Why fresh complaints from the same customers (--fresh): the engine must not have seen the text,
     but the customer list has to be the site's own, or nobody could be linked.
Why one at a time: that is how complaints reach the live site; it also times each one end to end.
Why a clean copy of the data per batch: batches stay independent (on Vercel, change
     LIVE_SYNC_PREFIX and redeploy). The test adds rows to the live data, so reset it afterwards.
The engine never reads truth.json; only `score` does.
"""
import json
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

from app import ingest


def call(base: str, method: str, path: str, body=None, tries: int = 4) -> dict:
    for k in range(tries):
        try:
            req = urllib.request.Request(base + path, method=method, headers={"Content-Type": "application/json"},
                                         data=json.dumps(body).encode() if body is not None else None)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001  (network hiccup: retry, then give up)
            print(f"  retry {k + 1} {path}: {str(e)[:100]}", flush=True)
            time.sleep(3 * (k + 1))
    raise RuntimeError(f"{method} {path} failed {tries} times")


def send(folder: Path, base: str) -> None:
    truth = json.loads((folder / "truth.json").read_text(encoding="utf-8"))
    calls = {json.loads(line)["call_id"]: json.loads(line) for line in open(folder / "calls.jsonl", encoding="utf-8")}
    # which real problem each issue found by the engine stands for, as the site sees it before the test
    (folder / "before_accuracy.json").write_text(json.dumps(call(base, "GET", "/accuracy"), indent=1))
    with open(folder / "results.jsonl", "w", encoding="utf-8") as out:
        for n, c in enumerate(ingest.load_all(folder), 1):
            t0 = time.time()
            if c["channel"] == "call":
                res = call(base, "POST", "/webhooks/call", calls[c["id"]])
            else:
                res = call(base, "POST", "/complaints", {k: c[k] for k in ("channel", "text", "email", "user_id", "handle", "order_id") if c.get(k)})
            rec = dict(src_id=c["id"], truth=truth[c["id"]], wall_s=round(time.time() - t0, 2), mode=res.get("mode"),
                       live_id=res["complaint"]["id"], result=res.get("result"), gate=res.get("gate"), events=res.get("events"))
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            print(f"{n:3d} {c['id']} {rec['mode']} {rec['wall_s']:5.2f}s truth={rec['truth']['issue']} -> {rec['result'].get('settled')}", flush=True)
    # a complaint can be filed after its own answer (when a new issue forms), so read the final state
    final = {}
    for line in open(folder / "results.jsonl", encoding="utf-8"):
        r = json.loads(line)
        d = call(base, "GET", f"/complaints/{r['live_id']}")
        final[r["src_id"]] = dict(filed=d.get("filed_under"), customer_id=d["complaint"].get("customer_id"))
    (folder / "final.json").write_text(json.dumps(final, indent=1, ensure_ascii=False))


def pct(a: int, b: int):
    return round(100 * a / b, 1) if b else None


def score(folders: list[Path]) -> dict:
    recs = []
    for f in folders:
        before = json.loads((f / "before_accuracy.json").read_text())
        label = {i["key"]: i["true_issue"] for i in before["discovered"]["issues"]}
        final = json.loads((f / "final.json").read_text(encoding="utf-8"))
        for line in open(f / "results.jsonl", encoding="utf-8"):
            r = json.loads(line)
            r.update(label=label, final=final[r["src_id"]])
            recs.append(r)
    # an issue created during the test takes the label most of its test members carry
    newm = defaultdict(Counter)
    for r in recs:
        f = r["final"]["filed"]
        if f and f["key"].startswith("new_") and f["key"] not in r["label"]:
            newm[f["key"]][r["truth"]["issue"]] += 1
    m, by_n, by_ok, wait, mistakes, lat = Counter(), Counter(), Counter(), [], [], defaultdict(list)
    for r in recs:
        t, g, f = r["truth"], r["gate"], r["final"]["filed"]
        kept = g["is_complaint"] >= 0.5
        stages = [e["stage"] for e in r["events"]]
        lat["dropped" if not kept else "llm" if "llm" in stages else "verify" if "verify" in stages else "match"].append(r["wall_s"])
        cust = r["final"]["customer_id"]
        m["linked"] += cust is not None
        m["link_wrong"] += cust is not None and cust != t["customer_id"]
        if not t["is_complaint"]:
            m["noise"] += 1
            m["noise_removed"] += not kept
            if kept:
                mistakes.append(("kept a non-complaint", r["src_id"]))
            continue
        m["real"] += 1
        if not kept:
            mistakes.append(("set aside a real complaint", r["src_id"], t["issue"]))
            continue
        m["kept"] += 1
        m["area_ok"] += g["component"] == t["component"]
        if f:
            labels = dict(r["label"], **{k: c.most_common(1)[0][0] for k, c in newm.items()})
            ok = labels.get(f["key"], f["key"]) == t["issue"]
            by_n[f["stage"]] += 1
            by_ok[f["stage"]] += ok
            if not ok:
                mistakes.append((f"filed wrong by {f['stage']}", r["src_id"], t["issue"], f["key"]))
        else:
            wait.append((r["src_id"], t["issue"], bool(r["result"].get("urgent"))))
    filed, right = sum(by_n.values()), sum(by_ok.values())
    walls = sorted(r["wall_s"] for r in recs)
    cost = sum(e["cost_usd"] or 0 for r in recs for e in r["events"])
    return dict(
        complaints=len(recs), on_live_models=sum(r["mode"] == "live" for r in recs),
        gate=dict(real_kept=f"{m['kept']}/{m['real']}", noise_removed=f"{m['noise_removed']}/{m['noise']}",
                  right_pct=pct(m["kept"] + m["noise_removed"], len(recs))),
        area=dict(right=f"{m['area_ok']}/{m['kept']}", pct=pct(m["area_ok"], m["kept"])),
        filed=dict(right=f"{right}/{filed}", pct=pct(right, filed),
                   by_stage={s: f"{by_ok[s]}/{by_n[s]}" for s in sorted(by_n)}),
        waiting=dict(n=len(wait), cases=wait),
        customers=dict(linked=m["linked"], wrong=m["link_wrong"]),
        seconds=dict(median=median(walls), p90=walls[int(len(walls) * 0.9)],
                     median_by_path={k: median(v) for k, v in lat.items()}),
        cost_usd=round(cost, 5), per_100k_usd=round(cost / len(recs) * 100_000, 2),
        mistakes=mistakes)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) >= 4 and sys.argv[1] == "send":
        send(Path(sys.argv[2]), sys.argv[3].rstrip("/"))
    elif len(sys.argv) >= 3 and sys.argv[1] == "score":
        for f in sys.argv[2:]:
            print(f, json.dumps(score([Path(f)]), indent=1))
        if len(sys.argv) > 3:
            print("all", json.dumps(score([Path(f) for f in sys.argv[2:]]), indent=1))
    else:
        print(__doc__)
