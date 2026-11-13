"""The funnel. Each complaint passes through checks ordered cheapest first; every check
either settles it or passes it on:

  gate (Jev) -> similarity match -> verify (Jev yes/no) -> adjudicate (LLM) -> buffer

Why this order: a complaint costs only as much as it needs. Most repeat a known problem and
     settle on a similarity score; the LLM sees only what the cheaper checks could not decide.
Not one LLM call per complaint: that is the baseline this design is measured against.
Why issues live in a per-component registry: "the same problem" gets a fixed identity to
     count customers against, and each comparison is limited to a small relevant set.
"""
import json
from collections import defaultdict

import numpy as np

from ..config import cost_usd, est_tokens
from ..providers import llm as prompts

# Why a cap: exemplars learned from past verdicts widen what an issue matches; unlimited
# growth would let one wrong verdict drag an issue towards a different problem.
EXEMPLAR_CAP = 25


class BudgetExceeded(RuntimeError):
    pass


class Engine:
    def __init__(self, pack, con, gate, embedder, llm, identity, learn: bool = True):
        self.pack, self.con, self.gate, self.embedder, self.llm, self.identity, self.learn = pack, con, gate, embedder, llm, identity, learn
        t = pack["thresholds"]
        # Similarity cut-offs are per embedder: a 0.7 from the sentence model and from the hash model mean different things.
        self.t = {**{k: v for k, v in t.items() if not isinstance(v, dict)}, **t[embedder.name]}
        self.mid = (self.t["match_hi"] + self.t["match_lo"]) / 2
        self.issues: dict[int, dict] = {}
        self.by_component: dict[str, list[dict]] = defaultdict(list)
        self.buffer: dict[str, list[dict]] = defaultdict(list)   # unmatched complaints waiting to recur
        self.new_count = 0
        self._baseline_prefix = None
        # Why a hard cap: live runs spend real credit; a bug or a wrong cut-off must not drain it.
        self.budget_usd: float | None = None
        self.spent_usd = 0.0
        self._gate_cache: dict[str, dict] = {}

    # ---------------------------------------------------------------- registry
    def seed_registry(self, created_at: str) -> None:
        for i in self.pack["seed_issues"]:
            self.add_issue(i["key"], i["component"], i["title"], i["description"], "seed",
                           [f"{i['title']}. {i['description']}"] + list(i.get("examples", [])), created_at)

    def add_issue(self, key, component, title, description, origin, texts, created_at) -> dict:
        cur = self.con.execute("INSERT INTO issues(key, component, title, description, origin, created_at) VALUES(?,?,?,?,?,?)",
                               (key, component, title, description, origin, created_at))
        issue = dict(id=cur.lastrowid, key=key, component=component, title=title, description=description, origin=origin,
                     texts=list(texts), mat=self.embedder.encode(list(texts)))
        self._recentre(issue)
        self.issues[issue["id"]] = issue
        self.by_component[component].append(issue)
        self.con.executemany("INSERT INTO exemplars VALUES(?,?)", [(issue["id"], t) for t in texts])
        self._baseline_prefix = None   # the baseline prompt lists every issue, so it grows too
        return issue

    def restore(self) -> None:
        """Rebuild the in-memory registry and buffer from a finished run's database.
        Why: the API can then take one live complaint (or a voice-agent webhook) on top of
        a batch run without reprocessing 1,500 complaints. Vectors are re-embedded from the
        stored texts. Not stored as blobs: they depend on the embedder in use."""
        for row in self.con.execute("SELECT * FROM issues WHERE origin != 'merged' ORDER BY id").fetchall():
            texts = [r[0] for r in self.con.execute("SELECT text FROM exemplars WHERE issue_id=? ORDER BY rowid", (row["id"],))]
            issue = dict(row) | dict(texts=texts, mat=self.embedder.encode(texts))
            self._recentre(issue)
            self.issues[issue["id"]] = issue
            self.by_component[issue["component"]].append(issue)
        for row in self.con.execute("SELECT p.complaint_id, p.component, c.text, c.customer_id, c.sender FROM pending p "
                                    "JOIN complaints c ON c.id = p.complaint_id").fetchall():
            self.buffer[row["component"]].append(dict(id=row["complaint_id"], vec=self.embedder.encode([row["text"]])[0],
                                                      text=row["text"], customer_id=row["customer_id"],
                                                      person=self._person(row["customer_id"], row["sender"])))
        self.new_count = self.con.execute("SELECT COUNT(*) FROM issues WHERE origin='discovered'").fetchone()[0]

    @staticmethod
    def _person(customer_id: str | None, sender: str | None) -> str | None:
        """Who counts as one person for the new-issue rule.
        Why the sender too (decided 13 Nov): someone not in the customer list (a new email
             address, an unknown phone or handle) is still one identifiable person, so their
             report should count. Not: a sender-less complaint. With no address at all, three
             reports could be one person, so they still do not count."""
        if customer_id:
            return customer_id
        return f"sender:{str(sender).strip().lower()}" if sender and str(sender).strip() else None

    @staticmethod
    def _recentre(issue: dict) -> None:
        centre = issue["mat"].mean(axis=0)
        issue["centroid"] = centre / (np.linalg.norm(centre) or 1.0)

    @staticmethod
    def _score(vec: np.ndarray, issue: dict) -> float:
        """Why half centroid, half best exemplar: the centroid is the issue's general meaning;
        the best exemplar lets one close wording (e.g. the Hinglish example) count.
        Not centroid alone: it averages away minority wordings. Not best exemplar alone:
        one odd exemplar would then decide matches by itself."""
        return 0.5 * float(issue["centroid"] @ vec) + 0.5 * float((issue["mat"] @ vec).max())

    def _candidates(self, vec: np.ndarray, components: list[str]) -> list[dict]:
        found = [dict(key=i["key"], title=i["title"], description=i["description"], component=i["component"],
                      sim=self._score(vec, i), issue=i) for c in components for i in self.by_component[c]]
        return sorted(found, key=lambda x: -x["sim"])

    def _components(self, g: dict, c: dict) -> list[str]:
        ranked = sorted(g["component_probs"].items(), key=lambda kv: -kv[1])
        comps = [ranked[0][0]]
        # Why: a complaint routed to the wrong component is never compared with its true issue,
        # so when the top two are close we search both registries.
        if len(ranked) > 1 and ranked[0][1] - ranked[1][1] < self.t["component_margin"]:
            comps.append(ranked[1][0])
        # The caller's IVR choice is a free hint. Not trusted over the gate: people press the wrong key.
        ivr = (c.get("meta") or {}).get("ivr_choice")
        if ivr in self.pack["components"] and ivr not in comps:
            comps.append(ivr)
        return comps

    # ---------------------------------------------------------------- bookkeeping
    def _event(self, cid: str, stage: str, model: str, usage: dict) -> None:
        # Not applying the prompt-cache discount to funnel LLM calls: caching was not verified,
        # so the funnel is costed at full list price (the conservative side).
        cost = cost_usd(self.pack, model, usage["in_tokens"], usage["out_tokens"])
        self.con.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
                         (cid, stage, model, usage["in_tokens"], usage["out_tokens"], cost, usage["latency_s"], int(usage["estimated"])))
        self.spent_usd += cost
        if self.budget_usd is not None and self.spent_usd > self.budget_usd:
            # Not committing here: the caller decides (a batch keeps what it has; a live
            # complaint rolls back and is retried offline).
            raise BudgetExceeded(f"spend cap ${self.budget_usd:.2f} reached after ${self.spent_usd:.4f}; run stopped")

    def _settle(self, cid: str, stage: str, issue: dict | None = None) -> dict:
        self.con.execute("UPDATE complaints SET settled=? WHERE id=?", (stage, cid))
        return dict(id=cid, settled=stage, issue=issue["key"] if issue else None, title=issue["title"] if issue else None)

    def _assign(self, c: dict, vec, cand: dict, stage: str, confidence, reason: str) -> dict:
        issue = cand["issue"]
        self.con.execute("INSERT INTO assignments VALUES(?,?,?,?,?,?)", (c["id"], issue["id"], stage, cand["sim"], confidence, reason))
        # Why learn only from verify/LLM verdicts: those wordings were NOT obviously similar, so
        # remembering them lets the next such complaint settle at the cheap match stage.
        # Not learning from plain matches: they are already close and would add nothing.
        if self.learn and stage in ("verify", "llm") and len(issue["texts"]) < EXEMPLAR_CAP:
            issue["texts"].append(c["text"])
            issue["mat"] = np.vstack([issue["mat"], vec])
            self._recentre(issue)
            self.con.execute("INSERT INTO exemplars VALUES(?,?)", (issue["id"], c["text"]))
        return self._settle(c["id"], stage, issue)

    # ---------------------------------------------------------------- the funnel
    def prefetch_gate(self, complaints: list[dict], workers: int = 8) -> None:
        """Run the gate for a whole batch in parallel before the funnel starts.
        Why only the gate: its answer depends on the complaint alone. Verify and adjudicate
        depend on the registry as it stands at that moment, so they stay in order.
        Not sequential gate calls: about 0.55 s each, i.e. 14 minutes for 1,500 complaints."""
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(workers) as pool:
            for c, g in zip(complaints, pool.map(lambda c: self.gate.classify(c["text"]), complaints)):
                self._gate_cache[c["id"]] = g

    def process(self, c: dict) -> dict:
        cid, text = c["id"], c["text"]
        ident = self.identity.resolve(c)
        g = self._gate_cache.pop(cid, None) or self.gate.classify(text)
        self._event(cid, "gate", self.gate.model, g["usage"])
        sender = c.get("email") or c.get("phone") or c.get("handle") or c.get("user_id")
        self.con.execute("INSERT INTO complaints(id, channel, text, created_at, sender, customer_id, link_method, link_conf, order_id, order_status, meta) "
                         "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                         (cid, c["channel"], text, c["created_at"], sender, ident["customer_id"], ident["link_method"], ident["link_conf"],
                          ident["order_id"], ident["order_status"], json.dumps(c.get("meta") or {})))
        probs = g["component_probs"]
        self.con.execute("INSERT INTO gate VALUES(?,?,?,?,?,?,?,?,?)",
                         (cid, g["is_complaint"], g["component"], max(probs.values()), json.dumps(probs),
                          g["impact"], g["emotion"], g["money_lost"], g["legal_risk"]))
        # What the same complaint would cost if an LLM did everything in one call (projected, not run).
        if self._baseline_prefix is None:
            self._baseline_prefix = est_tokens(prompts.baseline_prefix(self.pack, list(self.issues.values())))
        self.con.execute("INSERT INTO baseline VALUES(?,?,?,?)",
                         (cid, self._baseline_prefix, self._baseline_prefix + est_tokens(text), prompts.BASELINE_OUT_TOKENS))

        if g["is_complaint"] < self.t["is_complaint"]:
            return self._settle(cid, "dropped")           # praise, spam, questions leave here

        comps = self._components(g, c)
        vec = self.embedder.encode([text])[0]
        cands = self._candidates(vec, comps)
        best = cands[0] if cands else None

        if best and best["sim"] >= self.t["match_hi"]:    # clearly a known issue
            return self._assign(c, vec, best, "match", None, "similarity above the auto-file cut-off")
        if not best or best["sim"] < self.t["match_lo"]:  # clearly unlike anything known
            return self._to_buffer(c, vec, g, ident, comps[0])

        # Unsure band. Ask the decision model a yes/no per close candidate before paying for an LLM.
        top = cands[: self.t["verify_candidates"]]
        p, usage = self.gate.verify(text, top, mid=self.mid)
        self._event(cid, "verify", self.gate.model, usage)
        winner = max(top, key=lambda x: p[x["key"]])
        if p[winner["key"]] >= self.t["verify_yes"]:
            return self._assign(c, vec, winner, "verify", p[winner["key"]], "decision model confirmed it is the same problem")
        if all(v <= self.t["verify_no"] for v in p.values()):
            # A confident "no" to every candidate goes to the buffer, not the LLM (open decision 7):
            # the LLM would be shown the same candidates and most likely also answer "new".
            return self._to_buffer(c, vec, g, ident, comps[0])

        # Still unsure: the LLM sees one component's registry as a stable prefix, then the complaint.
        comp = best["component"]
        verdict, usage = self.llm.adjudicate(comp, self.by_component[comp], text, [x for x in cands if x["component"] == comp], mid=self.mid)
        self._event(cid, "llm", self.llm.model, usage)
        if verdict["issue"]:
            chosen = next(x for x in cands if x["key"] == verdict["issue"])
            return self._assign(c, vec, chosen, "llm", None, verdict["reason"])
        return self._to_buffer(c, vec, g, ident, comps[0])

    # ---------------------------------------------------------------- new issues
    def _to_buffer(self, c: dict, vec, g: dict, ident: dict, comp: str) -> dict:
        """Unmatched complaints wait here, visible to staff as "unconfirmed reports".
        Why wait: PS-19 asks for recurring issues; one unusual complaint should not become a
             ranked issue. The complaint itself is still stored and can be handled.
        Why the urgent flag: a single report of lost money or a safety risk should not wait
             for two more people (decided 13 Nov)."""
        urgent = g["money_lost"] >= self.t["urgent_flag"] or g["legal_risk"] >= self.t["urgent_flag"]
        buf = self.buffer[comp]
        sender = c.get("email") or c.get("phone") or c.get("handle") or c.get("user_id")
        buf.append(dict(id=c["id"], vec=vec, text=c["text"], customer_id=ident["customer_id"],
                        person=self._person(ident["customer_id"], sender)))
        self.con.execute("INSERT INTO pending VALUES(?,?)", (c["id"], comp))
        self.con.execute("UPDATE complaints SET settled='pending', urgent=? WHERE id=?", (int(urgent), c["id"]))
        # Why a star around the new complaint, not chained clustering: chains drift (A~B, B~C
        # does not mean A and C are one problem). Every member here is close to this complaint.
        sims = np.stack([b["vec"] for b in buf]) @ vec
        members = [b for b, s in zip(buf, sims) if s >= self.t["cluster"]]
        # Why distinct people, not complaints: three posts from one angry person are not three people.
        # A person is a linked customer, or else a distinct sender address (see _person).
        if len({m["person"] for m in members if m["person"]}) >= self.t["new_issue_customers"]:
            existing = self._existing_match(comp, members, c["id"])
            if existing:
                return existing
            issue = self._promote(comp, members, c["created_at"], c["id"])
            return dict(id=c["id"], settled="new_issue", issue=issue["key"], title=issue["title"])
        return dict(id=c["id"], settled="pending", issue=None, title=None, urgent=urgent)

    @staticmethod
    def _typical(members: list[dict]) -> list[int]:
        mat = np.stack([m["vec"] for m in members])
        centre = mat.mean(axis=0)
        return list(np.argsort(-(mat @ (centre / (np.linalg.norm(centre) or 1.0)))))   # most typical first

    def _existing_match(self, comp: str, members: list[dict], trigger: str) -> dict | None:
        """Check before creating: is this group of reports really a known issue in new words?
        Why: in the first live run, different wordings of one problem became separate issues
             (the Android crash became 5). Three reports together say more than one alone, so
             the decision model gets a second look with all of them.
        Not the LLM here: a yes/no is Jev's job and costs ~$0.00002."""
        order = self._typical(members)
        state = "\n".join(f"- {members[i]['text']}" for i in order[:3])
        centre = np.stack([m["vec"] for m in members]).mean(axis=0)
        cands = self._candidates(centre / (np.linalg.norm(centre) or 1.0), [comp])[: self.t["verify_candidates"]]
        if not cands:
            return None
        p, usage = self.gate.verify(state, cands, mid=self.mid)
        self._event(trigger, "verify_group", self.gate.model, usage)
        best = max(cands, key=lambda x: p[x["key"]])
        if p[best["key"]] < self.t["verify_yes"]:
            return None
        issue, ids = best["issue"], {m["id"] for m in members}
        self.buffer[comp] = [b for b in self.buffer[comp] if b["id"] not in ids]
        for m in members:
            self.con.execute("DELETE FROM pending WHERE complaint_id=?", (m["id"],))
            self.con.execute("INSERT INTO assignments VALUES(?,?,?,?,?,?)", (m["id"], issue["id"], "verify", self._score(m["vec"], issue),
                                                                            p[best["key"]], "group of similar reports confirmed as a known issue"))
            self.con.execute("UPDATE complaints SET settled='verify' WHERE id=?", (m["id"],))
        return dict(id=trigger, settled="verify", issue=issue["key"], title=issue["title"])

    def _promote(self, comp: str, members: list[dict], created_at: str, trigger: str) -> dict:
        order = self._typical(members)
        named, usage = self.llm.name_issue(comp, [members[i]["text"] for i in order[:5]])
        self._event(trigger, "llm_name", self.llm.model, usage)   # one LLM call per new issue, not per complaint
        self.new_count += 1
        # Why the title is an exemplar only when the LLM named it: a placeholder title would pull matching off course.
        head = [f"{named['title']}. {named['description']}"] if named.get("named", True) else []
        issue = self.add_issue(f"new_{self.new_count}", comp, named["title"], named["description"], "discovered",
                               head + [members[i]["text"] for i in order[:8]], created_at)
        # Sweep the rest of this component's buffer: earlier complaints may belong to the new issue too.
        taken, ids, remaining = list(members), {m["id"] for m in members}, []
        for b in self.buffer[comp]:
            if b["id"] in ids:
                continue
            (taken if self._score(b["vec"], issue) >= self.t["match_hi"] else remaining).append(b)
        self.buffer[comp] = remaining
        for m in taken:
            self.con.execute("DELETE FROM pending WHERE complaint_id=?", (m["id"],))
            self.con.execute("INSERT INTO assignments VALUES(?,?,?,?,?,?)",
                             (m["id"], issue["id"], "new_issue", self._score(m["vec"], issue), None, "grouped into a newly discovered issue"))
            self.con.execute("UPDATE complaints SET settled='new_issue' WHERE id=?", (m["id"],))
        return issue

    # ---------------------------------------------------------------- curator
    def curate(self) -> list[dict]:
        """The Curator: after a batch, review each discovered issue against the issues near it
        in the same component, and merge duplicates. Also names any issue still unnamed.
        Why after the batch: by then each discovered issue has its full set of wordings, so
             "same problem?" is judged on more evidence than at creation time.
        Why the LLM: deciding that "app crashes on cart" and "app closes after update" share a
             root cause is a judgement in words (decided 13 Nov). One call per discovered
             issue, about $0.0002 each.
        Why merged issues are kept as rows (origin='merged') with a merges record: the merge
             is visible and traceable, and nothing is deleted."""
        log = []
        for issue in [i for i in list(self.issues.values()) if i["origin"] == "discovered"]:
            if issue["id"] not in self.issues:
                continue
            comp = issue["component"]
            others = [o for o in self.by_component[comp] if o["id"] != issue["id"]]
            if not others:
                continue
            sims = {o["key"]: float(issue["centroid"] @ o["centroid"]) for o in others}
            near = sorted(others, key=lambda o: -sims[o["key"]])[:4]   # the LLM sees the 4 closest, not the whole list
            verdict, usage = self.llm.curate(comp, issue, near, sims=sims, threshold=self.t.get("curate_sim", 0.6))
            self._event(f"issue:{issue['key']}", "llm_curate", self.llm.model, usage)
            target = next((o for o in near if o["key"] == verdict["same_as"]), None)
            if target:
                self._merge(issue, target, verdict)
                log.append(dict(merged=issue["key"], into=target["key"], title=target["title"], reason=verdict["reason"]))
            elif issue["title"].startswith("Unnamed"):
                named, usage = self.llm.name_issue(comp, issue["texts"][:5])
                self._event(f"issue:{issue['key']}", "llm_name", self.llm.model, usage)
                if named.get("named"):
                    self._retitle(issue, named["title"], named["description"])
        self.con.commit()
        return log

    def _retitle(self, issue: dict, title: str, description: str) -> None:
        issue["title"], issue["description"] = title, description
        self.con.execute("UPDATE issues SET title=?, description=? WHERE id=?", (title, description, issue["id"]))

    def _merge(self, src: dict, dst: dict, verdict: dict) -> None:
        self.con.execute("UPDATE assignments SET issue_id=? WHERE issue_id=?", (dst["id"], src["id"]))
        self.con.execute("UPDATE exemplars SET issue_id=? WHERE issue_id=?", (dst["id"], src["id"]))
        self.con.execute("UPDATE issues SET origin='merged' WHERE id=?", (src["id"],))
        self.con.execute("INSERT INTO merges VALUES(?,?,?)", (src["id"], dst["id"], verdict["reason"]))
        room = max(0, EXEMPLAR_CAP - len(dst["texts"]))
        dst["texts"] += src["texts"][:room]
        dst["mat"] = np.vstack([dst["mat"], src["mat"][:room]])
        self._recentre(dst)
        # Why seeded titles are kept: they are the company's own names for its known issues.
        if dst["origin"] == "discovered" and verdict.get("title"):
            self._retitle(dst, verdict["title"], verdict["description"] or dst["description"])
        del self.issues[src["id"]]
        self.by_component[src["component"]] = [i for i in self.by_component[src["component"]] if i["id"] != src["id"]]
        self._baseline_prefix = None
