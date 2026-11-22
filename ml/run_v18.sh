#!/usr/bin/env bash
# v18 on Kaggle: expert iteration. The planner's finished plans (tools/distill.py: two-storey ground floors with the proper stair, narrow 3-bed houses) are added x4 to fine-tuning and to the RL prompts (data/pk18); quality weight 0.2
#   data   pk16 (v13 synthetic plans without the ones that waste their plot, tools/build_v16.py) + world11 (ResPlan) +
#          world_cc11 (1,346 CubiCasa5k real plans) + real11/real13/real14 Pakistani plans repeated x20
#   SFT    fine-tune the v13 model on that mix
#   RL     reward = rule score x (1 - Q + Q x quality): quality (ml/quality.py) = plot use, no wasted space inside the house,
#          room sizes of real Pakistani plans, usable room proportions, a lounge as the hub
#   eval   v13 vs v16 on the same held-out prompts: rules (evaluate.py), real plans (eval_real.py), plot use (eval_quality.py)
# usage: bash ml/run_v18.sh [finetune_epochs] [rl_steps] [quality_weight]
set -e
FT=${1:-6}; RL=${2:-600}; Q=${3:-0.2}; TAG=v18
NG=$(python -c "import torch;print(torch.cuda.device_count())")
G1=0; [ "$NG" -ge 2 ] && G1=1
mkdir -p runs
T0=$(date +%s)
INIT=$(find . /kaggle/input -name rl_v13_model.pt 2>/dev/null | head -1)
[ -z "$INIT" ] && { echo "rl_v13_model.pt not found"; exit 1; }
EXTRA="--extra data/world11/train.jsonl*1 --extra data/world_cc11/train.jsonl*1 --extra data/real11/train.jsonl*20 --extra data/real13/train.jsonl*20 --extra data/real14/train.jsonl*20"
wc -l data/pk17/train.jsonl data/world_cc11/train.jsonl data/real14/train.jsonl

CUDA_VISIBLE_DEVICES=0 python ml/train.py --init "$INIT" --data data/pk17 $EXTRA --extra data/distill18.jsonl*4 --mirror --epochs "$FT" --bs 256 --lr 4e-4 --out "runs/ft_$TAG" > "runs/ft_$TAG.log" 2>&1 &
P_FT=$!
CUDA_VISIBLE_DEVICES=$G1 python ml/evaluate.py --ckpt "$INIT" --data data/pk17 --n 400 --samples 4 --out "runs/eval_v13_on_$TAG.json" > "runs/eval_v13_on_$TAG.log" 2>&1 &
P_EV0=$!
wait $P_FT; tail -n 2 "runs/ft_$TAG.log"
echo "fine-tune done at $(( ($(date +%s) - T0) / 60 )) min"
CUDA_VISIBLE_DEVICES=0 python ml/rl.py --init "runs/ft_$TAG/model.pt" --data data/pk18 --out "runs/rl_$TAG" --steps "$RL" --quality "$Q" --style-miss 0.5 --styled 0.5 > "runs/rl_$TAG.log" 2>&1 &
P_RL=$!
wait $P_EV0
CUDA_VISIBLE_DEVICES=$G1 python ml/evaluate.py --ckpt "runs/ft_$TAG/model.pt" --data data/pk17 --n 400 --samples 4 --out "runs/eval_ft_$TAG.json" > "runs/eval_ft_$TAG.log" 2>&1
wait $P_RL; tail -n 3 "runs/rl_$TAG.log"
echo "RL done at $(( ($(date +%s) - T0) / 60 )) min"
CUDA_VISIBLE_DEVICES=0 python ml/evaluate.py --ckpt "runs/rl_$TAG/model.pt" --data data/pk17 --n 400 --samples 4 --out "runs/eval_rl_$TAG.json" > "runs/eval_rl_$TAG.log" 2>&1 &
P1=$!
CUDA_VISIBLE_DEVICES=$G1 python ml/eval_quality.py --ckpt "$INIT" "runs/ft_$TAG/model.pt" "runs/rl_$TAG/model.pt" --data data/pk17 --real data/real13 --n 400 --samples 2 --out "runs/eval_quality_$TAG.json" > "runs/eval_quality_$TAG.log" 2>&1 &
P2=$!
wait $P1; wait $P2
python ml/eval_real.py --ckpt "$INIT" "runs/ft_$TAG/model.pt" "runs/rl_$TAG/model.pt" --real data/real13 --out "runs/eval_real_$TAG.json" > "runs/eval_real_$TAG.log" 2>&1
python - <<EOF
import json
keys = ("valid%", "perfect%", "focus_ok%", "diversity", "style_followed%")
print("=== rules, held-out requests ===")
for f in ("runs/eval_v13_on_$TAG.json", "runs/eval_ft_$TAG.json", "runs/eval_rl_$TAG.json"):
    try:
        d = json.load(open(f)); d = d[-1] if isinstance(d, list) else d
        print(f, {k: d.get(k) for k in keys})
    except Exception as e: print(f, e)
print("=== plot use (quality 0-1) ===")
for r in json.load(open("runs/eval_quality_$TAG.json")): print(json.dumps(r))
print("=== real Pakistani plans ===")
for l in open("runs/eval_real_$TAG.log"):
    if l.startswith("{"):
        d = json.loads(l); print({"model": d["model"], "gold_ppl": d.get("gold_ppl"), "valid%": d["realism"]["valid%"], "mean_score": d["realism"]["mean_score"], "mean_gap%": d["realism"]["mean_gap%"]})
EOF
zip -r "runs_$TAG.zip" "runs/ft_$TAG" "runs/rl_$TAG" runs/*"$TAG"*.json runs/*"$TAG"*.log > /dev/null 2>&1 || true
cp "runs/rl_$TAG/model.pt" "rl_${TAG}_model.pt"
rm -rf data ml tools real                                          # keep the output small: only the results are downloaded
echo "ALL DONE in $(( ($(date +%s) - T0) / 60 )) min  ->  rl_${TAG}_model.pt and runs_$TAG.zip"
