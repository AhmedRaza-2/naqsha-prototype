"""Dataset v17 (also used by v18): the v13 synthetic plans without the ones that use their plot badly (ml/quality.py below --min).

    python tools/build_v17.py --min 0.82
  data/pk13/train.jsonl -> data/pk17/train.jsonl (val and test copied unchanged, so the numbers stay comparable with v13)
A plot size never loses more than 40% of its plans, so no size disappears from the training set.
(v16 used the same script with the first version of ml/quality.py, whose room-size targets did not shrink on small plots.)
"""
import argparse, json, shutil, sys
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml")); sys.path.insert(0, str(ROOT / "tools"))


def q_of(line):
    import layoutlm as L
    from quality import quality
    r = json.loads(line)
    try:
        plan, cs, rects, _ = L.parse_plan(r["prompt"] + "\n" + r["completion"])
        return quality(plan, rects)[0]
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=float, default=0.82)
    ap.add_argument("--src", default="data/pk13")
    ap.add_argument("--out", default="data/pk17")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    lines = open(f"{a.src}/train.jsonl", encoding="utf-8").read().splitlines()
    with Pool(a.workers) as p: qs = p.map(q_of, lines, chunksize=200)
    plot = lambda l: " ".join(json.loads(l)["prompt"].split()[:4])          # "PLOT 30x50 BEDS 3": plot size and bedrooms (as data/pk17 was built)
    by = defaultdict(list)
    for i, l in enumerate(lines): by[plot(l)].append(i)
    keep = set()
    for idx in by.values():
        good = [i for i in idx if qs[i] is not None and qs[i] >= a.min]
        if len(good) < 0.6 * len(idx):                                         # keep the best 60% of this plot size
            good = sorted(idx, key=lambda i: -(qs[i] or 0))[: max(1, int(0.6 * len(idx)))]
        keep.update(good)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    with open(out / "train.jsonl", "w", encoding="utf-8", newline="\n") as f:
        for i in sorted(keep): f.write(lines[i] + "\n")
    for name in ("val.jsonl", "test.jsonl", "meta.json"):
        if (Path(a.src) / name).exists(): shutil.copy(Path(a.src) / name, out / name)
    v = [q for q in qs if q is not None]
    kq = [qs[i] for i in keep if qs[i] is not None]
    print(f"{len(lines)} plans, kept {len(keep)}; mean quality {sum(v) / len(v):.3f} -> {sum(kq) / len(kq):.3f}")


if __name__ == "__main__":
    main()
