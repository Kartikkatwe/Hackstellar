"""Offline stand-ins for Jev and the LLM.

Why: the pipeline can be built, tested and demoed with no credit and no network (the
     fallback if the venue Wi-Fi fails). They never read the ground-truth labels.
Not a substitute for measuring Jev: a mock run shows how the funnel routes and what it
     would cost. Its accuracy says nothing about Jev's, and every report marks it "mock".
Why the component comes from embeddings and the rest from generic word lists: nothing here
     is specific to groceries, so a telecom pack works in mock mode with no extra work.
Why token counts are scaled by pack.jev_token_factor: AI/ML API's docs example bills 406
     tokens for a request that chars/4 puts at about 120. Using the higher figure keeps
     the mock from flattering Jev's cost.
"""
import math

import numpy as np

from ..config import est_tokens
from . import llm as prompts
from .gate import build_questions, request_tokens, verify_questions

PRAISE = ["love", "great", "thank you", "thanks for", "awesome", "polite", "five stars", "appreciated", "saved a lot",
          "accha hai", "keep it up", "good job", "super fast"]
QUESTION = ["do you", "can i", "how do i", "what time", "is there a", "which cities", "kya aap", "how can i"]
SPAM = ["click", "you have won", "earn rs", "claim here", "free phone", "congratulations"]
PROBLEM = [" not ", "n't", " never ", " no ", " nahi", "wrong", " late", "missing", "worst", "broken", "failed", "error", "still ",
           "again", "unable", "cannot", "problem", "complain", "galat", "kharab", "refund", "crash", "expired", "rude",
           "useless", "stuck", "twice", "delay", "damaged", "kat ga", "gayab", "band ho", "atak", "kam aaya", "der se",
           "bar bar", "nothing", "do baar"]
MONEY = ["debited", "deducted", "charged twice", "charged the full", "double charge", "billed twice", "duplicate charge",
         "kat gay", "kat gaya", "money has left", "is gone", "refund", "not returned", "wapas nahi", "i paid for", "was charged",
         "full price", "full amount", "less than what i paid", "extra money", "double payment", "do baar", "two debits",
         "took rs", "pure kate", "pura paisa", "deducted twice", "less money"]
LEGAL = ["consumer court", "fraud", "police", "food safety", "legal", "lawyer", "court", "fall sick", "food poisoning", "unsafe"]
BLOCKED = ["cannot", "can't", "unable", "never completes", "crash", "not placed", "never received", "not received", "nahi mila",
           "missing", "wrong", "did not arrive", "nahi ho raha", "band ho", "nahi aaya", "no way to", "does nothing", "not saved",
           "got nothing", "received nothing", "galat"]
INCONVENIENT = [" late", "delay", "wait", "retry", "times", "again", "loop", "slow", "der ", "bar bar", "callback", "call back"]
EMOTION = [  # checked strongest first
    (3, ["worst", "pathetic", "shame", "useless", "cheating", "never ordering", "bakwas", "done with this"]),
    (2, ["unacceptable", "immediately", "very angry", "very disappointed", "really bad", "galat hai", "resolved today", "what is going on"]),
    (1, ["frustrating", "not happy", "seriously", "keeps happening", "sort it out", "fix this soon", "jaldi"]),
]


def _hits(text: str, words: list[str]) -> int:
    return sum(w in text for w in words)


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


