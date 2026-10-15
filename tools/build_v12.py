"""Dataset v12: the v11 recipe with the layout families balanced and the gaps v11 showed filled.

    python tools/build_v12.py --rows 30000 --corridor 7000 --wing 14000 --workers 10
Changes from v11 (tools/build_v11.py):
  - rows / compact plans are generated again (not converted from v9): kanal houses are deeper (bands.generate) and
    small plots more often have no car porch, which lets the kitchen take the front row (bands.generate_small)
  - bedroom-wing plans on every plot from 10 marla to 2 kanal and for 2-5 bedrooms (gen_tree.wing adds a study, stairs
    or store when the plot is deeper than the bedrooms need), sampled evenly over three plot-size ranges so big plots
    do not end up with rows only
  - "bigger bedrooms" is judged against each family's own baseline (bands.BED_BASE_FAMILY), so wing and corridor plans
    with bigger bedrooms now pass the checker and enter the data (v11 had 49 and 0)
  - 70% of the plans carry their STYLE tag (v11: 50%), so the model sees more requests that name a layout
Writes data/pk12/{train,val,test}.jsonl (held-out plot sizes for val/test). The world pretraining set (data/world11) and
the real plans (data/real11) are the same as v11.
"""
import argparse, json, random, sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands, tree, gen_tree  # noqa: E402
from build_v11 import encodable, row_of  # noqa: E402

MARLA = bands.MARLA
TAG = 0.7
WING_BINS = [(9.5, 14), (14, 22), (22, 45)]                    # marla ranges a wing plot is drawn from, evenly


def sample_plot(rng, fam):
    while True:
        if fam == "corridor":
            W = rng.choice([25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]); D = rng.randint(50, 80)
            if 6 < W * D / MARLA <= 14.5: return W, D
        else:
            lo, hi = rng.choice(WING_BINS)
            W = rng.choice([35, 36, 38, 40, 42, 45, 48, 50, 55, 60]); D = rng.randint(55, 125)
            if lo < W * D / MARLA <= hi: return W, D


def _gen_tree(args):
    fam, n, seed = args
    rng = random.Random(seed)
    out, seen, tries = [], set(), 0
    while len(out) < n and tries < n * 400:
        tries += 1
        W, D = sample_plot(rng, fam)
        beds = 2 if fam == "corridor" else rng.randint(2, 5)
        baths = beds + rng.choice([0, 1, 1, 2])
        focus = rng.choices(bands.FOCUS_VALUES, [0.4, 0.2, 0.2, 0.2])[0]
        p = gen_tree.generate(W, D, beds, rng, baths, focus, fam)
        if p is None or tree.score(tree.check(p, beds)) < 1.0: continue
        if tree.family_of(p) != fam: continue                     # the label must be what the geometry shows
        r = row_of(p, fam, rng.random() < TAG)
        if not encodable(r["prompt"] + " " + r["completion"]): continue
        key = r["prompt"].split(" STYLE")[0] + r["completion"]
        if key in seen: continue
        seen.add(key); out.append(r)
    return out


def rows_plans(n, workers, rng):
    rows, tried, rej = bands.build_parallel(n, workers, seed=12)
    print(f"rows / compact: {len(rows)} plans from {tried} tries; most common rejections {rej.most_common(4)}")
    out = []
    for r in rows:
        tp = tree.from_bands(bands.parse(r["prompt"] + "\n" + r["completion"]))
        fam = "compact" if tp["plot"]["w"] * tp["plot"]["d"] / MARLA <= 6 else "rows"
        row = row_of(tp, fam, rng.random() < TAG)
        if encodable(row["prompt"] + " " + row["completion"]): out.append(row)
    return out


def size_bin(r):
    m = r["plot"][0] * r["plot"][1] / MARLA
    return "<=6" if m <= 6 else "6-10" if m <= 10 else "10-14" if m <= 14 else "14-22" if m <= 22 else ">22"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=30000)
    ap.add_argument("--corridor", type=int, default=7000)
    ap.add_argument("--wing", type=int, default=14000)
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--out", default="data/pk12")
    a = ap.parse_args()
    rng = random.Random(12)
    rows = rows_plans(a.rows, a.workers, rng)
    jobs = [("corridor", a.corridor // a.workers + 1, 1200 + i) for i in range(a.workers)] + \
           [("wing", a.wing // a.workers + 1, 2200 + i) for i in range(a.workers)]
    with Pool(a.workers) as pool:
        for part in pool.map(_gen_tree, jobs): rows += part
    c = Counter((size_bin(r), r["style"]) for r in rows)
    print("plans by plot size and family:")
    for b in ("<=6", "6-10", "10-14", "14-22", ">22"):
        print(f"  {b:6s} " + "  ".join(f"{f} {c[(b, f)]}" for f in ("compact", "rows", "corridor", "wing") if c[(b, f)]))
    print("by family and focus:", sorted(Counter((r["style"], r["focus"]) for r in rows).items()))
    parts = bands.split_by_plot(rows)
    out = ROOT / a.out
    out.mkdir(parents=True, exist_ok=True)
    for name, rs in parts.items():
        random.Random(1).shuffle(rs)
        with open(out / f"{name}.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for r in rs: f.write(json.dumps(r) + "\n")
    print({k: len(v) for k, v in parts.items()}, "->", out)


if __name__ == "__main__":
    main()
