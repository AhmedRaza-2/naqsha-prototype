"""Expert iteration (self-distillation) for the layout model: the planner's finished plans become training data.

The live model drafts; the planner then repairs each draft (proper turning stair, porch, rooms grown toward real sizes, rule
polishing: js/plantweak.js, js/polish.js). A plan that comes out of that pipeline passing every rule is the plan the model
*should* have written. Training on those teaches the network to write them directly, so the repair step no longer has to
squeeze rooms (two-storey ground floors lost their minimum sizes when the stair was widened afterwards).

    python tools/distill.py --n 1600 --pages 4 --out data/distill18.jsonl
Requests: two-storey ground floors, narrow 3-bedroom single-storey plots and a general mix; plot sizes held out in
data/pk13 (val, test) are never used, so the evaluation stays honest.
"""
import argparse, asyncio, http.server, json, random, socket, threading
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = r"""
async ([w, d, beds, storeys, n]) => {
  const M = await import('/js/modelplans.js'), T = await import('/js/tree.js');
  const Ls = await M.modelLayouts({ w, d }, { beds, baths: beds + 1, storeys, focus: 'balanced' }, () => {}, { n });
  const out = [];
  for (const L of Ls) {
    if (!L.plan.tree || L.checks.some((c) => c.level !== 'ok')) continue;
    const cs = T.check(L.plan, beds);
    if (cs.some((c) => c.level !== 'ok') || L.plan.beds !== beds) continue;
    const comp = T.serialize(L.plan).split('\n').slice(1).join('\n');
    out.push({ comp, baths: L.plan.baths, family: L.family || null });
  }
  return out;
}"""


def requests(n, rng, held):
    out = []
    def plot(wlo, whi, ratio=(1.6, 2.2)):
        for _ in range(50):
            w = rng.randint(wlo, whi); d = int(round(w * rng.uniform(*ratio)))
            if (w, d) not in held: return w, d
        return w, d
    for _ in range(int(n * 0.45)):                                  # two-storey ground floors
        w, d = plot(25, 50); out.append((w, d, rng.choice([2, 2, 3, 3, 4] if w >= 35 else [2, 3]), 2))
    for _ in range(int(n * 0.25)):                                  # narrow plots, three bedrooms on one floor
        w, d = plot(26, 32, (1.8, 2.4)); out.append((w, d, 3, 1))
    while len(out) < n:                                             # everything else
        w, d = plot(25, 55); out.append((w, d, rng.choice([2, 3, 3, 4] if w >= 35 else [2, 3]), 1))
    rng.shuffle(out)
    return out


async def worker(ctx, url, queue, results, n_drafts, done):
    page = await ctx.new_page()
    await page.goto(url)
    while not queue.empty():
        w, d, beds, storeys = await queue.get()
        n0 = len(results)
        try:
            res = await asyncio.wait_for(page.evaluate(JS, [w, d, beds, storeys, n_drafts]), timeout=240)     # a request that hangs is skipped
        except Exception as e:
            res = []
            await page.goto(url)
        for r in res:
            p = f"PLOT {w}x{d} BEDS {beds} BATHS {r['baths']} FOCUS balanced" + (" STOREYS 2" if storeys == 2 else "")
            results.append({"prompt": p, "completion": r["comp"], "plot": [w, d], "beds": beds, "baths": r["baths"], "focus": "balanced",
                            "style": r["family"], "score": 1.0, "floor": 0, "source": "distill"})
            if r["family"]:
                results.append({**results[-1], "prompt": p + f" STYLE {r['family']}"})
        done[0] += 1
        with open(str(OUT) + ".partial", "a", encoding="utf-8", newline="\n") as f:        # saved as it goes: a stopped run keeps what it drew
            for r in results[n0:]: f.write(json.dumps(r) + "\n")
        if done[0] % 25 == 0: print(f"{done[0]} requests, {len(results)} plans", flush=True)


OUT = None


async def main_async(a):
    global OUT
    OUT = a.out
    from playwright.async_api import async_playwright
    held = set()
    for name in ("val", "test"):
        for l in open(ROOT / "data/pk13" / f"{name}.jsonl", encoding="utf-8"):
            held.add(tuple(json.loads(l)["plot"]))
    reqs = requests(a.n, random.Random(a.seed), held)
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    H = partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); H.log_message = lambda *x, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    queue = asyncio.Queue()
    for r in reqs: queue.put_nowait(r)
    results, done = [], [0]
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context()
        await asyncio.gather(*[worker(ctx, f"http://127.0.0.1:{port}/index.html", queue, results, a.drafts, done) for _ in range(a.pages)])
        await b.close()
    srv.shutdown()
    seen, rows = set(), []
    for r in results:
        k = r["prompt"] + "\n" + r["completion"]
        if k not in seen: seen.add(k); rows.append(r)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    two = sum(1 for r in rows if "STOREYS 2" in r["prompt"])
    narrow3 = sum(1 for r in rows if "STOREYS" not in r["prompt"] and r["beds"] == 3 and r["plot"][0] <= 32)
    print(f"{len(reqs)} requests -> {len(rows)} plans that pass every rule ({two} two-storey ground floors, {narrow3} narrow 3-bed)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=800)
    ap.add_argument("--pages", type=int, default=3, help="tabs; more than the CPU has cores only slows every tab down")
    ap.add_argument("--drafts", type=int, default=16)
    ap.add_argument("--seed", type=int, default=18)
    ap.add_argument("--out", default="data/distill18.jsonl")
    asyncio.run(main_async(ap.parse_args()))
