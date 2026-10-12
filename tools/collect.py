"""Stage 1: collect candidate Pakistani house-plan images (private research use only).

Searches Bing Images in parallel, drops small images, removes near-duplicates across ALL groups
(perceptual hash + source URL) and files images into data/raw/<group>/ with a manifest.jsonl.

Two modes:
  size mode (default)  plot size x templates x cities/societies      -> raw/5_marla, raw/1_kanal ...
  --discover           area / society / feet-dimension / house-type / Urdu queries
                       -> raw/area_islamabad, raw/ft_30x60, raw/type_corner_plot, raw/urdu ...

    python tools/collect.py --sizes 5 10
    python tools/collect.py --discover --per-query 60

Then run tools/verify.py to keep only genuine floor plans. data/ is git-ignored; do not redistribute images.
"""
import argparse, json, shutil, sys, threading
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

# --- discover mode: plans found by area / society / feet dimensions / house type, any plot size ---
DIMS = ["20x40", "20x50", "22x45", "25x40", "25x45", "25x50", "25x60", "27x50", "30x40", "30x50", "30x60", "30x70",
        "32x60", "35x60", "35x65", "35x70", "36x70", "40x60", "40x70", "40x80", "45x90", "50x80", "50x90", "50x100", "60x90"]
DIM_TPL = ["{d} house plan pakistan", "{d} ghar ka naqsha", "{d} floor plan with dimensions"]
CITY_TPL = ["{a} plot layout plan", "{a} house map naqsha", "{a} residential house floor plan", "{a} corner plot house plan",
            "{a} double storey house plan", "{a} house design 2d plan"]
AREAS = {
    "islamabad": ["Islamabad", "G-13 Islamabad", "G-14 Islamabad", "I-8 Islamabad", "E-11 Islamabad", "D-12 Islamabad",
                  "B-17 Islamabad", "F-17 Islamabad", "Gulberg Greens Islamabad", "Bahria Enclave Islamabad", "DHA Islamabad",
                  "Top City Islamabad", "Blue World City", "Faisal Town Islamabad", "Jinnah Garden Islamabad", "Naval Anchorage",
                  "PWD Islamabad", "Media Town Islamabad", "Soan Garden", "CBR Town", "Airport Housing Society", "Capital Smart City"],
    "lahore": ["Lahore", "Johar Town Lahore", "Wapda Town Lahore", "Model Town Lahore", "Valencia Town Lahore", "Bahria Orchard Lahore",
               "Lake City Lahore", "Allama Iqbal Town Lahore", "State Life Society Lahore", "Paragon City Lahore", "Eden Lahore",
               "DHA Lahore Phase 6", "Bahria Town Lahore", "LDA Avenue Lahore", "Askari 11 Lahore", "Gulberg Lahore", "Park View City Lahore"],
    "karachi": ["Karachi", "Gulshan-e-Iqbal Karachi", "Gulistan-e-Jauhar Karachi", "Bahria Town Karachi", "DHA Karachi",
                "Scheme 33 Karachi", "North Nazimabad Karachi", "Malir Karachi", "Saadi Town Karachi", "Clifton Karachi"],
    "rawalpindi": ["Rawalpindi", "Bahria Town Rawalpindi", "Gulraiz Rawalpindi", "Chaklala Scheme 3", "Adiala Road Rawalpindi", "DHA Rawalpindi"],
    "other": ["Faisalabad", "Multan", "Peshawar", "Quetta", "Gujranwala", "Sialkot", "Sargodha", "Bahawalpur", "Hyderabad Sindh",
              "Abbottabad", "Sheikhupura", "Jhelum", "Gujrat", "Sahiwal", "Mardan", "Nowshera", "Kasur", "Okara"],
}
HOUSE_TYPES = ["3 bedroom", "4 bedroom", "5 bedroom", "with basement", "with shop", "corner plot", "double storey", "triple storey",
               "single storey", "modern", "with courtyard", "narrow plot", "with servant quarter", "with garage", "with lawn",
               "duplex", "rental portion", "with separate gate for portion", "north facing", "west facing"]
URDU = ["گھر کا نقشہ", "مکان کا نقشہ", "نقشہ جات مرلہ", "پانچ مرلہ گھر کا نقشہ", "دس مرلہ مکان کا نقشہ", "ایک کنال کا نقشہ",
        "سات مرلہ گھر کا نقشہ", "تین مرلہ گھر کا نقشہ", "ڈبل سٹوری گھر کا نقشہ", "کارنر پلاٹ نقشہ"]

_lock = threading.Lock()
_urls = {}


