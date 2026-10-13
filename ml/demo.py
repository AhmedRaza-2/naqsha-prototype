"""Text -> labeled 2D house plans, using the trained layout model (or the rule-based generator when no checkpoint is given).

    python ml/demo.py "10 marla 3 bed" --ckpt runs/rl/model.pt
    python ml/demo.py "30x60 4 bedrooms" --ckpt runs/sft/model.pt --candidates 32 --top 3
    python ml/demo.py "7 marla 3 bed"                         # no checkpoint: rule-based generator (for testing the pipeline)
Writes out/<prompt>_1.png ... showing every room labeled, with its dimensions in feet-inches.
"""
import argparse, random, re, sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402
bands = L.bands

NAMES = {"master": "Master Bedroom", "bed": "Bedroom", "bath": "Bath", "kitchen": "Kitchen", "lounge": "TV Lounge / Living",
         "drawing": "Drawing Room", "dining": "Dining", "lobby": "Entrance Lobby", "lawn": "Front Lawn", "void": "",
         "courtyard": "Courtyard", "porch": "Car Porch", "stairs": "Stairs", "store": "Store", "passage": "Passage",
         "prayer": "Prayer Room", "study": "Study", "servant": "Servant Room", "dress": "Dressing", "garage": "Garage",
         "balcony": "Balcony", "other": "Room"}
COLORS = {"master": "#d9cdf0", "bed": "#e7e0f4", "bath": "#c9e5ee", "kitchen": "#f7dccd", "lounge": "#dfeedb", "drawing": "#f6e7c8",
          "dining": "#dce8f4", "lobby": "#ececec", "lawn": "#cfe8b8", "courtyard": "#d8ecc8", "void": "#f7f7f7"}

# standard plot dimensions (ft) for common marla sizes, 1 marla = 225 sq ft as in the web app
STD = {3: (20, 34), 4: (25, 36), 5: (25, 45), 6: (30, 45), 7: (30, 52), 8: (35, 58), 10: (35, 65), 12: (40, 68), 14: (40, 80),
       20: (50, 90)}


def parse_request(text):
    """'10 marla 3 bed' / '1 kanal 4 bedrooms' / '30x60 3 bed' -> (W, D, beds). Plain regexes, no external service."""
    t = text.lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)", t)
    if m:
        W, D = float(m[1]), float(m[2])
    else:
        m = re.search(r"(\d+(?:\.\d+)?)\s*(marla|kanal)", t)
        if not m:
            raise ValueError("could not find a plot size, e.g. '10 marla' or '30x60'")
        marla = float(m[1]) * (20 if m[2] == "kanal" else 1)
        key = min(STD, key=lambda k: abs(k - marla))
        W, D = STD[key] if abs(key - marla) < 0.01 else (STD[key][0], round(marla * 225 / STD[key][0]))
    b = re.search(r"(\d+)\s*(?:bed|br|bedroom)", t)
    beds = int(b[1]) if b else 3
    return int(W) if W == int(W) else W, int(D) if D == int(D) else D, beds


def ftin(v):
    ft = int(v)
    inch = round((v - ft) * 12)
    if inch == 12: ft, inch = ft + 1, 0
    return f"{ft}'-{inch}\""


def render(plan, out, title="", px_h=900):
    W, D = plan["plot"]["w"], plan["plot"]["d"]
    s, mg = px_h / D, 40
    im = Image.new("RGB", (int(W * s) + 2 * mg, int(D * s) + 2 * mg + 30), "white")
    d = ImageDraw.Draw(im)
    try:
        f, fb = ImageFont.truetype("arial.ttf", 13), ImageFont.truetype("arialbd.ttf", 13)
    except Exception:
        f = fb = ImageFont.load_default()
    X, Y = (lambda x: mg + x * s), (lambda y: mg + 30 + (D - y) * s)           # road at the bottom
    d.text((mg, 10), title or f"Plot {W:g} x {D:g} ft", fill="black", font=fb)
    d.rectangle([X(0), Y(D), X(W), Y(0)], outline="black", width=3)
    for r in sorted(bands.to_rects(plan), key=lambda r: r["t"] == "bath"):
        if r["t"] == "void":
            continue
        d.rectangle([X(r["x"]), Y(r["y"] + r["d"]), X(r["x"] + r["w"]), Y(r["y"])], fill=COLORS.get(r["t"], "#eee"), outline="#222", width=2 if r["t"] != "bath" else 1)
        name = NAMES.get(r["t"], r["t"])
        if r["t"] == "bath" and r.get("parent") is not None: name = "Bath"
        label = f"{name}\n{ftin(r['w'])} x {ftin(r['d'])}"
        wpx = r["w"] * s
        if wpx < 70: label = f"{name.split()[0]}\n{r['w']:g}x{r['d']:g}"       # small rooms: short label
        lines = label.count("\n") + 1
        top = Y(r["y"] + r["d"]) + 4 if r["t"] == "bath" else Y(r["y"]) - 16 * lines - 3     # room names at the road side, clear of the bath
        d.multiline_text((X(r["x"]) + 5, top), label, fill="black", font=f if r["t"] == "bath" else fb, spacing=2)
    d.text((mg, im.height - 22), "ROAD (front) - plan is indicative, not a drawing for approval", fill="gray", font=f)
    im.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("request")
    ap.add_argument("--ckpt", default=None, help="trained model; omit to use the rule-based generator")
    ap.add_argument("--candidates", type=int, default=24, help="plans sampled; the best by rule score are shown")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--temp", type=float, default=0.8)
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    W, D, beds = parse_request(a.request)
    prompt = bands.prompt_for(W, D, beds)
    print("request ->", prompt)
    cands = []
    if a.ckpt:
        if not Path(a.ckpt).exists():
            sys.exit(f"checkpoint {a.ckpt} not found - train first (see ml/KAGGLE.md) and put model.pt there, "
                     "or run without --ckpt to use the rule-based generator.")
        model = L.load(a.ckpt).eval()
        for ids in model.sample([prompt] * a.candidates, temperature=a.temp):
            r, failed = L.reward(prompt, ids)
            if r > 0:
                cands.append((r, bands.parse(L.ids_to_plan_text(prompt, ids)), failed))
    else:
        rng = random.Random(0)
        for _ in range(a.candidates * 4):
            p = bands.generate(W, D, beds, rng)
            if p and p["beds"] == beds:
                cs = bands.check(p, beds)
                cands.append((bands.score(cs), p, bands.failed(cs)))
    uniq, seen = [], set()
    for r, p, failed in sorted(cands, key=lambda c: -c[0]):
        k = bands.serialize(p)
        if k not in seen: seen.add(k); uniq.append((r, p, failed))
    if not uniq:
        print("no valid plan found (try more --candidates, or this plot cannot hold that many bedrooms on one floor)")
        return
    out = Path(a.out); out.mkdir(exist_ok=True)
    slug = re.sub(r"\W+", "_", a.request.strip())
    for i, (r, p, failed) in enumerate(uniq[:a.top], 1):
        f = out / f"{slug}_{i}.png"
        render(p, f, f"Plan {i}: {W:g} x {D:g} ft, {beds} bed  |  rule score {r:.2f}" + (f"  |  not met: {', '.join(failed)}" if failed else ""))
        print(f"plan {i}: score {r:.2f} {failed or ''} -> {f}")


if __name__ == "__main__":
    main()
