"""The LLM's three jobs and their prompts: adjudicate an unsure match, name a new issue,
and (for comparison only) the "LLM reads every complaint" baseline prompt.

Why the component registry is the fixed prefix (Kartik's idea): it is identical for every
     complaint in that component, so the provider's prompt cache can bill it at the lower
     cache-read rate, and the LLM reads only issues that could be relevant.
Not the whole registry in every prompt: longer, dearer, and more wrong candidates to pick.
Why JSON-only replies checked against known keys: an invented issue key is treated as
     "new" instead of creating a phantom issue.
"""
import json
import os
import re

from .http import post_json

URL = "https://openrouter.ai/api/v1/chat/completions"
ADJUDICATE_OUT_TOKENS = 40    # assumed reply sizes, used only when usage is estimated
NAME_OUT_TOKENS = 50
BASELINE_OUT_TOKENS = 90


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


def naming_prompt(pack: dict, component: str, texts: list[str]) -> str:
    listed = "\n".join(f"- {t}" for t in texts)
    return (f"These complaints to {pack['name']} ({component}) describe one problem that is not in the issue list yet:\n{listed}\n\n"
            'Name it. Reply with JSON only: {"title": "<at most 8 words>", "description": "<one sentence>"}')


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

    def _chat(self, system: str, user: str, max_tokens: int) -> tuple[dict, dict]:
        # temperature 0: the same complaint should get the same verdict on every run.
        data, secs = post_json(URL, self.key, {"model": self.model, "temperature": 0, "max_tokens": max_tokens,
                                               "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
        u = data.get("usage") or {}
        usage = dict(in_tokens=u.get("prompt_tokens", 0), out_tokens=u.get("completion_tokens", 0), latency_s=secs, estimated=not u)
        return _json(data["choices"][0]["message"]["content"]), usage

    def adjudicate(self, component: str, issues: list[dict], text: str, candidates: list[dict], mid: float | None = None) -> tuple[dict, dict]:
        """-> ({issue: key or None, reason}, usage). candidates and mid are unused here; the mock needs them."""
        reply, usage = self._chat(adjudicator_prefix(self.pack, component, issues), f"Complaint: {text}", 120)
        key = reply.get("issue")
        known = {i["key"] for i in issues}
        return dict(issue=key if key in known else None, reason=str(reply.get("reason", ""))[:200]), usage

    def name_issue(self, component: str, texts: list[str]) -> tuple[dict, dict]:
        reply, usage = self._chat("You name recurring customer problems concisely.", naming_prompt(self.pack, component, texts), 120)
        title = str(reply.get("title") or texts[0])[:80]
        return dict(title=title, description=str(reply.get("description") or texts[0])[:200]), usage
