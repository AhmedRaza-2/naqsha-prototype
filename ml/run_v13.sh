#!/usr/bin/env bash
# v13 on Kaggle (2 x T4): two-storey houses. Starts from the v12 model (rl_v12_model.pt in the dataset), whose
# vocabulary grows by the new tokens (FLOOR, BOX, UP, STOREYS, 0, terrace), and teaches it ground floors with stairs and
# first floors drawn over them (tools/build_v13.py), keeping the single-storey plans, world plans and real plans in the mix.
#   GPU 0: fine-tune v12 on data/pk13 + world + real plans   ||  GPU 1: v12 on the new test set (the starting point)
#   GPU 0: RL with both checkers (ground floor rules, first-floor rules) and the STYLE reward  ||  GPU 1: evaluate the fine-tuned model
#   then: evaluate the RL model; real-plan likelihood and room sizes; zip
# usage: bash ml/run_v13.sh [tag] [finetune_epochs] [rl_steps]     e.g. bash ml/run_v13.sh v13 8 500
set -e
TAG=${1:-v13}; FT=${2:-8}; RL=${3:-500}
NG=$(python -c "import torch;print(torch.cuda.device_count())")
G1=0; [ "$NG" -ge 2 ] && G1=1
INIT=$(find . /kaggle/input -name rl_v12_model.pt 2>/dev/null | head -1)
[ -z "$INIT" ] && { echo "rl_v12_model.pt not found: add it to the dataset"; exit 1; }
echo "GPUs: $NG   start from $INIT, fine-tune $FT epochs, RL $RL steps"
mkdir -p runs
T0=$(date +%s)

CUDA_VISIBLE_DEVICES=0 python ml/train.py --init "$INIT" --data data/pk13 --extra "data/world11/train.jsonl*1" --extra "data/real11/train.jsonl*20" --extra "data/real13/train.jsonl*20" \
  --mirror --epochs "$FT" --bs 256 --lr 6e-4 --out "runs/ft_$TAG" > "runs/ft_$TAG.log" 2>&1 &
P_FT=$!
CUDA_VISIBLE_DEVICES=$G1 python ml/evaluate.py --ckpt "$INIT" --data data/pk13 --n 400 --samples 4 --out "runs/eval_v12_on_$TAG.json" > "runs/eval_v12_on_$TAG.log" 2>&1 &
P_EV0=$!
wait $P_FT
T1=$(date +%s); echo "fine-tuning took $((T1 - T0)) s"; tail -n 2 "runs/ft_$TAG.log"

CUDA_VISIBLE_DEVICES=0 python ml/rl.py --init "runs/ft_$TAG/model.pt" --data data/pk13 --out "runs/rl_$TAG" --steps "$RL" --style-miss 0.5 --styled 0.5 > "runs/rl_$TAG.log" 2>&1 &
P_RL=$!
wait $P_EV0
CUDA_VISIBLE_DEVICES=$G1 python ml/evaluate.py --ckpt "runs/ft_$TAG/model.pt" --data data/pk13 --n 400 --samples 4 --out "runs/eval_ft_$TAG.json" > "runs/eval_ft_$TAG.log" 2>&1 &
P_EV=$!
wait $P_RL; wait $P_EV
T2=$(date +%s); echo "RL + evaluation (in parallel) took $((T2 - T1)) s"

python ml/evaluate.py --ckpt "runs/rl_$TAG/model.pt" --data data/pk13 --n 400 --samples 4 --out "runs/eval_rl_$TAG.json" > "runs/eval_rl_$TAG.log" 2>&1
python ml/eval_real.py --ckpt "$INIT" "runs/ft_$TAG/model.pt" "runs/rl_$TAG/model.pt" --real data/real13 --out "runs/eval_real_$TAG.json" > "runs/eval_real_$TAG.log" 2>&1
python - <<EOF
import json
keys = ("valid%", "perfect%", "focus_ok%", "diversity", "style_followed%", "by_floor")
print("=== held-out requests (plot sizes never trained on): single storey, two-storey ground floors, first floors ===")
for f in ("runs/eval_v12_on_$TAG.json", "runs/eval_ft_$TAG.json", "runs/eval_rl_$TAG.json"):
    for r in json.load(open(f)):
        if "rule-based" in r["model"] and f != "runs/eval_v12_on_$TAG.json": continue
        print({"model": r["model"], **{k: (round(r[k], 3) if isinstance(r.get(k), float) else r.get(k)) for k in keys}})
print("=== real Pakistani plans (gold, never trained on) ===")
for r in json.load(open("runs/eval_real_$TAG.json")):
    re_ = r.get("realism", {})
    print({"model": r["model"], "gold_ppl": r.get("gold_ppl"), "valid%": re_.get("valid%"), "size_gap%": re_.get("median_area_gap%")})
EOF
zip -r "runs_$TAG.zip" "runs/ft_$TAG" "runs/rl_$TAG" runs/*"$TAG"*.json runs/*"$TAG"*.log > /dev/null
cp "runs/rl_$TAG/model.pt" "rl_${TAG}_model.pt"
echo "ALL DONE in $(( $(date +%s) - T0 )) s  ->  runs_$TAG.zip, rl_${TAG}_model.pt"
