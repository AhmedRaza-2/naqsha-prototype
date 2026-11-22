"""CubiCasa5k (5,000 real floor plans drawn as SVG, CC BY-NC 4.0, zenodo.org/records/2613548) -> slicing-tree plans for pretraining.

    python real/cubicasa_convert.py <folder with high_quality_architectural, high_quality, colorful> --out data/world_cc --workers 4
    python real/cubicasa_convert.py --selftest

Same recipe as real/resplan_convert.py (which supplies the tree fitter): every room polygon is read from model.svg
(<g class="Space Bedroom"><polygon points="..."/>), rasterised on a 0.5 ft grid, turned so the entrance is on the road side and cut
recursively into a slicing tree. The SVGs have no real-world scale, so it comes from the median bedroom (12.6 m2, the same
assumption resplan_convert makes for ResPlan plans without an area). Plans are kept when the tree reproduces the layout well.
Rows are tagged  source: cubicasa  and the prompt carries SRC world like the ResPlan rows.
"""
import argparse, json, re, sys, xml.etree.ElementTree as ET
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import tree  # noqa: E402
import resplan_convert as R  # noqa: E402

# CubiCasa space class -> our type; None = leave as void (unknown / undefined space)
CLASSES = {"Bedroom": "bed", "Bath": "bath", "Kitchen": "kitchen", "LivingRoom": "lounge", "Dining": "dining", "Entrance": "lobby",
           "DraughtLobby": "lobby", "Hall": "passage", "Storage": "store", "Closet": "store", "Garage": "porch", "Outdoor": "lawn",
           "Library": "study", "Sauna": "bath", "Undefined": None, "Alcove": None, "Fireplace": None}
PAINT_LAST = ["lawn", "porch", "passage", "lobby", "store", "dining", "lounge", "kitchen", "bed", "bath"]     # later = wins where polygons overlap
R.TYPES = ["void"] + sorted(set(t for t in CLASSES.values() if t))
R.TID = {t: i for i, t in enumerate(R.TYPES)}
FT = R.FT


def read_svg(path):
    """-> list of (type or None, shapely polygon) for every Space in the SVG."""
    from shapely.geometry import Polygon
    root = ET.parse(path).getroot()
    out = []
    for g in root.iter():
        if not g.tag.endswith("}g") and g.tag != "g": continue
        cls = g.get("class") or ""
        m = re.match(r"Space\s+(\w+)", cls)
        if not m: continue
        for poly in list(g):                                          # direct children only: nested groups hold icons and dimension marks
            if not poly.tag.endswith("polygon"): continue
            pts = re.findall(r"(-?\d+(?:\.\d+)?)[, ]+(-?\d+(?:\.\d+)?)", poly.get("points") or "")
            if len(pts) < 3: continue
            try:
                p = Polygon([(float(a), float(b)) for a, b in pts])
                if not p.is_valid: p = p.buffer(0)
            except Exception:
                continue
            if not p.is_empty and p.area > 0: out.append((CLASSES.get(m[1]), p))
    return out


