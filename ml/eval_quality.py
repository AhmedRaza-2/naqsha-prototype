"""Compare models on rules AND plot use: samples plans for held-out prompts and scores each with the rule checker and ml/quality.py.

    python ml/eval_quality.py --ckpt runs/rl_v13_model.pt runs/rl_v16/model.pt --data data/pk13 --n 400 --out runs/eval_quality_v16.json
Per model: valid% (no rule error), perfect% (every rule), mean quality and its parts (use, waste, sizes, shape, hub),
and the same on the prompts of the real plans (data/real13) when they exist.
"""
import argparse, json, random, statistics as st, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402
from quality import quality  # noqa: E402


def score_set(model, prompts, samples, temp):
    rows = []
    for i in range(0, len(prompts), 64):
        ps = [p for p in prompts[i:i + 64] for _ in range(samples)]
        comps = model.sample(ps, temperature=temp)
        for p, c in zip(ps, comps):
            try:
                plan, cs, rects, _ = L.parse_plan(L.ids_to_plan_text(p, c))
            except Exception:
                rows.append(None); continue
            sc = L.bands.score(cs)
            q, parts = quality(plan, rects) if sc > 0 else (0.0, {})
            rows.append((sc, q, parts))
    ok = [r for r in rows if r and r[0] > 0]
    agg = {"plans": len(rows), "valid%": round(100 * len(ok) / max(1, len(rows)), 2),
           "perfect%": round(100 * sum(1 for r in ok if r[0] == 1) / max(1, len(rows)), 2),
           "quality": round(st.mean([r[1] for r in ok]), 4) if ok else 0}
    for k in ("use", "waste", "sizes", "shape", "hub"):
        v = [r[2][k] for r in ok if k in r[2]]
        if v: agg[k] = round(st.mean(v), 4)
    return agg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", nargs="+", required=True)
    ap.add_argument("--data", default="data/pk13")
    ap.add_argument("--real", default="data/real13")
    ap.add_argument("--n", type=int, default=400)
    ap.add_argument("--samples", type=int, default=2)
    ap.add_argument("--temp", type=float, default=0.8)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    random.seed(0)
    val = sorted({json.loads(l)["prompt"] for l in open(f"{a.data}/val.jsonl", encoding="utf-8")})
    random.shuffle(val); val = val[: a.n]
    realp = []
    for name in ("train", "val", "test"):
        f = Path(a.real) / f"{name}.jsonl"
        if f.exists(): realp += [json.loads(l)["prompt"] for l in open(f, encoding="utf-8")]
    out = []
    for ck in a.ckpt:
        m = L.load(ck).eval()
        res = {"model": ck, "held_out": score_set(m, val, a.samples, a.temp)}
        if realp: res["real_prompts"] = score_set(m, sorted(set(realp)), a.samples, a.temp)
        print(json.dumps(res), flush=True)
        out.append(res)
    if a.out: Path(a.out).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
