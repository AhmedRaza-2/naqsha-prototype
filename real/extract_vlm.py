"""Read real plan images with a vision-language model (Qwen2.5-VL) and write room lists (see real/assemble.py).

Kaggle (GPU, Internet on), one process per GPU:
    CUDA_VISIBLE_DEVICES=0 python real/extract_vlm.py --shard 0/2 --out data/real/raw_0.jsonl &
    CUDA_VISIBLE_DEVICES=1 python real/extract_vlm.py --shard 1/2 --out data/real/raw_1.jsonl &
The model only does perception: room types, printed sizes and their rough row / order. Geometry and validation are done
afterwards by real/assemble.py and real/build_real.py. Two hand-transcribed gold plans are given as examples, and the
labels + sizes our OCR already read from the image are given as hints. Output lines: {"id", "text", "sec"}; the script
resumes where it stopped if the file already exists.
"""
import argparse, json, re, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "real"))
sys.path.insert(0, str(ROOT / "tools"))

TYPES = "bed, master, drawing, lounge, dining, kitchen, lobby, stairs, store, passage, dress, servant, prayer, study, porch, lawn, courtyard, void"
EXAMPLE_IDS = ["b6593ed82ccc388e", "ab69e709ccf09c26"]          # shown to the model; left out of its accuracy check

INSTRUCTIONS = f"""You are reading a Pakistani house floor plan. Transcribe ONLY the ground floor as rows of rooms, from the road side (row 1) to the back of the plot.

Answer with JSON only, in exactly this form:
{{"plot":[W,D],"rows":[[ROOM,ROOM,...],[ROOM,...],...]}}
- W = plot width along the road, D = plot depth, in feet.
- Row 1 faces the road (gate, car porch, front lawn). Rooms in a row go left to right as seen from the road.
- ROOM = ["type", width, depth] or, when the room has its own washroom, ["type", width, depth, bath_width, bath_depth, "L" or "R"] (the washroom's back corner).
- type is one of: {TYPES}. TV lounge, family room, living = lounge. Car porch, garage = porch. Open to sky, OTS, light well = courtyard. Side passage, back open space = void. Front or back lawn, verandah = lawn. Largest bedroom with a washroom = master.
- Sizes in feet from the printed labels (12'-6"x14'-0" = 12.5 x 14). The rooms of a row should add up to about W across.
- A washroom goes inside the room it opens from. A common washroom goes on the lounge, dining or passage next to it.
- If there is no ground floor plan in the image, or it has no drawing room, answer {{"skip":"reason"}}."""


def compact(rooms):
    """Gold room list -> the compact JSON the model is asked to write."""
    baths = {(b["row"], b["col"]): b for b in rooms.get("baths", [])}
    rows = []
    for ri, row in enumerate(rooms["rows"], 1):
        out = []
        for ci, r in enumerate(row, 1):
            x = [r["t"], r["w"], r["d"]]
            if (ri, ci) in baths:
                b = baths[(ri, ci)]
                x += [b["w"], b["d"], b.get("side", "R")]
            out.append(x)
        rows.append(out)
    return json.dumps({"plot": rooms["plot"], "rows": rows}, separators=(",", ":"))


def prompt_for(cand, examples):
    hints = []
    if cand.get("plot"): hints.append(f"Printed plot size read by OCR: {cand['plot'][0]} x {cand['plot'][1]} ft.")
    elif cand.get("marla"): hints.append(f"The plan was found by searching for a {cand['marla']} marla house (1 marla = 225 sq ft).")
    if cand.get("labels"): hints.append("Room labels and sizes read by OCR (may be noisy): " + "; ".join(cand["labels"][:24]) + ".")
    ex = "\n".join(f"Example ({e['note']}):\n{compact(e['rooms'])}" for e in examples)
    return f"{INSTRUCTIONS}\n\n{ex}\n\n" + "\n".join(hints) + "\nNow the plan in the image. JSON only:"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default=str(ROOT / "real/candidates.jsonl"))
    ap.add_argument("--images", default=str(ROOT / "data/clean"))
    ap.add_argument("--gold", default=str(ROOT / "real/gold.jsonl"))
    ap.add_argument("--out", default=str(ROOT / "data/real/raw.jsonl"))
    ap.add_argument("--model", default="Qwen/Qwen2.5-VL-7B-Instruct", help="any Hugging Face image-text-to-text model, e.g. Qwen/Qwen3-VL-8B-Instruct")
    ap.add_argument("--fp16", action="store_true", help="full fp16 weights instead of 4-bit (3B fits a T4 this way)")
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--max-pixels", type=int, default=1024 * 28 * 28)
    ap.add_argument("--max-new", type=int, default=700)
    a = ap.parse_args()

    import torch
    from PIL import Image
    from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig

    k, n = (int(v) for v in a.shard.split("/"))
    cands = [json.loads(l) for l in open(a.candidates, encoding="utf-8")][: a.limit]
    cands = cands[k::n]
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    done = set()
    if out.exists():                                              # resume; a line cut off by a killed process is read again
        good = []
        for l in open(out, encoding="utf-8"):
            try:
                done.add(json.loads(l)["id"]); good.append(l.rstrip("\n") + "\n")
            except (json.JSONDecodeError, KeyError):
                pass
        out.write_text("".join(good), encoding="utf-8")
    todo = [c for c in cands if c["id"] not in done]
    gold = {g["id"]: g for g in (json.loads(l) for l in open(a.gold, encoding="utf-8"))}
    examples = [gold[i] for i in EXAMPLE_IDS if i in gold]
    print(f"shard {a.shard}: {len(cands)} plans, {len(done)} already done, {len(todo)} to go; model {a.model}", flush=True)

    quant = None if a.fp16 else BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float16)
    model = AutoModelForImageTextToText.from_pretrained(a.model, torch_dtype=torch.float16, quantization_config=quant,
                                                               device_map={"": 0}, attn_implementation="sdpa").eval()
    proc = AutoProcessor.from_pretrained(a.model, min_pixels=256 * 28 * 28, max_pixels=a.max_pixels)
    proc.tokenizer.padding_side = "left"

    t_all = time.time()
    with open(out, "a", encoding="utf-8") as f:
        for i in range(0, len(todo), a.batch):
            chunk = todo[i:i + a.batch]
            t0 = time.time()
            imgs = [Image.open(Path(a.images) / c["image"]).convert("RGB") for c in chunk]
            texts = [proc.apply_chat_template([{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": prompt_for(c, examples)}]}],
                                              tokenize=False, add_generation_prompt=True) for c in chunk]
            inputs = proc(text=texts, images=imgs, padding=True, return_tensors="pt").to(model.device)
            with torch.no_grad():
                gen = model.generate(**inputs, max_new_tokens=a.max_new, do_sample=False)   # no repetition penalty: sizes and brackets repeat in valid JSON
            outs = proc.batch_decode(gen[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)
            sec = (time.time() - t0) / len(chunk)
            for c, o in zip(chunk, outs):
                f.write(json.dumps({"id": c["id"], "text": o.strip(), "sec": round(sec, 1)}) + "\n")
            f.flush()
            if i == 0 or (i // a.batch) % 10 == 0:
                print(f"[{a.shard}] {i + len(chunk)}/{len(todo)}  {sec:.1f} s/plan  e.g. {outs[0][:160]!r}", flush=True)
    print(f"shard {a.shard} done in {time.time() - t_all:.0f} s", flush=True)


if __name__ == "__main__":
    main()
