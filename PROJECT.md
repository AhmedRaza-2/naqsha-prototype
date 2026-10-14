# Naqsha AI: Plot Size to House Layout to 3D Walkthrough

Project brief, research summary and current status. Last updated: 2026-10-13 (layout-model section 3.5 added).

---

## 1. Idea and goal

A web tool for Pakistan where a user:

1. enters a **plot size** (marla / kanal / feet),
2. receives several **house layout plans** (naqsha) suited to Pakistani homes,
3. picks one and chooses a **design** (facade style),
4. takes a **virtual first-person walkthrough** of the finished house in 3D.

**Positioning.** The idea is no longer new: MakaanPlan (Islamabad) and Unrean (Multan) already do "marla plot to AI layout to 3D". The project differentiates through:

1. a layout model trained on **real Pakistani plans**,
2. an **explainable rule checker** (setbacks, room sizes, reachability, privacy, ventilation),
3. a **free in-browser walkthrough**,
4. a **proper evaluation with architects**.

It is a semester/prototype project, not a replacement for a registered architect. Output is concept-only, not approved or structural drawings.

---

## 2. Research findings (summary)

- **Demand.** Basic plans cost roughly Rs 10,000 to 50,000 from a naqsha nawees, or Rs 15 to 80 per sq ft from architects. Design is about 1 to 3% of build cost, so value lies in exploring options early and avoiding mistakes, not in price.
- **Competitors.** MakaanPlan and Unrean (Pakistan); NakshaAI, Cadbull AI, GrehYug (India); Maket.ai, Planner 5D, RoomSketcher and others (global). None combine open data, an explainable local-bylaw checker and a published evaluation.
- **Approach (state of the art).** Fine-tune a small language model on real plans, then apply reinforcement learning with verifiable rewards (a rule checker as the reward). References found in this session: Mila's RLVR floor-plan paper (NeurIPS 2025), Autodesk FLOORA (Qwen3 0.6B/1.7B), FloorplanVLM and Raster2Seq (image to JSON/polygons), and the ResPlan dataset (17,000 vector plans, CC BY 4.0).
- **Partly verified.** HypergraphFormer (arXiv 2605.18932) and a markup-based vector floor-plan paper (arXiv 2604.04859) did appear in a later search, but only summaries were seen; read the papers before citing. ResPlan's claimed South Asian origin is also unconfirmed and should be checked by plotting samples.
- **Bylaw numbers** in the prototype come from architecture-firm blogs. Verify them against official CDA/LDA/RDA/DHA documents before claiming compliance.

---

## 3. Current status

### 3.1 Working prototype (done)

A static web app (no build step, Three.js from CDN):

- **Step 1.** Plot input: marla presets (5, 7, 10 marla, 1 kanal), custom width/depth, bedrooms, and a free-text box ("10 marla 3 bed").
- **Step 2.** Three rule-generated layouts as 2D plans, with an explainable rule check (setbacks, coverage, minimum room sizes, reachability, guest privacy, kitchen ventilation, natural light) and an indicative PKR cost estimate.
- **Step 3.** Three facade styles (Modern, Classic, Mediterranean) shown as front elevations.
- **Step 4.** A 3D walkthrough: first-person walking with collision (WASD/arrows, drag to look), plus an overview mode with a roof toggle.

The layouts are **rule-based** (`js/layout.js`), not a trained model. They stand in for the future ML generator and share its output format.

**Live:** https://ahmedraza-2.github.io/naqsha-prototype/
**Repo:** https://github.com/AhmedRaza-2/naqsha-prototype (public)

### 3.2 Data pipeline (done, in `tools/`)

| Stage | Script | What it does |
|---|---|---|
| 1. Collect | `collect.py` | Parallel Bing image search; size filter; global near-duplicate removal (perceptual hash + URL). Size mode (3 marla to 1 kanal) and `--discover` mode (areas, societies, feet dimensions, house types, Urdu). |
| 1b. Rescue | `ingest_staging.py` | Recovers images left by interrupted crawls. |
| 2. Verify | `verify.py` | OCR (RapidOCR) checks for room words and printed dimensions; flags Indian markers; resumable; 10 parallel workers, one ONNX thread each (about 1 image/s). |
| 3. Clean set | `build_clean.py` | Global dedupe; builds `data/clean/` with images, `metadata.jsonl`, train/val/test splits and a review pile. |
| Gold set | `plan_schema.py`, `render_plan.py` | Standard plan format, validator, mirror augmentation, relative coordinates, and a renderer for checking annotations. |

`data/` is git-ignored and never published (images are copyrighted; keep derived data only).

