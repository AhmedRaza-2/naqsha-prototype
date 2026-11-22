> Current: see `MODELS.md` (live model, weights, training code). The newest run script is `ml/run_v18.sh`; `ml/run_v13.sh` is the recipe of the live v13. Older sections below are history (their scripts are in git history).

# Training on Kaggle (2 x T4, about 35 minutes)

1. Build the package locally: `python tools/build_v12.py --workers 10` writes `data/pk12`; zip `ml/`, `tools/bands.py`,
   `tools/tree.py`, `tools/gen_tree.py`, `data/pk12`, `data/world11` and `data/real11` (the last upload was
   `kaggle_upload/naqsha-v12.zip`, 2.8 MB) and upload it as a Kaggle dataset.
2. New notebook, add the dataset, **Settings -> Accelerator: GPU T4 x2** (internet not needed). One cell:

```bash
%cd /kaggle/working
!F=$(find /kaggle/input -name run_v12.sh | head -1); SRC=$(dirname $(dirname $F)); echo "files from: $SRC"; cp -r $SRC/ml $SRC/tools $SRC/data .
!ls data
!bash ml/run_v12.sh v12 15 10 500
```

The script ([run_v12.sh](run_v12.sh)) uses both GPUs at once:
pretraining on world plans (GPU 0) || the no-pretraining ablation (GPU 1), then fine-tuning on the Pakistani plans with
world and real plans mixed in, then RL with the rule checker and the layout-family reward (GPU 0) || evaluation of the
supervised models (GPU 1), then evaluation of the RL model and the real-plan comparison.

3. Download `rl_v12_model.pt` and `runs_v12.zip` from the Output panel (or `from IPython.display import FileLink;
   display(FileLink('rl_v12_model.pt'))`). Locally: `python ml/export_onnx.py --ckpt runs/rl_v12_model.pt --out
   runs/v12/layout`, then `python ml/coverage_styles.py --onnx runs/v12/layout.onnx` for the planner-style sweep.

## What the printed tables mean
- Held-out requests (plot sizes never trained on): valid%, perfect% (every rule check passed), focus_ok% (bigger
  rooms where asked), diversity (share of the plot that differs between two plans for the same request) and
  style_followed% (plans with the layout family the request named).
- Real Pakistani plans (gold, never trained on): gold_ppl (lower = the model finds real plans more likely), valid% and
  size_gap% (room sizes against the real plans).

## v14: more real layouts (CubiCasa5k + checked vision readings), one command
Upload `kaggle_upload/naqsha-v14.zip` (211 MB: scripts, pk13 / world / real datasets, the 1,111 candidate plan images, `rl_v13_model.pt`)
as a Kaggle dataset. New notebook, add the dataset, **Accelerator: GPU T4 x2**, **Internet: On** (phone-verified account). One cell:

```bash
%cd /kaggle/working
!F=$(find /kaggle/input -name run_v14.sh | head -1); SRC=$(dirname $(dirname $F)); cp -r $SRC/ml $SRC/tools $SRC/real $SRC/data $SRC/runs .
!bash ml/run_v14.sh 600 8 400
```
Arguments: plans to read with the vision model (0 = skip it, CubiCasa only), fine-tune epochs, RL steps, optional vision model name.
It downloads CubiCasa5k from zenodo and converts it while the vision model reads the Pakistani plans (every reading is checked by the
rule checker and sent back with the reason when it fails, up to 3 rounds), builds `data/world_cc11` and `data/real14`, fine-tunes v13 on
everything (real plans repeated 20x), runs RL, and prints held-out validity plus likelihood of real gold plans for v13 vs v14.
Resumable: if the session stops, run the same cell again. Download `rl_v14_model.pt` and `runs_v14.zip`, then locally
`python ml/export_onnx.py --ckpt runs/rl_v14_model.pt --out runs/v14/layout` and compare with `python ml/coverage_styles.py --onnx runs/v14/layout.onnx`
before replacing `models/layout.onnx` (only ship it if gold_ppl and validity are no worse than v13).
