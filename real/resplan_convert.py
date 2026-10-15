"""ResPlan (17,000 real residential plans, CC BY 4.0, github.com/m-agour/ResPlan) -> slicing-tree plans for pretraining.

    python real/resplan_convert.py data/resplan/ResPlan.pkl --out data/world --workers 8 [--limit 200] [--show 6]

Each plan's room polygons are rasterised on a 0.5 ft grid (one room type per cell), turned so the front door faces the
road (row 0), and then cut recursively like a decision tree: every cut is the horizontal or vertical line that best
separates room types, until a piece is almost one room. A plan is kept when its rooms cover the real layout well
(fidelity, the share of cells whose room type the tree reproduces) and its text is short enough for the model.
The pickle is loaded with an unpickler that only allows Shapely geometry and NumPy scalars.
"""
import argparse, json, pickle, sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands, tree  # noqa: E402

ALLOWED = {("shapely.io", "from_wkb"), ("numpy._core.multiarray", "scalar"), ("numpy", "dtype"), ("numpy.core.multiarray", "scalar")}
# ResPlan class -> our room type; earlier entries win where polygons overlap
CLASSES = [("bathroom", "bath"), ("kitchen", "kitchen"), ("bedroom", "bed"), ("storage", "store"), ("stair", "stairs"),
           ("living", "lounge"), ("inner", "passage"), ("balcony", "balcony"), ("garden", "lawn"), ("parking", "porch"), ("pool", "lawn")]
TYPES = ["void"] + sorted({t for _, t in CLASSES})
TID = {t: i for i, t in enumerate(TYPES)}
RES = 0.5            # ft per cell
FT = 3.28084


class SafeUnpickler(pickle.Unpickler):
    def find_class(self, mod, name):
        if (mod, name) not in ALLOWED: raise pickle.UnpicklingError(f"blocked {mod}.{name}")
        return super().find_class(mod, name)


def load(path):
    with open(path, "rb") as f:
        return SafeUnpickler(f).load()


