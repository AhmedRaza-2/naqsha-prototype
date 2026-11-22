"""Read real plan images with a vision-language model, check every reading with our rule checker, and send failures back.

Unlike real/extract_vlm.py (one try per plan, ~1% usable), each reading goes through the same checks the training set uses
(assemble -> validator: kitchen, drawing room, bedrooms, washrooms, sizes close to the plot). A reading that fails is returned to
the model together with the reason ("missing kitchen", "no washroom", "rooms do not fit the plot width") and the model answers
again, up to --rounds times. Output lines {"id","text","sec","round"} go to the same raw_*.jsonl files real/build_real.py reads
(a later line for the same id replaces an earlier one), so nothing else changes.

    CUDA_VISIBLE_DEVICES=0 python real/extract_vlm2.py --shard 0/2 --out data/real/raw_0.jsonl &
    CUDA_VISIBLE_DEVICES=1 python real/extract_vlm2.py --shard 1/2 --out data/real/raw_1.jsonl &
Resumes: plans that already passed are skipped; plans that failed are retried from the first round again only if --redo is given.
"""
import argparse, json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "real"))
sys.path.insert(0, str(ROOT / "tools"))
import bands  # noqa: E402
from assemble import assemble  # noqa: E402
from build_real import parse_json, from_compact, encodable, _num  # noqa: E402
from extract_vlm import prompt_for, EXAMPLE_IDS  # noqa: E402


