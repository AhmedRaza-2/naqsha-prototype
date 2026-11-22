"""How well a plan uses its plot, in [0, 1]: the part of the RL reward (v16) the rule checker does not see.

The checker (tools/bands.py) says whether a plan is allowed; this says whether it is a good house for its plot:
  use      the built area against what the plot may cover (coverage limit of its size class): a 10 marla plan covering 45%
           when 65% is allowed wastes the plot. Ground floors only (a first floor stands on the ground floor's box).
  waste    space inside the house outline that is no room (voids and light wells inside the box, beyond a small allowance)
  sizes    bedrooms, kitchen, lounge, drawing and dining room against the median size of that room in real Pakistani plans
           of the same size class (data/real_stats.json, 275 plans; full marks within +-22%, none at about 2x off), scaled
           down when the plot cannot hold all the rooms asked for at those sizes (v17: v16 asked a 25x45 plot for 30x50 rooms)
  shape    rooms that are not corridors, stairs or washrooms keep a usable proportion (long side up to 1.8x the short one)
  hub      a house with two or more bedrooms has a lounge (without one the kitchen or drawing room becomes the passage)

    from quality import quality;  q, parts = quality(plan, rects)
"""
import math

OPEN = {"lawn", "void", "porch", "courtyard", "garage", "balcony", "terrace"}
BEDS = {"bed", "master"}
MARLA = 225
# median room area (sq ft) in the real plans by size class (tools/real_stats.py); the large-plot lounge and kitchen are
# raised to the mid-plot trend (only 6 and 11 real samples there)
REAL = {
    "small": {"bed": 143, "master": 160, "kitchen": 88, "lounge": 178, "drawing": 151, "dining": 112},
    "mid": {"bed": 168, "master": 185, "kitchen": 108, "lounge": 238, "drawing": 197, "dining": 140},
    "large": {"bed": 175, "master": 200, "kitchen": 130, "lounge": 280, "drawing": 215, "dining": 155},
}
WEIGHTS = {"use": 0.25, "waste": 0.2, "sizes": 0.3, "shape": 0.15, "hub": 0.1}
NO_SHAPE = {"passage", "stairs", "lobby", "bath", "store", "dress"}


def size_class(W, D):
    m = W * D / MARLA
    return "small" if m <= 6 else "mid" if m <= 14 else "large"


def cover_limit(W, D):
    m = W * D / MARLA
    return 75 if m <= 6 else 70 if m <= 8.5 else 65 if m <= 14 else 60


def _near(a, target):
    """1 within +-22% of the target, falling to 0 at about twice (or half) of it."""
    if a <= 0: return 0.0
    return max(0.0, min(1.0, 1 - (abs(math.log(a / target)) - 0.2) / 0.55))


def quality(plan, rects):
    W, D = plan["plot"]["w"], plan["plot"]["d"]
    upper = bool(plan.get("floor"))
    mains = [r for r in rects if r["t"] not in OPEN and r["t"] != "bath"]
    if not mains: return 0.0, {}
    built = sum(r["w"] * r["d"] for r in mains)
    x0, x1 = min(r["x"] for r in mains), max(r["x"] + r["w"] for r in mains)
    y0, y1 = min(r["y"] for r in mains), max(r["y"] + r["d"] for r in mains)
    box = (x1 - x0) * (y1 - y0)
    parts = {}
    if not upper:
        cov = 100 * built / (W * D)
        parts["use"] = max(0.0, min(1.0, cov / (0.92 * cover_limit(W, D))))
    inside = sum(r["w"] * r["d"] for r in rects if r["t"] in ("void", "courtyard")
                 and r["x"] >= x0 - 0.01 and r["x"] + r["w"] <= x1 + 0.01 and r["y"] >= y0 - 0.01 and r["y"] + r["d"] <= y1 + 0.01)
    parts["waste"] = max(0.0, 1 - max(0.0, inside / max(box, 1) - 0.04) / 0.16)       # up to 4% of the box free (a light well), none left at 20%
    real = REAL[size_class(W, D)]
    # what these rooms can have on this plot: the real sizes, scaled down when the plot cannot hold every room asked for at that
    # size (about 70% of what may be built goes to them; the rest is washrooms, stairs, entrance and passages)
    avail = 0.7 * (box if upper else W * D * cover_limit(W, D) / 100)
    need = sum(real[r["t"]] for r in mains if r["t"] in real) or 1
    fit = min(1.0, avail / need)
    sz = [_near(r["w"] * r["d"] - (r["bath"][0] * r["bath"][1] if r.get("bath") else 0), real[r["t"]] * fit) for r in mains if r["t"] in real]
    parts["sizes"] = sum(sz) / len(sz) if sz else 1.0
    sh = [min(1.0, 1.8 / (max(r["w"], r["d"]) / max(min(r["w"], r["d"]), 0.5))) for r in mains if r["t"] not in NO_SHAPE]
    parts["shape"] = (sum(sh) / len(sh)) ** 2 if sh else 1.0
    beds = sum(1 for r in mains if r["t"] in BEDS)
    parts["hub"] = 1.0 if beds < 2 or any(r["t"] == "lounge" for r in mains) else 0.0
    w = {k: WEIGHTS[k] for k in parts}
    q = sum(parts[k] * w[k] for k in parts) / sum(w.values())
    return q, {k: round(v, 3) for k, v in parts.items()}