### 3.3 Data numbers

| Item | Count |
|---|---|
| Images collected (raw, after in-folder dedupe) | about 10,400 |
| Unique after global dedupe | 8,132 |
| **Clean verified plans (unique)** | **1,147** |
| Split (train / val / test) | 959 / 115 / 73 |
| Strong tier (rooms plus dimensions) / likely tier | 883 / 264 |
| Sheets with several floor plans (need splitting) | 114 |
| Near-miss review pile | 597 |

Notes:

- An earlier count of 1,988 was inflated by duplicates across folders. 1,147 is the real figure.
- A plan's folder/group name records which search found it, **not** its plot size. Plot size must come from the printed dimensions.
- OCR verification has high precision but only moderate recall: about half of the rejected near-misses were real plans (Urdu thumbnails, collages, small text).
- Yield from area-based searches (e.g. "Lahore") was low. Plot-size and feet-dimension searches worked best.

### 3.4 Gold set (started)

Three plans annotated (G01 to G03) in absolute coordinates; 35 more selected for later. A side-by-side render check showed that **positions estimated by eye are only about plus or minus 3 ft** and leave gaps, although room sizes (from printed labels) are reliable. Absolute-coordinate annotation will not be scaled up.

**Decision pending:** switch to a **band format** (ordered rows from road to back, rooms left to right with printed widths). It is easier to read, tiles without gaps, scale-free, and matches the output of the rule-based generator.

### 3.5 Layout model (deep-learning core, in `tools/bands.py` and `ml/`)

Scope: plot size + bedroom count in, house layouts out. Method follows the current literature (Mila RLVR, NeurIPS 2025): an autoregressive transformer, then reinforcement learning with the rule checker as reward.

