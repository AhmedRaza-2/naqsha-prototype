"""Room sizes read from the real Pakistani plans (OCR text of the clean set), compared with the synthetic training plans.

    python tools/real_stats.py                 # prints a table and writes data/real_stats.json
Method: in the OCR text a room label is usually followed by its printed size ("BED", "10-0\"X14'-0\""). We pair each label
with the next size, keep sizes that are plausible for that room type, and take the plot size from the printed 'Size' line
(or the marla in the search group). OCR is noisy, so this is a statistical check, not an exact annotation.
"""
import json, re, statistics as st, sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands  # noqa: E402

LABELS = [  # (regex on the label text, canonical type)
    (r"master", "master"), (r"bed", "bed"), (r"bath|toilet|w\.?c\b|washroom|lav|ensuite|dress", None),   # baths handled below
    (r"kitchen|kitchn|kich|\bhen\b", "kitchen"), (r"tv|lounge|lounge|hall|family|living", "lounge"),
    (r"drawing|draw|guest|drg", "drawing"), (r"dining|dinng|dinning", "dining"),
]
# feet-inches pair such as 10-0"X14'-0"  13'-6"x12'-0"  14-0*-/6-0-   (OCR turns quotes into * ° ~ - /)
NUM = r"(\d{1,2})\s*['’`´\-]\s*(\d{1,2})?"
DIM = re.compile(NUM + r"[\"”°*~'’`´\-]*\s*[xX×*/]+\s*[\"”°*~'’`´\-/]*\s*" + NUM)
PLOT = re.compile(r"(\d{2,3})\s*['’`´\-]\s*(?:\d{1,2})?[\"”°*~]*\s*[xX×]\s*(\d{2,3})\s*['’`´\-]")


def label_type(text):
    t = text.lower()
    if re.search(r"bath|toilet|washroom|\bw\.?c\b|lavat", t): return "bath"
    if re.search(r"dress|store|servant|stair|lobby|porch|lawn|garage|terrace|passage|corridor", t): return None
    for rx, ty in LABELS:
        if ty and re.search(rx, t): return ty
    return None


def feet(f, i):
    return int(f) + (int(i) if i else 0) / 12


def pairs(texts):
    out = []
    for k, line in enumerate(texts):
        ty = label_type(line)
        if not ty: continue
        for nxt in texts[k + 1:k + 3]:                              # size is on the same or the next line
            m = DIM.search(nxt) or DIM.search(line)
            if m:
                a, b = feet(m[1], m[2]), feet(m[3], m[4])
                out.append((ty, a, b))
                break
    return out


PLAUSIBLE = {"master": (9, 22), "bed": (8, 20), "bath": (3, 12), "kitchen": (6, 18), "lounge": (9, 30), "drawing": (9, 28), "dining": (7, 22)}


def real_rooms():
    rows = [json.loads(l) for l in open(ROOT / "data/clean/metadata.jsonl", encoding="utf-8")]
    rooms = defaultdict(list)                                       # (marla class, type) -> [(w, d)]
    used = 0
    for r in rows:
        texts = r.get("ocr_text", [])
        plot = None
        for t in texts:
            m = PLOT.search(t)
            if m and 15 <= int(m[1]) <= 120 and 25 <= int(m[2]) <= 250:
                plot = (int(m[1]), int(m[2])); break
        marla = plot[0] * plot[1] / 225 if plot else r.get("plot_marla")
        if not marla: continue
        cls = "small<=6" if marla <= 6 else "mid 6-14" if marla <= 14 else "large>14"
        got = 0
        for ty, a, b in pairs(texts):
            lo, hi = PLAUSIBLE[ty]
            w, d = sorted((a, b))
            if lo <= d <= hi and 3 <= w <= hi:                        # w = short side, d = long side
                rooms[(cls, ty)].append((w, d)); got += 1
        used += got > 0
    return rooms, used, len(rows)


def synth_rooms(path="data/synth/train.jsonl", limit=8000):
    rooms = defaultdict(list)
    for i, l in enumerate(open(ROOT / path, encoding="utf-8")):
        if i >= limit: break
        r = json.loads(l)
        p = bands.parse(r["prompt"] + "\n" + r["completion"])
        marla = p["plot"]["w"] * p["plot"]["d"] / 225
        cls = "small<=6" if marla <= 6 else "mid 6-14" if marla <= 14 else "large>14"
        for x in bands.to_rects(p):
            ty = {"master": "master", "bed": "bed", "bath": "bath", "kitchen": "kitchen", "lounge": "lounge", "drawing": "drawing", "dining": "dining"}.get(x["t"])
            if ty: rooms[(cls, ty)].append(tuple(sorted((x["w"], x["d"]))))
    return rooms


def med(v, k): return st.median([a[k] for a in v])


def main():
    real, used, total = real_rooms()
    syn = synth_rooms(sys.argv[1] if len(sys.argv) > 1 else "data/synth/train.jsonl")
    print(f"plans with at least one readable room size: {used} of {total}\n")
    print(f"{'size class':10s} {'room':8s} {'real n':>6s} {'real short x long (ft, median)':>32s} {'synthetic':>16s}")
    table = {}
    for cls in ("small<=6", "mid 6-14", "large>14"):
        for ty in ("master", "bed", "bath", "kitchen", "lounge", "drawing", "dining"):
            rv, sv = real.get((cls, ty), []), syn.get((cls, ty), [])
            if len(rv) < 5: continue
            rw, rd = med(rv, 0), med(rv, 1)
            sw, sd = (med(sv, 0), med(sv, 1)) if sv else (float("nan"),) * 2
            table[f"{cls}/{ty}"] = {"real_n": len(rv), "real_w": rw, "real_d": rd, "synth_w": sw, "synth_d": sd}
            flag = "" if not sv else ("  <-- synthetic is smaller" if rw * rd > 1.2 * sw * sd else "  <-- synthetic is bigger" if rw * rd < 0.8 * sw * sd else "")
            print(f"{cls:10s} {ty:8s} {len(rv):>6d} {rw:>14.1f} x {rd:<14.1f} {sw:>6.1f} x {sd:<6.1f}{flag}")
    (ROOT / "data/real_stats.json").write_text(json.dumps({"plans_used": used, "plans_total": total, "table": table}, indent=1))
    print("\nwrote data/real_stats.json")


if __name__ == "__main__":
    main()
