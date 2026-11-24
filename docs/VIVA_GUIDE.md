# Naqsha AI: viva guide

Everything below is taken from the repository as it is today (numbers from the evaluation logs; file paths are real).
Read sections 1 to 6 once, then use section 9 (questions) and section 10 (hands-on) to practise.

---

## 1. The 60-second answer

"Naqsha AI turns a plot size and a few wishes (bedrooms, washrooms, floors, cars) into house plans for Pakistani plots,
and then into a 3D walkthrough. The plans are drawn by a **neural network I trained from scratch**: a GPT-style
transformer that writes a plan one token at a time, as a *slicing tree* (`H 10 13 [lawn] [V 12 [drawing] [lobby]] ...`).
It was trained in stages: pretraining on **synthetic** plans from rule-based generators, fine-tuning on **real** plans
(Pakistani ones I collected and read, plus public datasets ResPlan and CubiCasa5k), then **reinforcement learning**
where a rule checker is the reward, then **self-distillation** where the finished plans of the planner become
training data. It runs in the browser (ONNX, no server). A second transformer reads typed or spoken requests in
English, Roman Urdu and Urdu script, a **U-Net CNN** reads a photo of an existing plan, and Whisper does speech to text."

Why deep learning and not just rules? Rules can only repeat the layouts their author thought of. The network learns the
*distribution* of good layouts (what sits next to what, typical sizes) and produces many different valid plans; the rule
checker then keeps the model honest. That combination (learned generator + symbolic verifier) is the core idea.

---

## 2. Where we started and how it grew (from the git history)

| When | What |
|---|---|
| 9 Oct | First prototype: plot size, layouts, 3D walkthrough (rule-based) |
| 12 Oct | **Data collection**: crawler for plan images (searches like "5 marla naqsha map"), OCR verifier, de-duplication |
| 13-14 Oct | Plan schema + validator, **rule-based layout generator**, **transformer training, RL, evaluation**, **ONNX export with KV cache**, model running in the browser |
| 14-17 Oct | v7 to v12: washroom/bigger-room preferences, real-plan fine-tuning (real-plan perplexity 299 to 58), ResPlan pretraining, slicing trees, bedroom-wing and side-corridor families |
| 17-18 Oct | v13: **two-storey houses** (first floors drafted over the ground floor), constrained decoding |
| Nov | Request reader (small transformer), 3D interiors, English/Urdu voice, CubiCasa5k, vision-model plan reading |
| 20-22 Nov | v14-v17 experiments (not shipped), **v18 shipped** (self-distillation), planner rules, editor (split/join/move rooms) |
| 23 Nov | **Plan reader CNN** (U-Net) code and browser side |

Mention that v14, v15, v16, v17 were trained, measured and **rejected** (see `MODELS.md`): it shows you evaluate honestly.

---

## 3. Datasets: what, how many, and which folder

**Important:** the `data/` folder is in `.gitignore`, so it is only on this PC (it is large). The committed copies are
`real_plans/` (real images and lists), `real/` (hand transcriptions, scripts), `weights/` (model weights) and `models/` (what the browser loads).

### 3.1 Real Pakistani plans (the "real" data)

| Step | Folder / file | Count |
|---|---|---|
| Crawled images, by search group | `data/raw/<group>/` + `data/manifest.jsonl` | 10,409 images |
| OCR check "is this really a floor plan with Pakistani text" | `data/verified.jsonl`, `tools/verify.py` | 1,988 real plans found |
| Cleaned set (dedup, quality tier) | `data/clean/` (copy in **`real_plans/`**, committed) | **1,147** plans (train 959 / val 115 / test 73) |
| Read by hand into room lists | `real/hand/*.json` (274 files), `real/TRANSCRIBE.md` | built into `data/real13` |
| Read by a vision model (Qwen2.5-VL-7B) with checker feedback | `real/extract_vlm2.py` | 600 read, 61 kept to `data/real14` |
| **Training rows from real plans** | `data/real11`, `data/real13`, `data/real14` | about 136 train; test: 33 + 9 gold plans (`real/gold.jsonl`) never trained on |

Honest point: the *real* Pakistani set is small (about 136 training plans). Printed room sizes in the images are
incomplete, and OCR-only reconstruction kept only 3 of 1,147; that is why a vision model and hand transcription were used.

### 3.2 Public real datasets

| Dataset | What | Folder | Used as |
|---|---|---|---|
| **ResPlan** (17,000 residential plans, CC BY 4.0) | vector plans, `real/resplan_convert.py` rasterises rooms and fits a slicing tree | `data/world11` (9,928 train / 2,334 val) | pretraining, tagged `SRC world` |
| **CubiCasa5k** (5,000 plans as SVG + images, CC BY-NC 4.0, Zenodo 2613548) | `real/cubicasa_convert.py` for trees, `real/cubicasa_masks.py` for the CNN | `data/world_cc11` (1,346 train / 71 val) | layout pretraining; **U-Net training data** |

