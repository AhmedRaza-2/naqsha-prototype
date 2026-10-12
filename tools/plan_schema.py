"""Canonical plan format + validator + normaliser for the training data.

A plan is one floor of one house:
  {
    "id": "G01", "source_id": "<image hash>",
    "plot": {"w": 25, "d": 45},            # feet; w = across the road frontage, d = depth
    "road": "south",                        # side of the plot the road is on, as drawn
    "floor": "ground",
    "rooms": [{"type": "bed", "name": "Master Bedroom", "x": 0, "y": 20, "w": 12, "d": 14}, ...]
  }
Coordinates are feet in the canonical frame: origin = front-left corner of the plot (road in front, standing
on the road looking in), x grows to the right, y grows toward the back. Rooms are axis-aligned rectangles.
Attached baths may sit fully inside their bedroom.

    python tools/plan_schema.py data/gold/annotations      # validate a folder of JSON plans
"""
import json, sys
from pathlib import Path

TYPES = {"bed", "bath", "kitchen", "lounge", "drawing", "dining", "porch", "lawn", "stairs", "store", "lobby",
         "courtyard", "garage", "balcony", "passage", "prayer", "study", "servant", "dress", "other"}
OPEN_TYPES = {"porch", "lawn", "courtyard", "garage", "balcony"}   # not enclosed living space


def _overlap(a, b):
    ox = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])
    oy = min(a["y"] + a["d"], b["y"] + b["d"]) - max(a["y"], b["y"])
    return max(ox, 0) * max(oy, 0)


def _inside(a, b, tol=0.6):
    """a fully inside b"""
    return (a["x"] >= b["x"] - tol and a["y"] >= b["y"] - tol and
            a["x"] + a["w"] <= b["x"] + b["w"] + tol and a["y"] + a["d"] <= b["y"] + b["d"] + tol)


def validate(plan, tol=1.0):
    """Return (errors, warnings). Errors make a plan unusable for training."""
    errs, warns = [], []
    W, D = plan["plot"]["w"], plan["plot"]["d"]
    rooms = plan["rooms"]
    if not (15 <= W <= 150 and 25 <= D <= 250):
        errs.append(f"implausible plot {W}x{D}")
    if len(rooms) < 4:
        errs.append("fewer than 4 rooms")
    for i, r in enumerate(rooms):
        if r["type"] not in TYPES:
            errs.append(f"room {i}: unknown type {r['type']}")
        if r["w"] <= 0 or r["d"] <= 0:
            errs.append(f"room {i} {r['type']}: non-positive size")
        if r["x"] < -tol or r["y"] < -tol or r["x"] + r["w"] > W + tol or r["y"] + r["d"] > D + tol:
            errs.append(f"room {i} {r['name']}: outside plot")
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            a, b = rooms[i], rooms[j]
            ov = _overlap(a, b)
            if ov > 4 and not (_inside(a, b) or _inside(b, a)):
                errs.append(f"overlap {a['name']} / {b['name']} ({ov:.0f} sq ft)")
    living = sum(r["w"] * r["d"] for r in rooms if r["type"] not in OPEN_TYPES and not _contained(r, rooms))
    cover = living / (W * D)
    if cover > 1.0:
        errs.append(f"room areas ({living:.0f}) exceed plot ({W * D})")
    elif cover < 0.35:
        warns.append(f"only {cover:.0%} of plot covered by enclosed rooms")
    if not any(r["type"] == "bed" for r in rooms):
        errs.append("no bedroom")
    if not any(r["type"] == "kitchen" for r in rooms):
        warns.append("no kitchen")
    return errs, warns


def _contained(r, rooms):
    """room sits inside a larger room (e.g. attached bath) -> do not double count its area"""
    return any(o is not r and o["w"] * o["d"] > r["w"] * r["d"] and _inside(r, o) for o in rooms)


def mirror(plan):
    """Left-right mirror: a valid plan stays valid (data augmentation)."""
    W = plan["plot"]["w"]
    p = json.loads(json.dumps(plan))
    for r in p["rooms"]:
        r["x"] = round(W - r["x"] - r["w"], 2)
    p["id"] = plan["id"] + "_m"
    return p


def to_relative(plan):
    """Fractions of the plot (scale-free) - what the model learns the layout pattern from."""
    W, D = plan["plot"]["w"], plan["plot"]["d"]
    return [{**r, "x": r["x"] / W, "y": r["y"] / D, "w": r["w"] / W, "d": r["d"] / D} for r in plan["rooms"]]


def main(folder):
    ok = bad = 0
    for f in sorted(Path(folder).glob("*.json")):
        p = json.loads(f.read_text(encoding="utf-8"))
        errs, warns = validate(p)
        status = "OK " if not errs else "BAD"
        ok += not errs
        bad += bool(errs)
        print(f"{status} {f.name:10s} {p['plot']['w']}x{p['plot']['d']}  rooms={len(p['rooms'])}"
              + ("  ERR: " + "; ".join(errs) if errs else "") + ("  warn: " + "; ".join(warns) if warns else ""))
    print(f"\n{ok} valid, {bad} need fixing")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/gold/annotations")
