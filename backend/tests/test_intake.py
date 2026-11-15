"""Sending complaints in: the live endpoint and the voice webhook.
(Checklist sections D and G.)"""
from concurrent.futures import ThreadPoolExecutor

import pytest

CALL = {"call_id": "V-TEST", "customer_utterances": ["my refund never came and money was debited"],
        "started_at": "2026-11-14T10:00:00", "caller_number": "+910000000000"}


def send(client, text="refund not received for my cancelled order", **extra):
    return client.post("/complaints", json={"text": text, **extra})


def test_a_complaint_goes_through_and_returns_its_trail(client, query):
    r = send(client)
    assert r.status_code == 200
    body = r.json()
    assert body["complaint"]["id"] == "L-00001" and body["mode"] == "offline"
    assert body["gate"]["component"] in client.get("/config").json()["components"]
    assert body["events"][0]["stage"] == "gate"
    assert query("SELECT settled FROM complaints WHERE id='L-00001'")[0][0] == body["result"]["settled"]


def test_live_ids_count_up(client):
    assert [send(client).json()["complaint"]["id"] for _ in range(3)] == ["L-00001", "L-00002", "L-00003"]


def test_offline_models_are_always_labelled(client):
    """A stand-in answer must never pass for a live one."""
    assert send(client).json()["mode"] == "offline"
    assert client.get("/health").json()["live_complaints_use"] == "mock"


def test_hinglish_money_complaint_reaches_payments(client):
    r = send(client, "paise kat gaye lekin order nahi bana, please check").json()
    assert r["gate"]["component"] == "payments" and r["result"]["settled"] != "dropped"


def test_praise_is_set_aside_at_the_gate(client):
    r = send(client, "Love the 10 minute delivery, great job team!").json()
    assert r["result"]["settled"] == "dropped" and r["filed_under"] is None


def test_known_sender_is_linked_to_their_customer_record(client, customers):
    c = customers[0]
    r = send(client, email=c["email"], channel="email").json()["complaint"]
    assert (r["customer_id"], r["link_method"]) == (c["id"], "sender_email")


def test_unknown_sender_is_stored_unlinked(client):
    r = send(client, email="stranger@example.com", channel="email").json()["complaint"]
    assert r["customer_id"] is None and r["link_method"] == "unlinked"


def test_typed_order_id_with_a_typo_fails_the_check(client, orders):
    real = orders[0]["order_id"]                                  # BN-NNNNNN-C
    wrong = real[:-1] + str((int(real[-1]) + 1) % 10)
    r = send(client, f"refund not received for {wrong}").json()["complaint"]
    assert r["order_status"] == "failed_check" and r["customer_id"] is None


def test_unknown_order_id_is_not_a_link(client):
    r = send(client, order_id="BN-000000-0").json()["complaint"]
    assert r["order_status"] == "failed_check" and r["customer_id"] is None


def test_one_person_sending_three_reports_does_not_create_an_issue(client):
    """PS-19 counts people, not messages: an issue needs three different people."""
    text = "the store near me shows as closed in the app but it is open qzx"
    results = [send(client, text, user_id="same_person").json()["result"]["settled"] for _ in range(3)]
    assert "new_issue" not in results


def test_three_different_people_create_a_new_issue(client):
    text = "the store near me shows as closed in the app but it is open qzx"
    before = len(client.get("/issues/top?n=500").json()["issues"])
    results = [send(client, text, user_id=f"person{i}").json()["result"] for i in range(3)]
    assert results[-1]["settled"] == "new_issue"
    assert len(client.get("/issues/top?n=500").json()["issues"]) == before + 1


def test_manual_link_updates_the_complaint(client, customers):
    cid = send(client, email="stranger@example.com", channel="email").json()["complaint"]["id"]
    assert client.post(f"/complaints/{cid}/link", json={"customer_id": customers[3]["id"]}).json() == {"linked": True}
    c = client.get(f"/complaints/{cid}").json()["complaint"]
    assert (c["customer_id"], c["link_method"]) == (customers[3]["id"], "manual")


def test_manual_link_to_an_unknown_customer_is_404(client):
    cid = send(client).json()["complaint"]["id"]
    assert client.post(f"/complaints/{cid}/link", json={"customer_id": "C-9999"}).status_code == 404


# ---------------------------------------------------------------- voice webhook
def test_voice_webhook_files_a_call(client):
    r = client.post("/webhooks/call", json=CALL)
    assert r.status_code == 200 and r.json()["complaint"]["channel"] == "call"


def test_voice_webhook_links_a_known_caller(client, customers):
    r = client.post("/webhooks/call", json={**CALL, "caller_number": customers[1]["phone"]}).json()["complaint"]
    assert (r["customer_id"], r["link_method"]) == (customers[1]["id"], "caller_number")


def test_voice_webhook_without_required_fields_is_422(client):
    assert client.post("/webhooks/call", json={}).status_code == 422


def test_missing_text_is_422(client):
    assert client.post("/complaints", json={"channel": "chat"}).status_code == 422


# ---------------------------------------------------------------- integrity under concurrency
def test_fifty_complaints_at_once_are_all_stored_once(client, query):
    """Checklist D3 in miniature (the full 2,000-complaint run is in loadtest/)."""
    with ThreadPoolExecutor(20) as pool:
        codes = list(pool.map(lambda i: send(client, f"refund not received, attempt {i}").status_code, range(50)))
    assert codes == [200] * 50
    total, unique = query("SELECT COUNT(*), COUNT(DISTINCT id) FROM complaints WHERE id LIKE 'L-%'")[0]
    assert total == unique == 50
    assert query("SELECT COUNT(*) FROM complaints WHERE settled IS NULL")[0][0] == 0
    assert query("SELECT COUNT(*) FROM complaints c LEFT JOIN gate g ON g.complaint_id=c.id WHERE g.complaint_id IS NULL")[0][0] == 0


# ---------------------------------------------------------------- batch runs
def test_live_batch_run_is_refused_unless_enabled(client):
    assert client.post("/runs", json={"mode": "live"}).status_code == 403