class LoggingDownloader(ImageDownloader):
    def download(self, task, default_ext, timeout=8, max_retry=1, overwrite=False, **kwargs):
        # fail fast on dead/blocked image hosts instead of retrying 3x with long timeouts
        try:
            return super().download(task, default_ext, timeout=timeout, max_retry=max_retry, overwrite=overwrite, **kwargs)
        except Exception:  # e.g. PIL DecompressionBombError on a huge image: skip it, keep the thread alive
            return False

    def process_meta(self, task):
        with _lock:
            _urls[(str(self.storage.root_dir), task["filename"])] = task["file_url"]


def slug(t):
    return "".join(c if c.isalnum() else "_" for c in t.lower()).strip("_")[:40]


def size_queries(sizes, quick):
    qs = []
    for n in sizes:
        s, g = SIZES[n], f"{n}_marla"
        qs += [(g, t.format(s=s)) for t in (GENERIC[:3] if quick else GENERIC)]
        qs += [(g, PLACE_TPL.format(s=s, p=p)) for p in (PLACES[:3] if quick else PLACES)]
    return qs


def discover_queries(quick):
    qs = []
    for d in DIMS[:4] if quick else DIMS:
        qs += [(f"ft_{d}", t.format(d=d)) for t in DIM_TPL]
    for grp, areas in AREAS.items():
        for a in areas[:2] if quick else areas:
            qs += [(f"area_{grp}", t.format(a=a)) for t in (CITY_TPL[:2] if quick else CITY_TPL)]
    for t in HOUSE_TYPES[:3] if quick else HOUSE_TYPES:
        qs += [(f"type_{slug(t)}", f"{t} house plan pakistan"), (f"type_{slug(t)}", f"{t} naqsha floor plan marla")]
    qs += [("urdu", q) for q in (URDU[:2] if quick else URDU)]
    return qs


def crawl(g, q, per_query):
    stage = STAGE / (slug(q) + "_" + slug(g))
    shutil.rmtree(stage, ignore_errors=True)
    c = BingImageCrawler(downloader_cls=LoggingDownloader, storage={"root_dir": str(stage)},
                         feeder_threads=1, parser_threads=2, downloader_threads=2, log_level=50)
    c.crawl(keyword=q, max_num=per_query, min_size=(500, 500))
    return g, q, stage


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-query", type=int, default=60)
    ap.add_argument("--workers", type=int, default=3, help="parallel queries; more than ~4 triggers host rate limits")
    ap.add_argument("--sizes", type=int, nargs="*", default=list(SIZES))
    ap.add_argument("--discover", action="store_true", help="search by area/society/feet dimensions/house type/Urdu")
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)

    known, seen_urls = [], set()  # global dedupe across every group
    if MANIFEST.exists():
        for l in MANIFEST.read_text(encoding="utf-8").splitlines():
            if l:
                r = json.loads(l)
                known.append(int(r["phash"], 16))
                if r.get("url"):
                    seen_urls.add(r["url"])

    queries = discover_queries(a.quick) if a.discover else size_queries(a.sizes, a.quick)
    print(f"{len(queries)} queries, {a.workers} parallel, {len(known)} images already known", flush=True)
    total = dup = 0
    with ThreadPoolExecutor(a.workers) as ex, MANIFEST.open("a", encoding="utf-8") as man:
        futs = [ex.submit(crawl, g, q, a.per_query) for g, q in queries]
        for fu in as_completed(futs):
            try:
                g, q, stage = fu.result()
            except Exception as e:
                print("failed:", e)
                continue
            kept = 0
            dest_dir = RAW / g
            dest_dir.mkdir(exist_ok=True)
            for f in sorted(stage.glob("*")):
                url = _urls.get((str(stage), f.name))
                if url in seen_urls:
                    dup += 1
                    continue
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
                    dup += 1
                    continue
                dest = dest_dir / f"{ph}{f.suffix.lower()}"
                try:
                    shutil.move(str(f), dest)  # file handle is closed above (required on Windows)
                except OSError:
                    continue
                known.append(v)
                if url:
                    seen_urls.add(url)
                size = int(g.split("_")[0]) if g.endswith("_marla") else None
                man.write(json.dumps({"file": str(dest.relative_to(ROOT)), "phash": str(ph), "size": size, "group": g,
                                      "query": q, "url": url, "w": w, "h": h}) + "\n")
                kept += 1
            man.flush()
            total += kept
            shutil.rmtree(stage, ignore_errors=True)
            print(f"[{total:5d} new, {dup} dup] {g} | {q}: +{kept}", flush=True)
    print("done; total new:", total, "duplicates skipped:", dup)


if __name__ == "__main__":
    main()