### 3.3 Synthetic Pakistani plans

| What | Code | Folder |
|---|---|---|
| Single-floor plans (rows and compact layouts) | `tools/bands.py` (generator + validator) | |
| Side-corridor and bedroom-wing families | `tools/gen_tree.py` | |
| First floors over a ground floor | `tools/gen_upper.py` | |
| Builds the v13 set | `tools/build_v13.py` | **`data/pk13`**: 72,577 train / 4,591 val / 8,813 test |
| Quality-filtered set (drops plans that waste their plot) | `tools/build_v17.py`, `ml/quality.py` | **`data/pk17`**: 66,390 train |
| Planner-finished plans (self-distillation) | `tools/distill.py` | **`data/distill18.jsonl`**: 1,832 |
| Request-reader sentences (templates, English + Roman Urdu, speech/typing slips) | `ml/nlu.py gen` | generated on the fly |

**How the synthetic plans are generated** (this is a favourite question): a plot (e.g. 30x50) gets its **setbacks**
(front 10, rear 4, sides 3 for 6-8.5 marla; stricter for bigger plots), which fixes the buildable box. The generator
then splits the box into rows and columns following real Pakistani habits (lawn and car porch in front, drawing room
and entrance at the front, kitchen and lounge in the middle, bedrooms with attached washrooms at the back), with random
sizes on a 0.5 ft grid. **Every plan must pass the rule checker** (`tools/bands.py: check`): setbacks, coverage limit,
minimum room sizes, attached baths, entrance on the road side, every room reachable, guest privacy, kitchen ventilation,
natural light. Plans that fail are discarded. Held-out **plot sizes** (val/test) are never in training.

**The plan language (slicing tree):** `H 12 13 [..] [..]` cuts the box horizontally at 12 ft, `V` vertically, `[bed +bath 5x7 R]`
is a room with its washroom. It always tiles the plot exactly, which is why the output is a valid plan geometry.

Where the plots come from: `tools/real_stats.py` compared room sizes in real plans (275 usable) with the synthetic ones
(`data/real_stats.json`, bedrooms about 143-175 sq ft, kitchens 88-130...), and the generator was tuned to match.

---

## 4. The models (what is deep learning here)

| # | Model | Type | Size | Trained by us? | Job | Where |
|---|---|---|---|---|---|---|
| 1 | **Layout model (v18)** | decoder-only **Transformer** (GPT-style), 6 layers, 8 heads, d=256, tied embeddings, learned positions, vocab 357 | 4.9 M params | yes, **from scratch** | writes the plan as tokens | `ml/layoutlm.py`, weights `weights/layout/v18_rl_model.pt`, browser `models/layout.onnx` (int8, 5.2 MB) |
| 2 | **Request reader** | Transformer **encoder** (2 layers) with hashed character n-gram word embeddings, tags per word + sentence labels | 0.6 M | yes | reads "10 marla 2 floors 4 bed" typed or spoken, English / Roman Urdu | `ml/nlu.py`, `models/nlu.onnx` |
| 3 | **Plan reader** | **U-Net CNN** (encoder-decoder with skip connections), 4.4 M params, 11 classes | 4.4 M | yes (training queued on Kaggle) | labels every pixel of a plan photo (wall, door, kitchen, bedroom...) | `ml/planreader.py`, `js/planreader.js` |
| 4 | Whisper tiny.en / base | pretrained speech transformer | | no (used as is, in the browser) | speech to text fallback | `js/voice.js` |
| 5 | Qwen2.5-VL-7B (4-bit) | pretrained vision-language model | | no (tool) | read real plan images into training rows, with rule-checker feedback and retry | `real/extract_vlm2.py` |

### 4.1 The training pipeline of the layout model

1. **Pretraining / supervised learning** (`ml/train.py`): next-token cross-entropy, only on the plan after the prompt;
   AdamW (betas 0.9/0.95, weight decay 0.1), gradient clipping 1.0, mixed precision, 2 GPUs (DDP) on Kaggle T4s;
   **left-right mirror augmentation**. Data mix: synthetic + ResPlan + CubiCasa, real Pakistani plans repeated x20.
