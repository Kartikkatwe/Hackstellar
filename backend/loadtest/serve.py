"""Launch the API for load testing. SIM_LATENCY=1 makes the offline gate/LLM sleep for the
latencies measured on the live run (gate 0.53 s, verify 0.54 s, LLM 1.90 s)."""
import os, sys, time
sys.path.insert(0, sys.argv[1])
os.chdir(sys.argv[1])
import uvicorn
from app import api
from app.providers import mock
if os.environ.get("SIM_LATENCY") == "1":
    def slow(fn, secs):
        def inner(*a, **k):
            time.sleep(secs); return fn(*a, **k)
        return inner
    mock.MockGate.classify = slow(mock.MockGate.classify, 0.53)
    mock.MockGate.verify = slow(mock.MockGate.verify, 0.54)
    mock.MockLLM.adjudicate = slow(mock.MockLLM.adjudicate, 1.90)
uvicorn.run(api.app, host="127.0.0.1", port=int(sys.argv[2]), log_level="warning")
