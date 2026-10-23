# The crawled real house plans

These are the real Pakistani house plans collected at the start of the project, before any model was trained.
They are the "real data" the model was checked against and fine-tuned on.

| What | Where | Count |
|---|---|---|
| The plan images (JPG) | `images/` | 1,147 |
| One line of facts per plan: id, plot size (marla), search query, source web address, which split, quality tier, room types seen | `metadata.jsonl` | 1,147 |
| Train / validation / test lists of those plans | `train.jsonl`, `val.jsonl`, `test.jsonl` | 959 / 115 / 73 |
| A short summary of the collection (plans per plot size and city) | `summary.txt` | |
| Plans read into the model's row format (room sizes and order) | `transcriptions/` | ~20 by hand, a few hundred read by a vision model |
| How the room sizes in real plans compare with the generated ones | `real_stats.json` | |

How they were made: images were crawled from web searches such as "5 marla house plan pakistan", exact and
near-duplicates were removed, and only sheets that really show a floor plan were kept (`metadata.jsonl` has the
quality tier). 597 near-miss images that were rejected are not included.
The by-hand transcriptions (with the pictures drawn back from them) are in `../real/hand/`, and the scripts that
turn an image into a plan are in `../real/` and `../tools/`.

The images belong to the websites listed in `source_url`; they are included here for study of the project only.
