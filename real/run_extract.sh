#!/usr/bin/env bash
# Read the real plan images with a vision-language model on every GPU in parallel (one process per GPU, each on its own
# shard of the plans), then build the real-plan dataset. Needs Kaggle "Internet on" to download the model once.
# usage: bash real/run_extract.sh [limit] [model]      e.g.  bash real/run_extract.sh 400
#        (plans with the most printed sizes go first; about 25-40 s per plan per T4 for the 7B model in 4-bit)
set -e
LIMIT=${1:-400}; MODEL=${2:-Qwen/Qwen2.5-VL-7B-Instruct}
python -c "import bitsandbytes" 2>/dev/null || pip install -q -U bitsandbytes
python -c "import accelerate" 2>/dev/null || pip install -q -U accelerate
NG=$(python -c "import torch;print(torch.cuda.device_count())")
echo "GPUs: $NG   plans: $LIMIT   model: $MODEL"
T0=$(date +%s)
mkdir -p data/real runs
for ((g = 0; g < NG; g++)); do
  CUDA_VISIBLE_DEVICES=$g python real/extract_vlm.py --model "$MODEL" --limit "$LIMIT" --shard "$g/$NG" --out "data/real/raw_$g.jsonl" > "runs/extract_$g.log" 2>&1 &
done
# progress every 2 minutes until every shard has finished
while [ "$(jobs -rp | wc -l)" -gt 0 ]; do
  sleep 120
  echo "$(( ($(date +%s) - T0) / 60 )) min: $(cat data/real/raw_*.jsonl 2>/dev/null | wc -l) of $LIMIT plans read"
done
wait
tail -n 3 runs/extract_*.log
echo "reading took $(( $(date +%s) - T0 )) s"
python real/build_real.py build
