"""The small parts on their own: order IDs, identity rules, the embedder, cost arithmetic."""
import numpy as np
import pytest

from app import orderid
from app.config import cost_usd, est_tokens, load_pack
from app.pipeline.identity import Identity
from app.providers.embed import HashEmbedder

PACK = load_pack()


# ---------------------------------------------------------------- order IDs (Luhn check digit)
def test_check_digit_matches_the_worked_example():
    assert orderid.luhn_digit("375660") == "8"          # the example in HOW_IT_WORKS.md
    assert orderid.make("BN", 375660) == "BN-375660-8"


@pytest.mark.parametrize("typed", ["BN-375660-8", "bn 375660 8", "BN375660-8", "Order BN-375660-8 please"])
def test_order_id_found_however_it_is_typed(typed):
    assert orderid.find(typed, "BN") == [("BN-375660-8", True)]


def test_single_digit_typo_fails_the_check():
    for pos in range(6):
        digits = list("375660")
        digits[pos] = str((int(digits[pos]) + 1) % 10)
        (found, ok), = orderid.find(f"BN-{''.join(digits)}-8", "BN")
        assert not ok, f"typo at position {pos} was accepted as {found}"


def test_text_without_an_order_id_finds_nothing():
    assert orderid.find("my order of 375660 rupees never came", "BN") == []


# ---------------------------------------------------------------- identity
CUSTOMERS = [dict(id="C-1", name="A", email="a@x.com", phone="+911", chat_user_id="u_1", social_handle="@a"),
             dict(id="C-2", name="B", email="b@x.com", phone="+912", chat_user_id="u_2", social_handle=None)]
ORDERS = [dict(order_id=orderid.make("BN", 111111), customer_id="C-1", date="2026-11-01"),
          dict(order_id=orderid.make("BN", 222222), customer_id="C-2", date="2026-11-01")]
O1, O2 = ORDERS[0]["order_id"], ORDERS[1]["order_id"]


def ident(**c):
    c.setdefault("text", "refund not received")
    c.setdefault("created_at", "2026-11-10T10:00:00")
    return Identity(PACK, CUSTOMERS, ORDERS).resolve(c)


@pytest.mark.parametrize("field,value,method", [("user_id", "u_1", "chat_login"), ("phone", "+911", "caller_number"),
                                                ("email", "A@X.com", "sender_email"), ("handle", "@a", "linked_handle")])
def test_channel_identifier_links_the_customer(field, value, method):
    r = ident(**{field: value})
    assert (r["customer_id"], r["link_method"]) == ("C-1", method)


def test_unknown_sender_stays_unlinked():
    r = ident(email="nobody@x.com")
    assert r["customer_id"] is None and r["link_method"] == "unlinked" and r["order_status"] == "none"


def test_typed_order_id_links_an_unknown_sender():
    r = ident(email="nobody@x.com", text=f"refund for {O1} please")
    assert (r["customer_id"], r["link_method"], r["order_status"]) == ("C-1", "order_in_text", "verified")


def test_typed_order_id_never_overrides_the_channel_identifier():
    r = ident(email="a@x.com", text=f"this is about my mother's order {O2}")
    assert r["customer_id"] == "C-1" and r["order_status"] == "other_account"


def test_typo_in_typed_order_id_is_a_failed_check_not_a_link():
    r = ident(email="nobody@x.com", text="refund for BN-111112-9 please")
    assert r["customer_id"] is None and r["order_status"] == "failed_check"


def test_order_dated_after_the_complaint_does_not_link():
    r = ident(email="nobody@x.com", text=f"refund for {O1}", created_at="2026-10-01T10:00:00")
    assert r["customer_id"] is None and r["order_status"] == "failed_check"


def test_handle_is_remembered_after_one_verified_order_id():
    i = Identity(PACK, CUSTOMERS, ORDERS)
    i.resolve(dict(handle="@new", text=f"order {O2} never arrived", created_at="2026-11-10T10:00:00"))
    later = i.resolve(dict(handle="@new", text="still nothing", created_at="2026-11-11T10:00:00"))
    assert (later["customer_id"], later["link_method"]) == ("C-2", "learned_handle")


# ---------------------------------------------------------------- embedder
def test_hash_embedder_is_deterministic_and_unit_length():
    a, b = HashEmbedder(), HashEmbedder()
    texts = ["money debited but order not placed", "paise kat gaye lekin order nahi bana"]
    va, vb = a.encode(texts), b.encode(texts)
    assert np.array_equal(va, vb)                       # same vectors in a new process: crc32, not hash()
    assert np.allclose(np.linalg.norm(va, axis=1), 1.0, atol=1e-5)


def test_similar_complaints_score_higher_than_unrelated_ones():
    e = HashEmbedder()
    v = e.encode(["I was charged twice for one order", "charged two times for a single order", "the delivery partner was rude"])
    assert v[0] @ v[1] > v[0] @ v[2]


def test_amounts_and_ids_do_not_change_the_vector():
    e = HashEmbedder()
    v = e.encode(["refund of Rs 500 not received for BN-111111-4", "refund of Rs 9000 not received for BN-222222-8"])
    assert v[0] @ v[1] > 0.99


# ---------------------------------------------------------------- cost arithmetic
def test_token_estimate_is_about_four_characters_each():
    assert est_tokens("a" * 400) == 100 and est_tokens("") == 1


def test_cost_uses_list_prices_per_million_tokens():
    model = PACK["models"]["adjudicator"]
    p = PACK["prices_usd_per_million"][model]
    assert cost_usd(PACK, model, 1_000_000, 1_000_000) == pytest.approx(p["input"] + p["output"])
    assert cost_usd(PACK, model, 0, 0) == 0
