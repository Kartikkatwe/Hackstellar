"""The LLM's jobs and their prompts: adjudicate an unsure match, name a new issue, decide
whether two issues are the same problem (Curator), and, for comparison only, the "LLM reads
every complaint" baseline prompt.

Why the component registry is the fixed prefix (Kartik's idea): it is identical for every
     complaint in that component, so the provider's prompt cache can bill it at the lower
     cache-read rate, and the LLM reads only issues that could be relevant.
Not the whole registry in every prompt: longer, dearer, and more wrong candidates to pick.
Why JSON-only replies checked against known keys: an invented issue key is treated as
     "new" instead of creating a phantom issue.
Why naming and merging are always the LLM's job (decided 13 Nov): these are judgements in
     words. Not rules or regex on complaint text: they break on the next phrasing.
"""
import json
import os
import re

from .http import post_json

URL = "https://openrouter.ai/api/v1/chat/completions"
ADJUDICATE_OUT_TOKENS = 60    # assumed reply sizes, used only when usage is estimated (mock)
NAME_OUT_TOKENS = 50
CURATE_OUT_TOKENS = 70
BASELINE_OUT_TOKENS = 90
# Why 1024 and low reasoning effort: Haiku 5.5 thinks before answering and the thinking counts
# against max_tokens. With a 120 cap, 59 of 66 verdicts in the first live run were cut off
# before the answer. Measured: effort "low" answers completely in ~60 tokens.
MAX_TOKENS = 1024
REASONING = {"effort": "low"}


def _registry(issues: list[dict], with_component: bool = False) -> str:
    lines = []
    for i in issues:
        tag = f" [{i['component']}]" if with_component else ""
        examples = " e.g. " + " | ".join(i["texts"][1:3]) if len(i.get("texts", [])) > 1 else ""
        lines.append(f"- {i['key']}{tag}: {i['title']}. {i['description']}{examples}")
    return "\n".join(lines) or "- (none yet)"


def adjudicator_prefix(pack: dict, component: str, issues: list[dict]) -> str:
    return (f"You triage customer complaints for {pack['name']} ({pack['domain']}).\n"
            f"Component: {component} - {pack['components'][component]}\n"
            f"Known issues in this component:\n{_registry(issues)}\n\n"
            "Decide whether the complaint describes the same underlying problem as one known issue. "
            "Different wording of the same problem is a match. A different problem in the same area is not.\n"
            'Reply with JSON only: {"issue": "<key, or new>", "reason": "<one short sentence>"}')


NAMING_RULES = ("Write the title as a neutral problem statement a product team would use, in English even if the "
                "complaints are in Hindi or Hinglish. Leave out greetings, emotion, threats, amounts, order IDs and "
                "customer details. Describe the problem, not one customer's story.")


def naming_prompt(pack: dict, component: str, texts: list[str]) -> str:
    listed = "\n".join(f"- {t}" for t in texts)
    return (f"These complaints to {pack['name']} ({component}) describe one problem that is not in the issue list yet:\n{listed}\n\n"
            f"Name it. {NAMING_RULES}\n"
            'Reply with JSON only: {"title": "<at most 8 words>", "description": "<one sentence>"}')


def curator_prompt(pack: dict, component: str, issue: dict, others: list[dict]) -> str:
    return (f"You keep the issue list for {pack['name']} ({pack['domain']}) free of duplicates.\n"
            f"Component: {component} - {pack['components'][component]}\n\n"
            f"Issue under review:\n{_registry([issue])}\n\nOther issues in this component:\n{_registry(others)}\n\n"
            "Is the issue under review the same underlying problem as one of the others? Same root cause or same "
            "fix means same problem, even if customers describe different symptoms of it. A different problem "
            "in the same area is not the same.\n"
            f"If it is the same, give a title and description for the combined issue. {NAMING_RULES}\n"
            'Reply with JSON only: {"same_as": "<key, or none>", "title": "<at most 8 words>", "description": "<one sentence>", "reason": "<one short sentence>"}')