2. **Fine-tuning** on real plans (the biggest jump: real-plan perplexity 299 to 58 at v10, 9.2 at v13).
3. **Reinforcement learning, GRPO-style** (`ml/rl.py`): for each prompt sample 8 plans, **reward = rule-checker score**
   (plus a plot-use quality term, `ml/quality.py`), advantage = reward relative to its group, policy-gradient with a
   **KL penalty to the frozen fine-tuned model** so it stays realistic. A penalty also if the plan is not the layout family asked.
4. **Self-distillation / expert iteration** (`tools/distill.py`, v18): the model drafts, the full planner repairs and polishes
   (proper stair, porch, room sizes), the plans that pass every rule become new training data.
5. **Constrained decoding** at run time (`js/grammar.js`): a "guide" only lets the model write tokens that keep the tree valid
   (sizes add up, required rooms present, stairs above stairs). Sampling is then nucleus sampling; the rule checker ranks drafts.
6. **Export**: PyTorch to ONNX with a key/value cache (one token per call), int8 dynamic quantization, runs with onnxruntime-web (WebAssembly).

### 4.2 Where is the CNN?

Be straightforward: the **layout generator is a transformer, not a CNN** (a CNN is for grids of pixels; the plan is a sequence).
The CNN is the **plan reader** (U-Net) that takes an image of a plan. Data: CubiCasa5k, official split 4,199 / 399 / 399.
Loss: weighted cross-entropy + Dice; metric: **IoU** per class and mean IoU on the test plans; augmentation: rotation, flip, contrast, blur, noise.
Status to state honestly: code, data builder, browser module and Kaggle script are done and tested end to end on a small
stand-in set; the full training run was waiting for a Kaggle GPU slot, so **report the IoU only once it has run**.

---

## 5. Results you can quote (from the evaluation logs)

| Measure | Value |
|---|---|
| Held-out plot sizes, plans that pass **every** rule | v13 92.7 percent, **v18 93.9 percent** |
| Valid (no rule error) | 99 percent |
| Real-plan perplexity (lower = knows real plans better) | 299 (v9) to 58 (v10) to 21 (v12) to 9.2 (v13) to **9.06 (v18)** |
| Through the real planner, 40 requests | v18: 62 layouts pass every rule vs v13: 53; less wasted space (0.971 vs 0.919) |
| Layout family asked vs drawn | 99+ percent |
| Rule suite in a real browser (31 layouts) | 0 problems |

Ablations / rejected experiments (`MODELS.md`): v14 (+61 vision plans) gain in noise; v15 (+CubiCasa) realism score fell;
v16/v17 (quality reward) better on the held-out set but not better through the planner. Saying "I measured it and did not ship it" is a strength.

---

## 6. Techniques and frameworks (a checklist to speak from)

- **Sequence modelling**: transformer decoder, causal self-attention, positional embeddings, weight tying, KV cache.
- **Training**: cross-entropy, AdamW, mixed precision, DDP, data augmentation (mirror), curriculum (synthetic then real).
- **Transfer learning**: pretrain on synthetic + public plans, fine-tune on real.
- **RL from a verifiable reward**: GRPO-style policy gradient, KL regularisation, group-relative advantage.
- **Self-training**: expert iteration / self-distillation.
- **Decoding**: nucleus sampling, constrained decoding with a grammar guide, re-ranking with a rule checker.
- **Evaluation**: held-out *plot sizes*, perplexity on real plans, rule pass rate, A/B through the whole app, diversity.
- **CNN**: U-Net, Dice + weighted cross-entropy, IoU.
- **NLP**: char n-gram hashing embeddings, small transformer encoder, token tagging + multi-label classification.
- **Frameworks**: PyTorch, ONNX / onnxruntime-web, transformers.js (Whisper), three.js (3D), Playwright (browser tests), Kaggle (2 x T4).

---

## 7. How the app uses the models (end to end)

1. User types or speaks a request, or uploads a plan photo (CNN). The request reader (patterns + transformer) fills the form.
2. The layout model drafts about 12-24 plans per request in the browser (with constrained decoding).
3. The **rule checker** scores them, the **planner** repairs them (proper stair, porch, rooms grown toward real sizes), the best 3 different families are shown.
4. For two floors, a first floor is drafted over the chosen ground floor (box and stairs given in the prompt).
5. The editor, doors/windows and 3D walkthrough work on the same plan object.

---

## 8. Honest limitations (say them before they ask)

- Real Pakistani training data is small (about 136 plans); most knowledge is synthetic. More hand/vision-read real plans is the next lever.
- Narrow plots (26-28 ft wide) with 3 bedrooms on one floor rarely pass every rule; 3 bedrooms on the ground floor of a two-storey house is tight.
- The rule checker is my design of Pakistani practice (indicative setbacks, not legal advice); the reward only knows those rules.
- The 3D and furniture are procedural, not learned.
- The plan reader's size estimate assumes a bedroom of about 150 sq ft because a photo has no ruler.

