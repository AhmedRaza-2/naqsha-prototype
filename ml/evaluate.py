"""Evaluate a trained layout model on plot sizes it never saw (the held-out test split).

    python ml/evaluate.py --ckpt runs/sft/model.pt --n 300 --samples 4
Metrics (per generated plan unless stated):
  parse      the text is valid band syntax
  valid      parses AND tiles the plot AND has the asked bedroom count AND has kitchen/drawing/lobby (no 'err')
  score      mean rule-checker score (0 for invalid)             perfect = all rule checks pass
  bed_ok     bedroom count equals the request
  best@N     best score among the N samples for a prompt, averaged over prompts (what the user would see)
  distinct   distinct plans among the N samples of a prompt (diversity)
  copied     generated plan is identical to a training plan (memorisation check)
Baseline: the random rule-based generator, one try per prompt.
"""
import argparse, json, random, re, sys
from collections import Counter, defaultdict
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402
tree = L.tree
bands = L.bands


def run(model, prompts, samples, temperature, top_k, train_set, bs=256):
    dev = next(model.parameters()).device
    model.eval()
    flat = [p for p in prompts for _ in range(samples)]
    outs = []
    for i in range(0, len(flat), bs):
        outs += model.sample(flat[i:i + bs], temperature, top_k)
    res = []
    for k, p in enumerate(prompts):
        group = []
        for ids in outs[k * samples:(k + 1) * samples]:
            text = L.decode(ids)
            r, failed = L.reward(p, ids)
            parse = "unparseable" not in failed
            want = int(re.search(r"BEDS (\d+)", p)[1])
            try:
                plan, cs, rects = parse_any(p + "\n" + text)
                nb = sum(r_["t"] in bands.BEDS for r_ in rects if "parent" not in r_)
                valid = not any(c[0] == "err" for c in cs)
                bath_ok = not any(c[1] == "bath count" for c in cs)
                focus_ok = not any(c[1].startswith("bigger ") and c[0] != "ok" for c in cs) and not any(c[1] == "focus value" for c in cs)
                family = tree.family_of(plan, rects)
            except Exception:
                nb, valid, bath_ok, focus_ok, family = -1, False, False, False, None
            group.append(dict(text=text, reward=r, parse=parse, valid=valid, bed_ok=nb == want, bath_ok=bath_ok, focus_ok=focus_ok, perfect=r == 1.0,
                              copied=(p, text) in train_set, failed=failed, grid=grid_of(p + "\n" + text) if valid else None,
                              shape=skeleton(p + "\n" + text) if valid else None,
                              asked=L.asked_style(p), family=family if valid else None))
        res.append(group)
    return res


def parse_any(text):
    """Rows of rooms or slicing tree -> (plan, checks, rectangles)."""
    plan, cs, rects, _ = L.parse_plan(text)
    return plan, cs, rects


def grid_of(text):
    """Room type of every 1 ft cell (rows from the road): used to measure how different two layouts are."""
    import numpy as np
    plan, _, rects = parse_any(text)
    W, D = int(plan["plot"]["w"]), int(plan["plot"]["d"])
    g = np.zeros((D, W), np.int16)
    ids = {}
    for r in sorted(rects, key=lambda r: "parent" in r):                  # washrooms drawn over their rooms
        y0, y1, x0, x1 = int(r["y"]), int(r["y"] + r["d"]), int(r["x"]), int(r["x"] + r["w"])
        g[y0:y1, x0:x1] = ids.setdefault(r["t"], len(ids) + 1)
    return g, ids


def layout_distance(a, b):
    """Share of the plot where two layouts put a different kind of room (0 = same layout, 1 = nothing in common)."""
    (ga, ia), (gb, ib) = a, b
    if ga.shape != gb.shape: return None
    name_a = {v: k for k, v in ia.items()}; name_b = {v: k for k, v in ib.items()}
    import numpy as np
    ta = np.vectorize(lambda v: hash(name_a.get(int(v), "")) % 9973)(ga)
    tb = np.vectorize(lambda v: hash(name_b.get(int(v), "")) % 9973)(gb)
    return float((ta != tb).mean())


def skeleton(text):
    """Macro arrangement: the first two levels of cuts with sizes and room names dropped (rows of rooms are converted
    to a tree first). Rows layouts all share one arrangement; a side corridor or a bedroom wing is a different one."""
    full = text
    body = full.split("\n", 1)[1].lstrip()
    if body[:1] in ("H", "V") or ":" not in body:
        node = tree.parse(full)["tree"]
    else:
        node = tree.from_bands(bands.parse(full))["tree"]

    def sig(n, depth):
        if n["k"] == "room": return "R"
        if depth == 2: return n["k"]
        return n["k"] + "(" + ",".join(sig(k, depth + 1) for k in n["kids"]) + ")"
    return sig(node, 0)


