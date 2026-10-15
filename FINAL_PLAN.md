# Naqsha AI: final plan (deep-learning semester project)

> **Revised plan (v2), after review of the live product.** Problems found: every layout follows the same three-row
> structure with different sizes; elevations are static drawings; furniture is hard-coded; the 3D render is fast but
> flat. Root causes and the new go-to option are in section 0. Sections 1 to 7 below are the earlier plan; the items
> there that are still planned (constrained decoding, ablations, human evaluation, report) are folded into section 0.

## 0. Go-to option v2: pretrain on world plans, fine-tune on Pakistani plans, richer plan language, real 3D

### Why every layout looks the same
1. The model learns from our synthetic generator, and the generator has essentially one Pakistani template
   (front row: drawing + entrance; middle row: kitchen + lounge; back row: bedrooms). A model trained on one template
   reproduces that template; it only changes sizes.
2. The plan language (rows of rooms) cannot express L-shaped lounges, side corridors, central courtyards, rooms that
   span two rows, or a bedroom wing. Even a perfect model could not draw them.
3. The real data that would teach other arrangements is tiny (9 gold + 13 silver plans).

### The fix, in deep-learning terms
| Step | What | DL concept |
|---|---|---|
| A. Richer plan language | Replace rows-of-rooms with a **slicing tree**: the plot is cut recursively, horizontally or vertically, into rooms (`H 12 [ ... ] [ ... ]`). Rows are a special case, so all current data converts losslessly; the last size of each cut stays implicit, so sums stay exact. The checker already works on rectangles. | sequence representation design (cf. FMLM, CVPR 2026) |
| B. Pretraining on real plans from around the world | **ResPlan** (17,000 real residential plans, CC BY 4.0, room polygons + graphs) converted to slicing trees (rectangles fitted to each room; plans kept when the fit covers at least 90% of the area). Optionally MSD (ECCV 2024) and RPLAN (80,000, academic request). | large-scale pretraining, transfer learning |
| C. Fine-tuning on Pakistani plans | A more varied Pakistani generator (v11: side corridor, central court, L-lounge, bedroom wing, open kitchen, front bedroom, servant quarter) + the real Pakistani plans; then RL with the rule checker. | domain adaptation, RL with verifiable rewards |
| D. Diversity on purpose | a STYLE/arrangement token, diverse top-3 selection (most different layouts among the valid ones), and a diversity metric in the evaluation | conditional generation, diversity vs quality trade-off |
| E. Constrained decoding | grammar masks during sampling: only tokens that keep the tree valid | structured / constrained decoding |
| F. Evaluation | validity, preferences, rule score, **diversity** (pairwise layout distance), real-plan perplexity, ablations (pretraining on/off, language rows vs tree, RL on/off, model size), human study | ablation and scaling study |

### 3D, elevations and furniture
| Problem | Fix |
|---|---|
| Flat 3D render | physically based materials, ACES tone mapping, soft shadows from a sun, environment lighting, ambient occlusion; textures for floors, plaster, brick and stone per style |
| Static elevation drawings | elevations rendered from the actual 3D model (front orthographic camera), so they change with every layout and style; style parameters for parapets, cladding, window frames, porch canopy, boundary wall and gate |
| Hard-coded furniture | a furniture **solver**: per room, candidate positions along walls are scored (against a wall, door swing clear, windows not blocked, 3 ft walkways, bed headboard on a solid wall, sofa facing the TV wall) and optimised by simulated annealing; real CC0 furniture models instead of boxes. Learned placement (ATISS on 3D-FRONT) is noted as future work: it needs a large licensed 3D dataset. |

### Order and time (about 12 working days)
| Days | Claude | You |
|---|---|---|
| 1-3 | slicing-tree language (Python, browser, editor), convert all data; ResPlan converter | download ResPlan if my download is too slow |
| 3-4 | Pakistani generator v11 (more arrangements); package pretrain + fine-tune + RL Kaggle run | run it (about 1.5 h) |
| 5-7 | 3D: materials, lighting, shadows, textures; elevations from the 3D model; furniture solver and models | review the look |
| 8 | constrained decoding, diverse top-3, ablation run script | run ablations (about 1.5 h) |
| 9 | human-evaluation page | send to 10 people |
| 10-12 | report, slides, demo script | review, record demo |

If time runs short, cut in this order: human study, MSD/RPLAN, furniture models (keep the solver), ablation breadth.
A to C plus the 3D lighting are the must-haves.

**One line:** a small transformer, trained from scratch, drafts rule-checked Pakistani house layouts from a plot size
and a few preferences. It learns from synthetic plans, is sharpened with reinforcement learning against a rule
checker, and is adapted to real plans read by a vision model. It runs in the browser with an editor and a 3D walkthrough.

