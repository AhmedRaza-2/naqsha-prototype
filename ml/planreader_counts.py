"""How well the plan reader counts rooms (the thing the app uses), on the held-out CubiCasa test plans.

    python ml/planreader_counts.py --ckpt runs/planreader/model.pt --data data/planreader
For every test plan: bedrooms and washrooms counted from the network's picture (connected regions, same thresholds as js/planreader.js)
against the same count taken from the true mask. Reports exact-count share and within-one share.
"""
import argparse, sys
from pathlib import Path
import numpy as np, torch
from scipy import ndimage
sys.path.insert(0, str(Path(__file__).resolve().parent))
import planreader as P

def count(mask, cls, minpx):
    lab, n = ndimage.label(mask == cls)
    return int(sum(1 for i in range(1, n + 1) if (lab == i).sum() >= minpx))

ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--data", default="data/planreader")
a = ap.parse_args()
m = P.load(a.ckpt); te = np.load(Path(a.data) / "test.npz"); x, y = te["x"], te["y"]
res = {"bed": [], "bath": [], "kitchen": []}
with torch.no_grad():
    for i in range(0, len(x), 32):
        p = m(P.prep(torch.from_numpy(x[i:i + 32]))).argmax(1).numpy()
        for pm, tm in zip(p, y[i:i + 32]):
            for k, c, mn in (("bed", 6, 150), ("bath", 7, 60), ("kitchen", 4, 60)):
                res[k].append((count(pm, c, mn), count(tm, c, mn)))
for k, v in res.items():
    d = np.array(v); err = np.abs(d[:, 0] - d[:, 1])
    print(f"{k:8} plans {len(d)}  exact {100 * (err == 0).mean():.1f}%  within one {100 * (err <= 1).mean():.1f}%  mean true {d[:, 1].mean():.2f}  mean predicted {d[:, 0].mean():.2f}")
