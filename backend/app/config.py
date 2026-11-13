"""Loads .env and one domain pack, and holds the token and price arithmetic.

Why: the pack is the only place that knows which business is being served, so switching
     grocery to telecom is a config change, not a code change.
Not: constants spread across modules, which is what ties a prototype to one domain.
"""
import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def load_env(path: Path = ROOT / ".env") -> None:
    # Not python-dotenv: one less dependency for a ten-line job.
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def load_pack(name: str | None = None) -> dict:
    load_env()
    name = name or os.environ.get("PACK", "grocery")
    pack = yaml.safe_load((ROOT / "packs" / name / "pack.yaml").read_text(encoding="utf-8"))
    pack["id"] = name
    pack["data_path"] = ROOT / pack["data_dir"]
    return pack


def est_tokens(text: str) -> int:
    """Rough token count, used only when a provider did not report real usage.
    Why chars/4: the usual rule of thumb for English. Not a tokenizer library: each model
    has its own, and live runs replace this with the provider's real count anyway."""
    return max(1, (len(text) + 3) // 4)


def cost_usd(pack: dict, model: str, in_tokens: int, out_tokens: int = 0, cached_tokens: int = 0) -> float:
    """List-price cost. cached_tokens is the part of in_tokens billed at the cache-read rate."""
    p = pack["prices_usd_per_million"][model]
    fresh = in_tokens - cached_tokens
    return (fresh * p["input"] + cached_tokens * p.get("cache_read", p["input"]) + out_tokens * p.get("output", 0.0)) / 1e6
