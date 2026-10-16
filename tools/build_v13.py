"""Dataset v13: two-storey houses on top of the v12 set.

    python tools/build_v13.py --ground 14000 --workers 10
Adds to data/pk12 (single-storey plans, kept as they are):
  - ground floors of two-storey houses (prompt tag STOREYS 2): every family, with stairs (tools/bands.py and
    tools/gen_tree.py with stairs=True); fewer bedrooms downstairs, as in real two-storey houses
  - first floors for them (prompt PLOT .. FLOOR 1 BOX .. UP .. BEDS .. BATHS ..): one or two per ground floor, from
    tools/gen_upper.py, all perfect under the first-floor checker (bands.check_upper)
Writes data/pk13/{train,val,test}.jsonl; the held-out plot sizes of v12 stay held out (the split is by plot size).
"""
import argparse, json, random, sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands, tree, gen_tree, gen_upper  # noqa: E402
from build_v11 import row_of  # noqa: E402

MARLA = bands.MARLA
TAG = 0.7


def encodable(text):
    """Every number must be a token the model knows: 0, or 0.5 to 150 on the 0.5 ft grid."""
    import re
    nums = re.findall(r"\d+(?:\.\d+)?", text.replace("x", " "))
    return all((float(v) == 0 or 0.5 <= float(v) <= 150) and float(v) * 2 == int(float(v) * 2) for v in nums)


def families_for(W, D, beds):
    """Same as families_for in ml/coverage_styles.py (and familiesFor in js/modelplans.js)."""
    marla = W * D / MARLA
    if marla <= 6: return ["compact"]
    side = 3 if marla <= 14 else 5
    Bw = W - 2 * side
    fams = ["rows"]
    if 18 <= Bw <= 29 and beds == 2: fams.append("corridor")
    if Bw >= 29 and 2 <= beds <= 5: fams.append("wing")
    return fams


def ground(W, D, beds, baths, focus, fam, rng):
    if fam in ("compact", "rows"):
        bp = bands.generate(W, D, beds, rng, baths, focus, stairs=True)
        if bp is None or bp["beds"] != beds: return None
        p = tree.from_bands(bp)
    else:
        p = gen_tree.generate(W, D, beds, rng, baths, focus, fam, stairs=True)
        if p is None: return None
    p["storeys"] = 2
    if tree.score(tree.check(p, beds)) < 1.0 or tree.family_of(p) != fam: return None
    return p


def _gen(args):
    n, seed = args
    rng = random.Random(seed)
    out, seen, tries = [], set(), 0
    while sum(r["floor"] == 0 for r in out) < n and tries < n * 300:
        tries += 1
        W, D = bands.sample_plot(rng)
        if bands.max_beds(W, D) == 0: continue
        cap = bands.max_beds(W, D)
        beds = rng.randint(bands.min_beds(W, D), min(cap, 3))           # downstairs: fewer bedrooms in a two-storey house
        baths = min(beds + rng.choice([0, 1, 1, 2]), bands.max_baths(W, D, beds))
        focus = rng.choices(bands.FOCUS_VALUES, [0.4, 0.2, 0.2, 0.2])[0]
        fam = rng.choice(families_for(W, D, beds))
        g = ground(W, D, beds, baths, focus, fam, rng)
        if g is None: continue
        r = row_of(g, fam, rng.random() < TAG)
        key = r["prompt"] + r["completion"]
        if key in seen or not encodable(key): continue
        uppers = []
        for _ in range(rng.choice([1, 2])):
            want = rng.choices([1, 2, 3, 4], [0.15, 0.4, 0.3, 0.15])[0]       # upstairs: usually 2-3 bedrooms
            for t in range(36):
                ub = max(1, want - t // 12)                                    # fewer only when the floor cannot hold them
                ubath = ub + rng.choice([0, 1])
                u = gen_upper.upper(g, rng, ub, ubath)
                if u is None or tree.score(tree.check(u, ub)) < 1.0: continue
                head, comp = tree.serialize(u).split("\n", 1)
                if not encodable(head + " " + comp) or any(x["completion"] == comp for x in uppers): continue
                uppers.append({"prompt": head, "completion": comp, "plot": [W, D], "beds": ub, "baths": ubath, "focus": None,
                               "style": "upper", "score": 1.0, "floor": 1})
                break
        if not uppers: continue                                       # every ground floor here has a first floor
        seen.add(key)
        out.append({**r, "floor": 0}); out += uppers
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ground", type=int, default=14000)
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--base", default="data/pk12")
    ap.add_argument("--out", default="data/pk13")
    a = ap.parse_args()
    with Pool(a.workers) as pool:
        parts = pool.map(_gen, [(a.ground // a.workers + 1, 1300 + i) for i in range(a.workers)])
    new = [r for p in parts for r in p]
    print("two-storey ground floors by family:", dict(Counter(r["style"] for r in new if r["floor"] == 0)))
    print("first floors:", sum(r["floor"] == 1 for r in new), " by bedrooms:", dict(sorted(Counter(r["beds"] for r in new if r["floor"] == 1).items())))
    m = lambda r: r["plot"][0] * r["plot"][1] / MARLA
    print("ground floors by size:", dict(Counter("<=6" if m(r) <= 6 else "6-10" if m(r) <= 10 else "10-14" if m(r) <= 14 else ">14" for r in new if r["floor"] == 0)))
    # keep v12's held-out plot sizes held out: split the new plans by the same plot-size rule, then add v12's splits
    base = {name: [json.loads(l) for l in open(ROOT / a.base / f"{name}.jsonl", encoding="utf-8")] for name in ("train", "val", "test")}
    held = {name: {tuple(r["plot"]) for r in rows} for name, rows in base.items() if name != "train"}
    split = bands.split_by_plot(new, seed=13)
    for name in ("val", "test"):                                       # a plot size held out in v12 never enters training
        for nm2, rows in list(split.items()):
            if nm2 == name: continue
            move = [r for r in rows if tuple(r["plot"]) in held[name]]
            split[nm2] = [r for r in rows if tuple(r["plot"]) not in held[name]]
            split[name] += move
    out = ROOT / a.out
    out.mkdir(parents=True, exist_ok=True)
    for name in ("train", "val", "test"):
        rows = base[name] + split[name]
        random.Random(13).shuffle(rows)
        with open(out / f"{name}.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for r in rows: f.write(json.dumps(r) + "\n")
        print(name, len(rows), f"({len(split[name])} new)")


if __name__ == "__main__":
    main()
