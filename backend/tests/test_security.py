"""Security and robustness. Each test states the behaviour we want.

Tests marked @finding describe a weakness that is known and NOT fixed yet (numbers refer to
the Load Test and Vulnerability Report, 14 Nov 2026, and to docs/testing/Release_Test_Checklist.pdf).
They are expected to fail today. When a fix lands, the test passes, pytest reports that as an
error, and the marker is deleted. Tests without the marker already hold and must keep holding.

Why written before the fixes: a fix is done when its test passes, not when it looks right.
"""
import pytest

from conftest import finding, wait_for_batch

READS = ["/complaints?limit=3", "/pending", "/issues/top", "/issues/1", "/complaints/E-00001", "/funnel", "/cost",
         "/accuracy", "/config", "/segments/heatmap?dim=state"]
REFUSED = (401, 403)
CALL = {"call_id": "V-TEST", "customer_utterances": ["my refund never came"], "started_at": "2026-11-14T10:00:00",
        "caller_number": "+910000000000"}


# ================================================================ A. access control
@finding(1, "no authentication on any endpoint")
@pytest.mark.parametrize("path", READS)
def test_A1_reads_need_credentials(anon, path):
    assert anon.get(path).status_code in REFUSED


@finding(1, "no authentication on any endpoint")
def test_A3_writes_need_credentials(anon, query):
    before = query("SELECT COUNT(*) FROM complaints")[0][0]
    assert anon.post("/complaints", json={"text": "refund not received"}).status_code in REFUSED
    assert query("SELECT COUNT(*) FROM complaints")[0][0] == before


@finding(2, "anyone can wipe and rebuild the database with POST /runs")
def test_A5_batch_run_needs_admin(anon, query):
    before = query("SELECT COUNT(*) FROM complaints")[0][0]
    try:
        assert anon.post("/runs", json={"mode": "mock", "limit": 5}).status_code in REFUSED
    finally:
        wait_for_batch()
    assert query("SELECT COUNT(*) FROM complaints")[0][0] == before


@finding(1, "manual links need no credentials")
def test_A6_manual_link_needs_credentials(anon):
    assert anon.post("/complaints/E-00001/link", json={"customer_id": "C-0001"}).status_code in REFUSED