def summarize(res, prompts, name):
    flat = [g for grp in res for g in grp]
    n = len(flat)
    pct = lambda k: 100 * sum(g[k] for g in flat) / n
    out = {"model": name, "plans": n, "parse%": pct("parse"), "valid%": pct("valid"), "bed_ok%": pct("bed_ok"), "bath_ok%": pct("bath_ok"), "focus_ok%": pct("focus_ok"),
           "mean_score": sum(g["reward"] for g in flat) / n, "perfect%": pct("perfect"), "copied%": pct("copied"),
           "best@N": sum(max(g["reward"] for g in grp) for grp in res) / len(res),
           "distinct/N": sum(len({g["text"] for g in grp}) / len(grp) for grp in res) / len(res)}
    # diversity among the valid plans drafted for the same request
    dists, shapes = [], []
    for grp in res:
        ok = [g for g in grp if g.get("grid") is not None]
        for i in range(len(ok)):
            for j in range(i + 1, len(ok)):
                d = layout_distance(ok[i]["grid"], ok[j]["grid"])
                if d is not None: dists.append(d)
        if len(ok) >= 2: shapes.append(len({g["shape"] for g in ok}) / len(ok))
    out["diversity"] = sum(dists) / len(dists) if dists else None
    out["arrangements/N"] = sum(shapes) / len(shapes) if shapes else None
    out["arrangements_total"] = len({g["shape"] for g in flat if g.get("shape")})
    # requests that name a layout family (STYLE): share of their valid plans that have it, overall and per family
    asked = [g for g in flat if g.get("asked") and g["valid"]]
    out["style_followed%"] = 100 * sum(g["family"] == g["asked"] for g in asked) / len(asked) if asked else None
    out["style_followed_by_family"] = {f: round(100 * sum(g["family"] == f for g in asked if g["asked"] == f) / sum(g["asked"] == f for g in asked), 1)
                                       for f in sorted({g["asked"] for g in asked})}
    fails = Counter(f for g in flat for f in g["failed"])
    out["top_failures"] = fails.most_common(5)
    by = defaultdict(list)
    for p, grp in zip(prompts, res):
        W, D = map(float, p.split()[1].split("x"))
        marla = W * D / 225
        by["<=6 marla" if marla <= 6 else "6-14 marla" if marla <= 14 else ">14 marla"] += [g["reward"] for g in grp]
    out["score_by_size"] = {k: round(sum(v) / len(v), 3) for k, v in by.items()}
    return out


def baseline(prompts, seed=0):
    """One try of the random rule-based generator per prompt, scored by the same validator."""
    rng = random.Random(seed)
    res = []
    for p in prompts:
        W, D = map(float, p.split()[1].split("x"))
        want = int(re.search(r"BEDS (\d+)", p)[1])
        bm, fm = re.search(r"BATHS (\d+)", p), re.search(r"FOCUS ([a-z]+)", p)
        plan = bands.generate(int(W) if W == int(W) else W, int(D) if D == int(D) else D, want, rng, int(bm[1]) if bm else None, fm[1] if fm else "balanced")
        if plan is None or plan["beds"] != want:
            res.append([dict(text="", reward=0.0, parse=True, valid=False, bed_ok=False, bath_ok=False, focus_ok=False, perfect=False, copied=False, failed=["generator"])])
        else:
            cs = bands.check(plan, want)
            res.append([dict(text=bands.serialize(plan), reward=bands.score(cs), parse=True, valid=not any(c[0] == "err" for c in cs),
                             bed_ok=True, bath_ok=True, focus_ok=not any(c[1].startswith("bigger ") and c[0] != "ok" for c in cs), perfect=bands.score(cs) == 1.0, copied=False, failed=bands.failed(cs))])
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", nargs="+", required=True)
    ap.add_argument("--data", default="data/synth")
    ap.add_argument("--n", type=int, default=300, help="number of test prompts")
    ap.add_argument("--samples", type=int, default=4)
    ap.add_argument("--temp", type=float, default=0.8)
    ap.add_argument("--top-k", type=int, default=0)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    test = [json.loads(l) for l in open(f"{a.data}/test.jsonl", encoding="utf-8")]
    random.Random(0).shuffle(test)
    prompts = list(dict.fromkeys(r["prompt"] for r in test))[: a.n]      # test rows are already shuffled: a random sample of requests
    train_set = {(r["prompt"], r["completion"]) for r in map(json.loads, open(f"{a.data}/train.jsonl", encoding="utf-8"))}
    rows = [summarize(baseline(prompts), prompts, "rule-based generator (1 try)")]
    for c in a.ckpt:
        res = run(L.load(c), prompts, a.samples, a.temp, a.top_k, train_set)
        rows.append(summarize(res, prompts, c))
    for r in rows:
        print(json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()}, indent=1))
    if a.out: Path(a.out).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
