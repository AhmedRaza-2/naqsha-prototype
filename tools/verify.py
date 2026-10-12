"""Stage 2: verify collected images are real Pakistani-style floor plans using OCR (multi-process).

Each image is OCR'd and scored on room words, printed dimensions and Pakistan/India markers.
Results are appended to data/verified.jsonl (resumable: finished images are skipped), and accepted plans
are copied to data/verified/<group>/.

    python tools/verify.py --workers 8

Speed note: the OCR engine's ONNX session uses *all* cores by default, so naive multi-processing makes every
worker fight for the CPU. Each worker pins ONNX to a single thread, so N workers ~ N x throughput.
"""
import os
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse, json, re, shutil, sys, time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data"
ROOMS = ["bed", "kitchen", "lounge", "drawing", "dining", "porch", "lawn", "bath", "toilet", "wash", "store", "stair",
         "hall", "sitting", "lobby", "garage", "car", "tv", "balcony", "terrace", "servant", "gate", "courtyard", "passage", "dress"]
PK = ["marla", "kanal", "drawing", "lounge", "porch", "lawn", "tv lounge", "+92", "dha", "bahria", "lda", "gulberg", "naqsha",
      "car porch", "rear lawn", "front lawn", "setback", "wapda", "askari", "sector"]
IN = ["vastu", "pooja", "puja", "bhk", "facing", "north-east", "south-east", "sqm", "mandir", "master br", "m.br"]
DIM = re.compile(r"\d{1,3}\s*['’`′-]\s*\d{0,2}\s*[\"”″']?\s*[xX×*]\s*\d{1,3}")
FLOOR = re.compile(r"(ground|first|second|1st|2nd|top|roof|basement)\s*(floor|roof)?\s*plan", re.I)
_engine = None
MAX_SIDE = int(os.environ.get("PLAN_OCR_SIDE", 1024))


def _init_worker():
    """Pin ONNX Runtime to one thread per process, then build the OCR engine once per worker."""
    import onnxruntime as ort
    import rapidocr_onnxruntime.utils as u
    Orig = ort.SessionOptions

    def one_thread():
        o = Orig()
        o.intra_op_num_threads = 1
        o.inter_op_num_threads = 1
        return o
    u.SessionOptions = one_thread
    from rapidocr_onnxruntime import RapidOCR
    global _engine
    _engine = RapidOCR()


def ocr(path):
    import numpy as np
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 120_000_000
    im = Image.open(path).convert("RGB")
    s = MAX_SIDE / max(im.size)
    if s < 1:
        im = im.resize((int(im.width * s), int(im.height * s)))
    res, _ = _engine(np.array(im), use_cls=False)
    return [r[1] for r in (res or [])]


def looks_like_plan(path):
    """Cheap pixel test: reject photo/render-like images (mostly mid-tones)."""
    import numpy as np
    from PIL import Image
    g = np.asarray(Image.open(path).convert("L").resize((200, 200)))
    return ((g >= 100) & (g <= 190)).mean() < 0.70


def analyse(rec):
    try:
        path = ROOT / rec["file"]
        if not looks_like_plan(path):
            return {**rec, "ok": False, "tier": None, "reason": "not plan-like (pixel prefilter)"}
        texts = ocr(path)
    except Exception as e:
        return {**rec, "ok": False, "tier": None, "reason": f"error {type(e).__name__}"}
    blob = " ".join(texts).lower()
    rooms = sorted({k for k in ROOMS if k in blob})
    dims = DIM.findall(" ".join(texts))
    pk = sorted({k for k in PK if k in blob})
    ind = sorted({k for k in IN if k in blob})
    strong = len(rooms) >= 4 and len(dims) >= 2
    likely = len(rooms) >= 5 and len(pk) >= 2
    ok = (strong or likely) and not ind
    tier = ("strong" if strong else "likely") if ok else None
    reason = ("ok" if strong else "likely") if ok else ("india markers" if ind else "not enough room labels/dimensions")
    return {**rec, "ok": ok, "tier": tier, "reason": reason, "rooms": rooms, "n_dims": len(dims), "pk_markers": pk,
            "india_markers": ind, "pk_score": len(pk), "n_floor_labels": len(FLOOR.findall(" ".join(texts))),
            "texts": texts[:120]}


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-side", type=int, default=1024, help="OCR resize; 800 is ~30%% faster but finds fewer labels")
    a = ap.parse_args()
    os.environ["PLAN_OCR_SIDE"] = str(a.max_side)
    recs = [json.loads(l) for l in (ROOT / "manifest.jsonl").read_text(encoding="utf-8").splitlines() if l]
    out = ROOT / "verified.jsonl"
    done = {json.loads(l)["file"] for l in out.read_text(encoding="utf-8").splitlines() if l} if out.exists() else set()
    todo = [r for r in recs if r["file"] not in done]
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(todo)} to verify ({len(done)} already done) with {a.workers} workers", flush=True)
    t0, good = time.time(), 0
    if a.workers > 1:
        ex = ProcessPoolExecutor(a.workers, initializer=_init_worker)
        results = ex.map(analyse, todo, chunksize=2)
    else:
        _init_worker()
        results = map(analyse, todo)
    with out.open("a", encoding="utf-8") as fo:
        for i, r in enumerate(results, 1):
            fo.write(json.dumps(r, ensure_ascii=False) + "\n")
            if r["ok"]:
                good += 1
                g = r.get("group") or f"{r['size']}_marla"
                d = ROOT / "verified" / g
                d.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / r["file"], d / Path(r["file"]).name)
            if i % 50 == 0:
                fo.flush()
                rate = i / (time.time() - t0)
                eta = (len(todo) - i) / rate / 60
                print(f"{i}/{len(todo)}  passed {good}  {rate:.2f} img/s  ETA {eta:.0f} min", flush=True)
    print(f"done. verified {good}/{len(todo)} in {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
