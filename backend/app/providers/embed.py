"""Embedders: turn complaint text into a vector so "same problem, different words" can be
measured as a similarity score with no model call per comparison.

StEmbedder    local multilingual sentence model (chosen 13 Nov): free, offline, copes with Hinglish.
HashEmbedder  word + character n-gram TF-IDF in pure numpy. Fallback when PyTorch cannot load
              (this machine lacked the Visual C++ runtime). Catches shared words, not meaning.

Not an embedding API: costs credit and adds a network dependency to every complaint.
Not silently mixing the two: cut-offs differ per embedder (pack thresholds.st / .hash) and
the embedder's name is saved with the run, so results are never mislabelled.
"""
import math
import os
import re
import sys
import zlib
from collections import Counter

import numpy as np

# Function words carry no complaint meaning; negations (not, no, nahi) are kept on purpose.
STOP = set("the a an is are was were i my me you your it to of and in on for at this that have has had be been with but so "
           "please hi hello team rs ka ki ke ko hai tha thi se par bhi ho kar aur ye wo".split())


class _Cached:
    """Why a cache: each complaint is embedded once but compared at several stages."""
    def __init__(self):
        self._cache: dict[str, np.ndarray] = {}

    def encode(self, texts: list[str]) -> np.ndarray:
        missing = [t for t in dict.fromkeys(texts) if t not in self._cache]
        if missing:
            for t, v in zip(missing, self._encode(missing)):
                self._cache[t] = v
        return np.stack([self._cache[t] for t in texts])

    def fit(self, texts: list[str]) -> None:   # only the hash embedder learns from the corpus
        pass


class StEmbedder(_Cached):
    name = "st"

    def __init__(self, model: str):
        super().__init__()
        # Why: PyTorch needs Microsoft's C++ runtime, which this machine lacks system-wide.
        # The msvc-runtime pip package puts those (Microsoft-signed) DLLs in the venv; this
        # line lets Windows find them. Not a system-wide installer: needs admin rights.
        if os.name == "nt":
            for folder in (sys.prefix, os.path.join(sys.prefix, "Scripts")):
                if os.path.exists(os.path.join(folder, "msvcp140.dll")):
                    os.add_dll_directory(folder)
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        from sentence_transformers import SentenceTransformer   # imported here so a broken torch only breaks this class
        try:
            # Why local first: once downloaded, the model must load with no internet (venue Wi-Fi risk).
            self.model = SentenceTransformer(model, local_files_only=True)
        except Exception:
            self.model = SentenceTransformer(model)             # first run: download (about 470 MB)

    def _encode(self, texts):
        return self.model.encode(texts, normalize_embeddings=True, batch_size=64, show_progress_bar=False).astype(np.float32)


class HashEmbedder(_Cached):
    name = "hash"
    dim = 1 << 14   # 16,384 buckets: few collisions at this vocabulary size; 32k doubled memory for no gain

    def __init__(self):
        super().__init__()
        self.idf = None

    def _features(self, text: str) -> Counter:
        # Why drop digits: amounts and order IDs differ per customer and say nothing about the problem.
        words = [w for w in re.sub(r"[^a-z ]+", " ", text.lower()).split() if w not in STOP]
        feats = Counter()
        for w in words:
            feats["w:" + w] += 2          # whole words outweigh fragments
            padded = f"<{w}>"
            for n in (3, 4, 5):           # fragments absorb typos and inflections (charged / charge / charges)
                for i in range(len(padded) - n + 1):
                    feats["c:" + padded[i:i + n]] += 1
        for a, b in zip(words, words[1:]):
            feats["b:" + a + " " + b] += 2
        return feats

    def _bucket(self, feature: str) -> int:
        # Not Python's hash(): it is salted per process, so vectors would change between runs.
        return zlib.crc32(feature.encode()) % self.dim

    def fit(self, texts):
        """Learn IDF so rare, telling words outweigh common ones. Unsupervised: uses no labels."""
        df = np.zeros(self.dim, dtype=np.float32)
        for t in texts:
            df[list({self._bucket(f) for f in self._features(t)})] += 1
        self.idf = (np.log((len(texts) + 1) / (df + 1)) + 1).astype(np.float32)
        self._cache.clear()

    def _encode(self, texts):
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, t in enumerate(texts):
            for f, n in self._features(t).items():
                out[row, self._bucket(f)] += 1 + math.log(n)
            if self.idf is not None:
                out[row] *= self.idf
            norm = np.linalg.norm(out[row])
            if norm:
                out[row] /= norm
        return out


class HybridEmbedder:
    """Sentence model + word matching in one vector ("hybrid search").
    Why: measured on the 1,030 complaints about known issues, nearest-issue accuracy was
         80% for the sentence model, 84% for word matching and 91% for both together. The
         sentence model misses romanised Hindi and near-synonym issues; word matching
         misses paraphrases. Their mistakes differ, so they correct each other.
    Not either alone, and not a bigger sentence model: slower on a laptop CPU, a larger
         download, and still weak on Hinglish in Latin script.
    Why concatenation: the dot product of [sqrt(w)*dense, sqrt(1-w)*sparse] equals
         w*dense_sim + (1-w)*sparse_sim, so the rest of the engine needs no changes."""
    name = "hybrid"

    def __init__(self, dense: "StEmbedder", weight: float = 0.5):
        self.dense, self.sparse, self.w = dense, HashEmbedder(), weight

    def fit(self, texts):
        self.sparse.fit(texts)

    def encode(self, texts):
        return np.hstack([np.sqrt(self.w) * self.dense.encode(texts), np.sqrt(1 - self.w) * self.sparse.encode(texts)])


_LOADED: dict[str, StEmbedder] = {}   # the model takes seconds to load; tune.py and the API reuse one copy


def get_embedder(pack: dict, choice: str | None = None):
    """choice: hybrid | st | hash | auto (default; env EMBEDDER). auto = hybrid if the sentence model loads, else hash."""
    choice = choice or os.environ.get("EMBEDDER", "auto")
    if choice in ("st", "hybrid", "auto"):
        model = pack["models"]["embedder"]
        try:
            if model not in _LOADED:
                _LOADED[model] = StEmbedder(model)
            return _LOADED[model] if choice == "st" else HybridEmbedder(_LOADED[model], pack["models"].get("hybrid_dense_weight", 0.5))
        except (ImportError, OSError) as e:
            if choice != "auto":
                raise
            print(f"[embed] sentence model unavailable ({str(e).splitlines()[0][:90]}); using hash embedder")
    return HashEmbedder()
