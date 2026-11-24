# Naqsha models: what is live, how it was trained, where the weights are

Keep this file up to date whenever a model ships. Weights of every model that went live are in `weights/` and nowhere
else; models that were trained but not shipped are listed at the bottom with the reason, and their weights are not kept.

## Live now (naqsha-ai.vercel.app)

| Part | Version | Browser file | Weights (PyTorch) | Stamp |
|---|---|---|---|---|
| Layout model (draws the plans) | **v18** | `models/layout.onnx` + `models/vocab.json` | `weights/layout/v18_rl_model.pt` | `712ccc1f78` (sha1 of layout.onnx, `models/manifest.json`) |
| Request reader (typed / spoken requests) | nlu v1 | `models/nlu.onnx` + `models/nlu.json` | `weights/nlu/nlu.pt` | |

Speech fallback: Whisper tiny.en, loaded from the CDN (not trained here).

## How the layout model works

GPT-style transformer written from scratch (`ml/layoutlm.py`): 6 layers, 8 heads, d=256, tied embeddings, word-level vocabulary
of about 330 tokens. A prompt (`PLOT 30 x 50 BEDS 3 BATHS 3 STYLE wing`, plus `FLOOR / BOX / UP` for a first floor and
`STOREYS 2`) is completed with a slicing tree (`H 10 13 [lawn] [V 12 ...]`). In the browser it runs as int8 ONNX with a key/value
cache; `js/grammar.js` constrains decoding (sizes add up, required rooms present, stairs over stairs), and `js/bands.js` (the rule
checker, same rules as `tools/bands.py`) ranks the drafts.

## Training pipeline (all code in this repo)

| Step | Code | Notes |
|---|---|---|
| Synthetic Pakistani plans | `tools/bands.py`, `tools/gen_tree.py`, `tools/gen_upper.py`, `tools/build_v13.py`, `tools/build_v17.py` (drops plans that waste their plot) | rule-based generators, every plan passes the checker; v13 data = `data/pk13` (72,577 train), v17/v18 = `data/pk17` (66,390) |
| Self-distillation (expert iteration) | `tools/distill.py` | the live model drafts, the planner finishes the plans in headless Chrome, plans passing every rule become training data (`data/distill18.jsonl`) |
| World plans | `real/resplan_convert.py` (ResPlan), `real/cubicasa_convert.py` + `real/cubicasa_remote.py` (CubiCasa5k) | tagged `SRC world` |
| Real Pakistani plans | `real/` (hand transcriptions `real/hand` -> `real/build_hand.py`, `real/gold.jsonl`, vision reading `real/extract_vlm2.py` -> `real/build_real.py`), `tools/build_v14.py` (CubiCasa and vision plans into `data/world_cc11`, `data/real14`) | repeated x20 in fine-tuning |
| Pretrain / fine-tune | `ml/train.py` | `--init` previous model, `--extra file*repeat`, `--mirror` |
| Reinforcement learning | `ml/rl.py` | GRPO-style, reward = rule score (`--quality w` adds `ml/quality.py`), KL to the fine-tuned model |
| Evaluation | `ml/evaluate.py` (rules, held-out plots), `ml/eval_real.py` (real plans), `ml/eval_quality.py` (plot use), `tools/ab_models.py` (two models through the real planner), `tools/e2e_rules.py` (planner rules in the browser) | |
| Export to the browser | `ml/export_onnx.py --ckpt weights/layout/vNN_rl_model.pt --out models/layout` | then `python ml/coverage_styles.py --onnx models/layout.onnx` |
| Kaggle (2 x T4) | `ml/KAGGLE.md`, `ml/run_v18.sh` (recipe of the live v18), `ml/run_v13.sh` (v13, the model v18 starts from) | zip `ml`, `tools`, `data/...`, the init weights into a private dataset, `kaggle kernels push` a script that runs the `.sh` |
| Request reader | `ml/nlu.py` | templates in English and Roman Urdu |

To ship a model: export it, A/B it against the live one with `tools/ab_models.py models <new folder>`, run `tools/e2e_rules.py`,
copy its `.pt` into `weights/layout/` and update the table above, then deploy (`cd landing; npm run ship`).

## Shipped versions (weights in `weights/layout/`)

