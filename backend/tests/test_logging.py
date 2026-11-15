"""Logging: what must be recorded, and what must never be (see app/log.py)."""
import logging

import pytest

from app import log

SECRET_TEXT = "my card 4111 was charged twice zebra-marker"
SECRET_EMAIL = "private.person@example.com"


@pytest.fixture
def lines(caplog):
    caplog.set_level(logging.DEBUG, logger="cc")
    return lambda: [f"{r.levelname} {r.name} {r.getMessage()}" for r in caplog.records if r.name.startswith("cc")]


def test_every_response_carries_a_request_id(client):
    a, b = client.get("/health"), client.get("/health")
    assert len(a.headers["x-request-id"]) == 8 and a.headers["x-request-id"] != b.headers["x-request-id"]


def test_a_write_is_logged_with_method_path_status_and_time(client, lines):
    client.post("/complaints", json={"text": "refund not received"})
    line = next(l for l in lines() if "cc.request" in l and "path=/complaints" in l)
    assert line.startswith("INFO") and "method=POST" in line and "status=200" in line and " ms=" in line


def test_a_complaint_is_logged_by_id_and_outcome(client, lines):
    r = client.post("/complaints", json={"text": "refund not received"}).json()
    line = next(l for l in lines() if "cc.funnel" in l and "event=complaint" in l)
    assert f"complaint={r['complaint']['id']}" in line and f"settled={r['result']['settled']}" in line and "mode=offline" in line


def test_complaint_text_and_sender_are_never_logged(client, lines):
    """Complaints are personal data. Log lines carry IDs only."""
    client.post("/complaints", json={"text": SECRET_TEXT, "email": SECRET_EMAIL, "phone": "+919999900000", "channel": "email"})
    client.post("/webhooks/call", json={"call_id": "V-1", "customer_utterances": [SECRET_TEXT], "started_at": "2026-11-14T10:00:00",
                                         "caller_number": "+919999900000"})
    everything = "\n".join(lines())
    assert everything and all(s not in everything for s in ("zebra-marker", "4111", SECRET_EMAIL, "+919999900000"))


def test_query_strings_are_not_logged(client, lines):
    client.get("/complaints?settled=secret-filter-value")
    assert "secret-filter-value" not in "\n".join(lines())


def test_successful_reads_are_quiet_but_recorded_at_debug(client, lines):
    client.get("/funnel")
    line = next(l for l in lines() if "path=/funnel" in l)
    assert line.startswith("DEBUG")           # the dashboard polls this every second


def test_a_crash_is_logged_with_its_traceback(client, caplog, monkeypatch):
    from app import api

    def boom(con):
        raise RuntimeError("boom-marker")
    monkeypatch.setattr(api.metrics, "funnel", boom)
    caplog.set_level(logging.DEBUG, logger="cc")
    r = client.get("/funnel")
    record = next(x for x in caplog.records if "event=unhandled_error" in x.getMessage())
    assert record.levelno == logging.ERROR and "status=500" in record.getMessage()
    assert record.exc_info and "boom-marker" in str(record.exc_info[1])    # full detail in the log, none in the response
    assert "boom-marker" not in r.text


def test_a_refused_action_is_logged_as_a_security_event(client, lines):
    client.post("/runs", json={"mode": "live"})
    got = [l for l in lines() if "cc.security" in l]
    assert any("event=live_run_refused" in l for l in got)
    assert any("status=403" in l and l.startswith("WARNING") for l in got)


def test_admin_actions_are_logged(client, lines, customers):
    from conftest import wait_for_batch
    client.post("/complaints/E-00001/link", json={"customer_id": customers[0]["id"]})
    client.post("/runs", json={"mode": "mock", "limit": 5})
    wait_for_batch()
    got = "\n".join(l for l in lines() if "cc.admin" in l)
    assert f"event=manual_link complaint=E-00001 customer={customers[0]['id']}" in got
    assert "event=run_started mode=mock limit=5" in got and "event=run_finished" in got


def test_not_found_is_logged(client, lines):
    client.get("/complaints/NOPE")
    assert any("status=404" in l and l.startswith("INFO") for l in lines())


def test_log_values_cannot_forge_extra_lines():
    """A value with a line break must not start a new, fake log line."""
    out = log.kv(event="x", detail="first\n2026-01-01 INFO cc.admin event=fake")
    assert "\n" not in out and out.startswith('event=x detail="first ')


def test_log_file_failure_does_not_stop_the_api(tmp_path, monkeypatch):
    """On Vercel the function's own folder is read-only."""
    blocked = tmp_path / "file-not-dir"
    blocked.write_text("x")
    monkeypatch.setenv("LOG_TO_FILE", "1")
    monkeypatch.setenv("LOG_FILE", str(blocked / "app.log"))
    monkeypatch.setattr(log, "_ready", False)
    root = logging.getLogger("cc")
    before = list(root.handlers)
    try:
        assert log.setup() is root                       # no exception
    finally:
        for h in root.handlers[:]:
            if h not in before:
                root.removeHandler(h)
        monkeypatch.setattr(log, "_ready", True)