class MockGate:
    name = "mock"

    def __init__(self, pack: dict, embedder):
        self.pack, self.embedder, self.model = pack, embedder, pack["models"]["gate"]
        self.questions = build_questions(pack)
        self.factor = pack.get("jev_token_factor", 1.0)
        self.latency = pack["assumed_latency_s"]
        # Anchor each component with its description and its known issues, then pick the nearest.
        self.components = list(pack["components"])
        self.anchor_texts = {c: [pack["components"][c]] for c in self.components}
        for i in pack["seed_issues"]:
            self.anchor_texts[i["component"]] += [f"{i['title']}. {i['description']}"] + list(i.get("examples", []))
        self.anchors = None   # embedded lazily, after the hash embedder has learned its IDF

    def _usage(self, text: str, questions: dict, stage: str) -> dict:
        return dict(in_tokens=round(request_tokens(text, questions) * self.factor), out_tokens=0,
                    latency_s=self.latency[stage], estimated=True)

    def classify(self, text: str) -> dict:
        if self.anchors is None:
            self.anchors = {c: self.embedder.encode(t) for c, t in self.anchor_texts.items()}
        vec = self.embedder.encode([text])[0]
        sims = np.array([float((self.anchors[c] @ vec).max()) for c in self.components])
        probs = np.exp((sims - sims.max()) * 12)
        probs /= probs.sum()
        low = f" {text.lower()} "
        money = 0.9 if _hits(low, MONEY) else (0.3 if (" rs " in low or "paid" in low) else 0.04)
        legal = 0.93 if _hits(low, LEGAL) else 0.03
        emotion = next((level for level, words in EMOTION if _hits(low, words)), 0)
        base = 3 if (money >= 0.9 or legal >= 0.9) else 2 if _hits(low, BLOCKED) else 1 if _hits(low, INCONVENIENT) else 0
        is_complaint = _sigmoid(0.4 + 1.2 * min(_hits(low, PROBLEM), 3) - 2.2 * (_hits(low, PRAISE) + _hits(low, QUESTION) + _hits(low, SPAM)))
        best = int(probs.argmax())
        return dict(is_complaint=is_complaint, component=self.components[best],
                    component_probs={c: float(p) for c, p in zip(self.components, probs)},
                    impact=min(3.0, base + 0.3 * emotion / 3), emotion=float(emotion), money_lost=money, legal_risk=legal,
                    usage=self._usage(text, self.questions, "gate"))

    def verify(self, text: str, candidates: list[dict], mid: float = 0.5) -> tuple[dict, dict]:
        """Simulated: a steep curve around the midpoint of the unsure band. Real Jev reads the
        issue description, so it adds information this cannot."""
        return ({c["key"]: _sigmoid((c["sim"] - mid) / 0.04) for c in candidates},
                self._usage(text, verify_questions(candidates), "verify"))


class MockLLM:
    name = "mock"

    def __init__(self, pack: dict):
        self.pack, self.model = pack, pack["models"]["adjudicator"]
        self.latency = pack["assumed_latency_s"]["llm"]

    def adjudicate(self, component: str, issues: list[dict], text: str, candidates: list[dict], mid: float = 0.5) -> tuple[dict, dict]:
        """Simulated verdict (nearest issue if above the band's midpoint). The token count is
        taken from the prompt a live call would send, so the cost estimate is realistic."""
        prompt = prompts.adjudicator_prefix(self.pack, component, issues) + text
        usage = dict(in_tokens=est_tokens(prompt), out_tokens=prompts.ADJUDICATE_OUT_TOKENS, latency_s=self.latency, estimated=True)
        top = candidates[0] if candidates else None
        if top and top["sim"] >= mid:
            return dict(issue=top["key"], reason="nearest known issue (simulated verdict)"), usage
        return dict(issue=None, reason="no known issue is close enough (simulated verdict)"), usage

    def name_issue(self, component: str, texts: list[str]) -> tuple[dict, dict]:
        usage = dict(in_tokens=est_tokens(prompts.naming_prompt(self.pack, component, texts)), out_tokens=prompts.NAME_OUT_TOKENS,
                     latency_s=self.latency, estimated=True)
        words = texts[0].split()
        # Not a real title: a placeholder made from the most central complaint until a live LLM names it.
        return dict(title=" ".join(words[:9]).rstrip(".,") + ("..." if len(words) > 9 else ""), description=texts[0][:200]), usage