| Version | What changed | Key numbers |
|---|---|---|
| v7, v8 | washroom / bigger-room preferences; a model plan for every usual plot | weights not kept (ONNX in git history: fcaad22, d69a95a) |
| v9 | small plots from the model | 292/292 form requests answered |
| v10 | fine-tuned on real plans | real-plan perplexity 299 -> 58 |
| v11 | ResPlan pretraining, slicing-tree plans, bedroom wing and side corridor families | |
| v12 | layout families as asked, wings on big plots | real-plan perplexity 21.3 |
| v13 | two-storey houses: first floors over the ground floor | held-out 98.7% valid, 92.9% pass every rule; first floors 99.4% valid; real-plan perplexity 9.2 |
| **v18** (live) | expert iteration: v13 fine-tuned on `data/pk17` + 1,832 plans finished by the planner (`tools/distill.py`: two-storey ground floors with the proper 7 x 13.5 stair, narrow 3-bed houses) x4 + CubiCasa + real plans; RL with rules and plot-use quality 0.2 (`ml/run_v18.sh`) | held-out: 93.9% pass every rule (v13 92.7%), quality 0.924 (0.905), room sizes 0.846 (0.794), real-plan perplexity 9.06 (9.19). Through the planner, 40 requests each: 62 layouts pass every rule vs v13 53, quality 0.928 vs 0.920, wasted space 0.971 vs 0.919 |

## Trained, not shipped (weights not kept)

| Version | Data / change | Result | Why not shipped |
|---|---|---|---|
| v14 | +61 Pakistani plans read by a vision model | gold perplexity 9.10 (v13 9.19) | gain within noise |
| v15 | +1,417 CubiCasa5k plans | gold perplexity 8.59, held-out perfect 92.8% | realism score on real-style prompts fell 0.739 -> 0.668 |
| v16 | quality reward (`ml/quality.py`, weight 0.4), data filtered by quality (first version of `tools/build_v17.py`) | quality 0.905 -> 0.924, room sizes 0.794 -> 0.842, gold perplexity 8.49 | in the real planner it drew no layout for 25x45 and 28x55 with 3 bedrooms (asked for real-plan room sizes on plots too small for them) |
| v17 | v16 with room sizes scaled to what the plot can hold, quality weight 0.3 (data `data/pk17`; same steps as `ml/run_v18.sh` without the distilled plans) | held-out quality 0.905 -> 0.926, room sizes 0.795 -> 0.848, rules equal to v13 | through the planner (`tools/ab_models.py models runs/v17`) quality 0.909 vs v13 0.926, more wasted space, a weak 45x90 two-storey |

Also tried: ranking the planner's drafts by `js/quality.js` among equal rule scores: 0.918 vs 0.928 without it (the planner's
refine step already grows rooms toward real sizes after the pick), so it was taken out. `js/quality.js` stays as the measure
`tools/ab_models.py` uses. Run-to-run noise of that A/B is about +-0.02 quality, so a model must beat v13 by more than that.

## Plan reader (U-Net CNN): trained, not live

`ml/planreader.py`, weights `weights/planreader/planreader_unet_cubicasa.pt` (4.4 M parameters, 11 pixel classes), trained on CubiCasa5k
(4,199 train / 399 val / 399 test, 256 x 256, 60 epochs, about 50 s per epoch on a T4; recipe `ml/run_planreader.sh`).
Results on the held-out test plans (`weights/planreader/test_iou.json`): pixel accuracy 73.5 percent (all-background baseline 52.5), **mean IoU 0.403**
(background 0.83, living 0.53, bedroom 0.49, outdoor 0.47, kitchen 0.45, hall 0.36, bathroom 0.33, door/window 0.20, wall 0.19).
Counting what the app needs (`ml/planreader_counts.py`, 400 test plans): bedrooms exactly right 49.5 percent (within one 83.8),
washrooms 52.2 (83.8), kitchens 64.0 (95.8). Tuning the region-counting thresholds changed this by under 1 percent.
**Why it is not on the website:** CubiCasa is mostly Finnish and European apartments. On real Pakistani plan sheets
(banners, two floors on one sheet, printed dimensions, Urdu text, `docs/planreader_on_pakistani_plans.png`) the picture is blobby and the
counts are not reliable. The browser side (`js/planreader.js`, the "start from a plan photo" button) is in the code and stays hidden until
`models/planreader.onnx` + `models/planreader.json` exist. Next steps that would fix it: fine-tune on Pakistani plan images with pixel masks
(needs annotation), train at 512 px for thin walls, add a plan-sheet detector that crops one floor.
