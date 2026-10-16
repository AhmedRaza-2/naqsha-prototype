"""Reference sampler for the exported ONNX model (the browser runs the same loop in JavaScript).
    python ml/onnx_check.py --onnx models/layout.onnx --n 200
Generates plans token by token with the KV-cache graph, validates them with tools/bands.py, and reports validity."""
import argparse, json, random, sys
from pathlib import Path

import numpy as np
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402
bands = L.bands


def sample(sess, prompts, temp=0.8, max_new=140, rng=None):
    rng = rng or np.random.default_rng(0)
    B = len(prompts)
    starts = [[L.BOS] + L.encode(p) + [L.NL] for p in prompts]
    assert len({len(s) for s in starts}) == 1, "prompts in one batch must have the same token length"
    Ln, H, hd = 6, 8, 32
    k = np.zeros((Ln, B, H, 0, hd), np.float32); v = np.zeros_like(k)
    out = [[] for _ in range(B)]
    done = np.zeros(B, bool)
    toks = np.array(starts)
    for t in range(toks.shape[1] - 1):                       # feed the prompt (all but the last token) one token at a time
        _, k, v = sess.run(None, {"ids": toks[:, t:t + 1].astype(np.int64), "pos": np.array([t], np.int64), "past_k": k, "past_v": v})
    cur = toks[:, -1:]
    pos = toks.shape[1] - 1
    for _ in range(max_new):
        lg, k, v = sess.run(None, {"ids": cur.astype(np.int64), "pos": np.array([pos], np.int64), "past_k": k, "past_v": v})
        lg = lg / temp
        lg -= lg.max(-1, keepdims=True)
        pr = np.exp(lg); pr /= pr.sum(-1, keepdims=True)
        nxt = np.array([rng.choice(len(pr[i]), p=pr[i]) for i in range(B)])
        for i in range(B):
            if not done[i]:
                out[i].append(int(nxt[i]))
                if nxt[i] == L.EOS: done[i] = True
        cur = nxt[:, None]; pos += 1
        if done.all() or pos >= 255: break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", default="models/layout.onnx")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--data", default="data/pk12")
    a = ap.parse_args()
    sess = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"])
    test = [json.loads(l) for l in open(f"{a.data}/test.jsonl", encoding="utf-8")]
    prompts = sorted({r["prompt"] for r in test})
    random.Random(0).shuffle(prompts)
    by_len = {}
    for p in prompts[: a.n]:
        by_len.setdefault(len(L.encode(p)), []).append(p)
    scores, valid, perfect, total = [], 0, 0, 0
    for _, ps in by_len.items():
        for i in range(0, len(ps), 8):
            chunk = ps[i:i + 8]
            for p, ids in zip(chunk, sample(sess, chunk)):
                r, failed = L.reward(p, ids)
                total += 1; scores.append(r); valid += r > 0; perfect += r == 1.0
    print(f"{total} plans from the ONNX model: valid {valid / total:.1%}  perfect {perfect / total:.1%}  mean score {np.mean(scores):.3f}")


if __name__ == "__main__":
    main()
