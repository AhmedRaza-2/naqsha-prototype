"""Render canonical plan JSON to a PNG (road at the bottom) so annotations can be eyeballed against the source image.

    python tools/render_plan.py data/gold/annotations/G01.json [more.json ...]   -> data/gold/render/<id>.png
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw

COL = {"bed": "#e7e0f4", "bath": "#c9e5ee", "kitchen": "#f7dccd", "lounge": "#dfeedb", "drawing": "#f6e7c8", "dining": "#dce8f4",
       "porch": "#d9d6cc", "lawn": "#cfe8b8", "stairs": "#e9e9e9", "store": "#e6e2d6", "lobby": "#ececec", "courtyard": "#d8ecc8",
       "garage": "#d9d6cc", "balcony": "#d8ecc8", "passage": "#f2f2f2", "prayer": "#f1ecd2", "study": "#e8e8f8",
       "servant": "#ece0d6", "dress": "#efe3f0", "other": "#f0f0f0"}


def render(plan, out, px_h=900):
    W, D = plan["plot"]["w"], plan["plot"]["d"]
    s = px_h / D
    m = 20
    im = Image.new("RGB", (int(W * s) + 2 * m, int(D * s) + 2 * m), "white")
    d = ImageDraw.Draw(im)
    X = lambda x: m + x * s
    Y = lambda y: m + (D - y) * s
    d.rectangle([X(0), Y(D), X(W), Y(0)], outline="black", width=2)
    for r in sorted(plan["rooms"], key=lambda r: -r["w"] * r["d"]):
        d.rectangle([X(r["x"]), Y(r["y"] + r["d"]), X(r["x"] + r["w"]), Y(r["y"])], fill=COL.get(r["type"], "#eee"), outline="#333", width=1)
        d.text((X(r["x"]) + 3, Y(r["y"] + r["d"]) + 3), f"{r['name']}\n{r['w']:g}x{r['d']:g}", fill="black")
    d.text((m, im.height - 14), f"ROAD  |  {W}x{D} ft", fill="gray")
    im.save(out)


if __name__ == "__main__":
    out = Path("data/gold/render")
    out.mkdir(parents=True, exist_ok=True)
    for f in sys.argv[1:]:
        p = json.loads(Path(f).read_text(encoding="utf-8"))
        render(p, out / f"{p['id']}.png")
        print("rendered", p["id"])
