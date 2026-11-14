import asyncio, json, random, sys, time, statistics as st
import httpx
BASE = "http://127.0.0.1:%s" % sys.argv[1]

def pct(xs, p):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else None

async def run(name, make, concurrency, total, timeout=120.0):
    """make(i) -> (method, path, json|None). Returns a summary dict."""
    lat, codes, errs = [], {}, {}
    sem = asyncio.Semaphore(concurrency)
    limits = httpx.Limits(max_connections=concurrency + 5, max_keepalive_connections=concurrency + 5)
    async with httpx.AsyncClient(base_url=BASE, timeout=timeout, limits=limits) as cl:
        async def one(i):
            m, path, body = make(i)
            async with sem:
                t = time.perf_counter()
                try:
                    r = await cl.request(m, path, json=body)
                    codes[r.status_code] = codes.get(r.status_code, 0) + 1
                except Exception as e:
                    errs[type(e).__name__] = errs.get(type(e).__name__, 0) + 1
                lat.append(time.perf_counter() - t)
        t0 = time.perf_counter()
        await asyncio.gather(*[one(i) for i in range(total)])
        wall = time.perf_counter() - t0
    ok = sum(v for k, v in codes.items() if k < 400)
    return dict(name=name, concurrency=concurrency, total=total, ok=ok, codes=codes, errors=errs, wall_s=round(wall, 2),
                rps=round(total / wall, 1), p50_ms=round(pct(lat, .5) * 1000, 1), p95_ms=round(pct(lat, .95) * 1000, 1),
                p99_ms=round(pct(lat, .99) * 1000, 1), max_ms=round(max(lat) * 1000, 1), lat=lat)

def show(r):
    print(f"{r['name']:<34} c={r['concurrency']:<4} n={r['total']:<5} ok={r['ok']:<5} rps={r['rps']:<7} p50={r['p50_ms']:<8} p95={r['p95_ms']:<8} p99={r['p99_ms']:<8} max={r['max_ms']:<8} codes={r['codes']} err={r['errors']}", flush=True)
    return {k: v for k, v in r.items() if k != "lat"}