def baseline_prefix(pack: dict, issues: list[dict]) -> str:
    """What a single LLM call would need to do the gate's and the matcher's job together.
    Why include every issue: with no cheap routing step, the LLM must see the full registry."""
    comps = "\n".join(f"- {k}: {v}" for k, v in pack["components"].items())
    return (f"You process customer complaints for {pack['name']} ({pack['domain']}).\n"
            "For the message decide: is it a complaint, which component, which known issue it matches (or new), "
            "impact 0-3, emotion 0-3, whether money was lost, whether there is legal or safety risk.\n"
            f"Components:\n{comps}\nKnown issues:\n{_registry(issues, with_component=True)}\n"
            'Reply with JSON only: {"is_complaint": bool, "component": str, "issue": str, "impact": int, '
            '"emotion": int, "money_lost": bool, "legal_risk": bool, "reason": str}')


def _json(text: str) -> dict:
    match = re.search(r"\{.*\}", text or "", re.S)
    try:
        return json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        return {}


class OpenRouterLLM:
    name = "openrouter"

    def __init__(self, pack: dict):
        self.pack, self.model = pack, pack["models"]["adjudicator"]
        self.key = os.environ["OPENROUTER_API_KEY"]

    def _chat(self, system: str, user: str, required: str) -> tuple[dict, dict]:
        """Returns ({} if unreadable, usage summed over attempts).
        Why one retry: a cut-off or malformed reply is rare once thinking has room, and a second
        try is cheaper than a wrong grouping. Not more: a persistent failure is a real fault."""
        total = dict(in_tokens=0, out_tokens=0, latency_s=0.0, estimated=False)
        reply = {}
        for _ in range(2):
            # temperature 0: the same input should get the same verdict on every run.
            data, secs = post_json(URL, self.key, {"model": self.model, "temperature": 0, "max_tokens": MAX_TOKENS, "reasoning": REASONING,
                                                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
            u = data.get("usage") or {}
            total["in_tokens"] += u.get("prompt_tokens", 0)
            total["out_tokens"] += u.get("completion_tokens", 0)
            total["latency_s"] += secs
            total["estimated"] = total["estimated"] or not u
            reply = _json(data["choices"][0]["message"].get("content") or "")
            if reply.get(required):
                break
        return reply, total

    def adjudicate(self, component: str, issues: list[dict], text: str, candidates: list[dict], mid: float | None = None) -> tuple[dict, dict]:
        """-> ({issue: key or None, reason}, usage). candidates and mid are unused here; the mock needs them."""
        reply, usage = self._chat(adjudicator_prefix(self.pack, component, issues), f"Complaint: {text}", "issue")
        key = reply.get("issue")
        known = {i["key"] for i in issues}
        reason = str(reply.get("reason") or "LLM reply unreadable after a retry; treated as new")[:200]
        return dict(issue=key if key in known else None, reason=reason), usage

    def name_issue(self, component: str, texts: list[str]) -> tuple[dict, dict]:
        reply, usage = self._chat("You name recurring customer problems concisely.", naming_prompt(self.pack, component, texts), "title")
        # Not complaint text as a fallback title: judges read these. A neutral placeholder is
        # honest, and the Curator pass gets another chance to name it.
        title = str(reply.get("title") or f"Unnamed {component.replace('_', ' ')} issue ({len(texts)} reports)")[:80]
        return dict(title=title, description=str(reply.get("description") or "Not yet named.")[:200], named=bool(reply.get("title"))), usage

    def curate(self, component: str, issue: dict, others: list[dict], **_) -> tuple[dict, dict]:
        """-> ({same_as: key or None, title, description, reason}, usage). Extra args are for the mock."""
        reply, usage = self._chat("You merge duplicate customer issues.", curator_prompt(self.pack, component, issue, others), "same_as")
        key = reply.get("same_as")
        known = {o["key"] for o in others}
        return dict(same_as=key if key in known else None, title=str(reply.get("title") or "")[:80],
                    description=str(reply.get("description") or "")[:200], reason=str(reply.get("reason") or "")[:200]), usage
