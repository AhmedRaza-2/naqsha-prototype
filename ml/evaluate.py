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
import argparse, json, random, sys
from collections import Counter, defaultdict
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402
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
            want = int(p.split("BEDS ")[1])
            try:
                plan = bands.parse(p + "\n" + text)
                nb = sum(r_["t"] in bands.BEDS for b in plan["bands"] for r_ in b["rooms"])
                cs = bands.check(plan, plan["beds"])
                valid = not any(c[0] == "err" for c in cs)
            except Exception:
                nb, valid = -1, False
            group.append(dict(text=text, reward=r, parse=parse, valid=valid, bed_ok=nb == want, perfect=r == 1.0,
                              copied=(p, text) in train_set, failed=failed))
        res.append(group)
    return res


def summarize(res, prompts, name):
    flat = [g for grp in res for g in grp]
    n = len(flat)
    pct = lambda k: 100 * sum(g[k] for g in flat) / n
    out = {"model": name, "plans": n, "parse%": pct("parse"), "valid%": pct("valid"), "bed_ok%": pct("bed_ok"),
           "mean_score": sum(g["reward"] for g in flat) / n, "perfect%": pct("perfect"), "copied%": pct("copied"),
           "best@N": sum(max(g["reward"] for g in grp) for grp in res) / len(res),
           "distinct/N": sum(len({g["text"] for g in grp}) / len(grp) for grp in res) / len(res)}
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
        want = int(p.split("BEDS ")[1])
        plan = bands.generate(int(W) if W == int(W) else W, int(D) if D == int(D) else D, want, rng)
        if plan is None or plan["beds"] != want:
            res.append([dict(text="", reward=0.0, parse=True, valid=False, bed_ok=False, perfect=False, copied=False, failed=["generator"])])
        else:
            cs = bands.check(plan, want)
            res.append([dict(text=bands.serialize(plan), reward=bands.score(cs), parse=True, valid=not any(c[0] == "err" for c in cs),
                             bed_ok=True, perfect=bands.score(cs) == 1.0, copied=False, failed=bands.failed(cs))])
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
    prompts = sorted({r["prompt"] for r in test})[: a.n]
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