---

## 9. Likely viva questions, with short answers

1. **Why a transformer?** A plan is a sequence of decisions (cut, size, room); attention models long-range constraints (stairs above stairs, sizes summing to the plot); it also exports easily to ONNX for the browser.
2. **Why not a CNN or GAN for the layout?** Image generators give pixels, not a plan with exact sizes; our token output is always a valid tiling and can be edited and checked.
3. **Why is it "from scratch"?** Small domain-specific vocabulary (357 tokens), 4.9 M parameters, trained on our own data; a pretrained language model would be larger and not know slicing trees.
4. **Where does the data come from?** Section 3. Real: crawl (1,147 plans), hand/vision transcription, ResPlan, CubiCasa5k. Synthetic: rule-based generators validated by the checker.
5. **Is synthetic data cheating?** It is a standard way to get volume. It teaches structure; real plans (x20 repetition) teach realism; measured by real-plan perplexity on plans never trained on.
6. **How do you know it is not memorising?** Val/test use plot sizes never in training; "copied%" (exact copies of training plans) is 0 in the evaluation.
7. **What is perplexity and why 9.06?** exp(average loss) on real plans: the model is as uncertain as choosing among about 9 tokens at each step. It fell from 299 to 9 as real data and pretraining were added.
8. **What is the reward in RL?** The fraction of rule checks passed (0 if broken), plus plot use quality; group-relative advantages; KL to the reference model prevents collapse.
9. **Why KL penalty?** Without it the policy drifts to a few easy plans that maximise the reward (reward hacking).
10. **What is constrained decoding?** At each step the guide masks tokens that would break the plan; so even a weak sample is structurally valid.
11. **Why int8 / ONNX?** To run in the browser without a server: 5.2 MB, one token per call using a KV cache.
12. **What is the evaluation protocol?** Held-out plot sizes, rule pass rate, real-plan perplexity, diversity, and an A/B through the whole planner with the same requests for both models.
13. **What did not work?** OCR-only reconstruction (3 of 1,147); v14-v17 (not better in the planner); 6 parallel browser tabs for distillation (28 hours, hung).
14. **What is expert iteration?** Train on your own best outputs after a stronger process (here the planner repair + checker) improved them.
15. **What does the CNN do and how do you judge it?** Semantic segmentation of plans; IoU per class and mean IoU on CubiCasa test plans.
16. **What is a U-Net?** Encoder (downsampling, features) + decoder (upsampling) with skip connections to keep thin structures such as walls.
17. **Why Dice loss?** Walls and doors are thin; Dice counters class imbalance.
18. **Is data private / ethical?** Plan images belong to their sites and are used for study; public datasets keep their licences (CubiCasa is non-commercial).
19. **Future work?** More real Pakistani plans, learn the rule weights, train the CNN, a mixed English-Urdu speech backend.
20. **What did *you* build vs use?** Built: generators, validator, tokenizer, transformer, training/RL/distillation, ONNX export, planner, editor, NLU, U-Net. Used: PyTorch, Whisper, Qwen-VL (as a tool), public datasets.

---

## 10. Hands-on practice (run these to get comfortable)

```bash
# the rule checker and generator (no GPU)
python tools/bands.py            # generate and check a plan
python tools/gen_tree.py probe   # acceptance per family and plot size

# see the plan language and the vocabulary
python -c "import sys;sys.path.insert(0,'ml');import layoutlm as L;print(len(L.VOCAB));print(L.VOCAB[:40])"

# evaluate the live model on held-out plots
python ml/evaluate.py --ckpt weights/layout/v18_rl_model.pt --data data/pk13 --n 100 --samples 2

# real-plan perplexity
python ml/eval_real.py --ckpt weights/layout/v18_rl_model.pt --real data/real13

# the browser tests (planner rules, two models A/B)
python tools/e2e_rules.py
python tools/ab_models.py models runs/v18      # needs runs/v18/layout.onnx (python ml/export_onnx.py --ckpt weights/layout/v18_rl_model.pt --out runs/v18/layout)

# the CNN data and model
python real/cubicasa_masks.py <cubicasa5k.zip> --out data/planreader
python ml/planreader.py train --data data/planreader --out runs/planreader --epochs 60
python ml/planreader.py eval --ckpt runs/planreader/model.pt --data data/planreader
```

Read these files in this order to understand the code: `tools/bands.py` (rules), `tools/tree.py` (plan language),
`ml/layoutlm.py` (model), `ml/train.py`, `ml/rl.py`, `js/grammar.js` (constrained decoding), `js/modelplans.js` (planner), `MODELS.md` (history).