---

## 1. Where we are (done and live)

| Part | Status | Evidence |
|---|---|---|
| Synthetic data: generator + rule checker | done (v1 to v9) | 30,000 plans in 21 s on 10 processes; 72% acceptance |
| Model: GPT-style transformer from scratch | done | 4.9M parameters, word-level tokenizer, KV cache |
| Supervised training on 2 GPUs (DDP, fp16) | done | epoch 83 s on 1 GPU fp32 to 13 s on 2 GPUs fp16 |
| RL with the checker as reward (GRPO style) | done | v7: 42% to 75% fully passing; v9: 86.8% to 90.5% |
| Real plans: crawl, OCR, hand transcription, vision-model reading | done (small) | 1,147 crawled, 9 gold, 13 silver |
| Fine-tuning on real plans (v10, live) | done | real-plan perplexity 299 to 57.5 |
| Browser deployment: int8 ONNX, onnxruntime-web | done | 5.2 MB, no server, no paid API |
| Product: planner, recommendations, car porch, editor, 3D | done | naqsha-ai.vercel.app |

Headline numbers (v10, 1,200 plans for 300 requests on plot sizes never seen in training):
99.4% valid, 99.8% right bedroom and washroom counts, 99.0% preference met, 90.7% pass every design rule
(rule-based generator: 97.3 / 97.3 / 93.0 / 62.3). Coverage: all 292 form requests answered.

---

## 2. Research framing

**Problem.** Text- and graph-to-floorplan research (House-GAN, Graph2Plan, HouseDiffusion, Tell2Design, ChatHouseDiffusion,
HouseTune, DiffPlanner, FMLM) is trained on large Chinese/Western datasets (RPLAN, LIFULL, Swiss Dwellings). Pakistani
houses (marla plots, setbacks, drawing room with guest bath, car porch, servant quarter) have no public dataset.

**Our angle.** (1) A plan as a short token sequence (rows of rooms), like FMLM's markup but designed so sums are exact
by construction; (2) reinforcement learning with *verifiable* rewards (a rule checker, no human labels) instead of only
imitation; (3) synthetic-to-real transfer with very little real data, where a vision-language model is the teacher.

**Research questions**

| # | Question | Measured by | Current answer |
|---|---|---|---|
| RQ1 | Can a small transformer trained only on synthetic plans produce valid, request-following layouts for plot sizes it never saw? | validity, count accuracy, rule score, per-size score | yes: 99.4% valid, 90.7% perfect vs 62.3% for the generator |
| RQ2 | Does RL with a rule-checker reward improve on supervised training? | perfect%, reward curves, KL | yes: +33 points (v7), +3.7 (v9) |
| RQ3 | Does fine-tuning on a handful of real plans close the synthetic-to-real gap without losing validity? | real-plan perplexity, room-size gap, synthetic metrics | partly: perplexity 299 to 57.5 with 4 plans; -1.4 points perfect |
| RQ4 | What matters more, data quality or model capacity? | ablation table | data (v1 to v9 history); capacity: to measure |
| RQ5 | How much do parallel and distributed techniques save? | speed table | 6x per epoch; to finish the clean table |

---

## 3. Deep-learning concepts covered (and where)

| Concept | Where in the project |
|---|---|
| Tokenization, vocabulary design | `ml/layoutlm.py` (339 tokens; numbers on a 0.5 ft grid) |
| Transformer, causal self-attention, positional embeddings | `ml/layoutlm.py` (6 layers, 8 heads, d=256) |
| Teacher forcing, cross-entropy, perplexity | `ml/train.py`, `ml/eval_real.py` |
| AdamW, warmup + cosine schedule, gradient clipping | `ml/train.py` |
| Mixed precision (fp16) and gradient scaling | `ml/train.py` |
| Data parallelism (DistributedDataParallel) | `torchrun` in `ml/run_all.sh` |
| Data augmentation (mirroring) | `--mirror` |
| Generalisation: held-out plot sizes, stratified split | `split_by_plot` in `tools/bands.py` |
| Policy-gradient RL, GRPO group advantages, KL to a reference | `ml/rl.py` |
| Reward design (verifiable rewards) | `check` / `score` in `tools/bands.py` |
| Sampling: temperature, best-of-N, KV-cache decoding | `ml/layoutlm.py`, `js/model.js` |
| Transfer learning and fine-tuning, domain adaptation | `--init`, `--extra` in `ml/train.py` |
| Knowledge distillation / pseudo-labelling (vision model as teacher) | `real/extract_vlm.py`, `real/build_real.py` |
| Quantisation (int8) and ONNX deployment | `ml/export_onnx.py` |
| Constrained decoding | **to add (section 4, step 1)** |
| Scaling / ablation study | **to add (section 4, step 2)** |

