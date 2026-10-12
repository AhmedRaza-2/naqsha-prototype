"""Stage 2: verify collected images are real Pakistani-style floor plans using OCR.

For every image in data/manifest.jsonl, OCR the text and score it:
  - room words (bed room, kitchen, lounge, drawing, porch, lawn, bath ...)
  - printed dimensions like 14'-0" x 12'-0"
  - Pakistan markers (marla, kanal, drawing, lounge, porch, lawn, +92, DHA, Bahria ...)
  - India markers (vastu, pooja, bhk, facing ...) -> flagged, not accepted
Verified images are copied to data/verified/<size>_marla/ and described in data/verified.jsonl
(room labels + dimensions found), which is the input for the structured-extraction step.

    python tools/verify.py --workers 4
"""
import os
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse, json, re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent / "data"
ROOMS = ["bed", "kitchen", "lounge", "drawing", "dining", "porch", "lawn", "bath", "toilet", "wash", "store", "stair",
         "hall", "sitting", "lobby", "garage", "car", "tv", "balcony", "terrace", "servant", "gate", "courtyard", "passage", "dress"]
PK = ["marla", "kanal", "drawing", "lounge", "porch", "lawn", "tv lounge", "+92", "dha", "bahria", "lda", "gulberg", "naqsha",
      "car porch", "rear lawn", "front lawn", "setback", "wapda", "askari", "sector"]
IN = ["vastu", "pooja", "puja", "bhk", "facing", "north-east", "south-east", "sqm", "mandir", "master br", "m.br"]
DIM = re.compile(r"\d{1,3}\s*['’`′-]\s*\d{0,2}\s*[\"”″']?\s*[xX×*]\s*\d{1,3}")
_engine = None


def ocr(path):
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
    from PIL import Image
    im = Image.open(path).convert("RGB")
    s = 1024 / max(im.size)
    if s < 1:
        im = im.resize((int(im.width * s), int(im.height * s)))
    import numpy as np
    res, _ = _engine(np.array(im), use_cls=False)
    return [r[1] for r in (res or [])]


def looks_like_plan(path):
    """Cheap pixel test: reject photo/render-like images (mostly mid-tones); plans are near black/white or flat colour."""
    import numpy as np
    from PIL import Image
    g = np.asarray(Image.open(path).convert("L").resize((200, 200)))
    return ((g >= 100) & (g <= 190)).mean() < 0.70


def analyse(rec):
    if not looks_like_plan(ROOT / rec["file"]):
        return {**rec, "ok": False, "reason": "not plan-like (pixel prefilter)"}
    try:
        texts = ocr(ROOT / rec["file"])
    except Exception as e:
        return {**rec, "ok": False, "reason": f"ocr error {e}"}
    blob = " ".join(texts).lower()
    rooms = sorted({k for k in ROOMS if k in blob})
    dims = DIM.findall(" ".join(texts))
    pk = sorted({k for k in PK if k in blob})
    ind = sorted({k for k in IN if k in blob})
    strong = len(rooms) >= 4 and len(dims) >= 2
    likely = len(rooms) >= 5 and len(pk) >= 2
    ok = (strong or likely) and not ind
    reason = ("ok" if strong else "likely") if ok else ("india markers" if ind else "not enough room labels/dimensions")
    return {**rec, "ok": ok, "reason": reason, "rooms": rooms, "n_dims": len(dims), "pk_markers": pk,
            "india_markers": ind, "pk_score": len(pk), "texts": texts[:80]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=1, help="parallel processes; on some machines >1 is slower because ONNX already uses all cores")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    recs = [json.loads(l) for l in (ROOT / "manifest.jsonl").read_text(encoding="utf-8").splitlines() if l]
    out = ROOT / "verified.jsonl"
    done = {json.loads(l)["file"] for l in out.read_text(encoding="utf-8").splitlines() if l} if out.exists() else set()
    todo = [r for r in recs if r["file"] not in done]
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(todo)} to verify ({len(done)} already done)")
    good = 0
    ex = ProcessPoolExecutor(a.workers) if a.workers > 1 else None
    results = ex.map(analyse, todo, chunksize=4) if ex else map(analyse, todo)
    with out.open("a", encoding="utf-8") as fo:
        for i, r in enumerate(results, 1):
            fo.write(json.dumps(r, ensure_ascii=False) + "\n")
            if r["ok"]:
                good += 1
                d = ROOT / "verified" / f"{r['size']}_marla"
                d.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / r["file"], d / Path(r["file"]).name)
            if i % 25 == 0:
                fo.flush()
                print(f"{i}/{len(todo)} verified so far: {good}")
    print(f"done. verified {good}/{len(todo)}")


if __name__ == "__main__":
    main()
