"""The three measurements the pitch rests on: where complaints settled, what it cost against
an LLM-for-everything baseline, and how often the answer was right.

Why computed from stored events, not counters kept during the run: any figure can be traced
     back to the individual calls behind it.
Why the baseline is costed for two models, with and without prompt caching: a fair opponent
     would pick a cheap model and cache its prompt. Not comparing only against an expensive
     uncached LLM: that would inflate the saving and not survive a judge's question.
Why accuracy needs truth.json: synthetic data records each complaint's real issue, so
     accuracy is measured, not claimed. The engine never reads that file.
"""
import json
from collections import Counter, defaultdict

from ..config import cost_usd

STAGES = [("dropped", "Gate: not a complaint"), ("match", "Similarity match"), ("verify", "Verify (decision model)"),
          ("llm", "Adjudicate (LLM)"), ("new_issue", "Buffer: became a new issue"), ("pending", "Buffer: unconfirmed, waiting")]


def run_info(con) -> dict:
    return {r["key"]: json.loads(r["value"]) for r in con.execute("SELECT * FROM run")}


def funnel(con) -> dict:
    total = con.execute("SELECT COUNT(*) FROM complaints").fetchone()[0]
    by = dict(con.execute("SELECT settled, COUNT(*) FROM complaints GROUP BY settled").fetchall())
    calls = dict(con.execute("SELECT stage, COUNT(*) FROM events GROUP BY stage").fetchall())
    reached_llm = con.execute("SELECT COUNT(DISTINCT complaint_id) FROM events WHERE stage='llm'").fetchone()[0]
    return dict(
        total=total,
        stages=[dict(stage=s, label=label, count=by.get(s, 0), share=round(by.get(s, 0) / total, 4) if total else 0) for s, label in STAGES],
        gate_calls=calls.get("gate", 0), verify_calls=calls.get("verify", 0), llm_adjudications=reached_llm,
        llm_naming_calls=calls.get("llm_name", 0),
        share_without_llm=round(1 - reached_llm / total, 4) if total else 0,
        issues_seeded=con.execute("SELECT COUNT(*) FROM issues WHERE origin='seed'").fetchone()[0],
        issues_discovered=con.execute("SELECT COUNT(*) FROM issues WHERE origin='discovered'").fetchone()[0])


def cost(con, pack: dict) -> dict:
    n = con.execute("SELECT COUNT(*) FROM complaints").fetchone()[0] or 1
    stages, total, seconds, estimated = [], 0.0, 0.0, False
    for r in con.execute("SELECT stage, model, COUNT(*) calls, SUM(in_tokens) i, SUM(out_tokens) o, SUM(cost_usd) c, "
                         "SUM(latency_s) s, MAX(estimated) e FROM events GROUP BY stage, model ORDER BY MIN(rowid)"):
        stages.append(dict(stage=r["stage"], model=r["model"], calls=r["calls"], in_tokens=r["i"], out_tokens=r["o"],
                           cost_usd=round(r["c"], 6), seconds=round(r["s"], 1)))
        total, seconds, estimated = total + r["c"], seconds + r["s"], estimated or bool(r["e"])
    raw = con.execute("SELECT SUM(prefix_tokens) p, SUM(in_tokens) i, SUM(out_tokens) o FROM baseline").fetchone()
    # Why calibrate: 12 real baseline calls (cache_analysis.py --measure) showed the prompt is
    # 1.42x the chars/4 estimate and the reply about 197 tokens, not the 90 first assumed.
    cal = pack.get("baseline_calibration", {})
    scale = cal.get("token_scale", 1.0)
    b = dict(p=round(raw["p"] * scale), i=round(raw["i"] * scale), o=round(cal["out_tokens"] * n) if "out_tokens" in cal else raw["o"])
    baselines = []
    for model in pack["baseline_models"]:
        full = cost_usd(pack, model, b["i"], b["o"])
        # "cached" is the baseline's best case: every call a cache hit. Arrival gaps and the
        # 5-minute expiry make real figures worse for the baseline; see cache_analysis.py.
        cached = cost_usd(pack, model, b["i"], b["o"], cached_tokens=b["p"])
        baselines.append(dict(model=model, cost_usd=round(full, 6), cost_cached_usd=round(cached, 6),
                              saving_pct=round((1 - total / full) * 100, 1), saving_vs_cached_pct=round((1 - total / cached) * 100, 1),
                              per_100k_usd=round(full / n * 1e5, 2), per_100k_cached_usd=round(cached / n * 1e5, 2)))
    # Why prefer the measured figure: on a live run we know how long this LLM really took per call.
    # It is the adjudicator's short reply, so it understates a baseline call that writes more.
    measured = con.execute("SELECT AVG(latency_s) FROM events WHERE stage='llm' AND estimated=0").fetchone()[0]
    llm_latency = round(measured, 2) if measured else pack["assumed_latency_s"]["llm"]
    return dict(
        funnel=dict(stages=stages, cost_usd=round(total, 6), per_complaint_usd=round(total / n, 8), per_100k_usd=round(total / n * 1e5, 2),
                    seconds=round(seconds, 1)),
        baseline=dict(in_tokens=b["i"], out_tokens=b["o"], models=baselines, seconds=round(n * llm_latency, 1),
                      note=f"Projected from token counts at list price; one call per complaint at "
                           f"{'a measured' if measured else 'an assumed'} {llm_latency}s per call. The baseline itself was not run."),
        speedup=round(n * llm_latency / seconds, 1) if seconds else None,
        tokens_estimated=estimated,
        note="Token counts and timings are estimates (mock providers)." if estimated else "Token counts and timings are as reported by the providers.")


