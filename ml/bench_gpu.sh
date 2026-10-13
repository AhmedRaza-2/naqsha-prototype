#!/usr/bin/env bash
# Parallel-computing benchmark for the report: training throughput (samples/s) for 1 GPU fp32, 1 GPU fp16, 2 GPUs fp16.
# usage: bash ml/bench_gpu.sh        (about 5 minutes on Kaggle T4 x2)
set -e
NG=$(python -c "import torch;print(torch.cuda.device_count())")
python ml/train.py --epochs 2 --no-amp --bs 128 --out runs/bench_1gpu_fp32 > /dev/null
python ml/train.py --epochs 2 --bs 128 --out runs/bench_1gpu_fp16 > /dev/null
python ml/train.py --epochs 2 --bs 256 --out runs/bench_1gpu_fp16_bs256 > /dev/null
[ "$NG" -ge 2 ] && torchrun --nproc_per_node=2 ml/train.py --epochs 2 --bs 256 --out runs/bench_2gpu_fp16_bs256 > /dev/null
python - <<'EOF'
import json, glob, os
rows = []
for d in ["bench_1gpu_fp32", "bench_1gpu_fp16", "bench_1gpu_fp16_bs256", "bench_2gpu_fp16_bs256"]:
    f = f"runs/{d}/history.json"
    if os.path.exists(f):
        h = json.load(open(f))[-1]                      # second epoch (first one includes warm-up)
        rows.append((d, h["sec"], h["samples_per_sec"]))
base = rows[0][2]
print(f"{'setup':26s} {'epoch s':>8} {'samples/s':>10} {'speedup':>8}")
for d, s, sps in rows:
    print(f"{d:26s} {s:>8} {sps:>10} {sps / base:>7.2f}x")
EOF
