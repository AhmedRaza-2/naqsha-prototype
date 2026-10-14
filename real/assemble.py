"""Room list (what a person or a vision model reads off a plan image) -> band plan the model can learn from.

A room list is JSON:
  {"plot": [W, D],
   "rows": [[{"t": "porch", "w": 11, "d": 13}, {"t": "drawing", "w": 12, "d": 13}],      # row 1 = road side, left to right
            [{"t": "lounge", "w": 15, "d": 12}, {"t": "kitchen", "w": 8, "d": 12}], ...],
   "baths": [{"row": 2, "col": 1, "w": 5, "d": 7, "side": "R"}]}                          # washroom inside rows[1][1]
Perception (labels, printed sizes, rough position) is the hard part for a vision model; the geometry is done here:
row depths and room widths are scaled to the exact plot size and snapped to 0.5 ft, washrooms are fitted inside their
room, and the result is checked. `quality` says how far the printed sizes had to be stretched to fit the plot.

    python real/assemble.py real/gold.jsonl            # assemble and check the gold set, print a summary
"""
import json, re, statistics as st, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands  # noqa: E402

# room names as people (and the vision model) write them -> our types; first match wins, so "master bed" is a master
KEYWORDS = [("master", "master"), ("dress|wardrobe|closet", "dress"), ("bath|toilet|w\\.?c\\b|washroom|powder|lav", "bath"),
            ("draw|drg", "drawing"), ("bed|guest", "bed"), ("dining|dinning", "dining"), ("kitch|kichen|cook", "kitchen"),
            ("lounge|tv|living|family|sitting|hall", "lounge"), ("lobby|entrance|entry|foyer", "lobby"), ("porch|garage|parking|car", "porch"),
            ("ots|open|court|light|sky|patio", "courtyard"), ("lawn|garden|green|terrace|verand|deck|sit ?out", "lawn"),
            ("stair", "stairs"), ("store|utility|laundry|wash|pantry|box", "store"), ("servant|s\\.?\\s?q", "servant"),
            ("prayer|namaz", "prayer"), ("study|office|library", "study"), ("passage|corridor|gallery", "passage"),
            ("void|setback|yard|space|side|back", "void")]
KEEP = bands.TYPES - {"bath"}


def norm_type(t, keep_bath=False):
    """Room name -> our type ('other' if unknown). Washrooms come back as 'bath' only when keep_bath is set."""
    t = str(t).strip().lower()
    if t in KEEP: return t
    for rx, ty in KEYWORDS:
        if re.search(rx, t):
            return ty if ty != "bath" or keep_bath else "other"
    return "other"


def snap(v):
    return round(v * 2) / 2


def fit(lengths, total, minimum):
    """Scale lengths to sum exactly to total on the 0.5 ft grid (the last one takes the rounding)."""
    s = sum(lengths)
    if s <= 0: return None
    out, acc = [], 0.0
    for i, v in enumerate(lengths):
        if i == len(lengths) - 1:
            x = round(total - acc, 2)
        else:
            x = max(minimum, snap(v * total / s))
        out.append(x)
        acc += x
    return out if min(out) >= minimum - 1e-6 else None


