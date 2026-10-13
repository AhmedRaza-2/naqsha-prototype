# Running the training on Kaggle (free GPU)

## 1. Upload the code and data as one Kaggle Dataset
Make a folder `naqsha-ml` containing exactly this structure and upload it (kaggle.com -> Datasets -> New Dataset):

```
naqsha-ml/
  tools/bands.py
  ml/layoutlm.py  ml/train.py  ml/rl.py  ml/evaluate.py
  data/synth/train.jsonl  data/synth/val.jsonl  data/synth/test.jsonl
```

## 2. New Notebook -> add the dataset -> Settings: Accelerator = GPU T4 x1, Internet off is fine

```python
%cd /kaggle/working
!cp -r /kaggle/input/naqsha-ml/* .

# Stage A: supervised training (about 10-15 min on a T4)
!python ml/train.py --epochs 15 --mirror --out runs/sft

# Stage B: reinforcement learning with the rule checker as reward
!python ml/rl.py --init runs/sft/model.pt --out runs/rl --steps 300

# Evaluation on plot sizes never seen in training: baseline vs Stage A vs Stage A+B
!python ml/evaluate.py --ckpt runs/sft/model.pt runs/rl/model.pt --n 300 --samples 4 --out runs/eval.json
```

Download `runs/` (model.pt, history.json, loss.png, rl.png, eval.json) from the notebook Output tab.
The loss curves and the evaluation table are the figures for the report.

## Experiments to run for the report (each is one command)
| Experiment | Command change |
|---|---|
| Model size | `--d 128 --layers 4` vs `--d 256 --layers 6` vs `--d 384 --layers 8` |
| Mirror augmentation on/off | with and without `--mirror` |
| Sampling temperature | `evaluate.py --temp 0.5 / 0.8 / 1.0` |
| Best-of-N vs single sample | compare `best@N` and `mean_score` in the evaluation output |
| With vs without RL | the two checkpoints in the evaluation command above |
