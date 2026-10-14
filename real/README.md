# Real plans → training data

The model reads and writes plans as rows of rooms (the band format in `tools/bands.py`). The 1,147 crawled plans are
images, so each one has to be transcribed into that format before the model can learn from it.

| Set | Who transcribes | Size | Used for |
|---|---|---|---|
| **gold** (`real/gold.jsonl`) | by hand (Claude reads the image, sizes from the printed labels) | ~20 | few-shot examples for the vision model, its accuracy check, and the real-plan test set |
| **silver** (`data/real/silver.jsonl`) | Qwen2.5-VL-7B on Kaggle GPUs (`real/extract_vlm.py`), assembled by `real/assemble.py` | hundreds | fine-tuning data, kept only when it agrees with the printed room sizes |

Pipeline: `extract_vlm.py` (image → JSON room list) → `assemble.py` (room list → band plan, validation against the
OCR'd printed sizes) → `build_real.py` (prompts, train/test split) → `ml/train.py --init <v9 model> --extra data/real/train.jsonl`
(fine-tune) → `ml/rl.py` → `ml/eval_real.py` (likelihood of held-out real plans, realism, validity).

## Transcription conventions

1. **Front first.** The first row is the road side (gate, porch, front lawn). "Left" and "right" are as seen from the
   road looking at the house. Only the ground floor is transcribed.
2. **Rows.** Each row spans the full plot width and has one depth. Rooms in a row are listed left to right with their
   widths; widths in a row sum to the plot width and depths sum to the plot depth (the last width and the last depth
   are written implicitly). Sizes are in feet on a 0.5 ft grid and come from the printed labels (walls absorbed).
   When rooms in a row have different depths, the row takes the depth of its main rooms.
3. **Types.** bed, master (the largest bedroom with an attached bath), drawing, lounge (TV lounge, family, living),
   dining, kitchen, lobby (entrance, foyer), stairs, store, passage, dress, servant, prayer, study, porch (car porch,
   garage), lawn (front or back lawn, verandah), courtyard (open to sky, light well), void (side passages, setbacks,
   back open space).
4. **Washrooms** are written inside the room they open from, in its back corner: `+bath 5x7 R`. A common washroom goes
   on the lounge, dining or passage it opens from.
5. **Entrance.** A lobby only when the plan has one. Otherwise the porch or lawn opens into the lounge or dining room,
   which the checker accepts as the entrance; a drawing room next to the porch may have its own guest door.
6. **Skipped:** plans without a drawing room (mostly Indian plans in the crawl), plans with no readable ground floor,
   and sheets that are mostly elevations or 3D renders.