def accuracy(con, pack: dict) -> dict | None:
    path = pack["data_path"] / "truth.json"
    if not path.exists():
        return None
    truth = json.loads(path.read_text(encoding="utf-8"))
    seeds = {i["key"] for i in pack["seed_issues"]}
    rows = con.execute("SELECT c.id, c.settled, c.customer_id, g.component, i.key issue_key, i.title, i.origin, a.stage "
                       "FROM complaints c JOIN gate g ON g.complaint_id = c.id "
                       "LEFT JOIN assignments a ON a.complaint_id = c.id LEFT JOIN issues i ON i.id = a.issue_id").fetchall()

    # A discovered issue has no true name, so it takes the label most of its members carry.
    members, titles = defaultdict(Counter), {}
    for r in rows:
        if r["origin"] == "discovered" and r["id"] in truth:
            members[r["issue_key"]][truth[r["id"]]["issue"]] += 1
            titles[r["issue_key"]] = r["title"]
    label = {k: c.most_common(1)[0][0] for k, c in members.items()}

    real = missed = noise = noise_kept = comp_ok = comp_n = 0
    stage_ok, stage_n, waiting = Counter(), Counter(), Counter()
    link = Counter()
    for r in rows:
        t = truth.get(r["id"])
        if not t:
            continue
        kept = r["settled"] != "dropped"
        if t["is_complaint"]:
            real += 1
            if not kept:
                missed += 1
            else:
                comp_n += 1
                comp_ok += r["component"] == t["component"]
                if r["issue_key"]:
                    stage_n[r["stage"]] += 1
                    stage_ok[r["stage"]] += label.get(r["issue_key"], r["issue_key"]) == t["issue"]
                else:
                    waiting["known issue, should have matched" if t["issue"] in seeds else "new issue, not yet recurring"] += 1
        else:
            noise += 1
            noise_kept += kept
        if r["customer_id"] is None:
            link["unlinked"] += 1
        else:
            link["correct" if r["customer_id"] == t["customer_id"] else "wrong"] += 1

    assigned, right = sum(stage_n.values()), sum(stage_ok.values())
    hidden = {v for v in label.values() if v and v not in seeds}
    all_hidden = {t["issue"] for t in truth.values() if t["issue"] and t["issue"] not in seeds}
    linked = link["correct"] + link["wrong"]
    pct = lambda a, b: round(a / b * 100, 1) if b else None   # noqa: E731
    return dict(
        gate=dict(real_complaints=real, wrongly_dropped=missed, non_complaints=noise, non_complaints_let_through=noise_kept,
                  complaint_recall_pct=pct(real - missed, real), noise_removed_pct=pct(noise - noise_kept, noise)),
        component_accuracy_pct=pct(comp_ok, comp_n),
        issue=dict(assigned=assigned, correct=right, accuracy_pct=pct(right, assigned), coverage_pct=pct(assigned, real),
                   by_stage={s: dict(n=stage_n[s], accuracy_pct=pct(stage_ok[s], stage_n[s])) for s in stage_n},
                   still_waiting=dict(waiting)),
        discovered=dict(hidden_issues_in_data=len(all_hidden), hidden_issues_found=len(hidden),
                        issues=[dict(key=k, title=titles[k], true_issue=label[k], size=sum(c.values()),
                                     purity_pct=pct(c.most_common(1)[0][1], sum(c.values())),
                                     duplicate_of_known=label[k] in seeds) for k, c in members.items()]),
        identity=dict(linked=linked, link_accuracy_pct=pct(link["correct"], linked), wrong_links=link["wrong"], unlinked=link["unlinked"]))
