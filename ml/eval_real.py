"""How well does a model know real Pakistani plans? Compares checkpoints on held-out real plans.

    python ml/eval_real.py --ckpt runs/rl_v9/model.pt runs/rl_v10/model.pt --out runs/eval_real.json
1. Likelihood: average cross-entropy per token of the real plans (gold = hand transcribed, silver held out = read by the
   vision model, neither trained on). Lower = the model finds real layouts more probable, i.e. it has learned how real
   houses are arranged. Reported as loss and perplexity.
2. Realism of its own plans: for the same requests (plot, bedrooms, washrooms) it drafts --samples plans each; we report
   validity and rule score, and how far the median room sizes (bedroom, drawing, lounge, kitchen) are from the real
   plans' medians.
"""
import argparse, json, math, statistics as st, sys
from collections import defaultdict
from pathlib import Path

import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402
bands = L.bands
SIZE_TYPES = {"bedroom": {"bed", "master"}, "drawing": {"drawing"}, "lounge": {"lounge"}, "kitchen": {"kitchen"}}


def rows(path):
    p = Path(path)
    return [json.loads(l) for l in open(p, encoding="utf-8")] if p.exists() else []


@torch.no_grad()
def nll(model, data, bs=64):
    model.eval()
    dev = next(model.parameters()).device
    tot, n = 0.0, 0
    ex = [L.make_example(r["prompt"], r["completion"]) for r in data]
    for i in range(0, len(ex), bs):
        chunk = ex[i:i + bs]
        T = max(len(a) for a, _ in chunk)
        X = torch.full((len(chunk), T), L.PAD, dtype=torch.long)
        M = torch.zeros(len(chunk), T, dtype=torch.bool)
        for k, (ids, s) in enumerate(chunk):
            X[k, :len(ids)] = torch.tensor(ids); M[k, s:len(ids)] = True
        X, M = X.to(dev), M.to(dev)
        logits = model(X[:, :-1])
        tgt, mk = X[:, 1:], M[:, 1:]
        tot += F.cross_entropy(logits[mk].float(), tgt[mk], reduction="sum").item()
        n += mk.sum().item()
    return tot / max(1, n)


def sizes(plan):
    out = defaultdict(list)
    for r in bands.to_rects(plan):
        for k, ts in SIZE_TYPES.items():
            if r["t"] in ts: out[k].append(r["w"] * r["d"])
    return out


def realism(model, data, samples, temp=0.8):
    real = defaultdict(list)
    for r in data:
        for k, v in sizes(bands.parse(r["prompt"] + "\n" + r["completion"])).items(): real[k] += v
    prompts = [r["prompt"] for r in data for _ in range(samples)]
    outs = []
    model.eval()
    for i in range(0, len(prompts), 64):
        outs += model.sample(prompts[i:i + 64], temp, 0)                  # token ids
    gen, valid, scores = defaultdict(list), 0, []
    for p, ids in zip(prompts, outs):
        try:
            plan = bands.parse(p + "\n" + L.decode(ids))
            cs = bands.check(plan, plan["beds"])
        except Exception:
            scores.append(0.0); continue
        sc = bands.score(cs); scores.append(sc); valid += sc > 0
        if sc > 0:
            for k, v in sizes(plan).items(): gen[k] += v
    diff = {k: round(abs(st.median(gen[k]) - st.median(real[k])) / st.median(real[k]) * 100, 1) for k in SIZE_TYPES if gen[k] and real[k]}
    return {"plans": len(prompts), "valid%": round(100 * valid / max(1, len(prompts)), 1), "mean_score": round(sum(scores) / max(1, len(scores)), 3),
            "median_area_gap%": diff, "mean_gap%": round(sum(diff.values()) / max(1, len(diff)), 1) if diff else None,
            "real_median_sqft": {k: round(st.median(v)) for k, v in real.items() if v}, "model_median_sqft": {k: round(st.median(v)) for k, v in gen.items() if v}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", nargs="+", required=True)
    ap.add_argument("--real", default="data/real")
    ap.add_argument("--samples", type=int, default=4)
    ap.add_argument("--out", default="runs/eval_real.json")
    a = ap.parse_args()
    gold, silver = rows(f"{a.real}/test.jsonl"), rows(f"{a.real}/val.jsonl")
    res = []
    for ck in a.ckpt:
        model = L.load(ck)
        r = {"model": ck}
        for name, data in (("gold", gold), ("silver_heldout", silver)):
            if data:
                loss = nll(model, data)
                r[f"{name}_loss"] = round(loss, 4); r[f"{name}_ppl"] = round(math.exp(loss), 3)
        both = gold + silver
        if both: r["realism"] = realism(model, both, a.samples)
        print(json.dumps(r), flush=True)
        res.append(r)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
