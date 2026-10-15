"""Dataset v11 (slicing trees): world pretraining set + a more varied Pakistani set.

    python tools/build_v11.py --corridor 6000 --wing 6000 --workers 10
Writes
  data/world11/{train,val}.jsonl   ResPlan plans (tools/../real/resplan_convert.py) with the prompt tag SRC world
  data/pk11/{train,val,test}.jsonl Pakistani plans as trees: the v9 rows/compact plans converted, plus new corridor and
                                   wing plans (perfect under the checker); half the rows carry a STYLE tag so the model
                                   learns both "any arrangement" and "this arrangement"; held-out plot sizes for val/test
  data/real11/{train,test}.jsonl   the real Pakistani plans (silver for training, gold for testing) as trees
"""
import argparse, json, random, sys
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands, tree, gen_tree  # noqa: E402

MARLA = bands.MARLA


def encodable(text):
    """Every number must be a token the model knows: 0.5 to 150 on the 0.5 ft grid."""
    import re
    nums = re.findall(r"\d+(?:\.\d+)?", text.replace("x", " "))
    return all(0.5 <= float(v) <= 150 and float(v) * 2 == int(float(v) * 2) for v in nums)


def row_of(plan, style, tag):
    p = dict(plan)
    if tag: p["style"] = style
    txt = tree.serialize(p)
    head, comp = txt.split("\n", 1)
    cs = tree.check(plan, plan["beds"])
    return {"prompt": head, "completion": comp, "plot": [plan["plot"]["w"], plan["plot"]["d"]], "beds": plan["beds"], "baths": plan.get("baths"),
            "focus": plan.get("focus"), "style": style, "score": round(tree.score(cs), 3)}


def sample_plot(rng, fam):
    while True:
        if fam == "corridor":
            W = rng.choice([25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]); D = rng.randint(50, 80)
        else:
            W = rng.choice([34, 35, 36, 38, 40, 42, 45, 48, 50, 55, 60]); D = rng.randint(55, 110)
        if 6 < W * D / MARLA <= 45: return W, D


def _gen(args):
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
        r = row_of(p, fam, rng.random() < 0.5)
        key = r["prompt"].split(" STYLE")[0] + r["completion"]
        if key in seen: continue
        seen.add(key); out.append(r)
    return out


def convert_v9(path, rng):
    rows = []
    for l in open(path, encoding="utf-8"):
        r = json.loads(l)
        bp = bands.parse(r["prompt"] + "\n" + r["completion"])
        tp = tree.from_bands(bp)
        style = "compact" if bp["plot"]["w"] * bp["plot"]["d"] / MARLA <= 6 else "rows"
        rows.append(row_of(tp, style, rng.random() < 0.5))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corridor", type=int, default=6000)
    ap.add_argument("--wing", type=int, default=6000)
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--v9", default="data/synth_v9")
    a = ap.parse_args()
    rng = random.Random(11)

    # world pretraining set: tag the source
    Path("data/world11").mkdir(parents=True, exist_ok=True)
    for name in ("train", "val"):
        with open(f"data/world11/{name}.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for l in open(f"data/world/{name}.jsonl", encoding="utf-8"):
                r = json.loads(l); r["prompt"] += " SRC world"
                if not encodable(r["prompt"] + " " + r["completion"]): continue      # e.g. BATHS 0: no washroom was found
                f.write(json.dumps(r) + "\n")

    # Pakistani set: v9 converted + new families
    rows = []
    for name in ("train", "val", "test"):
        rows += convert_v9(f"{a.v9}/{name}.jsonl", rng)
    jobs = [("corridor", a.corridor // a.workers + 1, 100 + i) for i in range(a.workers)] + [("wing", a.wing // a.workers + 1, 200 + i) for i in range(a.workers)]
    with Pool(a.workers) as pool:
        for part in pool.map(_gen, jobs): rows += part
    from collections import Counter
    print("Pakistani rows by family:", dict(Counter(r["style"] for r in rows)))
    parts = bands.split_by_plot(rows)
    Path("data/pk11").mkdir(parents=True, exist_ok=True)
    for name, rs in parts.items():
        random.Random(1).shuffle(rs)
        with open(f"data/pk11/{name}.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for r in rs: f.write(json.dumps(r) + "\n")
    print({k: len(v) for k, v in parts.items()})

    # real Pakistani plans as trees
    Path("data/real11").mkdir(parents=True, exist_ok=True)
    for src, dst in (("data/real/train.jsonl", "train"), ("data/real/test.jsonl", "test"), ("data/real/test_silver.jsonl", "test_silver"), ("data/real/val.jsonl", "val")):
        if not Path(src).exists(): continue
        with open(f"data/real11/{dst}.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for l in open(src, encoding="utf-8"):
                r = json.loads(l)
                tp = tree.from_bands(bands.parse(r["prompt"] + "\n" + r["completion"]))
                head, comp = tree.serialize(tp).split("\n", 1)
                f.write(json.dumps({**r, "prompt": head, "completion": comp}) + "\n")
    print("real plans as trees in data/real11")


if __name__ == "__main__":
    main()
