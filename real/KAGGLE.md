# Kaggle: reading the real plans (v10 onwards)

A vision-language model reads the real plan images on both GPUs and the readings become the real-plan dataset
(data/real). tools/build_v11.py turns it into data/real11, which the training run (ml/run_v12.sh, see ml/KAGGLE.md)
mixes into fine-tuning and uses for the real-plan evaluation.

1. Upload `kaggle_upload/naqsha-real-v10` as a new dataset named **naqsha-real-v10** (140 MB: code, 721 plan images,
   9 hand-transcribed gold plans, the v9 synthetic set). Optional: put `rl_v9_model.pt` in that folder before
   uploading, so the v9 model is not trained again (saves about 10 minutes).
2. New notebook, attach only that dataset. Settings: **Accelerator GPU T4 x2**, **Internet on** (the vision model is
   downloaded from Hugging Face once, about 16 GB).
3. One cell:

```python
import glob, os, shutil
os.chdir("/kaggle/working")
hits = glob.glob("/kaggle/input/**/real/run_extract.sh", recursive=True); print(hits)
SRC = os.path.dirname(os.path.dirname(hits[0]))
for d in ("ml", "tools", "real", "data"):
    shutil.copytree(f"{SRC}/{d}", f"/kaggle/working/{d}", dirs_exist_ok=True)
!sed -i 's/\r$//' ml/*.sh real/*.sh
!bash real/run_extract.sh 400          # reads 400 plans, ~1.5-2 h on 2 x T4
from IPython.display import FileLink; display(FileLink("data/real/report.json"))
```

4. Because reading takes a while, run it with **Save Version → Save & Run All (Commit)** so it keeps going when the
   browser is closed. Download `rl_v10_model.pt`, `runs_v10.zip` and `data/real/report.json` from the version's output.

What to send back: the last lines of the output (the two evaluation tables) and `data/real/report.json`.

- `report.json`: how many plans the vision model read, how many were kept as training data and why the rest were
  rejected, and how well it matched the hand transcriptions (`vision_model_vs_gold`).
- Real held-out plans: `gold_ppl` / `silver_ppl` = perplexity of real plans (lower = the model knows real layouts
  better); `size_gap%` = how far its room sizes are from real ones.
- Synthetic held-out requests: validity, bedroom/washroom counts and rule score, to check nothing got worse.

To read more plans later, run `bash real/run_extract.sh 720`: it skips plans already read.