def assemble(rl):
    """-> (plan, info) or (None, reason)."""
    W, D = (snap(float(v)) for v in rl["plot"])
    if not (15 <= W <= 120 and 25 <= D <= 150): return None, "plot size out of range"
    # remember where each kept room was in the input, so washrooms stay attached to the right room
    rows, where = [], {}
    for ri, row in enumerate(rl.get("rows", []), 1):
        kept, pos = [], {}
        for ci, r in enumerate(row, 1):
            if float(r.get("w", 0)) > 0:
                pos[(ri, ci)] = len(kept)
                kept.append(r)
        if kept:
            where.update({k: (len(rows), v) for k, v in pos.items()})
            rows.append(kept)
    if len(rows) < 2: return None, "fewer than 2 rows"
    # a row's depth: its enclosed rooms' median depth (open strips like a lawn use their own)
    depth = []
    for row in rows:
        built = [float(r.get("d", 0)) for r in row if norm_type(r["t"]) not in bands.OPEN and float(r.get("d", 0)) > 0]
        anyd = [float(r.get("d", 0)) for r in row if float(r.get("d", 0)) > 0]
        depth.append(st.median(built) if built else st.median(anyd) if anyd else 0)
    if min(depth) <= 0: return None, "row without a depth"
    ds = fit(depth, D, 1.0)
    if ds is None: return None, "rows do not fit the plot depth"
    bands_, stretch = [], [abs(sum(depth) / D - 1)]
    for row, d in zip(rows, ds):
        ws = fit([float(r["w"]) for r in row], W, 1.0)
        if ws is None: return None, "rooms do not fit the plot width"
        stretch.append(abs(sum(float(r["w"]) for r in row) / W - 1))
        bands_.append({"d": d, "rooms": [{"t": norm_type(r["t"]), "w": w} for r, w in zip(row, ws)]})
    for b in rl.get("baths", []):
        try:
            bi, ri = where[(int(b["row"]), int(b["col"]))]
        except (KeyError, ValueError, TypeError):
            continue
        band, room = bands_[bi], bands_[bi]["rooms"][ri]
        if room["t"] in bands.OPEN or room.get("bath"): continue
        bw = min(snap(float(b.get("w", 5))), room["w"] - 1)
        bd = min(snap(float(b.get("d", 6))), band["d"] - 2)
        if bw < 3 or bd < 3: continue                             # does not fit this room: leave it out rather than squeeze it
        room["bath"] = [bw, bd, "L" if str(b.get("side", "R")).upper().startswith("L") else "R"]
    nb = sum(1 for b in bands_ for r in b["rooms"] if r["t"] in bands.BEDS)
    nbath = sum(1 for b in bands_ for r in b["rooms"] if r.get("bath"))
    plan = {"plot": {"w": W, "d": D}, "beds": nb, "baths": nbath, "focus": None, "bands": bands_}
    plan["focus"] = focus_of(plan)
    return plan, {"stretch": round(max(stretch), 3)}


def focus_of(plan):
    """Which 'bigger X' a real plan would satisfy: the one with the largest margin over its threshold, else balanced."""
    rects = bands.to_rects(plan)
    mains = [r for r in rects if r["t"] not in bands.OPEN and r["t"] != "bath"]
    built = sum(r["w"] * r["d"] for r in mains) or 1
    share = lambda ts: sum(r["w"] * r["d"] for r in mains if r["t"] in ts) / built
    nb = plan["beds"]
    W, D = plan["plot"]["w"], plan["plot"]["d"]
    base = bands.BED_BASE_SMALL if W * D / bands.MARLA <= 6 else bands.BED_BASE
    margins = {"bedrooms": share(bands.BEDS) - (base.get(nb, 0.57) + 0.04), "lounge": share({"lounge"}) - 0.20 - 0.08,
               "kitchen": share({"kitchen"}) - 0.10 - 0.04}
    f, m = max(margins.items(), key=lambda kv: kv[1])
    return f if m > 0 else "balanced"


def text_of(plan):
    return bands.serialize(plan)


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "real/gold.jsonl")
    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    ok = 0
    for r in rows:
        plan, info = assemble(r["rooms"])
        if plan is None:
            print(f"{r['id']}: FAILED ({info})"); continue
        cs = bands.check(plan)
        errs = [c for c in cs if c[0] == "err"]
        ok += not errs
        print(f"{r['id']}  {plan['plot']['w']:g}x{plan['plot']['d']:g}  beds {plan['beds']} baths {plan['baths']} focus {plan['focus']}  "
              f"stretch {info['stretch']:.0%}  score {bands.score(cs):.2f}  {'ERR ' + str([e[1] for e in errs]) if errs else 'failed: ' + ', '.join(bands.failed(cs))}")
    print(f"{ok}/{len(rows)} assemble into valid plans")


if __name__ == "__main__":
    main()
