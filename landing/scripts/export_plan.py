"""Export real, rule-checked plans for the landing page (so every plan shown on the page is real model-format data).
    python landing/scripts/export_plan.py
"""
import json, random, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import bands  # noqa: E402

W, D, BEDS = 38, 59, 3
rng = random.Random(7)
plans, seen = [], set()
for _ in range(4000):
    p = bands.generate(W, D, BEDS, rng)
    if p is None or p["beds"] != BEDS:
        continue
    cs = bands.check(p, BEDS)
    if bands.score(cs) < 1.0:
        continue
    key = bands.serialize(p)
    if key in seen:
        continue
    seen.add(key)
    plans.append((p, cs))
    if len(plans) == 3:
        break

out = []
for p, cs in plans:
    rects = bands.to_rects(p)
    out.append({
        "text": bands.serialize(p),
        "rooms": [{"i": r["i"], "t": r["t"], "x": r["x"], "y": r["y"], "w": r["w"], "d": r["d"], "parent": r.get("parent")} for r in rects],
        "checks": [{"name": c[1], "ok": c[0] == "ok"} for c in cs],
    })
data = {"plot": {"w": W, "d": D}, "marla": round(W * D / 225, 1), "beds": BEDS, "plans": out}
dest = ROOT / "landing" / "src" / "data" / "plan.json"
dest.write_text(json.dumps(data, indent=1), encoding="utf-8")
print("wrote", dest, len(out), "plans")
for o in out:
    print(o["text"].replace("\n", " / ")[:140])
