# Naqsha

Naqsha turns a Pakistani plot size (for example "10 marla, 3 bedrooms") into house floor plans, then lets you walk through the house in 3D in your browser.
The plans come from a small transformer trained from scratch on synthetic and real Pakistani layouts. A rule checker (setbacks, room sizes, reachability, light, privacy) scores every draft, and drafts that fail are dropped.
Everything runs client-side: the model is 5 MB of int8 ONNX, and you can type or speak the request in English, Roman Urdu or Urdu.

**Live demo: https://naqsha-ai.vercel.app** (the planner itself is at [/app/](https://naqsha-ai.vercel.app/app/))

This is a prototype. The plans are concept drawings, not approved or structural drawings.

---

## Run it locally

```sh
python -m http.server 5173        # from the repo root, then open http://localhost:5173
```

No build step: the planner is plain HTML and ES modules, with Three.js vendored in `vendor/`. The landing page in `landing/` is a separate Vite app (`cd landing && npm install && npm run dev`).

## What's where

| Path | What it is |
|---|---|
| `index.html`, `js/`, `styles.css` | The planner: request reader, model sampling, rule checker, plan editor, 3D walkthrough |
| `models/` | The files the browser loads: `layout.onnx` (layout model), `nlu.onnx` (request reader) |
| `weights/` | PyTorch weights of every model version that went live (see below) |
| `ml/` | Model code, training, reinforcement learning, evaluation, ONNX export |
| `tools/` | Synthetic plan generators, the Python rule checker, data pipeline, browser checks |
| `real/`, `real_plans/` | Hand transcriptions of real Pakistani plans used for fine-tuning and evaluation |
| `MODELS.md` | Which model is live, how each version was trained, and the results |
| `PROJECT.md` | Background, research notes and design decisions |

## Why model weights are in the repo

- **`models/` is the app.** It holds `layout.onnx` (5.2 MB), `nlu.onnx` (2.5 MB) and the onnxruntime-web files. The planner loads them from the same origin, and the deploy copies `models/` as is. Without them the site has no model.
- **`weights/` (about 130 MB: six layout versions at about 19.6 MB each, the request reader and the plan reader) holds the PyTorch checkpoints of every version that shipped.** Each new model is fine-tuned from an earlier one (v18 starts from v13), and each is compared with the live model before it replaces it (`tools/ab_models.py`). Keeping the shipped checkpoints lets anyone rebuild the exact ONNX files, roll back, or rerun those comparisons without retraining on a GPU. Most models that were trained but never shipped are listed in `MODELS.md` with the reason; their weights are not kept. The one exception is the plan reader (`weights/planreader/`, 17 MB), a U-Net that reads floor-plan photos. It is kept with its test results because it is the starting point for fine-tuning on Pakistani plans. It is not live yet (see `MODELS.md`).
- Every file is under GitHub's 100 MB limit, so plain git works without LFS. The cost is clone size: about 350 MB with history, of which the current checkpoints are about 130 MB. If that becomes a problem, the older checkpoints can move to GitHub Releases.
- **Training data is not in the repo.** `data/` is git-ignored because the collected plan images belong to the architects who drew them. Only derived data and hand transcriptions are committed.

## Tests

There is no unit-test suite and no CI yet. Correctness is checked by these scripts:

| Check | Command | What it does |
|---|---|---|
| Checker parity | `python tools/verify_js_port.py` (needs Node) | Scores about 1,100 plans (valid, flawed and deliberately broken) with both the Python rule checker and its JavaScript port, and reports any disagreement. Works on a fresh clone: it generates its own plans when `data/` is missing. |
| Browser end-to-end | `python tools/e2e_rules.py` (needs `pip install playwright`) | Serves the repo, drafts real plans with the real model in headless Chrome, and checks what a visitor would see: stairs open onto a hall, the kitchen is not a corridor, and similar rules |
| Model A/B | `python tools/ab_models.py models <other folder>` | Runs two models through the real planner on 40 requests and compares rule passes and plot use |
| Model evaluation | `ml/evaluate.py`, `ml/eval_real.py`, `ml/coverage_styles.py` | Validity on held-out plot sizes, perplexity on real plans, and coverage of every request the form can make |

**Known failure:** the parity check currently reports 256 mismatches out of 1,089 plans. All of them come from one gap: stair width and length warnings were added to the browser checker (`js/bands.js`) and not yet to the Python checker (`tools/bands.py`). Every other rule agrees.

## How it handles bad input

**The request form** (`validateRequest` in `js/main.js`):
- It rejects non-numeric sizes, widths outside 18–120 ft, depths outside 30–200 ft, and areas outside 3 marla to 3 kanal, and says which limit was hit.
- It refuses plots that are too shallow or narrow for a house after the standard open spaces, and explains why ("A single floor needs a plot at least 31 ft deep").
- It limits the bedroom and washroom choices to what the plot can hold.

**Typed or spoken requests** (`js/nlp.js`, `js/nlu.js`, `js/urdu.js`):
- A pattern reader and a small language model both read the sentence. A size is accepted only if each side is between 15 and 250 ft.
- The page shows what was understood as chips, and lists separately what it understood but cannot place yet.
- If the language model or the speech model fails to load, the pattern reader still works and the page asks you to type instead.

**Asking for something that doesn't fit:**
- The planner does not fail silently. It steps back one preference at a time (layout style, then bigger rooms, then extra washrooms, then car porch, then bedroom count) and says which one it gave up. For example: "4 bedrooms do not fit on one floor of 25 x 45 ft, so these are the closest layouts, with 2."

**Model output:**
- A grammar constrains decoding (`js/grammar.js`): room sizes must add up, required rooms must be present, and stairs must sit over stairs.
- Drafts that still don't parse are skipped.
- Every remaining draft is scored by the rule checker, and only the best distinct ones are shown.
- If no draft passes, the page shows an error with what to change, never a broken plan.

**Network failures:**
- A model download that stalls or fails shows a message, and pressing Generate retries it.
