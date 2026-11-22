"""CubiCasa5k plan image + SVG -> a (256 x 256 image, 256 x 256 class mask) pair for training the plan reader (ml/planreader.py).

    python real/cubicasa_masks.py <cubicasa5k.zip or folder> --out data/planreader --workers 4
Official split (train.txt 4,199 / val.txt 399 / test.txt 399 plans) is kept. The image is F1_original.png, letterboxed (longest side
256, white padding, no stretching); the mask is drawn from the SVG polygons with the same transform:
  0 background   1 wall   2 door / window   3 outdoor   4 kitchen   5 living / dining   6 bedroom   7 bathroom   8 hall / entrance
  9 storage      10 other room (garage, undefined, library ...)
Rooms are painted first, then walls, then doors and windows on top.
"""
import argparse, io, re, sys, zipfile
import xml.etree.ElementTree as ET
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SIZE = 256
NAMES = ["background", "wall", "door/window", "outdoor", "kitchen", "living/dining", "bedroom", "bathroom", "hall/entrance", "storage", "other room"]
ROOM = {"Outdoor": 3, "Kitchen": 4, "LivingRoom": 5, "Dining": 5, "Bedroom": 6, "Bath": 7, "Sauna": 7, "Entry": 8, "DraughtLobby": 8, "Hall": 8,
        "Storage": 9, "Closet": 9}


def _polys(g):
    """The group's own polygons (not those of nested groups: those are icons and dimension marks)."""
    out = []
    for p in list(g):
        if not p.tag.endswith("polygon"): continue
        pts = re.findall(r"(-?\d+(?:\.\d+)?)[, ]+(-?\d+(?:\.\d+)?)", p.get("points") or "")
        if len(pts) >= 3: out.append([(float(a), float(b)) for a, b in pts])
    return out


def make(img_bytes, svg_text, size=SIZE):
    """-> (image uint8 [size, size, 3], mask uint8 [size, size])."""
    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    root = ET.fromstring(svg_text)
    vb = [float(v) for v in root.get("viewBox").split()]
    sw, sh = vb[2], vb[3]
    iw, ih = im.size
    k = size / max(iw, ih)                                           # letterbox: same scale on both axes
    nw, nh = max(1, round(iw * k)), max(1, round(ih * k))
    ox, oy = (size - nw) // 2, (size - nh) // 2
    canvas = Image.new("RGB", (size, size), (255, 255, 255))
    canvas.paste(im.resize((nw, nh), Image.BILINEAR), (ox, oy))
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    fx, fy = nw / sw, nh / sh                                        # svg units -> letterboxed pixels

    def fill(g, v):
        for pts in _polys(g): draw.polygon([(ox + x * fx, oy + y * fy) for x, y in pts], fill=v)

    groups = {"room": [], "wall": [], "open": []}
    for g in root.iter():
        c = g.get("class") or ""
        m = re.match(r"Space\s+(\w+)", c)
        if m: groups["room"].append((g, ROOM.get(m[1], 10)))
        elif c.split(" ")[0] == "Wall": groups["wall"].append((g, 1))
        elif c.split(" ")[0] in ("Door", "Window"): groups["open"].append((g, 2))
    for kind in ("room", "wall", "open"):
        for g, v in groups[kind]: fill(g, v)
    return np.asarray(canvas, dtype=np.uint8), np.asarray(mask, dtype=np.uint8)


def _work(args):
    zpath, names = args
    z = zipfile.ZipFile(zpath)
    out = []
    for folder in names:
        base = "cubicasa5k" + folder.rstrip("/") + "/"
        try:
            out.append(make(z.read(base + "F1_original.png"), z.read(base + "model.svg").decode("utf-8")))
        except Exception:
            out.append(None)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("--out", default="data/planreader")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    z = zipfile.ZipFile(a.zip)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val", "test"):
        names = [l.strip() for l in z.read(f"cubicasa5k/{split}.txt").decode().splitlines() if l.strip()][: a.limit]
        chunks = [names[i::a.workers] for i in range(a.workers)]
        with Pool(a.workers) as p: parts = p.map(_work, [(a.zip, c) for c in chunks])
        res = [None] * len(names)
        for w, part in enumerate(parts):
            for j, r in enumerate(part): res[w + j * a.workers] = r
        ok = [r for r in res if r is not None]
        np.savez_compressed(out / f"{split}.npz", x=np.stack([r[0] for r in ok]), y=np.stack([r[1] for r in ok]))
        print(split, len(ok), "of", len(names), flush=True)


if __name__ == "__main__":
    main()
