#!/usr/bin/env bash
# v12 on Kaggle (2 x T4): the v11 recipe on the balanced v12 Pakistani set (tools/build_v12.py), and RL that also
# rewards drawing the layout family the request names (ml/rl.py --style-miss: a plan of another family keeps half its score).
#   GPU 0: pretrain on ResPlan (world)          ||  GPU 1: Pakistani plans only, from scratch (ablation: no pretraining)
#   GPU 0: fine-tune on Pakistani plans + 1x world plans (keeps their variety) + 20x real Pakistani plans
#   GPU 0: RL with the rule checker and the STYLE reward            ||  GPU 1: evaluate the two supervised models
#   then: evaluate the RL model; real-plan likelihood and room sizes for all models; zip
# usage: bash ml/run_v12.sh [tag] [pretrain_epochs] [finetune_epochs] [rl_steps]     e.g. bash ml/run_v12.sh v12 15 10 500
set -e
TAG=${1:-v12}; PRE=${2:-15}; FT=${3:-10}; RL=${4:-500}
NG=$(python -c "import torch;print(torch.cuda.device_count())")
G1=0; [ "$NG" -ge 2 ] && G1=1
echo "GPUs: $NG   pretrain $PRE epochs, fine-tune $FT, RL $RL steps"
mkdir -p runs
T0=$(date +%s)

CUDA_VISIBLE_DEVICES=0 python ml/train.py --data data/world11 --epochs "$PRE" --mirror --bs 256 --lr 1.5e-3 --out "runs/pre_$TAG" > "runs/pre_$TAG.log" 2>&1 &
P_PRE=$!
CUDA_VISIBLE_DEVICES=$G1 python ml/train.py --data data/pk12 --epochs $((PRE + FT)) --mirror --bs 256 --lr 1.5e-3 --out "runs/scratch_$TAG" > "runs/scratch_$TAG.log" 2>&1 &
P_SCR=$!
wait $P_PRE
T1=$(date +%s); echo "pretraining took $((T1 - T0)) s"; tail -n 2 "runs/pre_$TAG.log"

CUDA_VISIBLE_DEVICES=0 python ml/train.py --init "runs/pre_$TAG/model.pt" --data data/pk12 --extra "data/world11/train.jsonl*1" --extra "data/real11/train.jsonl*20" \
  --mirror --epochs "$FT" --bs 256 --lr 8e-4 --out "runs/ft_$TAG" > "runs/ft_$TAG.log" 2>&1
T2=$(date +%s); echo "fine-tuning took $((T2 - T1)) s"; tail -n 2 "runs/ft_$TAG.log"
wait $P_SCR; echo "scratch (no pretraining) finished"; tail -n 2 "runs/scratch_$TAG.log"

CUDA_VISIBLE_DEVICES=0 python ml/rl.py --init "runs/ft_$TAG/model.pt" --data data/pk12 --out "runs/rl_$TAG" --steps "$RL" --style-miss 0.5 --styled 0.6 > "runs/rl_$TAG.log" 2>&1 &
P_RL=$!
CUDA_VISIBLE_DEVICES=$G1 python ml/evaluate.py --ckpt "runs/scratch_$TAG/model.pt" "runs/ft_$TAG/model.pt" --data data/pk12 --n 300 --samples 4 --out "runs/eval_sft_$TAG.json" > "runs/eval_sft_$TAG.log" 2>&1 &
P_EV=$!
wait $P_RL; wait $P_EV
T3=$(date +%s); echo "RL + supervised evaluation (in parallel) took $((T3 - T2)) s"

python ml/evaluate.py --ckpt "runs/rl_$TAG/model.pt" --data data/pk12 --n 300 --samples 4 --out "runs/eval_rl_$TAG.json" > "runs/eval_rl_$TAG.log" 2>&1
python ml/eval_real.py --ckpt "runs/scratch_$TAG/model.pt" "runs/ft_$TAG/model.pt" "runs/rl_$TAG/model.pt" --real data/real11 --out "runs/eval_real_$TAG.json" > "runs/eval_real_$TAG.log" 2>&1
python - <<EOF
import json
keys = ("valid%", "bed_ok%", "bath_ok%", "focus_ok%", "perfect%", "mean_score", "diversity", "arrangements/N", "arrangements_total", "style_followed%", "style_followed_by_family", "copied%")
print("=== Pakistani held-out requests: rules, preferences and variety ===")
for f in ("runs/eval_sft_$TAG.json", "runs/eval_rl_$TAG.json"):
    for r in json.load(open(f)):
        if f.endswith("rl_$TAG.json") and "rule-based" in r["model"]: continue
        print({"model": r["model"], **{k: (round(r[k], 3) if isinstance(r.get(k), float) else r.get(k)) for k in keys}})
print("=== real Pakistani plans (gold, never trained on) ===")
for r in json.load(open("runs/eval_real_$TAG.json")):
    re_ = r.get("realism", {})
    print({"model": r["model"], "gold_ppl": r.get("gold_ppl"), "valid%": re_.get("valid%"), "size_gap%": re_.get("median_area_gap%")})
EOF
zip -r "runs_$TAG.zip" "runs/pre_$TAG" "runs/scratch_$TAG" "runs/ft_$TAG" "runs/rl_$TAG" runs/*"$TAG"*.json runs/*"$TAG"*.log > /dev/null
cp "runs/rl_$TAG/model.pt" "rl_${TAG}_model.pt"
echo "ALL DONE in $(( $(date +%s) - T0 )) s  ->  runs_$TAG.zip, rl_${TAG}_model.pt"
