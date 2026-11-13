"""Identity resolution: which customer sent this complaint?

Why: PS-19 asks to count affected customers, not messages, and to break results down by
     customer group. Both need each complaint tied to a CRM record.
Not guessing age, state or student status from complaint text: it is unreliable and the
     statement says "using available customer data".

Order of trust (decided 12 Nov, see DECISIONS.md):
  1. channel-native identifier  chat login > caller number > sender email > linked handle
  2. order ID captured at source (voice agent / chatbot asked for it and verified it)
  3. order ID typed in an email or post: regex proposes, we accept only if the check digit
     is valid, the order exists, and one more signal agrees
A typed ID never overrides a channel-native identifier.
"""
from .. import orderid

NATIVE = (  # (complaint field, CRM field, method, confidence)
    ("user_id", "chat_user_id", "chat_login", 1.0),
    ("phone", "phone", "caller_number", 0.95),
    ("email", "email", "sender_email", 0.95),
    ("handle", "social_handle", "linked_handle", 0.8),
)


class Identity:
    def __init__(self, pack: dict, customers: list[dict], orders: list[dict]):
        self.prefix, self.digits = pack["order_id"]["prefix"], pack["order_id"]["digits"]
        self.index = {field: {str(c[crm]).lower(): c["id"] for c in customers if c.get(crm)} for field, crm, _, _ in NATIVE}
        self.orders = {o["order_id"]: o for o in orders}
        # Why: once a handle is tied to a customer through an order ID, later posts from that
        # handle link automatically ("DM us your order ID" made systematic).
        self.learned_handles: dict[str, str] = {}

    def link_handle(self, handle: str, customer_id: str) -> None:
        """Staff linked a handle by hand; remember it."""
        self.learned_handles[handle.lower()] = customer_id

    def resolve(self, c: dict) -> dict:
        cust, method, conf = None, "unlinked", 0.0
        for field, _, m, cf in NATIVE:
            value = c.get(field)
            if value and str(value).lower() in self.index[field]:
                cust, method, conf = self.index[field][str(value).lower()], m, cf
                break
        if not cust and c.get("handle") in self.learned_handles:
            cust, method, conf = self.learned_handles[c["handle"]], "learned_handle", 0.75

        order_id, status = None, "none"   # none | verified | failed_check | other_account
        if c.get("order_id"):             # captured at source
            order = self.orders.get(c["order_id"])
            if order:
                order_id, status = c["order_id"], "verified"
                if not cust:              # e.g. call from an unknown number, but the agent verified the order
                    cust, method, conf = order["customer_id"], "order_at_source", 0.9
            else:
                order_id, status = c["order_id"], "failed_check"
        else:
            for oid, check_ok in orderid.find(c.get("scan") or c["text"], self.prefix, self.digits):
                order = self.orders.get(oid) if check_ok else None
                if not order:             # typo (check digit fails) or no such order
                    order_id, status = oid, "failed_check"
                    continue
                if cust and order["customer_id"] != cust:
                    # Why keep the native link: "my mom's order" should not move the complaint to her.
                    order_id, status = oid, "other_account"
                    continue
                if not cust:
                    # The one extra signal available for an unknown sender: the order predates the complaint.
                    if order["date"] > c["created_at"][:10]:
                        order_id, status = oid, "failed_check"
                        continue
                    cust, method, conf = order["customer_id"], "order_in_text", 0.7
                    if c.get("handle"):
                        self.learned_handles[c["handle"]] = cust
                order_id, status = oid, "verified"
                break
        return dict(customer_id=cust, link_method=method, link_conf=conf, order_id=order_id, order_status=status)
