"""A/B two layout models through the real planner in headless Chrome: same plots, same settings, the layouts a visitor would see.

    python tools/ab_models.py models runs/v16          (each folder holds layout.onnx and vocab.json)
    python tools/ab_models.py models:noq models        (":noq": the planner without quality ranking)
For every request both models draft three layouts with modelLayouts (js/modelplans.js); each layout is scored by its rule
checks (all passed = perfect) and by ml/quality.py (plot use, wasted space, real room sizes, proportions, lounge).
"""
import http.server, json, socket, statistics as st, sys, threading
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml")); sys.path.insert(0, str(ROOT / "tools"))
import layoutlm as L  # noqa: E402
from quality import quality  # noqa: E402

PLOTS = [(25, 45, 2, 1), (30, 50, 3, 1), (30, 60, 3, 1), (35, 65, 3, 1), (35, 65, 4, 1), (40, 80, 4, 1), (50, 90, 5, 1), (32, 64, 3, 1),
         (26, 60, 3, 1), (28, 55, 3, 1), (28, 60, 3, 1), (30, 55, 3, 1),                                  # narrow plots, three bedrooms
         (25, 50, 2, 2), (30, 50, 2, 2), (30, 50, 3, 2), (30, 60, 3, 2), (35, 65, 3, 2), (35, 70, 3, 2), (40, 80, 4, 2), (45, 90, 4, 2)]   # two storeys
PLOTS = PLOTS * 2                                                    # every request twice: one run of the A/B varies by about +-0.02
JS = r"""
async ([w, d, beds, storeys, noq]) => {
  globalThis.__noQualityRank = noq;
  const M = await import('/js/modelplans.js'), Q = await import('/js/quality.js');
  const Ls = await M.modelLayouts({ w, d }, { beds, baths: beds, storeys, focus: 'balanced' }, () => {});
  return Ls.map((L) => { const r = Q.quality(L.plan, L.rects); return { q: [r.q, r.parts], ok: L.checks.filter((c) => c.level === 'ok').length, n: L.checks.length }; });
}"""


def run(model_dir, port):
    from playwright.sync_api import sync_playwright
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        page = b.new_page()
        noq = model_dir.endswith(":noq"); model_dir = model_dir.split(":")[0]
        md = ROOT / model_dir
        page.route("**/models/layout.onnx*", lambda r: r.fulfill(path=str(md / "layout.onnx"), content_type="application/octet-stream"))
        page.route("**/models/vocab.json*", lambda r: r.fulfill(path=str(md / "vocab.json"), content_type="application/json"))
        page.goto(f"http://127.0.0.1:{port}/index.html")
        for pl in PLOTS:
            res = page.evaluate(JS, list(pl) + [noq])
            row = {"plot": pl, "layouts": len(res), "perfect": 0, "q": []}
            for r in res:
                row["perfect"] += r["ok"] == r["n"]
                row["q"].append(tuple(r["q"]))
            out.append(row)
        b.close()
    return out


def main():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    H = partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); H.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    res = {m: run(m, port) for m in sys.argv[1:]}
    srv.shutdown()
    print(f"{'plot':22}" + "".join(f"{m:>28}" for m in res))
    for i, pl in enumerate(PLOTS):
        cells = []
        for m in res:
            r = res[m][i]
            q = st.mean([x[0] for x in r["q"]]) if r["q"] else 0
            cells.append(f"{r['layouts']} lay, {r['perfect']} perf, q {q:.3f}")
        print(f"{str(pl):22}" + "".join(f"{c:>28}" for c in cells))
    for m in res:
        allq = [x for r in res[m] for x in r["q"]]
        parts = {k: round(st.mean([x[1][k] for x in allq if k in x[1]]), 3) for k in ("use", "waste", "sizes", "shape", "hub")}
        print(f"{m}: layouts {sum(r['layouts'] for r in res[m])}, perfect {sum(r['perfect'] for r in res[m])}, quality {st.mean([x[0] for x in allq]):.4f} {parts}")


if __name__ == "__main__":
    main()
