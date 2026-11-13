"""Provider factory. mode = "live" (Jev + LLM over OpenRouter) or "mock" (offline stand-ins).

Why one switch: a run is either all live or all mock, so its figures carry one clear label.
Not per-call fallback from live to mock: see http.py.
"""
from .embed import get_embedder
from .gate import JevGate
from .llm import OpenRouterLLM
from .mock import MockGate, MockLLM


def build(pack: dict, mode: str = "mock", embedder_choice: str | None = None):
    embedder = get_embedder(pack, embedder_choice)
    if mode == "live":
        return JevGate(pack), embedder, OpenRouterLLM(pack)
    return MockGate(pack, embedder), embedder, MockLLM(pack)
