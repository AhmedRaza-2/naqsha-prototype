"""Coverage test: can the exported model answer every request the form can produce?
    python ml/coverage.py --onnx models/layout.onnx
The planner falls back to the rule-based generator when the model returns no valid plan, so the number that matters for a
visitor is "requests with at least one valid plan out of N samples". The sweep covers the preset plot sizes, the
usual plot sizes (3 marla to 60x110), every allowed bedroom count, every allowed washroom choice and every 'make bigger' choice."""
import argparse, sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402
from onnx_check import sample  # noqa: E402
bands = L.bands

PLOTS = [(20, 34), (20, 45), (25, 36), (25, 40), (25, 45), (30, 45), (30, 60), (35, 65), (38, 59), (40, 80), (45, 95), (50, 90), (60, 110)]


def beds_allowed(w, d):
    return range(bands.min_beds(w, d), bands.max_beds(w, d) + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", default="models/layout.onnx")
    ap.add_argument("--n", type=int, default=12, help="samples per request (the planner uses 12)")
    a = ap.parse_args()
    sess = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(1)
    rows, bad = [], []
    for w, d in PLOTS:
        marla = w * d / 225
        got = tot = perfect = 0
        for beds in beds_allowed(w, d):
            for baths in range(beds, bands.max_baths(w, d, beds) + 1):
                for focus in bands.FOCUS_VALUES:
                    prompt = bands.prompt_for(w, d, beds, baths, focus)
                    res = sample(sess, [prompt] * a.n, rng=rng)
                    scores = [L.reward(prompt, ids)[0] for ids in res]
                    tot += 1
                    got += any(s > 0 for s in scores)
                    perfect += any(s == 1.0 for s in scores)
                    if not any(s > 0 for s in scores):
                        bad.append(prompt.replace("\n", " "))
        rows.append((f"{w}x{d}", round(marla, 1), tot, got, perfect))
    print(f"{'plot':8s} {'marla':>6s} {'requests':>9s} {'>=1 valid':>10s} {'>=1 perfect':>12s}")
    for r in rows:
        print(f"{r[0]:8s} {r[1]:>6} {r[2]:>9} {r[3]:>10} {r[4]:>12}")
    T = sum(r[2] for r in rows)
    print(f"\ntotal {T} requests: {sum(r[3] for r in rows)} answered by the model, {sum(r[4] for r in rows)} with a perfect plan among {a.n} samples")
    if bad:
        print("\nno valid plan for:\n  " + "\n  ".join(bad[:40]))


if __name__ == "__main__":
    main()
