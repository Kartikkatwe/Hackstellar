"""Ranking: the top recurring issues, each with the numbers behind its score.

score = unique customers x average impact x (1 + money-loss share)
        x (1 + angry_weight x angry share) x trend

Why plain arithmetic over stored rows, no AI: PS-19 asks for transparent criteria, so every
     factor must be a number a judge can check by hand.
Why unique customers, not complaint count: one person who emails, phones and tweets is one
     affected customer. Unlinked posts are shown beside the score, never guessed into it.
Why emotion is a small multiplier (decided 13 Nov): anger matters, but a loud customer must
     not outrank a quiet one who lost money.
Not a learned ranking model: it could not be explained on screen.
Why segment filters are applied before counting: the same formula then answers "what are
     the top issues for students in Karnataka" with no special case.
"""
import datetime as dt
import json
from collections import Counter, defaultdict

ROWS_SQL = """
SELECT a.issue_id, a.stage, c.id, c.channel, c.created_at, c.customer_id,
       g.impact, g.emotion, g.money_lost, g.legal_risk, cu.profile
FROM assignments a
JOIN complaints c ON c.id = a.complaint_id
JOIN gate g ON g.complaint_id = c.id
LEFT JOIN customers cu ON cu.id = c.customer_id
"""


def _matches(profile: dict | None, filters: dict) -> bool:
    return profile is not None and all(str(profile.get(k)).lower() == str(v).lower() for k, v in filters.items())


def rank(con, pack: dict, filters: dict | None = None, n: int | None = None) -> list[dict]:
    r = pack["ranking"]
    filters = {k: v for k, v in (filters or {}).items() if k in pack["segments"] and v not in (None, "")}
    latest = con.execute("SELECT MAX(created_at) FROM complaints").fetchone()[0]
    if not latest:
        return []
    now = dt.datetime.fromisoformat(latest)
    agg = defaultdict(lambda: dict(complaints=0, customers=set(), unlinked=0, impact=0.0, money=0, legal=0, angry=0,
                                   channels=Counter(), stages=Counter(), recent=set(), prior=set()))
    for row in con.execute(ROWS_SQL):
        profile = json.loads(row["profile"]) if row["profile"] else None
        if filters and not _matches(profile, filters):
            continue
        a = agg[row["issue_id"]]
        a["complaints"] += 1
        a["impact"] += row["impact"]
        a["money"] += row["money_lost"] >= 0.5
        a["legal"] += row["legal_risk"] >= 0.5
        a["angry"] += row["emotion"] >= 1.5
        a["channels"][row["channel"]] += 1
        a["stages"][row["stage"]] += 1
        if row["customer_id"]:
            a["customers"].add(row["customer_id"])
            age = (now - dt.datetime.fromisoformat(row["created_at"])).days
            (a["recent"] if age < 7 else a["prior"] if age < 14 else set()).add(row["customer_id"])
        else:
            a["unlinked"] += 1

    out = []
    for issue in con.execute("SELECT * FROM issues"):
        a = agg.get(issue["id"])
        if not a:
            continue
        k = a["complaints"]
        customers = len(a["customers"])
        avg_impact = 1 + a["impact"] / k            # shown as 1 (annoyed) to 4 (harmed) so a mild issue is not multiplied by zero
        money, legal, angry = a["money"] / k, a["legal"] / k, a["angry"] / k
        # Why a floor of 5: with tiny counts, "doubled" is noise.
        rising = len(a["recent"]) >= 5 and len(a["recent"]) >= 2 * max(1, len(a["prior"]))
        trend = r["trend_multiplier"] if rising else 1.0
        score = customers * avg_impact * (1 + money) * (1 + r["angry_weight"] * angry) * trend
        critical = k >= 3 and (legal >= r["critical_legal_share"] or money >= r["critical_money_share"])
        out.append(dict(
            issue_id=issue["id"], key=issue["key"], component=issue["component"], title=issue["title"],
            description=issue["description"], origin=issue["origin"], score=round(score, 1),
            unique_customers=customers, complaints=k, unlinked_mentions=a["unlinked"],
            avg_impact=round(avg_impact, 2), money_share=round(money, 2), legal_share=round(legal, 2), angry_share=round(angry, 2),
            trend=trend, customers_last_7d=len(a["recent"]), customers_prior_7d=len(a["prior"]),
            channels=dict(a["channels"]), settled_at=dict(a["stages"]),
            flags=[f for f, on in (("money", money >= 0.5), ("legal", legal >= r["critical_legal_share"]),
                                   ("angry", angry >= 0.4), ("rising", rising)) if on],
            badge="Critical" if critical else None,
            formula=f"{customers} customers x {avg_impact:.2f} impact x {1 + money:.2f} money x "
                    f"{1 + r['angry_weight'] * angry:.2f} anger x {trend:.2f} trend = {score:.1f}"))
    out.sort(key=lambda x: -x["score"])
    rest = [x for x in out if not x["badge"]]
    for pos, x in enumerate(rest):                  # non-critical issues: thirds of the ranked list
        x["badge"] = ("High", "Medium", "Low")[min(2, pos * 3 // max(1, len(rest)))]
    for pos, x in enumerate(out, 1):
        x["rank"] = pos
    return out[: n or len(out)]


def heatmap(con, pack: dict, dim: str, n: int | None = None) -> dict:
    """Issues x values of one segment dimension.
    Why a rate (affected / segment size), not a raw count: otherwise the biggest segment
    always looks worst. lift = this segment's rate / the rate across all customers."""
    top = rank(con, pack, n=n or pack["ranking"]["top_n"])
    sizes = Counter()
    for row in con.execute("SELECT profile FROM customers"):
        sizes[str(json.loads(row["profile"]).get(dim))] += 1
    total = sum(sizes.values())
    cells = defaultdict(lambda: defaultdict(set))
    for row in con.execute(ROWS_SQL):
        if row["customer_id"] and row["profile"]:
            cells[row["issue_id"]][str(json.loads(row["profile"]).get(dim))].add(row["customer_id"])
    rows = []
    for issue in top:
        overall = issue["unique_customers"] / total if total else 0
        values = {}
        for value, size in sizes.items():
            affected = len(cells[issue["issue_id"]][value])
            rate = affected / size if size else 0
            values[value] = dict(affected=affected, rate=round(rate, 3), lift=round(rate / overall, 2) if overall else None)
        rows.append(dict(issue_id=issue["issue_id"], title=issue["title"], rank=issue["rank"], values=values))
    return dict(dimension=dim, label=pack["segments"][dim], segment_sizes=dict(sizes), rows=rows)