def rasterise(p):
    """-> label grid (rows from the front door side), or None for plans with a broken scale."""
    import shapely
    from shapely.ops import unary_union
    polys = [(p[k], t) for k, t in CLASSES if k in p and p[k] is not None and not p[k].is_empty]
    core = unary_union([g for g, t in polys if t not in ("balcony", "lawn", "porch")])
    if core.is_empty or core.area <= 0: return None
    allg = unary_union([g for g, _ in polys])
    # metres per unit: from the plan's net area, else its gross area, else a typical 12.6 m2 bedroom (some plans carry 0)
    s = None
    for area_m2, units in ((p.get("net_area"), core.area), (p.get("area"), allg.area)):
        try:
            v = (float(area_m2) / units) ** 0.5 if area_m2 and float(area_m2) > 0 else None
        except (TypeError, ValueError):
            v = None
        if v and 0.02 <= v <= 0.08: s = v; break
    if s is None and "bedroom" in p and not p["bedroom"].is_empty:
        geoms = getattr(p["bedroom"], "geoms", [p["bedroom"]])
        med = sorted(g.area for g in geoms)[len(geoms) // 2]
        v = (12.6 / med) ** 0.5 if med > 0 else None
        if v and 0.02 <= v <= 0.08: s = v
    if s is None: return None
    s *= FT                                                                # ft per unit
    x0, y0, x1, y1 = allg.bounds
    W, D = (x1 - x0) * s, (y1 - y0) * s
    if not (12 <= W <= 120 and 12 <= D <= 120): return None
    nx, ny = int(round(W / RES)), int(round(D / RES))
    xs = x0 + (np.arange(nx) + 0.5) * RES / s
    ys = y0 + (np.arange(ny) + 0.5) * RES / s
    X, Y = np.meshgrid(xs, ys)
    lab = np.zeros((ny, nx), np.int8)
    for g, t in reversed(polys):                                           # earlier classes painted last = win
        lab[shapely.contains_xy(g, X, Y)] = TID[t]
    # wall cells inside the outline: take the room type of the nearest labelled neighbour
    inside = shapely.contains_xy(allg.buffer(p.get("wall_depth", 4.5) * 1.2), X, Y)
    for _ in range(8):
        hole = (lab == 0) & inside
        if not hole.any(): break
        shifted = [np.roll(lab, 1, 0), np.roll(lab, -1, 0), np.roll(lab, 1, 1), np.roll(lab, -1, 1)]
        fill = np.zeros_like(lab)
        for sh in shifted: fill = np.where((fill == 0) & (sh > 0), sh, fill)
        lab = np.where(hole, fill, lab)
    # turn so the front door is on row 0 (the road side)
    fd = p.get("front_door")
    if fd is not None and not fd.is_empty:
        cx, cy = fd.centroid.x, fd.centroid.y
        d = {"bottom": cy - y0, "top": y1 - cy, "left": cx - x0, "right": x1 - cx}
        side = min(d, key=d.get)
    else:
        side = "bottom"
    # grid row 0 is y0 (bottom) in plan units
    if side == "top": lab = lab[::-1, :]
    elif side == "left": lab = np.rot90(lab, -1)                          # left edge -> row 0
    elif side == "right": lab = np.rot90(lab, 1)
    return lab


def _hist(cum, r0, r1, c0, c1):
    return cum[r1, c1] - cum[r0, c1] - cum[r1, c0] + cum[r0, c0]


def fit(lab, purity=0.96, min_cells=5, max_leaves=48):
    """Recursive axis cuts (like a decision tree on x and y) -> slicing tree in cells, and the misfit cell count."""
    ny, nx = lab.shape
    K = len(TYPES)
    onehot = np.eye(K, dtype=np.int32)[lab]
    cum = np.zeros((ny + 1, nx + 1, K), np.int32)
    cum[1:, 1:] = onehot.cumsum(0).cumsum(1)
    leaves = [0]

    def leaf(r0, r1, c0, c1):
        h = _hist(cum, r0, r1, c0, c1)
        return {"k": "room", "t": TYPES[int(h.argmax())]}, int(h.sum() - h.max())

    def go(r0, r1, c0, c1, depth):
        h = _hist(cum, r0, r1, c0, c1)
        area = int(h.sum())
        miss = area - int(h.max())
        if miss <= (1 - purity) * area or depth > 12 or leaves[0] >= max_leaves or (r1 - r0) < 2 * min_cells and (c1 - c0) < 2 * min_cells:
            leaves[0] += 1
            return leaf(r0, r1, c0, c1)
        best = None
        for k in range(r0 + min_cells, r1 - min_cells + 1):                # horizontal cut: front part rows r0..k
            a, b = _hist(cum, r0, k, c0, c1), _hist(cum, k, r1, c0, c1)
            cost = (a.sum() - a.max()) + (b.sum() - b.max())
            if best is None or cost < best[0]: best = (cost, "H", k)
        for k in range(c0 + min_cells, c1 - min_cells + 1):                # vertical cut: left part cols c0..k
            a, b = _hist(cum, r0, r1, c0, k), _hist(cum, r0, r1, k, c1)
            cost = (a.sum() - a.max()) + (b.sum() - b.max())
            if best is None or cost < best[0]: best = (cost, "V", k)
        if best is None or best[0] >= miss:                               # no cut helps: stop here
            leaves[0] += 1
            return leaf(r0, r1, c0, c1)
        _, kind, k = best
        if kind == "H":
            (n1, m1), (n2, m2) = go(r0, k, c0, c1, depth + 1), go(k, r1, c0, c1, depth + 1)
            return {"k": "H", "sizes": [k - r0], "kids": [n1, n2]}, m1 + m2
        (n1, m1), (n2, m2) = go(r0, r1, c0, k, depth + 1), go(r0, r1, k, c1, depth + 1)
        return {"k": "V", "sizes": [k - c0], "kids": [n1, n2]}, m1 + m2

    root, miss = go(0, ny, 0, nx, 0)
    return root, miss


def tidy(node, extent_cells):
    """Flatten nested cuts in the same direction, merge neighbouring rooms of the same type, cells -> feet."""
    if node["k"] == "room": return node

    def sizes_of(n, total):
        return n["sizes"] + [total - sum(n["sizes"])]
    parts = []
    for kid, sz in zip(node["kids"], sizes_of(node, extent_cells[node["k"]])):
        sub_ext = dict(extent_cells); sub_ext[node["k"]] = sz
        kid = tidy(kid, sub_ext)
        if kid["k"] == node["k"]:
            for kk, ks in zip(kid["kids"], kid["sizes"] + [sz - sum(kid["sizes"])]): parts.append((kk, ks))
        else:
            parts.append((kid, sz))
    merged = []
    for kid, sz in parts:
        if merged and kid["k"] == "room" and merged[-1][0]["k"] == "room" and merged[-1][0]["t"] == kid["t"] and kid["t"] != "bed":
            merged[-1] = (merged[-1][0], merged[-1][1] + sz)
        else:
            merged.append((kid, sz))
    if len(merged) == 1: return merged[0][0]
    return {"k": node["k"], "sizes": [s for _, s in merged[:-1]], "kids": [k for k, _ in merged]}


def to_feet(node):
    if node["k"] == "room": return node
    return {"k": node["k"], "sizes": [s * RES for s in node["sizes"]], "kids": [to_feet(k) for k in node["kids"]]}


def convert(p):
    lab = rasterise(p)
    if lab is None: return None, "bad scale or size"
    ny, nx = lab.shape
    root, miss = fit(lab)
    fidelity = 1 - miss / lab.size
    root = to_feet(tidy(root, {"H": ny, "V": nx}))
    plan = {"plot": {"w": nx * RES, "d": ny * RES}, "beds": 0, "baths": 0, "focus": "balanced", "tree": root}
    rooms, errs = tree.leaves(plan)
    if errs: return None, "cut sizes"
    beds = [r for r in rooms if r["t"] == "bed"]
    if not beds: return None, "no bedroom"
    # the largest bedroom is the master
    master_i = max((i for i, r in enumerate(rooms) if r["t"] == "bed"), key=lambda i: rooms[i]["w"] * rooms[i]["d"])
    for i, n in enumerate(_rooms_in_order(root)):
        if i == master_i: n["t"] = "master"
    plan["beds"] = len(beds)
    plan["baths"] = sum(1 for r in rooms if r["t"] == "bath")
    txt = tree.serialize(plan)
    ntok = len(tree._TOK.findall(txt.split("\n", 1)[1]))
    if ntok > 230: return None, "too long for the model"
    if not tree_encodable(txt): return None, "numbers outside the vocabulary"
    return {"id": int(p.get("id", -1)), "text": txt, "fidelity": round(fidelity, 3), "tokens": ntok}, "ok"


def _rooms_in_order(node):
    if node["k"] == "room":
        yield node
    else:
        for k in node["kids"]: yield from _rooms_in_order(k)


def tree_encodable(txt):
    import re
    return all(0.5 <= float(v) <= 150 and float(v) * 2 == int(float(v) * 2) for v in re.findall(r"(?<![x\d.])\d+(?:\.\d+)?(?![\d.])", txt.split("\n", 1)[1]))


def _work(chunk):
    out, why = [], Counter()
    for p in chunk:
        try:
            row, reason = convert(p)
        except Exception as e:
            row, reason = None, f"error {type(e).__name__}"
        why[reason] += 1
        if row: out.append(row)
    return out, why


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pkl")
    ap.add_argument("--out", default="data/world")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--min-fidelity", type=float, default=0.82)
    ap.add_argument("--show", type=int, default=0, help="render this many converted plans to <out>/preview")
    a = ap.parse_args()
    data = load(a.pkl)[: a.limit]
    split = json.load(open(Path(a.pkl).with_name("split.json"))) if Path(a.pkl).with_name("split.json").exists() else {}
    chunks = [data[i::a.workers] for i in range(a.workers)]
    with Pool(a.workers) as pool:
        parts = pool.map(_work, chunks)
    rows, why = [], Counter()
    for r_, w_ in parts: rows += r_; why.update(w_)
    kept = [r for r in rows if r["fidelity"] >= a.min_fidelity]
    why["fidelity below threshold"] = len(rows) - len(kept)
    why["ok"] -= why["fidelity below threshold"]
    val_ids = set(split.get("val", [])) | set(split.get("test", []))
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    n_tr = n_va = 0
    with open(out / "train.jsonl", "w", encoding="utf-8", newline="\n") as ftr, open(out / "val.jsonl", "w", encoding="utf-8", newline="\n") as fva:
        for i, r in enumerate(kept):
            head, comp = r["text"].split("\n", 1)
            row = {"prompt": head, "completion": comp, "id": r["id"], "fidelity": r["fidelity"], "source": "resplan"}
            is_val = (r["id"] in val_ids) if val_ids else (i % 20 == 0)
            (fva if is_val else ftr).write(json.dumps(row) + "\n")
            n_va += is_val; n_tr += not is_val
    fid = sorted(r["fidelity"] for r in kept)
    print(f"{len(data)} plans: kept {len(kept)} (train {n_tr}, val {n_va}); median fidelity {fid[len(fid) // 2] if fid else 0}; reasons {dict(why.most_common())}")
    if a.show:
        from render_plan import render
        prev = out / "preview"; prev.mkdir(exist_ok=True)
        for k, r in enumerate(kept[: a.show]):
            plan = tree.parse(r["text"])
            rects = tree.to_rects(plan)
            render({"id": f"w{k}", "plot": plan["plot"], "rooms": [{"t": x["t"], "name": x["t"], "x": x["x"], "y": x["y"], "w": x["w"], "d": x["d"], "type": x["t"]} for x in rects]}, prev / f"w{k}.png")
        print("previews in", prev)


if __name__ == "__main__":
    main()
