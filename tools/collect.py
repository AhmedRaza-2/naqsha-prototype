"""Stage 1: collect candidate Pakistani house-plan images (private research use only).

Many query variants (plot size x template x city/society) are searched in parallel on Bing Images,
then images are size-filtered and near-duplicate-removed (perceptual hash) and sorted into
data/raw/<plot-size>/ with a manifest.jsonl (source URL, query, hash).

    python tools/collect.py --per-query 60 --workers 8
    python tools/collect.py --sizes 5 10 --quick        # smaller test run

Then run tools/verify.py to keep only genuine floor plans. data/ is git-ignored; do not redistribute images.
"""
import argparse, json, shutil, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from PIL import Image
import imagehash
from icrawler.builtin import BingImageCrawler
from icrawler.downloader import ImageDownloader

ROOT = Path(__file__).resolve().parent.parent / "data"
STAGE, RAW, MANIFEST = ROOT / "_staging", ROOT / "raw", ROOT / "manifest.jsonl"

SIZES = {3: "3 marla", 4: "4 marla", 5: "5 marla", 6: "6 marla", 7: "7 marla", 8: "8 marla", 9: "9 marla",
         10: "10 marla", 12: "12 marla", 14: "14 marla", 16: "16 marla", 20: "1 kanal"}
GENERIC = ["{s} house plan pakistan", "{s} ground floor plan with dimensions", "{s} naqsha map",
           "{s} house map drawing room lounge porch", "{s} double story house plan pakistan",
           "{s} front elevation and floor plan", "{s} house design layout 2d", "{s} ghar ka naqsha"]
PLACES = ["DHA Lahore", "Bahria Town", "Gulberg Lahore", "Askari", "LDA Avenue", "Islamabad", "Karachi",
          "Faisalabad", "Multan", "Rawalpindi", "Peshawar", "Gujranwala", "Citi Housing", "Park View City",
          "Capital Smart City", "Gulshan-e-Iqbal", "Sialkot", "Hyderabad Sindh"]
PLACE_TPL = "{s} house plan {p}"

_lock = threading.Lock()
_urls = {}


class LoggingDownloader(ImageDownloader):
    def download(self, task, default_ext, timeout=8, max_retry=1, overwrite=False, **kwargs):
        # fail fast on dead/blocked image hosts instead of retrying 3x with long timeouts
        return super().download(task, default_ext, timeout=timeout, max_retry=max_retry, overwrite=overwrite, **kwargs)

    def process_meta(self, task):
        with _lock:
            _urls[(str(self.storage.root_dir), task["filename"])] = task["file_url"]


def build_queries(sizes, quick):
    qs = []
    for n in sizes:
        s = SIZES[n]
        qs += [(n, t.format(s=s)) for t in (GENERIC[:3] if quick else GENERIC)]
        qs += [(n, PLACE_TPL.format(s=s, p=p)) for p in (PLACES[:3] if quick else PLACES)]
    return qs


def crawl(n, q, per_query):
    stage = STAGE / q.replace(" ", "_").replace("/", "_")
    shutil.rmtree(stage, ignore_errors=True)
    c = BingImageCrawler(downloader_cls=LoggingDownloader, storage={"root_dir": str(stage)},
                         feeder_threads=1, parser_threads=2, downloader_threads=2, log_level=50)
    c.crawl(keyword=q, max_num=per_query, min_size=(500, 500))
    return n, q, stage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-query", type=int, default=60)
    ap.add_argument("--workers", type=int, default=3, help="parallel queries; more than ~4 triggers host rate limits")
    ap.add_argument("--sizes", type=int, nargs="*", default=list(SIZES))
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)

    hashes = {}  # size -> list[int]
    if MANIFEST.exists():
        for l in MANIFEST.read_text(encoding="utf-8").splitlines():
            if l:
                r = json.loads(l)
                hashes.setdefault(r["size"], []).append(int(r["phash"], 16))

    queries = build_queries(a.sizes, a.quick)
    print(f"{len(queries)} queries, {a.workers} parallel")
    total = 0
    with ThreadPoolExecutor(a.workers) as ex, MANIFEST.open("a") as man:
        futs = [ex.submit(crawl, n, q, a.per_query) for n, q in queries]
        for fu in as_completed(futs):
            try:
                n, q, stage = fu.result()
            except Exception as e:
                print("failed:", e)
                continue
            kept = 0
            dest_dir = RAW / f"{n}_marla"
            dest_dir.mkdir(exist_ok=True)
            known = hashes.setdefault(n, [])
            for f in sorted(stage.glob("*")):
                try:
                    with Image.open(f) as im:
                        w, h = im.size
                        if min(w, h) < 500 or not (0.35 < w / h < 2.6):
                            continue
                        ph = imagehash.phash(im.convert("RGB"))
                except Exception:
                    continue
                v = int(str(ph), 16)
                if any(bin(v ^ k).count("1") <= 5 for k in known):
                    continue
                dest = dest_dir / f"{ph}{f.suffix.lower()}"
                try:
                    shutil.move(str(f), dest)  # file handle is closed above (required on Windows)
                except OSError:
                    continue
                known.append(v)
                man.write(json.dumps({"file": str(dest.relative_to(ROOT)), "phash": str(ph), "size": n, "query": q,
                                      "url": _urls.get((str(stage), f.name)), "w": w, "h": h}) + "\n")
                kept += 1
            man.flush()
            total += kept
            shutil.rmtree(stage, ignore_errors=True)
            print(f"[{total:5d}] {q}: +{kept}")
    print("done; total new:", total)


if __name__ == "__main__":
    main()
