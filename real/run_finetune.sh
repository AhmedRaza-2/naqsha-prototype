#!/usr/bin/env bash
# Fine-tune the synthetic-trained model on real plans, then RL, then evaluate on synthetic AND real held-out plans.
# usage: bash real/run_finetune.sh [tag] [rl_steps]        e.g.  bash real/run_finetune.sh v10 300
#   1. base model: rl_v9 (an uploaded rl_v9_model.pt if one is attached, otherwise trained here in about 10 min)
#   2. data/real/{train,val,test}.jsonl from the vision model's transcriptions (real/run_extract.sh)
#   3. fine-tune on real plans mixed with the synthetic set (both GPUs, data parallel), keeping the checkpoint with
#      the lowest loss on held-out real plans
#   4. RL from the fine-tuned model (GPU 0)  ||  real-plan evaluation of the base model (GPU 1)
#   5. evaluations: synthetic held-out requests (rules, counts) and real held-out plans (likelihood, room sizes)
set -e
TAG=${1:-v10}; RL_STEPS=${2:-300}
NG=$(python -c "import torch;print(torch.cuda.device_count())")
T0=$(date +%s)
BASE=runs/rl_v9/model.pt
if [ ! -f "$BASE" ]; then
  F=$(find /kaggle/input -name 'rl_v9_model.pt' 2>/dev/null | head -1)
  if [ -n "$F" ]; then mkdir -p runs/rl_v9 && cp "$F" "$BASE"; echo "base model: $F"
  else echo "no rl_v9 model attached: training it first"; bash ml/run_all.sh v9 20 400; fi
fi
[ -f data/real/train.jsonl ] || python real/build_real.py build
NTR=$(wc -l < data/real/train.jsonl); NVA=$(wc -l < data/real/val.jsonl)
if [ "$NTR" -lt 20 ]; then echo "ERROR: only $NTR real training plans: run real/run_extract.sh (with Internet on) first. Stopping, nothing was fine-tuned."; exit 1; fi
echo "real plans: train $NTR, held-out $NVA, gold test $(wc -l < data/real/test.jsonl)"
SEL="--extra-val data/real/val.jsonl --select extra"; [ "$NVA" -lt 5 ] && SEL=""
LAUNCH="python"; [ "$NG" -ge 2 ] && LAUNCH="torchrun --nproc_per_node=$NG"
$LAUNCH ml/train.py --init "$BASE" --data data/synth --extra data/real/train.jsonl --extra-mult 20 --mirror $SEL \
  --epochs 6 --bs 256 --lr 3e-4 --out "runs/ft_$TAG"
T1=$(date +%s); echo "fine-tuning took $((T1 - T0)) s"
EVAL_GPU=0; [ "$NG" -ge 2 ] && EVAL_GPU=1
CUDA_VISIBLE_DEVICES=0 python ml/rl.py --init "runs/ft_$TAG/model.pt" --out "runs/rl_$TAG" --steps "$RL_STEPS" > "runs/rl_$TAG.log" 2>&1 &
RL_PID=$!
CUDA_VISIBLE_DEVICES=$EVAL_GPU python ml/evaluate.py --ckpt "$BASE" --n 300 --samples 4 --out "runs/eval_base_$TAG.json" > "runs/eval_base_$TAG.log" 2>&1 &
EV_PID=$!
wait $RL_PID; wait $EV_PID
T2=$(date +%s); echo "RL + base evaluation (in parallel) took $((T2 - T1)) s"
python ml/evaluate.py --ckpt "runs/rl_$TAG/model.pt" --n 300 --samples 4 --out "runs/eval_rl_$TAG.json" > "runs/eval_rl_$TAG.log" 2>&1
python ml/eval_real.py --ckpt "$BASE" "runs/ft_$TAG/model.pt" "runs/rl_$TAG/model.pt" --out "runs/eval_real_$TAG.json"
echo "=== synthetic held-out requests (rules) ==="; python - <<EOF
import json
for f in ("runs/eval_base_$TAG.json", "runs/eval_rl_$TAG.json"):
    for r in json.load(open(f)):
        if "rule-based" in r["model"]: continue
        print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items() if k in ("model", "valid%", "bed_ok%", "bath_ok%", "focus_ok%", "perfect%", "mean_score")})
print("=== real held-out plans (lower loss = knows real layouts better; gap = room sizes vs real) ===")
for r in json.load(open("runs/eval_real_$TAG.json")):
    re_ = r.get("realism", {})
    print({"model": r["model"], "gold_ppl": r.get("gold_ppl"), "silver_ppl": r.get("silver_heldout_ppl"), "valid%": re_.get("valid%"),
           "size_gap%": re_.get("median_area_gap%"), "mean_gap%": re_.get("mean_gap%")})
EOF
zip -r "runs_$TAG.zip" "runs/ft_$TAG" "runs/rl_$TAG" runs/eval_*"$TAG"*.json runs/*"$TAG"*.log data/real/report.json > /dev/null
cp "runs/rl_$TAG/model.pt" "rl_${TAG}_model.pt"
echo "ALL DONE in $(( $(date +%s) - T0 )) s  ->  runs_$TAG.zip, rl_${TAG}_model.pt"
