"""Rescue images left in data/_staging by interrupted crawls: apply the same size filter + global
near-duplicate check as collect.py, move survivors into data/raw/<group>/ and append them to manifest.jsonl.

    python tools/ingest_staging.py
After it finishes, data/_staging is empty and can be deleted.
"""
import json, re, shutil
from pathlib import Path
from PIL import Image
import imagehash

ROOT = Path(__file__).resolve().parent.parent / "data"
STAGE, RAW, MANIFEST = ROOT / "_staging", ROOT / "raw", ROOT / "manifest.jsonl"
Image.MAX_IMAGE_PIXELS = 120_000_000


def group_of(name):
    m = re.match(r"(\d+)_marla", name)
    if m:
        return f"{m.group(1)}_marla", int(m.group(1))
    return "rescued", None


def main():
    known = []
    for l in MANIFEST.read_text(encoding="utf-8").splitlines():
        if l:
            known.append(int(json.loads(l)["phash"], 16))
    kept = dup = bad = 0
    with MANIFEST.open("a", encoding="utf-8") as man:
        for d in sorted(p for p in STAGE.glob("*") if p.is_dir()):
            g, size = group_of(d.name)
            (RAW / g).mkdir(parents=True, exist_ok=True)
            for f in sorted(d.glob("*")):
                try:
                    with Image.open(f) as im:
                        w, h = im.size
                        if min(w, h) < 500 or not (0.35 < w / h < 2.6):
                            bad += 1
                            continue
                        ph = imagehash.phash(im.convert("RGB"))
                except Exception:
                    bad += 1
                    continue
                v = int(str(ph), 16)
                if any(bin(v ^ k).count("1") <= 5 for k in known):
                    dup += 1
                    continue
                dest = RAW / g / f"{ph}{f.suffix.lower()}"
                try:
                    shutil.move(str(f), dest)
                except OSError:
                    continue
                known.append(v)
                man.write(json.dumps({"file": str(dest.relative_to(ROOT)), "phash": str(ph), "size": size, "group": g,
                                      "query": d.name.replace("_", " "), "url": None, "w": w, "h": h}) + "\n")
                kept += 1
    shutil.rmtree(STAGE, ignore_errors=True)
    print(f"rescued {kept}, duplicates {dup}, unusable {bad}; _staging removed")


if __name__ == "__main__":
    main()
