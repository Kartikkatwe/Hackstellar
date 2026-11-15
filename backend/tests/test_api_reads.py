"""The dashboard's read endpoints: they answer, and their numbers are consistent with each other.
(Checklist section G: the product still works.)"""
import math
import re

import pytest

READS = ["/health", "/config", "/funnel", "/cost", "/accuracy", "/issues/top", "/pending", "/complaints?limit=20",
         "/segments/heatmap?dim=state", "/segments/compare?dim=is_student&a=true&b=false"]


@pytest.mark.parametrize("path", READS)
def test_read_endpoints_answer(client, path):
    assert client.get(path).status_code == 200


def test_funnel_stages_add_up_to_every_complaint(client):
    f = client.get("/funnel").json()
    assert sum(s["count"] for s in f["stages"]) == f["total"] == 1500
    assert sum(s["share"] for s in f["stages"]) == pytest.approx(1.0, abs=0.01)


def test_top_issues_are_ranked_by_score(client):
    issues = client.get("/issues/top").json()["issues"]
    assert 0 < len(issues) <= 10
    assert [i["rank"] for i in issues] == list(range(1, len(issues) + 1))
    assert issues == sorted(issues, key=lambda i: -i["score"])


def test_score_equals_its_published_formula(client):
    """The pitch says anyone can check a score with a calculator. So check every one."""
    for i in client.get("/issues/top?n=50").json()["issues"]:
        *factors, total = (float(x) for x in re.findall(r"\d+(?:\.\d+)?", i["formula"]))
        assert total == pytest.approx(i["score"], abs=0.05)
        # factors are shown to 2 decimals, so allow for their rounding
        assert math.prod(factors) == pytest.approx(i["score"], rel=0.02, abs=0.5), i["formula"]
        assert factors[0] == i["unique_customers"]


def test_unique_customers_never_exceed_complaints(client):
    for i in client.get("/issues/top?n=500").json()["issues"]:
        assert i["unique_customers"] + i["unlinked_mentions"] <= i["complaints"]


def test_issue_detail_matches_its_summary(client):
    top = client.get("/issues/top").json()["issues"][0]
    d = client.get(f"/issues/{top['issue_id']}").json()
    assert d["summary"]["score"] == top["score"]
    assert len(d["complaints"]) == top["complaints"]
    assert len({c["customer_id"] for c in d["complaints"] if c["customer_id"]}) == top["unique_customers"]
    for r in d["repeat_customers"]:                      # the evidence for "no double counting"
        assert len(r["contacts"]) > 1


def test_segment_filter_only_narrows_the_counts(client):
    everyone = {i["issue_id"]: i for i in client.get("/issues/top?n=500").json()["issues"]}
    students = client.get("/issues/top?n=500&is_student=true").json()
    assert students["filters"] == {"is_student": "true"}
    for i in students["issues"]:
        assert i["unique_customers"] <= everyone[i["issue_id"]]["unique_customers"]


def test_unknown_filter_is_ignored_not_an_error(client):
    r = client.get("/issues/top?favourite_colour=blue")
    assert r.status_code == 200 and r.json()["filters"] == {}


def test_heatmap_covers_every_segment_value(client):
    h = client.get("/segments/heatmap?dim=state").json()
    assert sum(h["segment_sizes"].values()) == 400
    for row in h["rows"]:
        assert set(row["values"]) == set(h["segment_sizes"])
        for cell in row["values"].values():
            assert 0 <= cell["rate"] <= 1


def test_heatmap_rejects_an_unknown_dimension(client):
    assert client.get("/segments/heatmap?dim=profile").status_code == 400


def test_complaint_trail_shows_gate_filing_and_cost(client):
    cid = client.get("/complaints?settled=match&limit=1").json()[0]["id"]
    t = client.get(f"/complaints/{cid}").json()
    assert t["complaint"]["id"] == cid and t["gate"] and t["filed_under"]["key"]
    assert [e["stage"] for e in t["events"]][0] == "gate"


@pytest.mark.parametrize("path", ["/complaints/NOPE", "/issues/999999"])
def test_missing_things_are_404(client, path):
    assert client.get(path).status_code == 404


def test_complaint_list_filters(client):
    unlinked = client.get("/complaints?linked=false&limit=50").json()
    assert unlinked and all(c["customer_id"] is None for c in unlinked)
    dropped = client.get("/complaints?settled=dropped&limit=50").json()
    assert dropped and all(c["settled"] == "dropped" for c in dropped)


def test_pending_lists_urgent_reports_first(client):
    urgent = [p["urgent"] for p in client.get("/pending").json()]
    assert urgent == sorted(urgent, reverse=True)


def test_config_describes_the_pack(client):
    c = client.get("/config").json()
    assert len(c["components"]) == 7
    assert {s["key"] for s in c["segments"]} == {"country", "state", "age_group", "is_student"}


# ---------------------------------------------------------------- the published live-run figures
def test_live_run_figures_have_not_changed(live_backup):
    """Checklist G2. These are the numbers quoted in the pitch; a change to the ranking or the
    metrics code that moves them must be noticed."""
    f = live_backup.get("/funnel").json()
    assert f["total"] == 1500 and f["share_without_llm"] == 0.9613
    top = live_backup.get("/issues/top").json()["issues"][0]
    assert (top["title"], top["score"], top["unique_customers"]) == ("Money debited but order not placed", 560.2, 67)
    a = live_backup.get("/accuracy").json()
    assert a["issue"]["accuracy_pct"] == 98.4 and a["gate"]["noise_removed_pct"] == 100.0
