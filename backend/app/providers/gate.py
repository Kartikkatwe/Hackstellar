"""The gate: Jev answers several typed questions about one complaint in a single request.

Why a decision model: every judgement here is a pick-one, a rating or a yes/no. It returns
     probabilities (so an unsure answer can be passed on) and can only answer from the
     options given (so nothing downstream has to parse free text).
Not an LLM for this step: it would be paid to write, and none of these answers need writing.
Why questions are built from the pack: Jev takes its labels per request with no training,
     which is what lets one engine serve any business.
Not reordering options: Jev's probabilities shift with option order, so pack order is kept.

Response shape follows the AI/ML API docs example. It is unconfirmed on OpenRouter until
the account has credit, so a live run should be checked on a few complaints first.
"""
import json
import os

from ..config import est_tokens
from .http import post_json

URL = "https://openrouter.ai/api/alpha/decisions"


def build_questions(pack: dict) -> dict:
    g = pack["gate"]
    questions = {
        "is_complaint": {"type": "noul", "instructions": "Is the customer reporting a problem with the service? Praise, spam and general questions are not complaints."},
        "component": {"type": "choice", "instructions": f"Which area of the {pack['domain']} business is this about?", "criteria": dict(pack["components"])},
        "impact": {"type": "score", "instructions": "How badly is the customer affected?", "criteria": list(g["impact_levels"])},
        "emotion": {"type": "score", "instructions": "How upset does the customer sound?", "criteria": list(g["emotion_levels"])},
    }
    for flag, question in g["flags"].items():
        questions[flag] = {"type": "noul", "instructions": question}
    return questions


def verify_questions(candidates: list[dict]) -> dict:
    """One yes/no per candidate issue, all in one request so the complaint is billed once."""
    return {f"c{i}": {"type": "noul", "instructions": f"Is this complaint about the same underlying problem as: \"{c['title']}. {c['description']}\"?"}
            for i, c in enumerate(candidates)}


def request_tokens(text: str, questions: dict) -> int:
    return est_tokens(text) + est_tokens(json.dumps(questions, ensure_ascii=False))


class JevGate:
    name = "jev"

    def __init__(self, pack: dict):
        self.model = pack["models"]["gate"]
        self.key = os.environ["OPENROUTER_API_KEY"]
        self.questions = build_questions(pack)

    def _ask(self, text: str, questions: dict) -> tuple[dict, dict]:
        data, secs = post_json(URL, self.key, {"model": self.model, "state": text, "questions": questions})
        reported = (data.get("usage") or {}).get("input_tokens")
        usage = dict(in_tokens=reported or request_tokens(text, questions), out_tokens=0, latency_s=secs, estimated=reported is None)
        return data["answers"], usage

    def classify(self, text: str) -> dict:
        a, usage = self._ask(text, self.questions)
        comp = a["component"]
        return dict(is_complaint=float(a["is_complaint"]["noul"]), component=comp["choice"],
                    component_probs=comp.get("probabilities") or {comp["choice"]: 1.0},
                    impact=float(a["impact"]["score"]), emotion=float(a["emotion"]["score"]),
                    money_lost=float(a["money_lost"]["noul"]), legal_risk=float(a["legal_risk"]["noul"]), usage=usage)

    def verify(self, text: str, candidates: list[dict], mid: float | None = None) -> tuple[dict, dict]:
        """candidates: [{key, title, description, sim}] -> ({key: p_same_problem}, usage).
        mid is ignored here; only the mock needs it."""
        a, usage = self._ask(text, verify_questions(candidates))
        return {c["key"]: float(a[f"c{i}"]["noul"]) for i, c in enumerate(candidates)}, usage
