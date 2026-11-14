# Testing strategy: Complaint Compass backend

How we test the backend after every round of fixes and before every demo. The tick-box list is [Release_Test_Checklist.pdf](Release_Test_Checklist.pdf); the scripts are in [`backend/loadtest/`](../../backend/loadtest/).

## Principles

1. **Test on a copy.** Always copy `runs/grocery_live_backup.db` to `runs/grocery.db` first. Never run tests against the backup itself.
2. **Offline by default.** Tests use the offline stand-ins (`PROVIDERS=mock`), so they cost nothing. Only two checklist items (F1, F6) need a live key.
3. **Measure with realistic delays.** The stand-ins answer instantly, which hides the real bottleneck. `SIM_LATENCY=1` makes them wait the latencies measured on the live run: gate 0.53 s, verify 0.54 s, LLM 1.90 s.
4. **Every fix gets a check, and nothing that passed may break.** Section G of the checklist re-checks the product itself, including the live-run numbers (96.13% never reach the LLM; top score 560.2).
5. **Write the numbers down.** The sign-off table records date, commit, tester and failed items.

## What is tested

| Layer | What | How |
|---|---|---|
| Access control | Every route needs a key; admin-only actions; cross-origin limits | Checklist A, by hand with `curl` |
| Identity and ranking | Identity cannot be claimed in a request; the ranking cannot be inflated | Checklist B; `probe.py`, `probe2.py` |
| Input validation | Bad, empty, oversized and wrong-type input is rejected cleanly | Checklist C; `probe.py` |
| Data integrity | No lost, duplicated or half-written complaints | Checklist D; `s1.py`, `probe2.py` |
| Load | Throughput, wait times, memory | Checklist E; `s1.py`, `s2.py` |
| Cost, keys, models | Spend cap, secrets, prompt handling, offline start | Checklist F |
| Regression | The product still works | Checklist G |

## When

- **After every fix:** the checklist section the fix belongs to, plus section G.
- **Before every demo or release:** the whole checklist. Any failure in A to D blocks a demo on a shared network.
- **After changing the engine or the database:** sections D, E and G.

## Running the scripts

From `backend/`, with the virtual environment active (`pip install httpx` once):

```bash
cp runs/grocery_live_backup.db runs/grocery.db

# 1. Reads and writes, no model delay (about 10 minutes)
PROVIDERS=mock python loadtest/serve.py "$PWD" 8101 &
python loadtest/s1.py 8101 data/grocery <server pid> s1.json

# 2. Writes with simulated model delay, and reads during a burst
SIM_LATENCY=1 PROVIDERS=mock python loadtest/serve.py "$PWD" 8102 &
python loadtest/s2.py 8102 data/grocery s2.json

# 3. Security and robustness probes (the scripts expect port 8103)
PROVIDERS=mock python loadtest/serve.py "$PWD" 8103 &
python loadtest/probe.py data/grocery runs/grocery.db <server pid>
python loadtest/probe2.py data/grocery runs/grocery.db
```

Notes:
- Add `EMBEDDER=hash` if the sentence model is not on the machine. The database must then come from a batch run with the same embedder (`EMBEDDER=hash PROVIDERS=mock python run_funnel.py`), because similarity cut-offs differ per embedder.
- Restart the server and re-copy the database between scripts: `probe.py` ends by starting a batch run, which rebuilds the database.
- `run_funnel.py` rewrites `runs/grocery_report.json`. After an offline run, restore it with `git checkout runs/grocery_report.json`.
- Stop each server when done (`kill <pid>`) and delete `runs/grocery.db`.

## Baseline (14 Nov 2026, 4-core Linux machine, offline models, hash embedder)

| Measure | Result |
|---|---|
| 2,000 writes at up to 100 at once | 0 lost, 0 duplicated |
| Writes, no model delay | 175–263 a second |
| Writes, simulated model delay | about 1.2 a second |
| Burst of 60 writes, longest wait | 48 s |
| `/issues/top` alone / 20 at once | 85 / 3.6 a second |
| `/segments/heatmap` at 20 at once | 2.2 a second |
| Memory growth over 2,000 writes | 231 MB |

Targets for the next run are in section E of the checklist.