def validate(text, cand):
    """Model answer -> (plan, '') when usable, else (None, reason in plain words for the model)."""
    js = parse_json(text)
    if not js: return None, "it was not valid JSON; answer with one line of JSON only"
    if "skip" in js: return None, "skip"
    if "rows" not in js or "plot" not in js: return None, 'the JSON needs "plot" and "rows"'
    ok = lambda p: isinstance(p, list) and len(p) == 2 and all(_num(v) for v in p) and 15 <= float(p[0]) <= 120 and 25 <= float(p[1]) <= 150
    plot = js.get("plot")
    if not ok(plot) and isinstance(plot, list) and len(plot) == 2 and ok(plot[::-1]): plot = plot[::-1]
    if not ok(plot): plot = cand.get("plot")
    if not ok(plot): return None, "the plot size is missing or unreadable (W and D in feet)"
    try:
        rooms = from_compact(js, [float(plot[0]), float(plot[1])])
        plan, info = assemble(rooms)
    except Exception:
        return None, "some numbers could not be read"
    if plan is None: return None, f"the rows do not add up to the plot ({info}): rooms of one row must add up to the plot width {plot[0]:g} and the rows to the depth {plot[1]:g}"
    errs = [c[1] for c in bands.check(plan) if c[0] == "err"]
    if errs: return None, f"the plan is incomplete: {errs[0]}. Look at the image again; every house has a drawing room and a kitchen"
    if plan["beds"] < 1: return None, "no bedroom was found"
    if plan["baths"] < 1: return None, "no washroom was found; write each washroom inside the room it opens from"
    if not encodable(bands.serialize(plan)): return None, "a size is not on the 0.5 ft grid"
    if info["stretch"] > 0.35: return None, f"the printed sizes are far from the plot size {plot[0]:g} x {plot[1]:g}; check the rows against the printed room sizes"
    return plan, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default=str(ROOT / "real/candidates.jsonl"))
    ap.add_argument("--images", default=str(ROOT / "data/clean"))
    ap.add_argument("--gold", default=str(ROOT / "real/gold.jsonl"))
    ap.add_argument("--out", default=str(ROOT / "data/real/raw.jsonl"))
    ap.add_argument("--model", default="Qwen/Qwen2.5-VL-7B-Instruct")
    ap.add_argument("--fp16", action="store_true")
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--rounds", type=int, default=3, help="1 = the first reading, then up to rounds-1 corrections")
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--max-pixels", type=int, default=1280 * 28 * 28)
    ap.add_argument("--max-new", type=int, default=1400)
    a = ap.parse_args()

    import torch
    from PIL import Image
    from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig

    k, n = (int(v) for v in a.shard.split("/"))
    cands = [json.loads(l) for l in open(a.candidates, encoding="utf-8")][: a.limit][k::n]
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    state = {}                                                    # id -> (last text, passed, rounds used)
    if out.exists():
        good = []
        for l in open(out, encoding="utf-8"):
            try:
                r = json.loads(l); good.append(l.rstrip("\n") + "\n")
                _, why = validate(r["text"], {})
                state[r["id"]] = (r["text"], not why, r.get("round", 1))
            except (json.JSONDecodeError, KeyError):
                pass
        out.write_text("".join(good), encoding="utf-8")
    gold = {g["id"]: g for g in (json.loads(l) for l in open(a.gold, encoding="utf-8"))}
    examples = [gold[i] for i in EXAMPLE_IDS if i in gold]
    cand_of = {c["id"]: c for c in cands}
    print(f"shard {a.shard}: {len(cands)} plans, {sum(1 for v in state.values() if v[1])} already usable; model {a.model}", flush=True)

    quant = None if a.fp16 else BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float16)
    model = AutoModelForImageTextToText.from_pretrained(a.model, torch_dtype=torch.float16, quantization_config=quant, device_map={"": 0}, attn_implementation="sdpa").eval()
    proc = AutoProcessor.from_pretrained(a.model, min_pixels=256 * 28 * 28, max_pixels=a.max_pixels)
    proc.tokenizer.padding_side = "left"

    def generate(jobs):
        """jobs: list of (cand, messages) -> list of answers"""
        imgs = [Image.open(Path(a.images) / c["image"]).convert("RGB") for c, _ in jobs]
        texts = [proc.apply_chat_template(m, tokenize=False, add_generation_prompt=True) for _, m in jobs]
        inputs = proc(text=texts, images=imgs, padding=True, return_tensors="pt").to(model.device)
        with torch.no_grad():
            gen = model.generate(**inputs, max_new_tokens=a.max_new, do_sample=False)
        return [o.strip() for o in proc.batch_decode(gen[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)]

    pending = [c for c in cands if c["id"] not in state]          # first reading
    history = {}                                                  # id -> messages so far
    stats = {"first_try": 0, "fixed": 0, "gave_up": 0, "skipped": 0}
    t_all = time.time()
    with open(out, "a", encoding="utf-8") as f:
        for rnd in range(1, a.rounds + 1):
            nxt = []
            for i in range(0, len(pending), a.batch):
                chunk = pending[i:i + a.batch]
                jobs = []
                for c in chunk:
                    msgs = history.get(c["id"]) or [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": prompt_for(c, examples)}]}]
                    jobs.append((c, msgs))
                t0 = time.time()
                outs = generate(jobs)
                sec = (time.time() - t0) / len(chunk)
                for (c, msgs), o in zip(jobs, outs):
                    plan, why = validate(o, c)
                    f.write(json.dumps({"id": c["id"], "text": o, "sec": round(sec, 1), "round": rnd}) + "\n")
                    if plan is not None:
                        stats["first_try" if rnd == 1 else "fixed"] += 1
                    elif why == "skip":
                        stats["skipped"] += 1
                    elif rnd < a.rounds:
                        history[c["id"]] = msgs + [{"role": "assistant", "content": [{"type": "text", "text": o}]},
                                                   {"role": "user", "content": [{"type": "text", "text": f"That answer was rejected by the checker: {why}. Look at the image again and answer with the corrected JSON only (one line)."}]}]
                        nxt.append(c)
                    else:
                        stats["gave_up"] += 1
                f.flush()
                if (i // a.batch) % 10 == 0:
                    print(f"[{a.shard}] round {rnd}: {i + len(chunk)}/{len(pending)}  {sec:.1f} s/plan  {stats}", flush=True)
            print(f"[{a.shard}] round {rnd} done: {stats}; {len(nxt)} go back to the model  ({time.time() - t_all:.0f} s)", flush=True)
            pending = nxt
            if not pending: break
    print(f"shard {a.shard} done in {time.time() - t_all:.0f} s  {stats}", flush=True)


if __name__ == "__main__":
    main()