def rasterise(spaces):
    import shapely
    from shapely.ops import unary_union
    rooms = [(t, g) for t, g in spaces if t]
    beds = sorted(g.area for t, g in rooms if t == "bed")
    if not rooms or not beds: return None, "no bedroom"
    med = beds[len(beds) // 2]
    s = (12.6 / med) ** 0.5 * FT                                  # ft per unit
    allg = unary_union([g for _, g in rooms])
    if allg.is_empty: return None, "empty"
    x0, y0, x1, y1 = allg.bounds
    W, D = (x1 - x0) * s, (y1 - y0) * s
    if not (12 <= W <= 120 and 12 <= D <= 120): return None, "size out of range"
    RES = R.RES
    nx, ny = int(round(W / RES)), int(round(D / RES))
    xs = x0 + (np.arange(nx) + 0.5) * RES / s
    ys = y0 + (np.arange(ny) + 0.5) * RES / s
    X, Y = np.meshgrid(xs, ys)
    lab = np.zeros((ny, nx), np.int8)
    for t in PAINT_LAST:
        for tt, g in rooms:
            if tt == t: lab[shapely.contains_xy(g, X, Y)] = R.TID[t]
    inside = shapely.contains_xy(allg.buffer(0.4 / (s / FT)), X, Y)       # walls: ~0.4 m either side
    for _ in range(8):
        hole = (lab == 0) & inside
        if not hole.any(): break
        fill = np.zeros_like(lab)
        for sh in (np.roll(lab, 1, 0), np.roll(lab, -1, 0), np.roll(lab, 1, 1), np.roll(lab, -1, 1)):
            fill = np.where((fill == 0) & (sh > 0), sh, fill)
        lab = np.where(hole, fill, lab)
    # entrance side = the road side (row 0)
    door = [g for t, g in rooms if t in ("lobby",)] or [g for t, g in rooms if t in ("lawn", "porch")]
    if door:
        c = unary_union(door).centroid
        d = {"bottom": c.y - y0, "top": y1 - c.y, "left": c.x - x0, "right": x1 - c.x}
        side = min(d, key=d.get)
    else:
        side = "bottom"
    if side == "top": lab = lab[::-1, :]
    elif side == "left": lab = np.rot90(lab, -1)
    elif side == "right": lab = np.rot90(lab, 1)
    return lab, "ok"


def convert(path, pid):
    lab, why = rasterise(read_svg(path))
    if lab is None: return None, why
    ny, nx = lab.shape
    root, miss = R.fit(lab)
    fidelity = 1 - miss / lab.size
    root = R.to_feet(R.tidy(root, {"H": ny, "V": nx}))
    plan = {"plot": {"w": nx * R.RES, "d": ny * R.RES}, "beds": 0, "baths": 0, "focus": "balanced", "tree": root}
    rooms, errs = tree.leaves(plan)
    if errs: return None, "cut sizes"
    beds = [r for r in rooms if r["t"] == "bed"]
    if not beds: return None, "no bedroom"
    area = lambda r: r["w"] * r["d"]
    tot = sum(area(r) for r in rooms) or 1
    if not any(r["t"] == "kitchen" for r in rooms): return None, "no kitchen"
    if not any(r["t"] in ("lounge", "dining") for r in rooms): return None, "no living room"
    if sum(area(r) for r in rooms if r["t"] == "void") / tot > 0.22: return None, "too much empty space"
    if plan["plot"]["w"] * plan["plot"]["d"] < 450: return None, "too small"
    master_i = max((i for i, r in enumerate(rooms) if r["t"] == "bed"), key=lambda i: rooms[i]["w"] * rooms[i]["d"])
    for i, n in enumerate(R._rooms_in_order(root)):
        if i == master_i: n["t"] = "master"
    plan["beds"] = len(beds)
    plan["baths"] = sum(1 for r in rooms if r["t"] == "bath")
    txt = tree.serialize(plan)
    if len(tree._TOK.findall(txt.split("\n", 1)[1])) > 230: return None, "too long for the model"
    if not R.tree_encodable(txt): return None, "numbers outside the vocabulary"
    return {"id": pid, "text": txt, "fidelity": round(fidelity, 3)}, "ok"


def _work(args):
    out, why = [], Counter()
    for path, pid in args:
        try:
            row, reason = convert(path, pid)
        except Exception as e:
            row, reason = None, f"error {type(e).__name__}"
        why[reason] += 1
        if row: out.append(row)
    return out, why


def selftest():
    """A hand-made SVG in CubiCasa's format: two bedrooms, bath, kitchen, living room, entrance."""
    import tempfile
    def sp(c, x0, y0, x1, y1):
        return f'<g id="s" class="Space {c}"><polygon points="{x0},{y0} {x1},{y0} {x1},{y1} {x0},{y1}"/></g>'
    svg = ('<svg xmlns="http://www.w3.org/2000/svg">' + sp("Entrance", 0, 0, 120, 120) + sp("LivingRoom", 120, 0, 480, 300)
           + sp("Kitchen", 480, 0, 720, 300) + sp("Bedroom", 0, 300, 360, 640) + sp("Bedroom", 360, 300, 720, 640) + sp("Bath", 0, 120, 120, 300) + '</svg>')
    p = Path(tempfile.mkdtemp()) / "model.svg"; p.write_text(svg)
    row, why = convert(p, "selftest")
    print(why, row)
    assert row and row["fidelity"] > 0.9, "selftest failed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?")
    ap.add_argument("--out", default="data/world_cc")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--min-fidelity", type=float, default=0.82)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest: return selftest()
    svgs = sorted(Path(a.root).rglob("model.svg"))[: a.limit]
    jobs = [(str(p), p.parent.name) for p in svgs]
    chunks = [jobs[i::a.workers] for i in range(a.workers)]
    with Pool(a.workers) as pool: parts = pool.map(_work, chunks)
    rows, why = [], Counter()
    for r_, w_ in parts: rows += r_; why.update(w_)
    kept = [r for r in rows if r["fidelity"] >= a.min_fidelity]
    why["fidelity below threshold"] = len(rows) - len(kept)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    n_tr = n_va = 0
    with open(out / "train.jsonl", "w", encoding="utf-8", newline="\n") as ftr, open(out / "val.jsonl", "w", encoding="utf-8", newline="\n") as fva:
        for i, r in enumerate(sorted(kept, key=lambda r: str(r["id"]))):
            head, comp = r["text"].split("\n", 1)
            row = {"prompt": head, "completion": comp, "id": f"cc{r['id']}", "fidelity": r["fidelity"], "source": "cubicasa"}
            is_val = i % 20 == 0
            (fva if is_val else ftr).write(json.dumps(row) + "\n")
            n_va += is_val; n_tr += not is_val
    print(f"{len(jobs)} plans: kept {len(kept)} (train {n_tr}, val {n_va}); reasons {dict(why.most_common())}")


if __name__ == "__main__":
    main()
