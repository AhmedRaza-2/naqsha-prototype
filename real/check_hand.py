"""Check one hand transcription (real/hand/<id>.json, see real/TRANSCRIBE.md) and draw it.

    python real/check_hand.py <id> [<id> ...]
Prints whether it assembles, how much it had to be stretched to fit the plot, the share of OCR'd printed sizes it
reproduces, and the rule check; draws real/hand/render/<id>.png (road at the bottom) to compare with the image.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools")); sys.path.insert(0, str(ROOT / "real"))
import bands  # noqa: E402
from assemble import assemble  # noqa: E402
from build_real import agreement  # noqa: E402
from render_plan import render, COL  # noqa: E402

HAND = ROOT / "real/hand"
COL.setdefault("terrace", "#d8ecc8")
_labels = None


def labels(pid):
    global _labels
    if _labels is None:
        _labels = {c["id"]: c.get("labels", []) for c in map(json.loads, open(ROOT / "real/candidates.jsonl", encoding="utf-8"))}
    return _labels.get(pid, [])


def check(pid):
    path = HAND / f"{pid}.json"
    try:
        js = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return f"{pid}: cannot read the JSON ({e})"
    if js.get("skip"): return f"{pid}: skipped ({js['skip']})"
    out = []
    for key in ("rooms", "first_floor"):
        rooms = js.get(key)
        if not rooms: continue
        try:
            plan, info = assemble(rooms)
        except Exception as e:
            out.append(f"{key}: FAILED to assemble ({e})"); continue
        if plan is None:
            out.append(f"{key}: FAILED ({info})"); continue
        W, D = plan["plot"]["w"], plan["plot"]["d"]
        sw = [sum(float(r["w"]) for r in row) for row in rooms["rows"]]
        msg = [f"{key}: {W:g}x{D:g}, {len(plan['bands'])} rows, beds {plan['beds']}, baths {plan['baths']}, stretch {info['stretch']:.0%}"]
        bad_rows = [i + 1 for i, s in enumerate(sw) if abs(s / W - 1) > 0.15]
        if bad_rows: msg.append(f"rows {bad_rows} add up to {[sw[i - 1] for i in bad_rows]} ft across (plot is {W:g})")
        if key == "rooms":
            ag, n = agreement(rooms, labels(pid))
            msg.append(f"agreement with {n} OCR'd sizes: {ag:.0%}" if ag is not None else "no OCR'd sizes to compare")
            cs = bands.check(plan)
            errs = [c[1] for c in cs if c[0] == "err"]
            msg.append(f"rules: {'design errors ' + str(errs) if errs else 'score ' + format(bands.score(cs), '.2f')} (fine either way)")
        (HAND / "render").mkdir(parents=True, exist_ok=True)
        rects = [dict(r, type=r["t"], name=r["t"]) for r in bands.to_rects(plan) if r["t"] != "void"]
        f = HAND / "render" / (f"{pid}.png" if key == "rooms" else f"{pid}_first.png")
        render({"plot": plan["plot"], "rooms": rects}, f, px_h=520)
        msg.append(f"drawn: {f.relative_to(ROOT)}")
        out.append(" | ".join(msg))
    return f"{pid}: " + ("\n   ".join(out) if out else "no rooms")


if __name__ == "__main__":
    for pid in sys.argv[1:]:
        print(check(pid))
