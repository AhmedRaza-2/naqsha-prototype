#!/usr/bin/env bash
# Plan reader (U-Net CNN) on Kaggle (T4 GPU, Internet ON): CubiCasa5k -> masks -> train -> test IoU -> ONNX.
# usage: bash ml/run_planreader.sh [epochs]
set -e
EP=${1:-60}
mkdir -p data/cubicasa runs
T0=$(date +%s)
[ -s data/cubicasa/cc.zip ] || wget -q -c -O data/cubicasa/cc.zip "https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1"
ls -la data/cubicasa/cc.zip
python real/cubicasa_masks.py data/cubicasa/cc.zip --out data/planreader --workers 4
echo "masks built at $(( ($(date +%s) - T0) / 60 )) min"
pip install -q onnxruntime scipy 2>/dev/null || true
python ml/planreader.py train --data data/planreader --out runs/planreader --epochs "$EP" --bs 32
python ml/planreader.py eval --ckpt runs/planreader/model.pt --data data/planreader --out runs/planreader/test_iou.json
python ml/planreader.py export --ckpt runs/planreader/model.pt --out runs/planreader/planreader.onnx
python - <<'EOF'
# a few test plans: image | truth | prediction, for the report
import numpy as np, torch, sys
sys.path.insert(0, "ml")
import planreader as P
from PIL import Image
m = P.load("runs/planreader/model.pt"); te = np.load("data/planreader/test.npz")
pal = np.array([[255,255,255],[30,30,30],[240,170,40],[170,220,150],[90,170,200],[230,200,120],[200,120,160],[120,200,230],[180,180,140],[150,150,200],[200,160,100]], np.uint8)
rows = []
for i in range(0, 8):
    x, y = te["x"][i], te["y"][i]
    with torch.no_grad(): p = m(P.prep(torch.from_numpy(x[None].copy()))).argmax(1)[0].numpy()
    rows.append(np.concatenate([x, pal[y], pal[p]], 1))
Image.fromarray(np.concatenate(rows, 0)).save("runs/planreader/samples.png")
EOF
cd runs && zip -rq ../planreader_results.zip planreader && cd ..
cp runs/planreader/planreader.onnx planreader.onnx
rm -rf data
echo "ALL DONE in $(( ($(date +%s) - T0) / 60 )) min"
