#!/usr/bin/env bash
# Whole pipeline on Kaggle, using every GPU and CPU core:
#   1. supervised training      - both GPUs (data-parallel, torchrun), fp16
#   2. RL (GPU 0)  ||  evaluation of the supervised model (GPU 1)      <- the two jobs overlap
#   3. evaluation of the RL model, then zip everything
# usage: bash ml/run_all.sh <tag> [epochs] [rl_steps]       e.g.  bash ml/run_all.sh v5 16 300
set -e
TAG=${1:-run}; EPOCHS=${2:-16}; RL_STEPS=${3:-300}
NG=$(python -c "import torch;print(torch.cuda.device_count())")
echo "GPUs: $NG   CPU cores: $(nproc)"
T0=$(date +%s)

if [ "$NG" -ge 2 ]; then
  torchrun --nproc_per_node=2 ml/train.py --epochs "$EPOCHS" --mirror --bs 256 --lr 1.5e-3 --out runs/sft_$TAG
else
  python ml/train.py --epochs "$EPOCHS" --mirror --bs 256 --lr 1.5e-3 --out runs/sft_$TAG
fi
T1=$(date +%s); echo "training took $((T1 - T0)) s"

EVAL_GPU=0; [ "$NG" -ge 2 ] && EVAL_GPU=1
CUDA_VISIBLE_DEVICES=0 python ml/rl.py --init runs/sft_$TAG/model.pt --out runs/rl_$TAG --steps "$RL_STEPS" > runs/rl_$TAG.log 2>&1 &
RL_PID=$!
CUDA_VISIBLE_DEVICES=$EVAL_GPU python ml/evaluate.py --ckpt runs/sft_$TAG/model.pt --n 300 --samples 4 --out runs/eval_sft_$TAG.json > runs/eval_sft_$TAG.log 2>&1 &
EV_PID=$!
wait $RL_PID; wait $EV_PID
T2=$(date +%s); echo "RL + SFT evaluation (in parallel) took $((T2 - T1)) s"

python ml/evaluate.py --ckpt runs/rl_$TAG/model.pt --n 300 --samples 4 --out runs/eval_rl_$TAG.json > runs/eval_rl_$TAG.log 2>&1
tail -n 25 runs/rl_$TAG.log | head -n 5
echo "=== SFT evaluation ==="; python - <<EOF
import json
for f in ("runs/eval_sft_$TAG.json", "runs/eval_rl_$TAG.json"):
    for r in json.load(open(f)):
        print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items() if k not in ("top_failures",)})
EOF
zip -r runs_$TAG.zip runs/sft_$TAG runs/rl_$TAG runs/eval_*_$TAG.json runs/*_$TAG.log > /dev/null
echo "ALL DONE in $(( $(date +%s) - T0 )) s  ->  runs_$TAG.zip"