- **Band format** (`tools/bands.py`): rows from road to back, rooms left to right with widths; the last width/depth of each row is implicit so sums are exact. Includes parser, mirror augmentation, validator/reward (`check`, `score`) and a randomised synthetic generator.
- **Synthetic data** (`data/synth/`, git-ignored): 30,000 valid layouts (26,977 train / 1,525 val / 1,498 test); val and test use plot sizes never seen in training.
- **Model** (`ml/layoutlm.py`): word-level tokenizer (334 tokens) and a GPT-style transformer written from scratch (about 4.9M parameters at d=256, 6 layers).
- **Stage A** `ml/train.py` (supervised), **Stage B** `ml/rl.py` (GRPO-style RL, validator reward), **evaluation** `ml/evaluate.py` (validity, bedroom-count accuracy, rule score, diversity, memorisation, best-of-N, vs rule-based baseline). Kaggle steps: `ml/KAGGLE.md`.
- **Results (Kaggle, run v5, two identical runs; 142 held-out plot sizes incl. small plots, 4 samples each):** supervised model 99.3% valid / 82.4-82.7% perfect; after RL 99.6-99.8% valid / 84.3-87.5% perfect / mean score 0.979-0.984 (RL gain is +1.6 to +5 points, so treat it as small); rule-based generator (1 try) 73.2% valid / 47.2% perfect. The shipped model (`models/layout.onnx`) is the second run: 99.6% valid, 84.3% perfect. Small plots (<=6 marla) score 0.995 vs 0.34 for the baseline. 0% of outputs copy a training plan.
- **Data lessons (ablation material):** run 1 (loose data, 50% perfect plans) 46% perfect; run 2 (perfect-only, unbalanced) collapsed on small plots (0.25); run 3 (perfect + size-balanced) 89% perfect but test set had no small plots; run v5 (stratified split) fixes that.
- **Parallel/distributed:** parallel data generation (3.5x on 8 workers), fp16 + 2-GPU DistributedDataParallel (epoch 83 s -> 13 s), key/value-cache sampling, parallel reward scoring, RL and evaluation overlapped on separate GPUs (whole pipeline 7.5 min). `ml/bench_gpu.sh` for a clean per-step table is not yet run.
- **Landing page** (`landing/`, Vite + React + Tailwind v4 + Motion + Lenis + Three.js): scroll-driven house hero (gate and door open, light floods into the next section), plot-size form that hands over to the planner via `?q=`, how-it-works, measured results, footer. Dev: `cd landing && npm run dev` (port 5174); planner: `python -m http.server 5173` at the repo root.
- **In the browser:** `models/layout.onnx` (5.2 MB int8, exported by `ml/export_onnx.py`) runs in the planner via onnxruntime-web (`js/model.js`); `js/bands.js` is a port of the checker verified against Python (`tools/verify_js_port.py`, 600 plans, 0 mismatches); the planner's Generate button drafts 12 plans, keeps the best 3 distinct ones and falls back to the rule-based generator if the model fails (`?rules` skips the model). ONNX-model check in Python: 100% valid, 89% perfect on 120 held-out prompts (`ml/onnx_check.py`).
- **Preferences + realism (v7 data):** the request now carries `BATHS` (washrooms: bedrooms + 0..2, the extras being a guest bath and a common bath off the lounge) and `FOCUS` (balanced / bedrooms / lounge / kitchen, measured as shares of the built area); the checker and RL reward include both. `tools/real_stats.py` reads room sizes from the OCR text of 275 real plans and showed the first synthetic data had rooms that were too long (bedrooms 17-19 ft deep vs 13-14 real; drawing rooms 20-31 ft vs 14-16). The generator now caps the built depth, adds a stair hall and car porch, and an inner court on wide plots; synthetic medians are now close to the real ones (bedrooms 10.5-12 x 13.5-16.5 vs 11-12.4 x 13-14). Run v7 (Kaggle, 1,200 plans for 300 held-out requests): supervised 97.8% valid / 42.3% perfect; after RL 99.3% valid / 75.1% perfect / mean 0.967; washroom count right 99.8%, bigger-room choice right 97.5%; rule-based baseline 71.3% valid / 25.7% perfect / 63.0% bigger-room. RL now matters (+33 points perfect). Found afterwards: the realism changes made 3 bedrooms infeasible for 30-38 ft wide plots in the data (the 10 marla 35x65 preset had only 2-bedroom plans), fixed in the generator for run v8 by sizing the end bedroom so it always touches the lounge, and bedroom limits by plot width are now enforced in the form and planner.
- **Run v8 (shipped, Kaggle 2xT4, 594 s end to end; 1,200 plans for 300 held-out requests):** supervised 99.7% valid / 79.6% perfect / mean 0.973; after RL 99.8% valid / 84.3% perfect / mean 0.982; bedroom and washroom counts right 99.9%, bigger-room choice right 98.8%; by size class 0.973 (<=6 marla), 0.989 (6-14), 0.977 (>14). Rule-based generator, one try: 98.0% valid / 41.3% perfect / 92.0% bigger-room (the fixed generator is a much stronger baseline than in v7, so the gap is now in design-rule quality, +43 points perfect). Exported ONNX (int8): 100% valid / 80.8% perfect on 120 held-out prompts. **Coverage** (`ml/coverage.py`): every request the form can make on 9 usual plot sizes (5 marla to 60x110; all allowed bedroom counts x 3 washroom choices x 4 bigger-room choices = 246 requests, 12 samples each) gets at least one valid plan from the model, 236 get a perfect one, so the planner no longer falls back to the rule-based plans on these sizes. Same sweep on v7: 236/246 answered, 202 perfect; the 10 failures were all 3-bedroom requests on the 10 marla 35x65 preset (10 of its 12 requests), the data gap fixed in v8.
- **Small plots (v9 data):** user testing showed 3-5 marla plots got stretched, unusable rooms (a 20 x 5.5 ft drawing room on 25 x 32): the generator had one template (lawn, then three rows) that needs about 33 ft of built depth, so it produced 0 valid plans on 20 ft wide plots and 0 perfect plans on 25 x 32 to 30 x 40; the model had no data there and the planner fell back to the old rule-based layouts. New compact template for plots up to 6 marla (`generate_small` in `tools/bands.py`, ported to `js/compact.js`), modelled on real 5 marla plans (Zameen: 11x15 garage beside a 12x12 drawing room, 20x11 lounge with stairs, 11x14 bedrooms with 5x8 baths, 7x14 kitchen, 4-5 ft back yard): the car porch sits beside the drawing room in the front row and is the front open space (front setback 5 ft for up to 6 marla, was 8); three rows (front / lounge / bedrooms) when deep enough, two rows and one bedroom on shallow or narrow plots; the kitchen's window comes from the porch, back yard or front lawn; 'bigger X' moves depth into the row that holds X. Widths are drawn from the ranges each plot allows, so acceptance on small plots went from 0-17% to 70-100%. Limits by probing: up to 6 marla, 2 bedrooms from about 24 x 42 (22 x 48), else 1; at least 31 ft deep; washrooms up to bedrooms + 1. Bigger-bedrooms threshold for small plots calibrated from the generated share distribution (1 bed 0.24, 2 beds 0.40, +0.04). Dataset v9: 30,000 perfect plans in 21 s on 10 workers (acceptance 72%, was 32%), 6,728 on small plots (2,577 with 2 bedrooms). The planner draws the car porch in 2D and 3D (walls facing it are outside walls with windows, the car is parked in it), retries the model with fewer preferences before falling back, and uses the compact generator as the fallback on small plots.
- **Known limits:** single storey only (up to 6 marla: 1-2 bedrooms; 30 ft wide fits 2 above 6 marla; 35 ft wide fits 3); 6-8.5 marla plots narrower than about 27 ft still use the old template and are weak (side setbacks leave under 21 ft); built depth is capped at about 42 ft, so long plots (1 kanal) get a large back yard and about 37% coverage, and all layouts for one request share the same outline; no modern features yet (open kitchen, dressing, study, balcony); real-plan annotation in band format not started.