@finding(1, "cross-origin requests are allowed from any website")
def test_A7_unknown_origin_is_not_allowed(anon):
    r = anon.options("/complaints", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") not in ("*", "https://evil.example")


@finding(15, "API docs are public")
@pytest.mark.parametrize("path", ["/docs", "/openapi.json", "/redoc"])
def test_A9_api_docs_are_not_public(anon, path):
    assert anon.get(path).status_code in (*REFUSED, 404)


def test_live_batch_runs_stay_off_by_default(client):
    assert client.post("/runs", json={"mode": "live"}).status_code == 403


# ================================================================ B. identity and ranking
@finding(3, "a customer login typed into a public request is trusted")
def test_B1_claimed_login_is_not_proof_of_identity(anon, customers):
    victim = customers[5]
    c = anon.post("/complaints", json={"text": "refund not received", "user_id": victim["chat_user_id"]}).json()["complaint"]
    assert c["customer_id"] != victim["id"]


@finding(3, "an order ID alone links a complaint to the order's owner as verified")
def test_B2_order_id_alone_is_not_a_verified_link(anon, orders):
    o = orders[10]
    c = anon.post("/complaints", json={"text": "refund not received", "order_id": o["order_id"]}).json()["complaint"]
    assert not (c["customer_id"] == o["customer_id"] and c["order_status"] == "verified")


@finding(4, "40 complaints under other customers' logins put a made-up issue at rank 1")
def test_B4_ranking_cannot_be_inflated_with_claimed_logins(anon, customers):
    text = "Competitor QuickMart is cheaper, BasketNow overcharged me and took my money, total fraud. vbnm hjkl"
    key = None
    for c in customers[40:80]:
        r = anon.post("/complaints", json={"text": text, "user_id": c["chat_user_id"]})
        if r.status_code == 200:
            key = r.json()["result"].get("issue") or key
    top10 = [i["key"] for i in anon.get("/issues/top").json()["issues"]]
    assert key is None or key not in top10


@finding(4, "no rate limit per sender")
def test_B5_one_sender_is_rate_limited(anon):
    codes = [anon.post("/complaints", json={"text": f"refund not received {i}", "email": "flood@example.com"}).status_code
             for i in range(40)]
    assert 429 in codes


def test_unknown_order_id_is_never_a_link(client):
    c = client.post("/complaints", json={"text": "refund not received", "order_id": "BN-000000-0"}).json()["complaint"]
    assert c["customer_id"] is None and c["order_status"] == "failed_check"


# ================================================================ C. input validation
@finding(9, "empty text crashes with HTTP 500")
def test_C1_empty_text_is_rejected_cleanly(client):
    assert client.post("/complaints", json={"text": ""}).status_code == 422


@finding(9, "whitespace-only text is stored as a complaint")
def test_C2_blank_text_is_rejected(client, query):
    before = query("SELECT COUNT(*) FROM complaints")[0][0]
    assert client.post("/complaints", json={"text": "   \n  "}).status_code == 422
    assert query("SELECT COUNT(*) FROM complaints")[0][0] == before


@finding(9, "no limit on complaint length")
def test_C3_oversized_text_is_rejected(client):
    assert client.post("/complaints", json={"text": "refund " * 200_000}).status_code in (413, 422)


@finding(9, "channel accepts any string, including markup")
def test_C4_unknown_channel_is_rejected(client):
    r = client.post("/complaints", json={"text": "refund not received", "channel": "<script>alert(1)</script>"})
    assert r.status_code == 422


@finding(10, "limit=-1 returns every row")
def test_C5_negative_page_size_cannot_bypass_the_cap(client):
    r = client.get("/complaints?limit=-1")
    assert r.status_code == 422 or len(r.json()) <= 1000


def test_C5_zero_page_size_returns_nothing(client):
    r = client.get("/complaints?limit=0")
    assert r.status_code == 422 or r.json() == []


def test_C5_page_size_is_capped_at_1000(client):
    assert len(client.get("/complaints?limit=999999").json()) == 1000


@finding(10, "n=-5 returns every issue")
def test_C6_top_n_cannot_be_negative(client):
    r = client.get("/issues/top?n=-5")
    assert r.status_code == 422 or len(r.json()["issues"]) <= 10


@finding(9, "wrong types in the webhook crash with HTTP 500")
@pytest.mark.parametrize("bad", [{"customer_utterances": [1, 2]}, {"ivr_choice": ["payments"]}, {"started_at": {"a": 1}},
                                 {"caller_number": ["x"]}])
def test_C7_webhook_with_wrong_types_is_rejected_cleanly(client, bad):
    assert client.post("/webhooks/call", json={**CALL, **bad}).status_code == 422


def test_C8_webhook_with_nothing_is_422(client):
    assert client.post("/webhooks/call", json={}).status_code == 422


@pytest.mark.parametrize("path", ["/complaints?settled=x' OR '1'='1", "/complaints?order_status=x' OR '1'='1"])
def test_C9_sql_injection_in_filters_returns_nothing(client, path):
    r = client.get(path)
    assert r.status_code == 200 and r.json() == []


def test_C9_sql_injection_in_path_and_segments(client):
    assert client.get("/complaints/x' OR '1'='1").status_code == 404
    r = client.get("/issues/top?state=x' OR '1'='1")
    assert r.status_code == 200 and r.json()["issues"] == []


def test_C10_unknown_heatmap_dimension_is_400(client):
    assert client.get("/segments/heatmap?dim=profile").status_code == 400


def test_unusual_characters_do_not_break_intake(client):
    r = client.post("/complaints", json={"text": "refund \u0000 nahi mila \U0001F621 ‮ ' \" ; --"})
    assert r.status_code == 200


# ================================================================ D. data integrity
@finding(8, "a crash mid-processing leaves a half-written complaint that the next request commits")
def test_D1_a_crash_leaves_no_half_written_complaint(client, query):
    client.post("/webhooks/call", json={**CALL, "ivr_choice": ["payments"]})     # crashes after the row is inserted, today
    client.post("/complaints", json={"text": "the app keeps crashing on my phone"})
    assert query("SELECT COUNT(*) FROM complaints WHERE settled IS NULL")[0][0] == 0


def test_D2_every_complaint_has_a_gate_record(client, query):
    for i in range(5):
        client.post("/complaints", json={"text": f"refund not received {i}"})
    assert query("SELECT COUNT(*) FROM complaints c LEFT JOIN gate g ON g.complaint_id=c.id WHERE g.complaint_id IS NULL")[0][0] == 0


def test_server_errors_do_not_leak_internals(client, monkeypatch):
    """A 500 must carry a request ID to quote, never a traceback or an exception message."""
    from app import api

    def boom(con):
        raise RuntimeError("secret internal detail /home/user/path")
    monkeypatch.setattr(api.metrics, "funnel", boom)
    r = client.get("/funnel")
    assert r.status_code == 500 and "secret" not in r.text and "Traceback" not in r.text
    assert r.json()["request_id"] == r.headers["x-request-id"]