---

## 4. Final go-to option: finish the core, add two DL extensions

Chosen because it gives the strongest report for the time left, uses only free GPUs, and every step produces a number.

1. **Constrained decoding** (Claude, 1 day). During sampling, mask tokens the grammar does not allow (a width after a
   room type, `|` or newline in the right places, no width that overflows the plot). Expected: parse rate 100%,
   fewer invalid plans, fewer samples needed. Report: validity and speed with vs without the mask.
2. **Ablation and scaling study** (Claude writes one Kaggle script, you run it, ~1.5 h on 2 GPUs). Each row trained
   and evaluated on the same held-out set: model size (1.2M / 4.9M / 19M params), data size (5k / 15k / 30k),
   mirroring on/off, RL steps (0 / 100 / 400), real fine-tuning on/off.
3. **More real data** (you run, overnight). v10b with the 11 recovered plans (6 min); optionally re-read 400 plans with
   Qwen3-VL-8B (75 min). Claude transcribes ~20 more gold plans so the real test set is 30, not 9.
4. **Parallel-computing table** (you run `bash ml/bench_gpu.sh`, 5 min) plus the numbers already measured: data generation
   3.5x on 8 processes, 2-GPU training, 2 GPUs reading plans in parallel, RL and evaluation overlapped.
5. **Human evaluation** (Claude builds a small page, you send it to 10 people, 10 min each). Blind pairs: real vs
   generated plan (which is real?), and "which layout would you build?" among the three drafts.
6. **Report, slides, demo** (Claude drafts; you review).

**Not doing (future work):** double-storey plans, a diffusion model on RPLAN, AutoCAD export.
**Alternatives considered:** A) stop and write up now: safe but no answer to RQ4 and weak RQ3. C) train a diffusion
baseline (HouseDiffusion): different data and too long on free GPUs. D) double-storey: high product value, little new
deep learning.

---

## 5. Schedule (10 working days)

| Day | Claude | You |
|---|---|---|
| 1 | constrained decoding (Python + browser) and its measurement | upload v10b, run (6 min) |
| 2 | ablation/scaling Kaggle script | run it (~1.5 h) |
| 3 | transcribe 20 more gold plans | optional Qwen3-VL re-read overnight |
| 4 | real-plan evaluation on 30 gold; ship the best model | run `bench_gpu.sh` (5 min) |
| 5 | human-evaluation page | send to 10 people |
| 6-7 | report draft (sections below) | read, mark what to change |
| 8 | slides and a 3-minute demo script | record the demo |
| 9 | fixes, final numbers, README | final check of the live site |
| 10 | buffer | rehearse |

---

## 6. Report outline (8 to 10 pages)

1. **Introduction:** the problem in Pakistan (marla plots, cost of a first draft), contributions.
2. **Related work:** procedural and rule-based layout; House-GAN / House-GAN++; Graph2Plan; HouseDiffusion;
   Tell2Design and ChatHouseDiffusion (text to plan); HouseTune and DiffPlanner (LLM + diffusion, 2025);
   FMLM (plans as markup, next-token prediction, CVPR 2026); RL with verifiable rewards.
3. **Data:** generator and its versions; rule checker; real crawl (1,147), OCR statistics, gold and silver sets.
4. **Method:** band representation and tokenizer; transformer; supervised training; RL (GRPO, KL); fine-tuning on
   real plans; constrained decoding; quantised in-browser inference.
5. **Parallel and distributed computing:** speed table and what each technique saves.
6. **Experiments:** metrics (validity, count accuracy, preference, rule score, perplexity, size gap, coverage);
   main results; ablations; unseen plot sizes; real-plan results; human evaluation.
7. **System:** planner, recommendations, editor, 3D walkthrough, no-server deployment.
8. **Limitations and ethics:** indicative setbacks only; copyright of crawled plans (only derived data shared);
   vision model noise; single storey.
9. **Conclusion and future work.**

---

## 7. Risks

| Risk | Plan |
|---|---|
| Kaggle GPU quota (30 h/week) | every run here is under 2 h; ablations batched into one run |
| Vision model reads geometry badly | keep it to room names/sizes; rely on gold for evaluation; Qwen3-VL as the upgrade |
| Small real test set | grow gold to 30; report confidence intervals |
| Deadline | items 1, 2, 4 and 6 are enough for a complete report; 3 and 5 strengthen it |