---

## 4. Plan: training the layout model

Deep-learning pipeline, in order:

1. **Understand.** Convert plan images to the standard format. Use a vision model as teacher on a few hundred plans, then distil into a local Qwen2.5-VL student (free to run at scale).
2. **Normalise.**
   - *Labels:* map every raw label to a fixed type list (e.g. "Drg Room" and "Guest room" become `drawing`; "TV Lounge" and "Family sitting hall" become `lounge`; "Car porch" and "Garage" become `porch`; unknown becomes `other`).
   - *Scale:* use printed dimensions (14'-6" becomes 14.5 ft), not pixels.
   - *Frame:* road at the front, one origin, standard mirror side, one plan per floor.
3. **Synthetic pretraining.** Generate tens of thousands of valid Pakistani-style plans with the rule generator.
4. **Supervised fine-tuning.** LoRA on a small Qwen3 (0.6B to 1.7B), on a free Kaggle GPU. Input: plot size, bedrooms, floors, features. Output: the layout. Mirror augmentation doubles the real data.
5. **Reinforcement learning with verifiable rewards.** The validator (setbacks, minimum sizes, reachability, privacy, area targets) is the reward (GRPO).
6. **Evaluate.** Validity rate, constraint adherence, diversity, per-size-band results, then blind architect ratings, compared with the rule-based baseline.
7. **Integrate.** Replace `generate()` in the web app; the rest (3D, rule checks) stays.

**Out of scope for the layout model** (separate components):

- 3D walkthrough: built procedurally from the layout (done).
- Front elevations: SDXL with ControlNet and a LoRA on Pakistani facades (future).
- Interiors: furniture placement (future).

---

## 5. Risks

- **Small real dataset** (1,147 plans): mitigated by synthetic pretraining, augmentation, and possibly ResPlan.
- **Noisy extraction labels:** mitigated by automatic validation, a held-out hand-checked gold set, and dropping bad rows.
- **Copyright:** plans belong to architects. Keep images local; share only derived data with credit; ask permission for research use (contact details are printed on plans).
- **Bylaw accuracy:** use official documents and show sources in the UI.
- **Liability:** concept only; recommend a registered architect.

---

## 6. Next steps

1. Decide on the **band format** for gold annotations; re-annotate G01 to G03 and do 12 to 15 more, checking each by rendering.
2. Build the **label-mapping table** (raw label to canonical room type).
3. Export **synthetic training data** from the rule generator.
4. Write the **first training script** (Qwen3 LoRA on a free Kaggle GPU).
5. Build the **image-to-plan extraction** (teacher/student) and run it over the 1,147 plans plus the 597 near-misses.
6. Add the **RL stage** with the validator as reward; then evaluate and run an architect survey.

Validation work still open: a 50 to 100 person survey, 5 to 8 interviews (architects, builders, homeowners), a competitor teardown on the same three briefs, and a landing-page smoke test.

---

## 7. Repository layout and commands

```
index.html, styles.css, js/        web app (layout.js = rule generator + validator)
tools/                             data pipeline scripts
data/ (git-ignored)
  raw/ verified/ clean/ gold/      images and datasets
  manifest.jsonl verified.jsonl    records
```

```powershell
# run the app locally
python -m http.server 5173

# data pipeline
python -u tools/collect.py --sizes 5 10            # size mode
python -u tools/collect.py --discover              # areas / dimensions / types / Urdu
python tools/ingest_staging.py                     # rescue interrupted downloads
python tools/verify.py --workers 10                # OCR verification (resumable)
python tools/build_clean.py                        # build data/clean + splits
python tools/plan_schema.py data/gold/annotations  # validate gold annotations
python tools/render_plan.py data/gold/annotations/G01.json
```

Windows notes: PowerShell has no `wc`; use `(Get-Content file).Count`. Run long crawls in your own terminal, not through a tool call that may kill them when it ends.
